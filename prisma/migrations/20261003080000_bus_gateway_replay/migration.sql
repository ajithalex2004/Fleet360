CREATE TABLE public.bus_gateway_ingest_receipts (
  tenant_id TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, gateway_id, body_hash)
);
CREATE INDEX bus_gateway_receipts_expiry_idx ON public.bus_gateway_ingest_receipts(expires_at);
ALTER TABLE public.bus_gateway_ingest_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_gateway_ingest_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.bus_gateway_ingest_receipts
USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*')
WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*');
