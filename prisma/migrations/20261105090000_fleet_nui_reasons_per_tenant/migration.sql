-- NUI (Not-In-Use) reason codes become per tenant.
--
-- fleet_nui_reasons had no tenant_id and no RLS, and its queries had no
-- tenant filter: every tenant saw one shared list, and any tenant user who
-- could edit fleet settings changed it for every other tenant.
--
-- 1. tenant_id TEXT, defaulting to the session's app.tenant_id (the same
--    pattern as 20261017090000_runtime_module_tables_and_isolation).
-- 2. Each tenant gets its own copy of the shared codes that exist today, so
--    no tenant loses a code it relies on. The shared rows themselves are kept
--    (tenant_id NULL): no tenant can see them, only platform context.
-- 3. One code per tenant (case-insensitive), which also makes the routes'
--    seed-on-first-view safe against two concurrent first requests.
-- 4. The standard tenant_isolation policy with RLS forced.
--
-- Safe to re-run.

-- FORCE RLS binds the migration owner too once step 4 has run once.
SELECT set_config('app.tenant_id', '*', false);

-- ── 1. Tenant column ──
ALTER TABLE public.fleet_nui_reasons ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.fleet_nui_reasons ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');

-- ── 2. Per-tenant copies of today's shared codes ──
INSERT INTO public.fleet_nui_reasons (
  id, tenant_id, code, name, reason_type, description, impact_level,
  is_billable, is_active, notes, created_at, updated_at
)
SELECT gen_random_uuid(), t.id::text, s.code, s.name, s.reason_type, s.description, s.impact_level,
       s.is_billable, s.is_active, s.notes, s.created_at, NOW()
FROM (
  SELECT DISTINCT ON (UPPER(code)) *
  FROM public.fleet_nui_reasons
  WHERE tenant_id IS NULL
  ORDER BY UPPER(code), updated_at DESC
) AS s
CROSS JOIN public.tenants AS t
WHERE NOT EXISTS (
  SELECT 1 FROM public.fleet_nui_reasons AS e
  WHERE e.tenant_id = t.id::text AND UPPER(e.code) = UPPER(s.code)
);

-- ── 3. One code per tenant ──
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnr_tenant_code ON public.fleet_nui_reasons (tenant_id, UPPER(code));

-- ── 4. Tenant isolation ──
ALTER TABLE public.fleet_nui_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_nui_reasons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.fleet_nui_reasons;
CREATE POLICY tenant_isolation ON public.fleet_nui_reasons FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

SELECT set_config('app.tenant_id', '', false);
