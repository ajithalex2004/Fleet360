-- Alert Engine — extend `alerts` and introduce `alert_rules`.
--
-- Every module publishes `alert.condition_detected` events; the engine
-- consumer looks up an AlertRule by (tenantId, code) and creates an
-- enriched Alert row with SLA / channels / recipients / escalation
-- level pre-resolved. This kills the "every module writes its own
-- alert with its own severity map" pattern that started with
-- /api/bus-ops/incidents.

-- ── extend alerts ─────────────────────────────────────────────────────
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS code               TEXT,
  ADD COLUMN IF NOT EXISTS source_module      TEXT,
  ADD COLUMN IF NOT EXISTS source_event_id    UUID,
  ADD COLUMN IF NOT EXISTS subject_type       TEXT,
  ADD COLUMN IF NOT EXISTS subject_id         TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_key         TEXT,
  ADD COLUMN IF NOT EXISTS channels           TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recipients         TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS context            JSONB,
  ADD COLUMN IF NOT EXISTS acknowledged_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by    TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by        TEXT,
  ADD COLUMN IF NOT EXISTS resolution_note    TEXT,
  ADD COLUMN IF NOT EXISTS sla_ack_due_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_resolve_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_level   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_escalated_at  TIMESTAMPTZ;

-- Dedup guard — partial unique index so an OPEN alert with a given
-- (tenantId, dedupeKey) can only exist once at a time. Resolved /
-- acknowledged alerts don't block a new one from being raised.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open_dedupe
  ON public.alerts (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND resolved_at IS NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_code               ON public.alerts (code);
CREATE INDEX IF NOT EXISTS idx_alerts_source             ON public.alerts (source_module, source_event_id);
CREATE INDEX IF NOT EXISTS idx_alerts_subject            ON public.alerts (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_alerts_sla_ack_due        ON public.alerts (sla_ack_due_at) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_sla_resolve_due    ON public.alerts (sla_resolve_due_at) WHERE resolved_at IS NULL;

-- ── alert_rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id                     TEXT PRIMARY KEY,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ,
  deleted_at             TIMESTAMPTZ,
  tenant_id              TEXT NOT NULL,

  code                   TEXT NOT NULL,   -- condition code (see AlertCondition constants)
  is_enabled             BOOLEAN NOT NULL DEFAULT TRUE,

  default_severity       TEXT NOT NULL DEFAULT 'MEDIUM',  -- LOW | MEDIUM | HIGH | CRITICAL
  default_channels       TEXT[] NOT NULL DEFAULT '{}',    -- PUSH | SMS | WHATSAPP | EMAIL | IN_APP
  recipient_types        TEXT[] NOT NULL DEFAULT '{}',    -- role names (FLEET_MANAGER, OPS_LEAD, DISPATCHER, DRIVER, PASSENGER)
  specific_recipient_ids TEXT[] NOT NULL DEFAULT '{}',    -- user ids for CUSTOM routing

  sla_ack_minutes        INTEGER,          -- time budget to acknowledge; NULL = no SLA
  sla_resolve_minutes    INTEGER,          -- time budget to resolve; NULL = no SLA

  /*
   * escalation_levels shape: JSON array of level configs, applied in order.
   *   [
   *     { "afterMinutes": 10, "channels": ["SMS"],   "recipients": ["OPS_LEAD"] },
   *     { "afterMinutes": 30, "channels": ["EMAIL"], "recipients": ["FLEET_MANAGER"] }
   *   ]
   * The escalation cron reads this and re-notifies at each threshold.
   */
  escalation_levels      JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_tenant_code ON public.alert_rules(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant_id         ON public.alert_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_deleted_at        ON public.alert_rules(deleted_at);

-- RLS mirrors the pattern used across bus_ops_* and spatial.places.
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_rules_tenant_isolation ON public.alert_rules;
CREATE POLICY alert_rules_tenant_isolation ON public.alert_rules
  USING (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));
