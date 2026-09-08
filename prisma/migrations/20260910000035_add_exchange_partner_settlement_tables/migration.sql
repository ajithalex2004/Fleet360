-- Fleet360 Exchange / Partner Settlement tables.
--
-- These 5 tables (plus ~15 satellite tables not created here — partner
-- users/vehicles/drivers/compliance docs/contracts/rate cards, marketplace
-- opportunities, invitations, invoice line items, disputes, etc.) are fully
-- modeled in schema.prisma and the app already has live routes against them
-- under /api/exchange/*, but no migration was ever generated for any of it —
-- schema.prisma describes the intended design; it was never migrated here.
--
-- Only the 5 tables the finance-anomaly Partner Settlements stream actually
-- needs are created: transport_partners -> outsource_requests ->
-- partner_quotes -> outsource_awards -> partner_invoices (that dependency
-- order matters for the FKs below). Satellite/child tables aren't required
-- for these 5 to exist and work — Postgres only needs the table a FK points
-- AT to exist first, not tables that would point at these.
--
-- id columns are TEXT (not UUID) to match this codebase's established
-- convention (vehicles.id, rental_agreements.id, etc. are all TEXT despite
-- holding UUID-shaped values, because a subset of legacy rows use non-UUID
-- custom-format ids) — confirmed via direct DB introspection this session,
-- same reasoning as agent_runs/fleet_work_orders/logistics_shipment_documents.
--
-- status/verificationStatus columns that schema.prisma types as plain
-- String (not a Prisma enum) are created as TEXT here, matching the model.
-- Columns typed as a real Prisma enum use a Postgres ENUM type, since
-- that's what Prisma actually generates for them.

CREATE TYPE "PartnerOnboardingStatus" AS ENUM ('DRAFT', 'APPLICATION_SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'REJECTED');
CREATE TYPE "PartnerOperationalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLACKLISTED');
CREATE TYPE "MarketplacePartnerStatus" AS ENUM ('NOT_APPLIED', 'UNDER_REVIEW', 'APPROVED', 'SUSPENDED', 'REJECTED');
CREATE TYPE "PartnerServiceDomain" AS ENUM ('PASSENGER_TRANSPORT', 'LIMOUSINE', 'FREIGHT', 'RECOVERY');
CREATE TYPE "OutsourcePricingMethod" AS ENUM ('CONTRACT_RATE', 'RFQ', 'MANUAL_PRICE');
CREATE TYPE "OutsourceRequestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'QUOTED', 'AWARDED', 'CANCELLED');
CREATE TYPE "PartnerQuoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SUPERSEDED', 'WITHDRAWN', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- ── 1. transport_partners ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transport_partners (
  id                       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,

  legal_name               TEXT        NOT NULL,
  trade_name                TEXT,
  partner_code             TEXT        NOT NULL UNIQUE,
  country                  TEXT        NOT NULL DEFAULT 'AE',
  city                     TEXT,
  address                  TEXT,
  trade_license_number     TEXT,
  tax_registration_number  TEXT,
  primary_contact_name     TEXT,
  primary_contact_email    TEXT,
  primary_contact_phone    TEXT,

  onboarding_status        "PartnerOnboardingStatus"  NOT NULL DEFAULT 'DRAFT',
  operational_status       "PartnerOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  marketplace_status       "MarketplacePartnerStatus" NOT NULL DEFAULT 'APPROVED',

  approved_at              TIMESTAMPTZ,
  approved_by              TEXT,
  rejection_reason         TEXT
);
CREATE INDEX IF NOT EXISTS idx_partners_onboarding ON transport_partners(onboarding_status);
CREATE INDEX IF NOT EXISTS idx_partners_operational ON transport_partners(operational_status);

-- ── 2. outsource_requests ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outsource_requests (
  id                      TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id               TEXT        NOT NULL,
  request_number          TEXT        NOT NULL UNIQUE,

  domain                  "PartnerServiceDomain"   NOT NULL DEFAULT 'PASSENGER_TRANSPORT',
  source_reference_type   TEXT        NOT NULL DEFAULT 'TRIP_SCHEDULE',
  source_reference_id     TEXT        NOT NULL,

  pricing_method          "OutsourcePricingMethod" NOT NULL DEFAULT 'RFQ',
  status                  "OutsourceRequestStatus" NOT NULL DEFAULT 'PUBLISHED',

  service_date            DATE        NOT NULL,
  pickup_time             TEXT        NOT NULL,
  pickup_location         TEXT        NOT NULL,
  pickup_latitude         DOUBLE PRECISION,
  pickup_longitude        DOUBLE PRECISION,
  dropoff_location        TEXT        NOT NULL,
  dropoff_latitude        DOUBLE PRECISION,
  dropoff_longitude       DOUBLE PRECISION,
  required_capacity       INTEGER     NOT NULL DEFAULT 50,
  vehicle_type_required   TEXT,
  special_instructions    TEXT
);
CREATE INDEX IF NOT EXISTS idx_outsource_req_tenant_status ON outsource_requests(tenant_id, status);

-- ── 3. partner_quotes ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_quotes (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id           TEXT        NOT NULL REFERENCES outsource_requests(id) ON DELETE CASCADE,
  partner_id           TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE CASCADE,
  revision_no          INTEGER     NOT NULL DEFAULT 1,
  supersedes_quote_id  TEXT,

  amount               NUMERIC(12,2) NOT NULL,
  vat_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(12,2) NOT NULL,
  currency             TEXT        NOT NULL DEFAULT 'AED',
  valid_until          TIMESTAMPTZ NOT NULL,
  status               "PartnerQuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
  notes                TEXT,

  proposed_vehicle_id  TEXT,
  proposed_driver_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_partner_quotes_req_partner ON partner_quotes(request_id, partner_id);

-- ── 4. outsource_awards ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outsource_awards (
  id                   TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id            TEXT        NOT NULL,
  request_id           TEXT        NOT NULL UNIQUE REFERENCES outsource_requests(id) ON DELETE RESTRICT,
  quote_id             TEXT        NOT NULL UNIQUE REFERENCES partner_quotes(id) ON DELETE RESTRICT,
  partner_id           TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE RESTRICT,

  awarded_price        NUMERIC(12,2) NOT NULL,
  vat_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_awarded        NUMERIC(12,2) NOT NULL,
  currency             TEXT        NOT NULL DEFAULT 'AED',
  commercial_snapshot  JSONB       NOT NULL,

  awarded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_by           TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'AWARDED',
  aborted_at           TIMESTAMPTZ,
  abort_reason         TEXT
);
CREATE INDEX IF NOT EXISTS idx_outsource_awards_tenant ON outsource_awards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_outsource_awards_partner ON outsource_awards(partner_id);

-- ── 5. partner_invoices ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_invoices (
  id                       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id               TEXT        NOT NULL REFERENCES transport_partners(id) ON DELETE RESTRICT,
  tenant_id                TEXT        NOT NULL,
  award_id                 TEXT        NOT NULL UNIQUE REFERENCES outsource_awards(id) ON DELETE RESTRICT,

  invoice_number           TEXT        NOT NULL,
  invoice_date             DATE        NOT NULL,
  subtotal_amount          NUMERIC(12,2) NOT NULL,
  vat_amount               NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount             NUMERIC(12,2) NOT NULL,
  currency                 TEXT        NOT NULL DEFAULT 'AED',
  status                   TEXT        NOT NULL DEFAULT 'SUBMITTED',
  verification_status      TEXT        NOT NULL DEFAULT 'MATCHED',

  approved_amount          NUMERIC(12,2),
  approved_at              TIMESTAMPTZ,
  approved_by              TEXT,
  rejection_reason         TEXT,

  payable_id               TEXT,
  settlement_statement_id  TEXT,

  CONSTRAINT uq_partner_invoice_number UNIQUE (partner_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_partner_invoices_tenant_status ON partner_invoices(tenant_id, status);
