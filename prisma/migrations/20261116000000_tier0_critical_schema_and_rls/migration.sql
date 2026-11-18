-- Tier 0 Critical Schema & RLS Hardening (F06, F10)
-- 1. Drop vulnerable set_tenant_context(TEXT) function
DROP FUNCTION IF EXISTS public.set_tenant_context(TEXT);

-- 2. report_schedules: add tenant_id, index, and RLS policy
ALTER TABLE IF EXISTS public.report_schedules ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_report_schedules_tenant ON public.report_schedules(tenant_id);
ALTER TABLE IF EXISTS public.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.report_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.report_schedules;
CREATE POLICY tenant_isolation ON public.report_schedules FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- 3. hos_logs: add tenant_id, index, and RLS policy
ALTER TABLE IF EXISTS public.hos_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hos_logs_tenant ON public.hos_logs(tenant_id);
ALTER TABLE IF EXISTS public.hos_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hos_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.hos_logs;
CREATE POLICY tenant_isolation ON public.hos_logs FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- 4. hos_violations: add tenant_id, index, and RLS policy
ALTER TABLE IF EXISTS public.hos_violations ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hos_violations_tenant ON public.hos_violations(tenant_id);
ALTER TABLE IF EXISTS public.hos_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hos_violations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.hos_violations;
CREATE POLICY tenant_isolation ON public.hos_violations FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- 5. driver_availability: create table if not exists, add missing columns, index, and RLS policy
CREATE TABLE IF NOT EXISTS public.driver_availability (
  driver_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  vehicle_id TEXT,
  service_types JSONB DEFAULT '["PASSENGER"]',
  shift_starts_at TIMESTAMPTZ,
  shift_ends_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.driver_availability ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS public.driver_availability ADD COLUMN IF NOT EXISTS vehicle_id TEXT;
ALTER TABLE IF EXISTS public.driver_availability ADD COLUMN IF NOT EXISTS service_types JSONB DEFAULT '["PASSENGER"]';
ALTER TABLE IF EXISTS public.driver_availability ADD COLUMN IF NOT EXISTS shift_starts_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.driver_availability ADD COLUMN IF NOT EXISTS shift_ends_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.driver_availability ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_driver_availability_tenant ON public.driver_availability(tenant_id);
ALTER TABLE IF EXISTS public.driver_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.driver_availability FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.driver_availability;
CREATE POLICY tenant_isolation ON public.driver_availability FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- 6. dispatch_jobs: add 11 missing DISPATCH_SCHEMA columns
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS origin_lat DECIMAL(10,8);
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS origin_lng DECIMAL(11,8);
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS dest_lat DECIMAL(10,8);
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS dest_lng DECIMAL(11,8);
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS origin_address TEXT;
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS destination_address TEXT;
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS scheduled_pickup TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS passenger_count INT DEFAULT 1;
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS driver_id TEXT;
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS vehicle_id TEXT;
ALTER TABLE IF EXISTS public.dispatch_jobs ADD COLUMN IF NOT EXISTS meta JSONB;
