-- Tables and columns the application expected but production never got.
--
-- The missing-tables check against production found five tables the code
-- uses that do not exist. They were only ever created by code at request
-- time, and the runtime database role (fleet360_app) is not allowed to
-- create or alter tables, so the code could never create them there:
--
--   ble_detections, ble_zone_rules, ble_movement_alerts
--       BLE gateway ingest, zone rules and movement alerts
--       (src/lib/assets/ble-hw-schema.ts).
--   spm_tickets
--       Scheduled preventive maintenance tickets (src/lib/assets/spm-schema.ts).
--       Its definition was also invalid (a unique constraint on an
--       expression), so it failed even where the role could create tables.
--       The rule "one ticket per cycle per day" becomes a unique index on
--       the UTC date.
--   rental_renewals
--       RAC renewal requests (src/app/api/rental/renewals/route.ts).
--
-- The RAC inquiry, quotation and handover tables that do exist were made
-- the same way, without a tenant_id, so they held every company's records
-- together. All four RAC tables get a tenant_id, document numbers unique
-- per company, and row level security.
--
-- The same request-time code also added columns to existing tables. Those
-- additions are made here for every table that exists, so the code can
-- stop attempting them.
--
-- Every new table gets row level security in the project's standard form.
-- Idempotent. Written in the one form the Neon SQL Editor runs whole: plain
-- DO blocks, no named quote tags.

SELECT set_config('app.tenant_id', '*', false);

-- ── 1. BLE tables ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.ble_detections') IS NULL THEN
    CREATE TABLE public.ble_detections (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    TEXT        NOT NULL,
      gateway_id   TEXT        NOT NULL,
      gateway_code TEXT,
      gateway_zone TEXT,
      tag_mac      TEXT        NOT NULL,
      tag_id       TEXT,
      asset_name   TEXT,
      rssi         INT,
      tx_power     INT,
      battery_pct  INT,
      raw_payload  JSONB,
      detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX idx_ble_detections_tenant      ON public.ble_detections (tenant_id);
    CREATE INDEX idx_ble_detections_gateway     ON public.ble_detections (gateway_id);
    CREATE INDEX idx_ble_detections_tag_mac     ON public.ble_detections (tag_mac);
    CREATE INDEX idx_ble_detections_detected_at ON public.ble_detections (detected_at);
  END IF;

  IF to_regclass('public.ble_zone_rules') IS NULL THEN
    CREATE TABLE public.ble_zone_rules (
      id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          TEXT        NOT NULL,
      gateway_id         TEXT        NOT NULL,
      gateway_code       TEXT,
      gateway_zone       TEXT,
      rule_name          TEXT,
      allowed_domains    TEXT[],
      allowed_categories TEXT[],
      alert_on_violation BOOLEAN     DEFAULT TRUE,
      severity           TEXT        NOT NULL DEFAULT 'MEDIUM',
      is_active          BOOLEAN     DEFAULT TRUE,
      notes              TEXT,
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX idx_ble_zone_rules_tenant  ON public.ble_zone_rules (tenant_id);
    CREATE INDEX idx_ble_zone_rules_gateway ON public.ble_zone_rules (gateway_id);
  END IF;

  IF to_regclass('public.ble_movement_alerts') IS NULL THEN
    CREATE TABLE public.ble_movement_alerts (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id        TEXT        NOT NULL,
      detection_id     TEXT,
      tag_mac          TEXT        NOT NULL,
      tag_id           TEXT,
      asset_name       TEXT,
      asset_no         TEXT,
      asset_domain     TEXT,
      from_gateway_id  TEXT,
      from_zone        TEXT,
      to_gateway_id    TEXT        NOT NULL,
      to_zone          TEXT        NOT NULL,
      rule_id          TEXT,
      severity         TEXT        NOT NULL DEFAULT 'MEDIUM',
      status           TEXT        NOT NULL DEFAULT 'OPEN',
      acknowledged_by  TEXT,
      acknowledged_at  TIMESTAMPTZ,
      resolution_notes TEXT,
      detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX idx_ble_movement_alerts_tenant      ON public.ble_movement_alerts (tenant_id);
    CREATE INDEX idx_ble_movement_alerts_gateway     ON public.ble_movement_alerts (to_gateway_id);
    CREATE INDEX idx_ble_movement_alerts_tag_mac     ON public.ble_movement_alerts (tag_mac);
    CREATE INDEX idx_ble_movement_alerts_detected_at ON public.ble_movement_alerts (detected_at);
    CREATE INDEX idx_ble_movement_alerts_status      ON public.ble_movement_alerts (status);
    CREATE INDEX idx_ble_movement_alerts_severity    ON public.ble_movement_alerts (severity);
  END IF;
END $$;

-- ── 2. preventive maintenance tickets ────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.spm_tickets') IS NULL THEN
    CREATE TABLE public.spm_tickets (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT        NOT NULL,
      ticket_code         TEXT        NOT NULL,
      cycle_id            UUID        NOT NULL,
      cycle_name          TEXT,
      asset_id            UUID,
      asset_name          TEXT,
      asset_no            TEXT,
      asset_category      TEXT,
      asset_location      TEXT,
      asset_domain        TEXT,
      maintenance_type    TEXT,
      triggered_by        TEXT        NOT NULL DEFAULT 'SCHEDULER',
      status              TEXT        NOT NULL DEFAULT 'OPEN',
      priority            TEXT        NOT NULL DEFAULT 'MEDIUM',
      assigned_to         TEXT,
      assigned_to_user_id TEXT,
      assigned_to_email   TEXT,
      scheduled_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at          TIMESTAMPTZ,
      completed_at        TIMESTAMPTZ,
      findings            TEXT,
      resolution_notes    TEXT,
      technician_notes    TEXT,
      completion_photos   TEXT[],
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX idx_spm_tickets_tenant         ON public.spm_tickets (tenant_id);
    CREATE INDEX idx_spm_tickets_cycle_id       ON public.spm_tickets (cycle_id);
    CREATE INDEX idx_spm_tickets_status         ON public.spm_tickets (status);
    CREATE INDEX idx_spm_tickets_scheduled_date ON public.spm_tickets (scheduled_date);
    CREATE INDEX idx_spm_tickets_priority       ON public.spm_tickets (priority);
    CREATE INDEX idx_spm_tickets_asset_id       ON public.spm_tickets (asset_id);
  END IF;
  -- One ticket per cycle per (UTC) day; the scheduler inserts with
  -- ON CONFLICT on exactly this expression.
  CREATE UNIQUE INDEX IF NOT EXISTS spm_tickets_cycle_day_key
    ON public.spm_tickets (cycle_id, ((scheduled_date AT TIME ZONE 'UTC')::date));
END $$;

-- ── 3. RAC inquiries, quotations, handovers and renewals ──────────────────
-- Inquiries, quotations and handovers exist in production (created by
-- request-time code while the app still connected as the owner) but have
-- no tenant_id: every company's records were in one pool, and every
-- company would have seen all of them. They get a tenant_id and row level
-- security below. Rows created before this have no tenant_id, so no
-- company sees them; the platform can still read them.
DO $$
BEGIN
  IF to_regclass('public.rental_inquiries') IS NULL THEN
    CREATE TABLE public.rental_inquiries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,
      inquiry_no      TEXT NOT NULL,
      customer_name   TEXT NOT NULL,
      email           TEXT,
      phone           TEXT NOT NULL,
      vehicle_type    TEXT,
      pickup_location TEXT,
      pickup_date     DATE,
      return_date     DATE,
      rental_days     INT,
      status          TEXT DEFAULT 'NEW',
      source          TEXT DEFAULT 'WALK_IN',
      assigned_to     TEXT,
      notes           TEXT,
      converted_to    TEXT
    );
  END IF;

  IF to_regclass('public.rental_quotations') IS NULL THEN
    CREATE TABLE public.rental_quotations (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id      TEXT NOT NULL,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW(),
      deleted_at     TIMESTAMPTZ,
      quote_no       TEXT NOT NULL,
      inquiry_id     UUID,
      customer_name  TEXT NOT NULL,
      email          TEXT,
      phone          TEXT,
      vehicle_type   TEXT,
      vehicle_id     TEXT,
      vehicle_name   TEXT,
      pickup_date    DATE NOT NULL,
      return_date    DATE NOT NULL,
      rental_days    INT NOT NULL,
      daily_rate     NUMERIC(10,2) NOT NULL,
      subtotal       NUMERIC(12,2) NOT NULL,
      vat_amount     NUMERIC(12,2) NOT NULL,
      grand_total    NUMERIC(12,2) NOT NULL,
      deposit_amount NUMERIC(12,2) DEFAULT 0,
      status         TEXT DEFAULT 'DRAFT',
      valid_until    DATE,
      notes          TEXT,
      sent_at        TIMESTAMPTZ,
      accepted_at    TIMESTAMPTZ,
      rejected_at    TIMESTAMPTZ,
      converted_to   TEXT
    );
  END IF;

  IF to_regclass('public.rental_handovers') IS NULL THEN
    CREATE TABLE public.rental_handovers (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          TEXT NOT NULL,
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW(),
      handover_no        TEXT NOT NULL,
      agreement_id       TEXT,
      agreement_no       TEXT,
      customer_name      TEXT,
      vehicle_id         TEXT,
      vehicle_no         TEXT,
      vehicle_name       TEXT,
      handover_type      TEXT NOT NULL DEFAULT 'PICKUP',
      handover_date      TIMESTAMPTZ DEFAULT NOW(),
      fuel_level         INT DEFAULT 4,
      odometer_reading   INT DEFAULT 0,
      condition_score    INT DEFAULT 3,
      body_condition     TEXT DEFAULT 'Good',
      interior_condition TEXT DEFAULT 'Clean',
      tyres_condition    TEXT DEFAULT 'Good',
      keys_count         INT DEFAULT 1,
      spare_key          BOOLEAN DEFAULT false,
      salik_tag          BOOLEAN DEFAULT false,
      parking_card       BOOLEAN DEFAULT false,
      accessories        JSONB DEFAULT '[]',
      checklist_items    JSONB DEFAULT '[]',
      notes              TEXT,
      signed_by          TEXT,
      signed_at          TIMESTAMPTZ,
      status             TEXT DEFAULT 'PENDING',
      branch_id          TEXT
    );
  END IF;

  IF to_regclass('public.rental_renewals') IS NULL THEN
    CREATE TABLE public.rental_renewals (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         TEXT        NOT NULL,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      deleted_at        TIMESTAMPTZ,
      renewal_no        TEXT        NOT NULL,
      agreement_id      TEXT,
      agreement_no      TEXT,
      customer_name     TEXT,
      vehicle_name      TEXT,
      vehicle_no        TEXT,
      original_end_date DATE,
      new_end_date      DATE,
      extension_days    INT,
      daily_rate        NUMERIC(10,2),
      renewal_amount    NUMERIC(12,2),
      vat_amount        NUMERIC(12,2),
      total_amount      NUMERIC(12,2),
      deposit_top_up    NUMERIC(12,2) DEFAULT 0,
      status            TEXT        DEFAULT 'PENDING',
      approved_by       TEXT,
      approved_at       TIMESTAMPTZ,
      notes             TEXT
    );
  END IF;
END $$;

-- tenant_id where missing, and document numbers unique per tenant: each
-- company numbers from its own count (RIQ-, RQT-, RHO-, RRN-yyyymm-nnnn),
-- so a platform-wide key rejected the second company's first record.
DO $$
DECLARE
  spec text[];
  rel regclass;
  col_attnum smallint;
  r record;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['rental_inquiries',  'inquiry_no'],
    ARRAY['rental_quotations', 'quote_no'],
    ARRAY['rental_handovers',  'handover_no'],
    ARRAY['rental_renewals',   'renewal_no']
  ] LOOP
    rel := to_regclass('public.' || spec[1]);
    IF rel IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS tenant_id TEXT', rel);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (tenant_id)', 'idx_' || spec[1] || '_tenant', rel);

    SELECT attnum INTO col_attnum FROM pg_attribute WHERE attrelid = rel AND attname = spec[2] AND NOT attisdropped;
    IF col_attnum IS NULL THEN
      CONTINUE;
    END IF;
    FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = rel AND contype = 'u' AND conkey = ARRAY[col_attnum] LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rel, r.conname);
    END LOOP;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s (tenant_id, %I)',
                   spec[1] || '_tenant_' || spec[2] || '_key', rel, spec[2]);
  END LOOP;
END $$;

-- ── 4. columns the request-time code used to add ─────────────────────────
DO $$
DECLARE
  spec text[];
  rel regclass;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['agent_runs',                'model_alias',                'TEXT'],
    ARRAY['agent_runs',                'model_provider',             'TEXT'],
    ARRAY['agent_runs',                'input_tokens',               'INT DEFAULT 0'],
    ARRAY['agent_runs',                'output_tokens',              'INT DEFAULT 0'],
    ARRAY['agent_runs',                'cached_tokens',              'INT DEFAULT 0'],
    ARRAY['agent_runs',                'tool_calls_count',           'INT DEFAULT 0'],
    ARRAY['agent_runs',                'agent_hops_count',           'INT DEFAULT 0'],
    ARRAY['agent_runs',                'matrix_elements_queried',    'INT DEFAULT 0'],
    ARRAY['agent_runs',                'solver_duration_ms',         'INT DEFAULT 0'],
    ARRAY['agent_runs',                'cost_usd',                   'NUMERIC(10,5) DEFAULT 0'],
    ARRAY['agent_runs',                'cost_aed',                   'NUMERIC(10,4) DEFAULT 0'],
    ARRAY['agent_runs',                'estimated_savings_aed',      'NUMERIC(12,2) DEFAULT 0'],
    ARRAY['agent_runs',                'actual_savings_aed',         'NUMERIC(12,2) DEFAULT 0'],
    ARRAY['agent_runs',                'business_outcome',           'TEXT'],
    ARRAY['agent_runs',                'decision_quality_score',     'NUMERIC(5,3)'],
    ARRAY['agent_runs',                'human_feedback',             'TEXT'],
    ARRAY['ai.agent_anomaly_flags',    'tenant_id',                  'TEXT DEFAULT ''default'''],
    ARRAY['ai.agent_anomaly_flags',    'stream_type',                'TEXT'],
    ARRAY['ai.agent_anomaly_flags',    'expected_value',             'TEXT'],
    ARRAY['ai.agent_anomaly_flags',    'actual_value',               'TEXT'],
    ARRAY['ai.agent_anomaly_flags',    'variance_pct',               'NUMERIC(8,2)'],
    ARRAY['ai.agent_anomaly_flags',    'likely_cause',               'TEXT'],
    ARRAY['ai.agent_anomaly_flags',    'financial_exposure_aed',     'NUMERIC(14,2)'],
    ARRAY['ai.agent_anomaly_flags',    'recommended_action',         'JSONB'],
    ARRAY['ai.agent_anomaly_flags',    'action_taken',               'TEXT'],
    ARRAY['ai.agent_anomaly_flags',    'action_taken_at',            'TIMESTAMPTZ'],
    ARRAY['ai.agent_anomaly_flags',    'action_taken_by',            'TEXT'],
    ARRAY['school_bus_routes',         'session',                    'TEXT NOT NULL DEFAULT ''MORNING'''],
    ARRAY['school_bus_routes',         'route_type',                 'TEXT NOT NULL DEFAULT ''STUDENT'''],
    ARRAY['school_bus_routes',         'assigned_attendant_id',      'TEXT'],
    ARRAY['school_bus_routes',         'seat_capacity',              'INT DEFAULT 40'],
    ARRAY['school_bus_routes',         'stop_sequence',              'JSONB DEFAULT ''[]'''],
    ARRAY['school_bus_routes',         'is_active',                  'BOOLEAN NOT NULL DEFAULT TRUE'],
    ARRAY['school_bus_routes',         'reassignment_history',       'JSONB DEFAULT ''[]'''],
    ARRAY['vehicles',                  'payload_capacity_kg',        'NUMERIC(10,2)'],
    ARRAY['vehicles',                  'payload_capacity_cbm',       'NUMERIC(10,3)'],
    ARRAY['vehicles',                  'depot_latitude',             'NUMERIC(10,7)'],
    ARRAY['vehicles',                  'depot_longitude',            'NUMERIC(10,7)'],
    ARRAY['vehicles',                  'cost_per_km',                'NUMERIC(8,2)'],
    ARRAY['drivers',                   'max_drive_hours_per_day',    'NUMERIC(4,2) DEFAULT 10'],
    ARRAY['drivers',                   'shift_start_local_time',     'TIME'],
    ARRAY['drivers',                   'shift_end_local_time',       'TIME'],
    ARRAY['logistics_shipment_stops',  'service_duration_minutes',   'INTEGER DEFAULT 15'],
    ARRAY['logistics_shipment_stops',  'geocode_confidence',         'NUMERIC(3,2)'],
    ARRAY['logistics_shipment_stops',  'geocoded_at',                'TIMESTAMPTZ'],
    ARRAY['logistics_assignments',     'route_plan_id',              'TEXT'],
    ARRAY['logistics_assignments',     'sequence_in_route',          'INTEGER'],
    ARRAY['logistics_route_plans',     'committed_by',               'TEXT'],
    ARRAY['logistics_shipment_stops',  'geofence_radius_m',          'INTEGER'],
    ARRAY['ble_gateways',              'api_key_hash',               'TEXT'],
    ARRAY['ble_gateways',              'api_key_prefix',             'TEXT'],
    ARRAY['ble_gateways',              'api_key_created_at',         'TIMESTAMPTZ'],
    ARRAY['ble_gateways',              'total_detections',           'BIGINT DEFAULT 0'],
    ARRAY['ble_gateways',              'last_detection_at',          'TIMESTAMPTZ'],
    ARRAY['ble_gateways',              'supported_protocols',        'TEXT[]'],
    ARRAY['ble_gateways',              'tag_model',                  'TEXT'],
    ARRAY['ble_tags',                  'tag_type',                   'TEXT DEFAULT ''GENERIC'''],
    ARRAY['ble_tags',                  'tag_model',                  'TEXT'],
    ARRAY['ble_tags',                  'advertisement_interval_ms',  'INT'],
    ARRAY['ble_tags',                  'current_gateway_id',         'TEXT'],
    ARRAY['ble_tags',                  'current_gateway_zone',       'TEXT'],
    ARRAY['ble_tags',                  'tx_power',                   'INT'],
    ARRAY['spm_cycles',                'assigned_to_user_id',        'TEXT'],
    ARRAY['spm_cycles',                'assigned_to_email',          'TEXT'],
    ARRAY['spm_tickets',               'assigned_to_user_id',        'TEXT'],
    ARRAY['spm_tickets',               'assigned_to_email',          'TEXT']
  ] LOOP
    rel := to_regclass(CASE WHEN position('.' IN spec[1]) > 0 THEN spec[1] ELSE 'public.' || spec[1] END);
    IF rel IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I %s', rel, spec[2], spec[3]);
  END LOOP;
END $$;

-- ── 5. row level security ────────────────────────────────────────────────
DO $$
DECLARE
  tname text;
  rel regclass;
  pol record;
BEGIN
  FOREACH tname IN ARRAY ARRAY['ble_detections', 'ble_zone_rules', 'ble_movement_alerts', 'spm_tickets',
                               'rental_inquiries', 'rental_quotations', 'rental_handovers', 'rental_renewals'] LOOP
    rel := to_regclass('public.' || tname);
    IF rel IS NULL THEN
      CONTINUE;
    END IF;

    FOR pol IN SELECT p.polname FROM pg_policy p WHERE p.polrelid = rel LOOP
      EXECUTE format('DROP POLICY %I ON %s', pol.polname, rel);
    END LOOP;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO fleet360_app', rel);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s FOR ALL '
      'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
      rel
    );
  END LOOP;
END $$;
