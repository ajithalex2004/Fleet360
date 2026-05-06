-- Multi-method boarding check-in: QR + NFC/RFID + BLE proximity beacons.
-- Each piece is independent so a tenant can opt in to one method without all.

-- ── BLE beacons mounted on each bus ──────────────────────────────────────
-- Web Bluetooth requires a known service UUID. We register one beacon per
-- vehicle; passengers' Android Chrome PWA scans for it within ~5m and
-- proves proximity by sending the UUID + RSSI to the check-in endpoint.
CREATE TABLE IF NOT EXISTS "vehicle_beacons" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMPTZ  DEFAULT NOW(),
  "vehicle_id"      UUID         NOT NULL UNIQUE,
  "ble_uuid"        TEXT         NOT NULL,
  "major"           INT,
  "minor"           INT,
  "is_active"       BOOLEAN      DEFAULT TRUE,
  "notes"           TEXT
);
CREATE INDEX IF NOT EXISTS "idx_vehicle_beacons_ble_uuid"
  ON "vehicle_beacons" ("ble_uuid");

-- ── RFID/NFC tags issued to staff ────────────────────────────────────────
-- Web NFC reads tag UID on Android Chrome. iOS Safari does not support Web
-- NFC; iOS staff fall back to displaying their QR on-screen.
CREATE TABLE IF NOT EXISTS "staff_rfid_tags" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMPTZ  DEFAULT NOW(),
  "staff_member_id" UUID         NOT NULL UNIQUE,
  "tag_uid"         TEXT         NOT NULL UNIQUE,
  "issued_at"       TIMESTAMPTZ  DEFAULT NOW(),
  "is_active"       BOOLEAN      DEFAULT TRUE,
  "notes"           TEXT
);

-- ── Boarding events (immutable audit log) ────────────────────────────────
-- One row per check-in or check-out. Source of truth — TripPassenger.status
-- is denormalised from this table.
CREATE TABLE IF NOT EXISTS "boarding_events" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMPTZ  DEFAULT NOW(),
  "schedule_id"     UUID         NOT NULL,
  "passenger_id"    UUID,
  "staff_member_id" UUID,
  "method"          TEXT         NOT NULL,                 -- QR|NFC|BLE|MANUAL
  "direction"       TEXT         NOT NULL DEFAULT 'BOARD', -- BOARD|ALIGHT
  "identifier"      TEXT,
  "stop_id"         UUID,
  "performed_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "performed_by"    TEXT,
  "raw_payload"     JSONB
);
CREATE INDEX IF NOT EXISTS "idx_boarding_events_schedule_id"
  ON "boarding_events" ("schedule_id");
CREATE INDEX IF NOT EXISTS "idx_boarding_events_passenger_id"
  ON "boarding_events" ("passenger_id");
CREATE INDEX IF NOT EXISTS "idx_boarding_events_staff_member_id"
  ON "boarding_events" ("staff_member_id");
