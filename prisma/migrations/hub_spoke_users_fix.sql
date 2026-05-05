-- ============================================================
-- Hub-and-Spoke: User & UserTenant fix migration
-- Prisma creates these tables as "User" and "UserTenant" (quoted, capital)
-- because neither model has a @@map directive.
-- ============================================================

-- ── 1. Add Admin Hub fields to "User" table ───────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN     DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS module_access  JSONB,
  ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ;

-- Back-fill: mark all existing users as active
UPDATE "User" SET is_active = TRUE WHERE is_active IS NULL;

-- ── 2. Add user FK to "UserTenant" if missing ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name  = 'UserTenant'
      AND constraint_name = 'UserTenant_user_id_fkey'
  ) THEN
    ALTER TABLE "UserTenant"
      ADD CONSTRAINT "UserTenant_user_id_fkey"
      FOREIGN KEY (user_id) REFERENCES "User"(id);
  END IF;
END $$;

-- ── Done ──────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE 'User hub fields applied successfully.'; END $$;
