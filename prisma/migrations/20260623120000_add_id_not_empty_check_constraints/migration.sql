-- Layer 3 enforcement for the multi-tenant maintenance domain: the database
-- itself now rejects empty-string primary keys on maintenance_requests and
-- histories. Combined with Layer 1 (explicit uuid.New() in the create
-- handler) and Layer 2 (the Model.BeforeCreate GORM hook), id='' becomes a
-- structural impossibility regardless of which code path attempts the
-- INSERT. The previous "runtime cleanup" subcommand in the Go backend is
-- removed in the same change-set because it has no remaining job to do.
--
-- This migration is the controlled, one-time data-correction migration the
-- enterprise pattern calls for — it deletes any pre-existing bad rows
-- (verified zero in dev at authoring time, but the DELETEs are idempotent
-- and safe to run against any database with accumulated legacy bad data),
-- then installs the constraints that prevent them from coming back.

-- Pre-clean any historical id='' rows so the CHECK constraint can be added.
-- Hard delete, not soft delete: malformed PK rows are unrecoverable garbage
-- regardless of audit trail.
DELETE FROM "maintenance_requests" WHERE "id" = '';
DELETE FROM "histories" WHERE "id" = '';

ALTER TABLE "maintenance_requests"
  ADD CONSTRAINT "chk_maintenance_requests_id_not_empty"
  CHECK ("id" <> '');

ALTER TABLE "histories"
  ADD CONSTRAINT "chk_histories_id_not_empty"
  CHECK ("id" <> '');
