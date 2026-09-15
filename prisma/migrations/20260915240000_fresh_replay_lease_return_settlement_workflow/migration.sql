-- Closes the "20260911120000" row from issue #77's audit.
--
-- 20260911120000_lease_return_settlement_workflow is already applied on
-- every real environment and is left untouched, same approach as every
-- migration in this series. Every table and column it creates is
-- self-contained except for one block: eight
-- `ALTER TABLE finance_security_deposits ADD COLUMN IF NOT EXISTS ...`
-- statements (reserved_amount, refund_status, refund_requested_amount/by/
-- at, refund_recorded_by/at, refunded_amount). ALTER TABLE requires the
-- table to already exist — unlike CREATE TABLE IF NOT EXISTS, there is no
-- built-in way for it to no-op gracefully.
--
-- finance_security_deposits itself doesn't exist yet at this point in
-- tracked history. It's created by 20260910000016
-- (finance_deposits_recurring_tables_and_rls), whose own CREATE TABLE is
-- separately broken on a fresh replay — a GENERATED ALWAYS AS (... CURRENT_
-- DATE ...) STORED column that Postgres rejects outright as non-immutable —
-- fixed elsewhere in this series by
-- 20260915220000_fresh_replay_finance_deposits_recurring. That fix already
-- includes these exact eight columns directly in the table's recreated
-- shape (pulled verbatim from production, where they already exist) — but
-- it necessarily runs later than this file, dated after every other fix in
-- this series, while 20260911120000 sits earlier in tracked history. Same
-- shape as the bookings/logistics_shipment_orders gap
-- (20260915200000_fresh_replay_bookings_hierarchy_tenant) elsewhere in this
-- series: a later fix supplies what an earlier migration needs.
--
-- Fix: guard the ALTER block on the table's existence. Skipping it here
-- loses nothing — 20260915220000's recreation of finance_security_deposits
-- later in this same chain already includes all eight columns as part of
-- the table's initial shape, so the end state is identical either way, just
-- reached by a different migration. Safe no-op on every real environment,
-- where finance_security_deposits already exists and already has all eight
-- columns.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260911120000_lease_return_settlement_workflow

DO $$
BEGIN
  IF to_regclass('public.finance_security_deposits') IS NULL THEN
    RAISE NOTICE 'SKIP finance_security_deposits refund-lifecycle columns — table does not exist yet; covered later by 20260915220000_fresh_replay_finance_deposits_recurring';
    RETURN;
  END IF;

  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "reserved_amount" NUMERIC(14,2) NOT NULL DEFAULT 0;
  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_status" TEXT;
  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_requested_amount" NUMERIC(14,2);
  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_requested_by" TEXT;
  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_requested_at" TIMESTAMPTZ(6);
  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_recorded_by" TEXT;
  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_recorded_at" TIMESTAMPTZ(6);
  ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refunded_amount" NUMERIC(14,2) NOT NULL DEFAULT 0;
END $$;
