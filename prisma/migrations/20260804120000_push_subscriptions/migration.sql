-- Migration: push_subscriptions table for the Staff Transport PWA.
-- Adds the table, RLS policy, and supporting indexes. Applied directly
-- via psycopg2 because prisma migrate deploy is blocked by a pre-existing
-- failed migration (see docs/TENANT_ISOLATION_STANDARD.md).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  revoked_at            TIMESTAMPTZ,
  tenant_id             TEXT,
  staff_member_id       UUID NOT NULL,
  endpoint              TEXT NOT NULL UNIQUE,
  p256dh                TEXT NOT NULL,
  auth                  TEXT NOT NULL,
  user_agent            TEXT,
  opt_in_trip_reminder  BOOLEAN DEFAULT TRUE,
  opt_in_running_late   BOOLEAN DEFAULT TRUE,
  opt_in_delay          BOOLEAN DEFAULT TRUE,
  last_sent_at          TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error_code       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_revoked
  ON push_subscriptions (tenant_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_staff_revoked
  ON push_subscriptions (staff_member_id, revoked_at);

-- RLS — same shape as every tenant-scoped table
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_tenant_isolation ON push_subscriptions;
CREATE POLICY push_subscriptions_tenant_isolation ON push_subscriptions
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );
