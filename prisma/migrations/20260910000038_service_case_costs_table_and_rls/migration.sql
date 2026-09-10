-- Create service_case_costs table migrated from runtime DDL in src/lib/service-tickets/cost-ledger.ts

CREATE TABLE IF NOT EXISTS public.service_case_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  ticket_id UUID NOT NULL,
  cost_type TEXT NOT NULL,
  estimated_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  approved_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  actual_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  currency TEXT NOT NULL DEFAULT 'AED',
  payer_type TEXT NOT NULL DEFAULT 'TENANT',
  vendor_id TEXT,
  vendor_name TEXT,
  invoice_reference TEXT,
  warranty_claim_id TEXT,
  insurance_claim_id TEXT,
  customer_recharge_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_case_costs_tenant_ticket 
  ON public.service_case_costs(tenant_id, ticket_id);

CREATE INDEX IF NOT EXISTS idx_service_case_costs_ticket 
  ON public.service_case_costs(ticket_id);

-- Enable and Force Row Level Security
ALTER TABLE public.service_case_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_case_costs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.service_case_costs;
CREATE POLICY tenant_isolation ON public.service_case_costs
  FOR ALL
  USING (
    (current_setting('app.tenant_id', true) = '*')
    OR (tenant_id = current_setting('app.tenant_id', true))
  )
  WITH CHECK (
    (current_setting('app.tenant_id', true) = '*')
    OR (tenant_id = current_setting('app.tenant_id', true))
  );

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_case_costs TO fleet360_app;
  END IF;
END $do$;