-- Customer Portal: align with the shared customer_portal_users table.
--
-- customer_portal_users / customer_portal_invitations were first created by
-- 20260910000030_shipper_portal_tables_and_rls (Shipper and RAC portals).
-- 20261127100000_customer_portal used CREATE TABLE IF NOT EXISTS, so on any
-- database that already had them (production included) its columns were
-- never added. This brings every database to the same shape:
--
--   * phone, session_version, invited_by_user_id exist on every database
--   * FSM portal users carry FSM_-prefixed roles (FSM_ADMIN / FSM_REQUESTER /
--     FSM_VIEWER) so the Shipper and RAC portals can tell them apart
--
-- Additive only; no columns are dropped. Rows created by the short-lived
-- Phase 2 shape (role ADMIN / REQUESTER / VIEWER, number in `mobile`) are
-- moved to the shared shape.

ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS invited_by_user_id TEXT;

-- The Phase 2 CHECK (ADMIN / REQUESTER / VIEWER) only exists where Phase 2
-- created the table; it would reject the shared table's other roles.
ALTER TABLE customer_portal_users DROP CONSTRAINT IF EXISTS customer_portal_users_role_check;

UPDATE customer_portal_users
   SET role = 'FSM_' || role, updated_at = NOW()
 WHERE role IN ('ADMIN', 'REQUESTER', 'VIEWER');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'customer_portal_users' AND column_name = 'mobile') THEN
    UPDATE customer_portal_users SET phone = mobile WHERE phone IS NULL AND mobile IS NOT NULL;
  END IF;
END $$;
