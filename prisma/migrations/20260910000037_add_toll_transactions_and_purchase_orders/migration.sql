-- New data models, designed and approved this session, to back the two
-- remaining Finance Anomaly streams that had no data model at all
-- (Trip Tolls, Procurement) — unlike the earlier fixes this session,
-- these are genuinely new features, not schema-drift repairs.
--
-- id columns are TEXT (not UUID) to match this codebase's established
-- convention. vehicle_id/driver_id/rental_agreement_id FKs reference real
-- TEXT-typed id columns (vehicles.id, drivers.id, rental_agreements.id are
-- all TEXT despite holding UUID-shaped values — confirmed via direct DB
-- introspection earlier this session).

CREATE TABLE IF NOT EXISTS toll_transactions (
  id                       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id                TEXT        NOT NULL,

  vehicle_id               TEXT        NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id                TEXT        REFERENCES drivers(id) ON DELETE SET NULL,
  trip_id                  TEXT,
  rental_agreement_id      TEXT        REFERENCES rental_agreements(id) ON DELETE SET NULL,

  toll_gate_name           TEXT        NOT NULL,
  toll_provider            TEXT        NOT NULL DEFAULT 'SALIK',
  toll_amount              NUMERIC(10,2) NOT NULL,
  currency                 TEXT        NOT NULL DEFAULT 'AED',
  occurred_at              TIMESTAMPTZ NOT NULL,

  responsible_party        TEXT        NOT NULL DEFAULT 'FLEET',
  is_billed_to_customer    BOOLEAN     NOT NULL DEFAULT FALSE,
  billed_invoice_id        TEXT,
  is_deducted_from_driver  BOOLEAN     NOT NULL DEFAULT FALSE,
  driver_deduction_ref     TEXT,

  source                   TEXT        NOT NULL DEFAULT 'MANUAL',
  notes                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_toll_transactions_tenant ON toll_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_toll_transactions_vehicle ON toll_transactions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_toll_transactions_occurred_at ON toll_transactions(occurred_at);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                     TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id              TEXT        NOT NULL,

  po_number              TEXT        NOT NULL,
  vendor_name            TEXT        NOT NULL,
  vendor_id              TEXT,

  item_name              TEXT        NOT NULL,
  line_items             JSONB       NOT NULL DEFAULT '[]',
  category               TEXT,

  authorized_po_amount   NUMERIC(12,2) NOT NULL,
  invoiced_amount        NUMERIC(12,2),
  currency               TEXT        NOT NULL DEFAULT 'AED',

  po_date                DATE        NOT NULL,
  invoice_date           DATE,

  status                 TEXT        NOT NULL DEFAULT 'DRAFT',

  source_type            TEXT,
  source_id              TEXT,

  requested_by           TEXT,
  approved_by            TEXT,
  notes                  TEXT,

  CONSTRAINT uq_purchase_orders_tenant_po_number UNIQUE (tenant_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
