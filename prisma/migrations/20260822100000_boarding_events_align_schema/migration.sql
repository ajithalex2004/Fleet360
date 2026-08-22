-- Migration: 20260822100000_boarding_events_align_schema
--
-- Aligns the boarding_events table with the BoardingEvent model, which
-- declares six columns the database never had:
--
--   updated_at, deleted_at, event_type, source, confidence, device_id
--
-- Prisma emits INSERT ... RETURNING <every model column>, so the missing
-- columns made EVERY BoardingEvent.create() fail with
--
--   The column `updated_at` does not exist in the current database
--
-- That breaks both boarding paths in staff transport, not just one:
--
--   src/app/api/bus-ops/gateway/events/route.ts  (BLE gateway ingest)
--   src/app/api/bus-ops/checkin/route.ts         (QR / NFC / manual)
--
-- In the gateway's case the failure was invisible: the throw was caught
-- into a counter and the handler still answered 200 { ok: true }.
--
-- The two Phase-2 enums are created here too. BoardingEventType and
-- BoardingSource are declared in schema.prisma but no matching Postgres
-- type was ever created, so the columns could not be added without them.
--
-- Additive only — no existing column is altered or dropped, and every
-- new column is nullable, so existing rows and any in-flight readers are
-- unaffected.

-- ── Phase-2 enum types ──────────────────────────────────────────────────────
-- Guarded so a re-run (or a database where these were added by hand) is a
-- no-op rather than an error. CREATE TYPE has no IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'boarding_event_type') THEN
    CREATE TYPE public.boarding_event_type AS ENUM ('BOARDED', 'ALIGHTED', 'NO_SHOW');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'boarding_source') THEN
    CREATE TYPE public.boarding_source AS ENUM ('BLE', 'RFID', 'QR', 'DRIVER', 'MANUAL', 'DISPATCHER');
  END IF;
END $$;

-- ── Missing columns ─────────────────────────────────────────────────────────

ALTER TABLE public.boarding_events
  -- Convention columns present on every other model in this schema.
  -- updated_at is the one that actually broke inserts: the model marks it
  -- @updatedAt, so Prisma writes it on every create.
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ(6),
  -- Phase-2 typed fields, added alongside the legacy method/direction
  -- text columns rather than replacing them. Nothing reads these yet —
  -- they exist because the model declares them, and a model column with
  -- no table column breaks every write to the table.
  ADD COLUMN IF NOT EXISTS event_type public.boarding_event_type,
  ADD COLUMN IF NOT EXISTS source     public.boarding_source,
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS device_id  TEXT;

-- ── Assertion ───────────────────────────────────────────────────────────────
-- Fail loudly rather than leave the same class of drift behind.

DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(c, ', ')
    INTO missing
  FROM unnest(ARRAY[
    'updated_at', 'deleted_at', 'event_type', 'source', 'confidence', 'device_id'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'boarding_events'
      AND column_name  = c
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'boarding_events still missing columns after migration: %', missing;
  END IF;
END $$;
