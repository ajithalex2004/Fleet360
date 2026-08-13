-- Layer 2.6 cleanup: drop LeaseContract (V1), LeasePayment (V1),
-- and LeaseVehicleReturn. These tables had no live readers or writers
-- across src/ at the time of removal — every leasing code path already
-- migrated to LeaseContract2 + its 18 sibling models.
--
-- IMPORTANT: Before running this migration in production, run the
-- preflight queries in docs/AUDIT_SCHEMA_V1_V2.md to:
--   1. Snapshot row counts (audit value).
--   2. Confirm no remaining FK references INTO V1 tables.
--   3. Decide on LeaseVehicleReturn archive strategy if it has data.
--
-- If you must abort: restoring from a pre-migration backup is the
-- only recovery path. The archive tables in the commented-out
-- section below are an option if you'd like a soft-drop pattern
-- instead — comment the DROP statements and uncomment the archive
-- block.

-- ── Preflight (run first, manual verification) ───────────────────────────────
--
-- SELECT 'lease_contracts' AS tbl, count(*) FROM lease_contracts
-- UNION ALL SELECT 'lease_payments',  count(*) FROM lease_payments
-- UNION ALL SELECT 'lease_vehicle_returns', count(*) FROM lease_vehicle_returns;
--
-- SELECT conname, conrelid::regclass, confrelid::regclass
-- FROM pg_constraint
-- WHERE confrelid IN ('lease_contracts'::regclass,
--                     'lease_payments'::regclass,
--                     'lease_vehicle_returns'::regclass);

-- ── Drop (hard) ─────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS "lease_vehicle_returns";
DROP TABLE IF EXISTS "lease_payments";
DROP TABLE IF EXISTS "lease_contracts";

-- ── Optional soft-drop pattern (uncomment if you prefer to archive) ──────────
--
-- CREATE TABLE "lease_contracts_archive"      AS SELECT * FROM "lease_contracts";
-- CREATE TABLE "lease_payments_archive"       AS SELECT * FROM "lease_payments";
-- CREATE TABLE "lease_vehicle_returns_archive" AS SELECT * FROM "lease_vehicle_returns";
--
-- DROP TABLE IF EXISTS "lease_vehicle_returns";
-- DROP TABLE IF EXISTS "lease_payments";
-- DROP TABLE IF EXISTS "lease_contracts";