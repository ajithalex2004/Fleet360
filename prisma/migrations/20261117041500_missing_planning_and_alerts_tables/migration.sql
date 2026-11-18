-- Additive sync for remaining schema.prisma tables missing on local fresh-replay DBs:
-- alert_rules, bus_ops_schedule_templates, transport_calendars, transport_calendar_entries,
-- stripe_events_processed, planning_constraints

CREATE TABLE IF NOT EXISTS public.alert_rules (
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6),
  deleted_at TIMESTAMPTZ(6),
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  default_severity TEXT NOT NULL DEFAULT 'MEDIUM',
  default_channels TEXT[],
  recipient_types TEXT[],
  specific_recipient_ids TEXT[],
  sla_ack_minutes INTEGER,
  sla_resolve_minutes INTEGER,
  escalation_levels JSONB,
  CONSTRAINT alert_rules_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant_id ON public.alert_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_deleted_at ON public.alert_rules(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_tenant_code ON public.alert_rules(tenant_id, code);

ALTER TABLE IF EXISTS public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.alert_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.alert_rules;
CREATE POLICY tenant_isolation ON public.alert_rules FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

CREATE TABLE IF NOT EXISTS public.bus_ops_schedule_templates (
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6),
  deleted_at TIMESTAMPTZ(6),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  route_id TEXT NOT NULL,
  vehicle_id TEXT,
  driver_id TEXT,
  week_type TEXT NOT NULL,
  active_days INTEGER[],
  session TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  arrival_time TEXT,
  direction TEXT NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to DATE,
  exception_dates DATE[],
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_by TEXT,
  CONSTRAINT bus_ops_schedule_templates_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_tenant ON public.bus_ops_schedule_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_route ON public.bus_ops_schedule_templates(route_id);
CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_deleted ON public.bus_ops_schedule_templates(deleted_at);
CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_status ON public.bus_ops_schedule_templates(status);

ALTER TABLE IF EXISTS public.bus_ops_schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_ops_schedule_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.bus_ops_schedule_templates;
CREATE POLICY tenant_isolation ON public.bus_ops_schedule_templates FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

CREATE TABLE IF NOT EXISTS public.transport_calendars (
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6),
  deleted_at TIMESTAMPTZ(6),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by TEXT,
  CONSTRAINT transport_calendars_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_transport_calendars_tenant ON public.transport_calendars(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transport_calendars_active ON public.transport_calendars(is_active);
CREATE INDEX IF NOT EXISTS idx_transport_calendars_deleted ON public.transport_calendars(deleted_at);

ALTER TABLE IF EXISTS public.transport_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transport_calendars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transport_calendars;
CREATE POLICY tenant_isolation ON public.transport_calendars FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

CREATE TABLE IF NOT EXISTS public.transport_calendar_entries (
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  calendar_id TEXT NOT NULL,
  entry_date DATE NOT NULL,
  kind TEXT NOT NULL,
  note TEXT,
  CONSTRAINT transport_calendar_entries_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_transport_calendar_entries_calendar ON public.transport_calendar_entries(calendar_id);
CREATE INDEX IF NOT EXISTS idx_transport_calendar_entries_date ON public.transport_calendar_entries(entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transport_calendar_entries_cal_date ON public.transport_calendar_entries(calendar_id, entry_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transport_calendar_entries_calendar_id_fkey'
  ) THEN
    ALTER TABLE public.transport_calendar_entries
      ADD CONSTRAINT transport_calendar_entries_calendar_id_fkey
      FOREIGN KEY (calendar_id) REFERENCES public.transport_calendars(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stripe_events_processed (
  id TEXT NOT NULL,
  stripe_event_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stripe_events_processed_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS stripe_events_processed_stripe_event_id_key
  ON public.stripe_events_processed(stripe_event_id);

CREATE TABLE IF NOT EXISTS public.planning_constraints (
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6),
  deleted_at TIMESTAMPTZ(6),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'BLOCK',
  penalty_score DECIMAL(10,2),
  params JSONB NOT NULL DEFAULT '{}',
  effective_from DATE,
  effective_to DATE,
  reason TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  updated_by TEXT,
  CONSTRAINT planning_constraints_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_planning_constraints_tenant ON public.planning_constraints(tenant_id);
CREATE INDEX IF NOT EXISTS idx_planning_constraints_tenant_kind ON public.planning_constraints(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_planning_constraints_deleted ON public.planning_constraints(deleted_at);
CREATE INDEX IF NOT EXISTS idx_planning_constraints_enabled ON public.planning_constraints(is_enabled);

ALTER TABLE IF EXISTS public.planning_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.planning_constraints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.planning_constraints;
CREATE POLICY tenant_isolation ON public.planning_constraints FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
