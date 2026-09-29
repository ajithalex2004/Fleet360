-- Incident status changes.
-- PATCH /api/incidents/:id writes lifecycle columns operations.incidents
-- never had, so every status change failed, and its fallback ran on the
-- already-failed transaction. incident_notes.incident_id was uuid while
-- incident ids are text, so the automatic status note and loading notes
-- failed too. Adds the columns and makes incident_id text. One statement
-- per line, so the Neon SQL Editor runs it as written; idempotent.

ALTER TABLE IF EXISTS operations.incidents ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS operations.incidents ADD COLUMN IF NOT EXISTS investigation_started_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS operations.incidents ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE IF EXISTS operations.incidents ADD COLUMN IF NOT EXISTS escalation_level TEXT;
ALTER TABLE IF EXISTS operations.incidents ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE IF EXISTS public.incident_notes ALTER COLUMN incident_id TYPE TEXT USING incident_id::text;
