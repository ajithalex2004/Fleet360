-- Fleet360 Exchange: the 22 partner tables that were never migrated.
--
-- schema.prisma models the whole Exchange (partner master data, marketplace,
-- trip execution, settlement), but 20260910000035_add_exchange_partner_settlement_tables
-- created only 5 of its tables (transport_partners, outsource_requests,
-- partner_quotes, outsource_awards, partner_invoices). Every /api/exchange/*
-- route that touches the rest fails in production with Prisma P2021, e.g.
-- "The table `public.partner_capabilities` does not exist in the current
-- database" (/api/exchange/marketplace) and the same for partner_scorecards
-- (/api/exchange/scorecard), and /api/exchange/partner/profile answers 500.
--
-- Additive only: CREATE TYPE / TABLE / INDEX guarded to be no-ops where the
-- object already exists. Columns, defaults, uniques and the foreign keys
-- between Exchange tables follow schema.prisma; conventions follow
-- 20260910000035 (TEXT ids defaulting to gen_random_uuid()::text,
-- updated_at defaulting to NOW(), plain-String status columns as TEXT).
-- As in that migration there are no database foreign keys to tenants or
-- users (a fresh install has no users table); the relations still work
-- through Prisma.
--
-- Row-level security: the 8 tables whose rows belong to one tenant
-- (a NOT NULL tenant_id) get the project's standard forced tenant_isolation
-- policy, the same form as 20260925130000_rls_for_unprotected_tenant_tables.
-- Tables without tenant_id follow the existing Exchange tables:
-- transport_partners and partner_quotes have no RLS either. They are
--   - partner-level master data: partner_users, partner_vehicles,
--     partner_drivers, partner_compliance_docs, partner_capabilities,
--     partner_service_areas;
--   - children reached through a tenant-scoped parent: outsource_request_partners
--     (request), partner_assignments and its revisions, pods and trip events
--     (award), partner_invoice_items (invoice), settlement_deductions (statement).
-- partner_scorecards is the one table with a tenant_id that is left without
-- RLS: it holds one row per partner (partner_id is unique) and tenant_id is
-- only the tenant that last evaluated it (ScorecardService.evaluatePartnerScorecard).
-- Under tenant isolation a second tenant's evaluation could not see the row,
-- would try to insert a second one for the same partner and fail on the
-- unique partner_id. It holds partner performance aggregates, not tenant data.

-- ── Enums ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT * FROM (VALUES
    ('DisputeStatus',             ARRAY['OPEN','UNDER_REVIEW','SETTLED','CREDIT_NOTE_ISSUED','REJECTED']),
    ('InvoiceVarianceReason',     ARRAY['WAITING_TIME','EXTRA_DISTANCE','ADDITIONAL_HOURS','PARKING','TOLL','ROUTE_CHANGE','VEHICLE_UPGRADE','CANCELLATION_CHARGE','OTHER']),
    ('OutsourceDeclineReason',    ARRAY['NO_VEHICLE','NO_DRIVER','AREA_NOT_SUPPORTED','TIMING_NOT_POSSIBLE','PRICE_NOT_VIABLE','COMPLIANCE_RESTRICTION','OTHER']),
    ('OutsourceExceptionStatus',  ARRAY['RAISED','ACKNOWLEDGED','RESOLUTION_REQUIRED','RESOLVED']),
    ('OutsourceExceptionType',    ARRAY['VEHICLE_BREAKDOWN','DRIVER_NO_SHOW','VEHICLE_NO_SHOW','DRIVER_REPLACEMENT','VEHICLE_REPLACEMENT','LATE_ARRIVAL','TRIP_CANCELLED','CUSTOMER_NO_SHOW','ROUTE_CHANGED','PASSENGER_OVER_CAPACITY','ACCIDENT','SERVICE_INTERRUPTED','OTHER']),
    ('OutsourceVisibility',       ARRAY['DIRECT','TENANT_NETWORK','EXCHANGE_NETWORK']),
    ('PartnerPerformanceTier',    ARRAY['STANDARD','BRONZE','SILVER','GOLD','PLATINUM']),
    ('SettlementStatementStatus', ARRAY['DRAFT','ISSUED','APPROVED','PAID','CANCELLED']),
    ('DeductionType',             ARRAY['LATE_ARRIVAL_PENALTY','CARGO_DAMAGE','VEHICLE_BREAKDOWN_PENALTY','HEADCOUNT_SHORTFALL','UNFULFILLED_SERVICE','OTHER'])
  ) AS t(name, labels) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typname = e.name
    ) THEN
      EXECUTE format('CREATE TYPE public.%I AS ENUM (%s)', e.name,
        (SELECT string_agg(quote_literal(l), ', ') FROM unnest(e.labels) AS l));
    END IF;
  END LOOP;
END $$;

-- ── Partner master data (no tenant) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_users (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id  TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'PARTNER_OPERATIONS',
  CONSTRAINT uq_partner_user UNIQUE (partner_id, user_id)
);

CREATE TABLE IF NOT EXISTS partner_vehicles (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id        TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  license_plate     TEXT        NOT NULL,
  plate_emirate     TEXT        NOT NULL DEFAULT 'Dubai',
  vehicle_type      TEXT        NOT NULL,
  seating_capacity  INTEGER     NOT NULL,
  make              TEXT,
  model             TEXT,
  year              INTEGER,
  mulkiya_expiry    DATE,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  CONSTRAINT uq_partner_vehicle_plate UNIQUE (partner_id, license_plate)
);

CREATE TABLE IF NOT EXISTS partner_drivers (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id      TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  full_name       TEXT        NOT NULL,
  mobile_number   TEXT        NOT NULL,
  license_number  TEXT,
  license_expiry  DATE,
  permit_type     TEXT,
  permit_expiry   DATE,
  is_active       BOOLEAN     NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS partner_compliance_docs (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id   TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  doc_type     TEXT        NOT NULL,
  doc_number   TEXT,
  file_url     TEXT        NOT NULL,
  expiry_date  DATE,
  status       TEXT        NOT NULL DEFAULT 'VALID'
);
CREATE INDEX IF NOT EXISTS idx_partner_compliance_doc ON partner_compliance_docs(partner_id, doc_type);

CREATE TABLE IF NOT EXISTS partner_capabilities (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id    TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  domain        "PartnerServiceDomain" NOT NULL DEFAULT 'PASSENGER_TRANSPORT',
  service_type  TEXT        NOT NULL,
  is_approved   BOOLEAN     NOT NULL DEFAULT true,
  CONSTRAINT uq_partner_capability UNIQUE (partner_id, domain, service_type)
);

CREATE TABLE IF NOT EXISTS partner_service_areas (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id  TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  emirate     TEXT        NOT NULL,
  zones       TEXT[]      NOT NULL DEFAULT '{}',
  CONSTRAINT uq_partner_service_area UNIQUE (partner_id, emirate)
);

-- One row per partner; tenant_id is the tenant that last evaluated it (see header).
CREATE TABLE IF NOT EXISTS partner_scorecards (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id           TEXT        NOT NULL UNIQUE REFERENCES transport_partners(id) ON DELETE CASCADE,
  tenant_id            TEXT,
  tier                 "PartnerPerformanceTier" NOT NULL DEFAULT 'STANDARD',
  composite_score      DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  on_time_performance  DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  quote_response_rate  DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  exception_rate       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  dispute_rate         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  pod_quality_rate     DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  total_awarded_trips  INTEGER     NOT NULL DEFAULT 0,
  completed_trips      INTEGER     NOT NULL DEFAULT 0,
  on_time_trips        INTEGER     NOT NULL DEFAULT 0,
  late_trips           INTEGER     NOT NULL DEFAULT 0,
  exceptions_count     INTEGER     NOT NULL DEFAULT 0,
  disputes_count       INTEGER     NOT NULL DEFAULT 0,
  quotes_submitted     INTEGER     NOT NULL DEFAULT 0,
  quotes_invited       INTEGER     NOT NULL DEFAULT 0,
  evaluated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scorecard_tier_score ON partner_scorecards(tier, composite_score);

-- ── Tenant ↔ partner (tenant-owned) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_platform_links (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  partner_id  TEXT        NOT NULL UNIQUE REFERENCES transport_partners(id) ON DELETE CASCADE,
  tenant_id   TEXT        NOT NULL UNIQUE,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_partner_relationships (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id         TEXT        NOT NULL,
  partner_id        TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT 'APPROVED',
  payment_terms     TEXT,
  commercial_notes  TEXT,
  CONSTRAINT uq_tenant_partner_relationship UNIQUE (tenant_id, partner_id)
);
CREATE INDEX IF NOT EXISTS idx_tpr_tenant ON tenant_partner_relationships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tpr_partner ON tenant_partner_relationships(partner_id);

CREATE TABLE IF NOT EXISTS partner_contracts (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id       TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  tenant_id        TEXT        NOT NULL,
  contract_number  TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  valid_from       DATE        NOT NULL,
  valid_until      DATE        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'ACTIVE',
  payment_terms    TEXT,
  document_url     TEXT,
  CONSTRAINT uq_partner_contract_number UNIQUE (tenant_id, contract_number)
);

CREATE TABLE IF NOT EXISTS partner_rate_cards (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id        TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  tenant_id         TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  domain            "PartnerServiceDomain" NOT NULL DEFAULT 'PASSENGER_TRANSPORT',
  vehicle_type      TEXT        NOT NULL,
  origin_zone       TEXT,
  destination_zone  TEXT,
  rate_amount       NUMERIC(12,2) NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'AED',
  unit_type         TEXT        NOT NULL DEFAULT 'PER_TRIP'
);

-- ── Requests: invitations and marketplace ────────────────────────────────

CREATE TABLE IF NOT EXISTS outsource_request_partners (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id      TEXT        NOT NULL REFERENCES outsource_requests(id) ON DELETE CASCADE,
  partner_id      TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at       TIMESTAMPTZ,
  declined_at     TIMESTAMPTZ,
  decline_reason  "OutsourceDeclineReason",
  decline_notes   TEXT,
  status          TEXT        NOT NULL DEFAULT 'INVITED',
  CONSTRAINT uq_outsource_req_partner UNIQUE (request_id, partner_id)
);

CREATE TABLE IF NOT EXISTS marketplace_opportunities (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id             TEXT        NOT NULL,
  outsource_request_id  TEXT        NOT NULL UNIQUE REFERENCES outsource_requests(id) ON DELETE CASCADE,
  domain                "PartnerServiceDomain" NOT NULL,
  visibility            "OutsourceVisibility"  NOT NULL DEFAULT 'EXCHANGE_NETWORK',
  status                TEXT        NOT NULL DEFAULT 'OPEN',
  published_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at             TIMESTAMPTZ NOT NULL,
  disclosure_payload    JSONB       NOT NULL,
  requirements_version  INTEGER     NOT NULL DEFAULT 1,
  created_by            TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marketplace_opps_domain_status ON marketplace_opportunities(domain, status, visibility);
CREATE INDEX IF NOT EXISTS idx_marketplace_opps_tenant ON marketplace_opportunities(tenant_id);

-- ── Trip execution (children of an award) ────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_assignments (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  award_id            TEXT        NOT NULL UNIQUE REFERENCES outsource_awards(id) ON DELETE CASCADE,
  partner_id          TEXT        NOT NULL,
  vehicle_id          TEXT,
  vehicle_plate       TEXT,
  driver_id           TEXT,
  driver_name         TEXT,
  driver_phone        TEXT,
  driver_token_hash   TEXT        NOT NULL UNIQUE,
  driver_token_exp    TIMESTAMPTZ NOT NULL,
  is_token_revoked    BOOLEAN     NOT NULL DEFAULT false,
  driver_assigned_at  TIMESTAMPTZ,
  reached_at          TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_assignment_driver_token_hash ON partner_assignments(driver_token_hash);

CREATE TABLE IF NOT EXISTS partner_assignment_revisions (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assignment_id    TEXT        NOT NULL REFERENCES partner_assignments(id) ON DELETE CASCADE,
  revision_no      INTEGER     NOT NULL DEFAULT 1,
  vehicle_plate    TEXT        NOT NULL,
  driver_name      TEXT        NOT NULL,
  driver_phone     TEXT        NOT NULL,
  replaced_reason  TEXT,
  replaced_by      TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignment_revisions ON partner_assignment_revisions(assignment_id);

CREATE TABLE IF NOT EXISTS outsource_pods (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assignment_id     TEXT        NOT NULL UNIQUE REFERENCES partner_assignments(id) ON DELETE CASCADE,
  passenger_count   INTEGER,
  signed_by_name    TEXT,
  signature_url     TEXT,
  photo_url         TEXT,
  completion_notes  TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_trip_events (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  assignment_id  TEXT        NOT NULL REFERENCES partner_assignments(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor          TEXT        NOT NULL DEFAULT 'DRIVER',
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  payload        JSONB
);
CREATE INDEX IF NOT EXISTS idx_trip_event_assignment ON partner_trip_events(assignment_id, occurred_at);

CREATE TABLE IF NOT EXISTS outsource_exceptions (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id         TEXT        NOT NULL,
  partner_id        TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  award_id          TEXT        REFERENCES outsource_awards(id) ON DELETE SET NULL,
  assignment_id     TEXT,
  type              "OutsourceExceptionType"   NOT NULL,
  status            "OutsourceExceptionStatus" NOT NULL DEFAULT 'RAISED',
  severity          TEXT        NOT NULL DEFAULT 'MEDIUM',
  description       TEXT        NOT NULL,
  resolution_notes  TEXT,
  raised_by         TEXT        NOT NULL,
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_outsource_exceptions_tenant ON outsource_exceptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_outsource_exceptions_partner ON outsource_exceptions(partner_id);

-- ── Settlement ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_settlement_statements (
  id                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id          TEXT        NOT NULL,
  partner_id         TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  statement_number   TEXT        NOT NULL,
  period_start       DATE        NOT NULL,
  period_end         DATE        NOT NULL,
  gross_amount       NUMERIC(12,2) NOT NULL,
  vat_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions   NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_payable        NUMERIC(12,2) NOT NULL,
  currency           TEXT        NOT NULL DEFAULT 'AED',
  status             "SettlementStatementStatus" NOT NULL DEFAULT 'DRAFT',
  tenant_trn         TEXT,
  partner_trn        TEXT,
  payment_reference  TEXT,
  paid_at            TIMESTAMPTZ,
  CONSTRAINT uq_settlement_statement_number UNIQUE (tenant_id, statement_number)
);
CREATE INDEX IF NOT EXISTS idx_settlement_tenant_status ON partner_settlement_statements(tenant_id, status);

CREATE TABLE IF NOT EXISTS settlement_deductions (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  statement_id  TEXT        NOT NULL REFERENCES partner_settlement_statements(id) ON DELETE CASCADE,
  invoice_id    TEXT,
  type          "DeductionType" NOT NULL,
  description   TEXT        NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  applied_by    TEXT        NOT NULL
);

CREATE TABLE IF NOT EXISTS partner_invoice_items (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id       TEXT        NOT NULL REFERENCES partner_invoices(id) ON DELETE CASCADE,
  description      TEXT        NOT NULL,
  variance_reason  "InvoiceVarianceReason",
  quantity         NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price       NUMERIC(12,2) NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  vat_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount     NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS outsource_disputes (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id         TEXT        NOT NULL,
  partner_id        TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  invoice_id        TEXT        NOT NULL REFERENCES partner_invoices(id) ON DELETE CASCADE,
  invoice_item_id   TEXT,
  dispute_number    TEXT        NOT NULL UNIQUE,
  disputed_amount   NUMERIC(12,2) NOT NULL,
  status            "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  reason            TEXT        NOT NULL,
  resolution_notes  TEXT,
  resolved_amount   NUMERIC(12,2),
  credit_note_ref   TEXT,
  raised_by         TEXT        NOT NULL,
  resolved_at       TIMESTAMPTZ,
  resolved_by       TEXT
);
CREATE INDEX IF NOT EXISTS idx_disputes_tenant_status ON outsource_disputes(tenant_id, status);

-- ── Access: runtime role grants and tenant isolation ─────────────────────

DO $$
DECLARE
  tbl text;
  pol record;
  all_tables text[] := ARRAY[
    'partner_users', 'partner_vehicles', 'partner_drivers', 'partner_compliance_docs',
    'partner_capabilities', 'partner_service_areas', 'partner_scorecards',
    'partner_platform_links', 'tenant_partner_relationships', 'partner_contracts',
    'partner_rate_cards', 'outsource_request_partners', 'marketplace_opportunities',
    'partner_assignments', 'partner_assignment_revisions', 'outsource_pods',
    'partner_trip_events', 'outsource_exceptions', 'partner_settlement_statements',
    'settlement_deductions', 'partner_invoice_items', 'outsource_disputes'
  ];
  -- Tables whose rows each belong to one tenant (tenant_id NOT NULL).
  tenant_tables text[] := ARRAY[
    'partner_platform_links', 'tenant_partner_relationships', 'partner_contracts',
    'partner_rate_cards', 'marketplace_opportunities', 'outsource_exceptions',
    'partner_settlement_statements', 'outsource_disputes'
  ];
BEGIN
  -- Default privileges already cover new tables where the migrating role owns
  -- the schema; grant explicitly as well, as 20260925130000 does.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    FOREACH tbl IN ARRAY all_tables LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', tbl);
    END LOOP;
  END IF;

  FOREACH tbl IN ARRAY tenant_tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies
                WHERE schemaname = 'public' AND tablename = tbl LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL '
      'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
      tbl
    );
  END LOOP;
END $$;
