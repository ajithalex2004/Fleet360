CREATE TABLE public.bus_rider_notification_rules (
 tenant_id TEXT NOT NULL, event_type TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false, channels TEXT[] NOT NULL DEFAULT ARRAY['EMAIL']::TEXT[],
 subject TEXT NOT NULL, body TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,event_type),
 CHECK (channels <@ ARRAY['EMAIL','SMS','WHATSAPP']::TEXT[])
);
CREATE TABLE public.bus_rider_deliveries (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, event_id TEXT NOT NULL, event_type TEXT NOT NULL,
 schedule_id TEXT NOT NULL, passenger_id TEXT NOT NULL, staff_member_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('EMAIL','SMS','WHATSAPP')), recipient TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','RETRY','SENT','BLOCKED','UNCERTAIN','FAILED','SUPPRESSED')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL, claim_token TEXT, claimed_at TIMESTAMPTZ,
 provider_id TEXT, last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,event_id,passenger_id,channel)
);
CREATE INDEX bus_rider_deliveries_due ON public.bus_rider_deliveries(tenant_id,status,next_attempt_at);
ALTER TABLE public.bus_rider_notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_rider_notification_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bus_rider_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_rider_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.bus_rider_notification_rules
 USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*')
 WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*');
CREATE POLICY tenant_isolation ON public.bus_rider_deliveries
 USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*')
 WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*');
