-- Migration: 20260811090000_close_mobile_sync_gaps
--
-- Closes 4 of the 6 codebase gaps identified in
-- docs/architecture/mobile-sync-conflict-resolution.md v0.3.
--
-- Gap 1: DvirDefect model added (was previously a JSON column on
--         BusPreTripCheck). Each defect is now its own row, allowing
--         per-defect severity, photo evidence, and status tracking.
-- Gap 2: CustomerInteraction model added. Notes and interactions
--         between a driver and a customer.
-- Gap 3: VehicleIssueReport model added. Ad-hoc issue reports
--         distinct from DVIR defects and TripIncident.
-- Gap 5: Incident model added (Operations-owned). Generic incident
--         reporting for non-trip events: workplace safety, security,
--         facility, regulatory, near-miss, etc.
--
-- Gap 4 (Receipt/Signature) is resolved by documentation in the
-- mobile-sync doc — receipts live on FinanceExpense.receiptUrl and
-- signatures live on BusPreTripCheck.signatureData. No new model.
--
-- Gap 6 (Finance fuel consumer) is resolved by a stub consumer in
-- src/lib/finance/consumers/fuel-expense-consumer.ts. Full wiring
-- requires the outbox event infrastructure, which is a separate
-- workstream (see data ownership doc Phase 4).
--
-- IMPORTANT: This migration was authored by hand because the
-- schema.prisma file does not currently validate (the multiSchema
-- preview feature is enabled but ~150 of the 200+ models are
-- missing the required `@@schema` attribute). This is a pre-existing
-- problem, not caused by these additions. The 4 new models added in
-- this migration are correctly tagged with `@@schema("public")`
-- and are forward-compatible.

-- ── dvir_defects (Gap 1) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dvir_defects (
  id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                      TIMESTAMPTZ(6)             DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ(6),
  deleted_at                      TIMESTAMPTZ(6),
  tenant_id                       TEXT,
  dvir_id                         UUID         NOT NULL,
  component                       TEXT         NOT NULL,
  position                        TEXT,
  severity                        TEXT         NOT NULL,
  description                     TEXT,
  photo_url                       TEXT,
  requires_immediate_attention    BOOLEAN      NOT NULL DEFAULT FALSE,
  status                          TEXT         NOT NULL DEFAULT 'OPEN',
  CONSTRAINT fk_dvir_defects_dvir FOREIGN KEY (dvir_id)
    REFERENCES bus_pretrip_checks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dvir_defects_dvir_id     ON dvir_defects(dvir_id);
CREATE INDEX IF NOT EXISTS idx_dvir_defects_tenant_id   ON dvir_defects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dvir_defects_severity    ON dvir_defects(severity);
CREATE INDEX IF NOT EXISTS idx_dvir_defects_deleted_at  ON dvir_defects(deleted_at)
  WHERE deleted_at IS NULL;

-- ── vehicle_issue_reports (Gap 3) ───────────────────────────────
-- Note: vehicles.id and drivers.id are TEXT in this DB (not UUID), so the
-- FK columns are TEXT to match. The Prisma schema declares them as UUID
-- but the underlying column is TEXT — Prisma's string-based UUIDs
-- are stored as text without type conflict.
CREATE TABLE IF NOT EXISTS vehicle_issue_reports (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ(6)             DEFAULT NOW(),
  updated_at          TIMESTAMPTZ(6),
  deleted_at          TIMESTAMPTZ(6),
  tenant_id           TEXT,
  vehicle_id          TEXT           NOT NULL,
  driver_id           TEXT,
  issue_type          TEXT           NOT NULL,
  severity            TEXT           NOT NULL,
  description         TEXT,
  photo_urls          JSONB,
  reported_at         TIMESTAMPTZ(6) NOT NULL    DEFAULT NOW(),
  status              TEXT           NOT NULL DEFAULT 'OPEN',
  resolved_at         TIMESTAMPTZ(6),
  resolved_by         TEXT,
  resolution_notes    TEXT
);
CREATE INDEX IF NOT EXISTS idx_vehicle_issue_reports_vehicle_id     ON vehicle_issue_reports(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_issue_reports_tenant_reported ON vehicle_issue_reports(tenant_id, reported_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_issue_reports_severity        ON vehicle_issue_reports(severity);
CREATE INDEX IF NOT EXISTS idx_vehicle_issue_reports_status          ON vehicle_issue_reports(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_issue_reports_deleted_at      ON vehicle_issue_reports(deleted_at)
  WHERE deleted_at IS NULL;

-- ── customer_interactions (Gap 2) ───────────────────────────────
-- Note: customers.id is TEXT in this DB, so customer_id is TEXT.
CREATE TABLE IF NOT EXISTS customer_interactions (
  id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ(6)             DEFAULT NOW(),
  updated_at           TIMESTAMPTZ(6),
  deleted_at           TIMESTAMPTZ(6),
  tenant_id            TEXT,
  customer_id          TEXT           NOT NULL,
  driver_id            TEXT,
  trip_id              TEXT,                                     -- soft reference, no FK
  interaction_type     TEXT           NOT NULL,
  channel              TEXT,
  notes                TEXT,
  location             TEXT,
  latitude             DECIMAL,
  longitude            DECIMAL,
  photo_urls           JSONB,
  occurred_at          TIMESTAMPTZ(6) NOT NULL,
  follow_up_required   BOOLEAN        NOT NULL DEFAULT FALSE,
  follow_up_at         TIMESTAMPTZ(6),
  CONSTRAINT fk_customer_interactions_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_id       ON customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_driver_id         ON customer_interactions(driver_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_tenant_occurred  ON customer_interactions(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_type              ON customer_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_deleted_at        ON customer_interactions(deleted_at)
  WHERE deleted_at IS NULL;

-- ── incidents (Gap 5) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ(6)             DEFAULT NOW(),
  updated_at          TIMESTAMPTZ(6),
  deleted_at          TIMESTAMPTZ(6),
  incident_no         TEXT           UNIQUE,
  tenant_id           TEXT,
  reported_by         TEXT,
  occurred_at         TIMESTAMPTZ(6) NOT NULL,
  incident_type       TEXT           NOT NULL,
  severity            TEXT           NOT NULL DEFAULT 'LOW',
  description         TEXT,
  location            TEXT,
  latitude            DECIMAL,
  longitude           DECIMAL,
  photo_urls          JSONB,
  injuries_reported   BOOLEAN                    DEFAULT FALSE,
  police_report       BOOLEAN                    DEFAULT FALSE,
  police_report_no    TEXT,
  insurance_claim     TEXT,
  status              TEXT           NOT NULL DEFAULT 'OPEN',
  assigned_to         TEXT,
  resolved_at         TIMESTAMPTZ(6),
  resolved_by         TEXT,
  resolution          TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_occurred  ON incidents(tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_incidents_type             ON incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_incidents_severity          ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_status            ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_deleted_at        ON incidents(deleted_at)
  WHERE deleted_at IS NULL;
