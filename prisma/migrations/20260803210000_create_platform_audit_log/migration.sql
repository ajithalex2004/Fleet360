-- =====================================================================
-- platform_audit_log — minimal audit trail for destructive platform
-- actions (tenant hard-delete, user hard-delete, plan mutations, etc.)
-- =====================================================================
--
-- Platform-level — no tenant_id, no RLS. Only SUPER_ADMIN should be
-- able to write; the audit API enforces the role check.
--
-- `metadata` is JSONB so we can capture whatever context the caller has
-- (row counts, dry-run results, IP, request id, etc.) without having
-- to migrate the table every time the shape changes.
--
-- Append-only by convention — there is intentionally no UPDATE or
-- DELETE on this table from the application code.

CREATE TABLE platform_audit_log (
  id                    TEXT PRIMARY KEY,
  action                TEXT NOT NULL,                  -- e.g. 'tenant.hard_delete'
  target_type           TEXT NOT NULL,                  -- e.g. 'tenant', 'user', 'plan'
  target_id             TEXT NOT NULL,
  target_name           TEXT,                            -- human-readable (name / email / etc.)
  performed_by_user_id  TEXT,
  performed_by_email    TEXT,
  dry_run               BOOLEAN NOT NULL DEFAULT false,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_target      ON platform_audit_log (target_type, target_id);
CREATE INDEX idx_audit_log_action_time ON platform_audit_log (action, created_at DESC);
CREATE INDEX idx_audit_log_actor_time  ON platform_audit_log (performed_by_user_id, created_at DESC);
