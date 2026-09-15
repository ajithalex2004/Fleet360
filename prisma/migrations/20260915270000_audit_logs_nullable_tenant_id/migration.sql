-- Closes #83: audit_logs.tenant_id is NOT NULL live, but AuditPayload.tenantId
-- (src/lib/audit.ts) has always been typed optional, and several real call
-- sites legitimately have no tenant to attribute a platform/system-level
-- event to (src/lib/with-audit.ts's `req.headers.get('x-tenant-id') ??
-- undefined`, and the platform-level TransportPartner-creation audit call
-- fixed in #82). Every such call has always failed its INSERT with 23502
-- (not-null violation), caught and swallowed by logAudit's own
-- best-effort try/catch — no functional symptom, just silently missing
-- audit events for every platform-level action, since audit_logs was
-- created.
--
-- No RLS policy change needed alongside this. audit_logs' policies
-- (confirmed against production):
--   tenant_isolation  FOR SELECT USING (app.tenant_id = '*' OR tenant_id = app.tenant_id)
--   audit_insert_only FOR INSERT WITH CHECK (app.tenant_id = '*' OR tenant_id = app.tenant_id)
--   audit_no_updates  FOR UPDATE USING (false)
--   audit_no_deletes  FOR DELETE USING (false)
-- withPlatformAdmin sets app.tenant_id = '*', which already satisfies both
-- the SELECT and INSERT checks regardless of whether tenant_id is NULL or a
-- real value — that's the mechanism logAudit already routes a missing
-- tenantId through. A regular (non-'*') tenant session's WHERE clause
-- (tenant_id = app.tenant_id) still correctly excludes NULL-tenant rows
-- either way — platform-level audit events stay platform-admin-only for
-- reads, the same "unattributable rows are not readable by an ordinary
-- tenant session" shape already used for auth_login_attempts. Only the
-- column constraint was ever the blocker.
--
-- No existing rows to backfill or reconcile: every no-tenantId call has
-- always failed to write at all, so there are zero pre-existing NULL-tenant
-- rows and zero rows with a wrong value to fix.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'audit_logs'
       AND column_name = 'tenant_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.audit_logs ALTER COLUMN tenant_id DROP NOT NULL;
  END IF;
END $$;
