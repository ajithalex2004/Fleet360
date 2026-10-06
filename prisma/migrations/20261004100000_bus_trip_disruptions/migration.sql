CREATE UNIQUE INDEX IF NOT EXISTS trip_schedules_tenant_id_id_key ON public.trip_schedules(tenant_id,id);
CREATE TABLE public.bus_trip_disruptions (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 tenant_id UUID NOT NULL,
 schedule_id TEXT NOT NULL,
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 incident_id UUID NOT NULL,
 reason TEXT NOT NULL,
 location TEXT,
 severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 status TEXT NOT NULL DEFAULT 'REPORTED' CHECK (status IN ('REPORTED','RECOVERED','RESOLVED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 original_vehicle_id TEXT,
 original_driver_id TEXT,
 original_arrival_time TIMESTAMPTZ,
 replacement_vehicle_id TEXT,
 replacement_driver_id TEXT,
 revised_eta TIMESTAMPTZ,
 inspection_id TEXT,
 recovery_notes TEXT,
 resolution_notes TEXT,
 reported_by TEXT NOT NULL,
 recovered_by TEXT,
 resolved_by TEXT,
 reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 recovered_at TIMESTAMPTZ,
 resolved_at TIMESTAMPTZ,
 report_event_id TEXT,
 recovery_event_id TEXT,
 resolution_event_id TEXT,
 CONSTRAINT bus_trip_disruptions_schedule_fkey FOREIGN KEY(tenant_id,schedule_id) REFERENCES public.trip_schedules(tenant_id,id),
 CONSTRAINT bus_trip_disruptions_recovery_check CHECK(status <> 'RECOVERED' OR (replacement_vehicle_id IS NOT NULL AND replacement_driver_id IS NOT NULL AND revised_eta IS NOT NULL AND inspection_id IS NOT NULL AND recovered_at IS NOT NULL)),
 CONSTRAINT bus_trip_disruptions_resolution_check CHECK(status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolution_notes IS NOT NULL)),
 UNIQUE(tenant_id,request_key)
);
CREATE INDEX bus_trip_disruptions_tenant_schedule_reported_idx ON public.bus_trip_disruptions(tenant_id,schedule_id,reported_at);
CREATE UNIQUE INDEX bus_trip_disruptions_one_open ON public.bus_trip_disruptions(tenant_id,schedule_id) WHERE status <> 'RESOLVED';
ALTER TABLE public.bus_trip_disruptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_trip_disruptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.bus_trip_disruptions
 USING (tenant_id::text = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*')
 WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*');
