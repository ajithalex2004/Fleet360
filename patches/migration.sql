-- TENANT-001: End-to-end tenant isolation for Leasing & Rental
--
-- Layers:
--   1. Schema ownership (tenant_id NOT NULL after backfill)
--   2. Parent/child composite integrity
--   3. Tenant-scoped business uniqueness
--   4. RLS USING + WITH CHECK (fail-closed, no tenant_id IS NULL in steady state)
--   5. FORCE ROW LEVEL SECURITY on newly tenantized tables
--
-- IMPORTANT: Assertions abort the migration if orphan/NULL tenant rows remain.
-- Review NOTICE lines when multiple tenants exist before production apply.

-- ═══════════════════════════════════════════════════════════════════════════
-- A. Lease children — add tenant_id, backfill from parent, composite FK
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "lease_quotation_items" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "lease_quotation_vehicles" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "lease_contract_vehicles" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "lease_invoice_lines" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

UPDATE "lease_quotation_items" i
SET "tenant_id" = q."tenant_id"
FROM "lease_quotations" q
WHERE i."quotation_id" = q."id" AND i."tenant_id" IS NULL;

UPDATE "lease_quotation_vehicles" v
SET "tenant_id" = q."tenant_id"
FROM "lease_quotations" q
WHERE v."quotation_id" = q."id" AND v."tenant_id" IS NULL;

UPDATE "lease_contract_vehicles" v
SET "tenant_id" = c."tenant_id"
FROM "lease_contracts_v2" c
WHERE v."contract_id" = c."id" AND v."tenant_id" IS NULL;

UPDATE "lease_invoice_lines" l
SET "tenant_id" = inv."tenant_id"
FROM "lease_invoices" inv
WHERE l."invoice_id" = inv."id" AND l."tenant_id" IS NULL;

DO $$
DECLARE n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT 1 FROM lease_quotation_items WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM lease_quotation_vehicles WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM lease_contract_vehicles WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM lease_invoice_lines WHERE tenant_id IS NULL
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'TENANT-001: % lease child rows still have NULL tenant_id — fix orphans before NOT NULL', n;
  END IF;
END $$;

ALTER TABLE "lease_quotation_items" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "lease_quotation_vehicles" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "lease_contract_vehicles" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "lease_invoice_lines" ALTER COLUMN "tenant_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lease_quotation_items_tenant_id ON lease_quotation_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lease_quotation_vehicles_tenant_id ON lease_quotation_vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lease_contract_vehicles_tenant_id ON lease_contract_vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lease_invoice_lines_tenant_id ON lease_invoice_lines(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_quotations_id_tenant ON lease_quotations(id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_contracts_v2_id_tenant ON lease_contracts_v2(id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_invoices_id_tenant ON lease_invoices(id, tenant_id);

ALTER TABLE lease_quotation_items DROP CONSTRAINT IF EXISTS lease_quotation_items_quotation_id_fkey;
ALTER TABLE lease_quotation_vehicles DROP CONSTRAINT IF EXISTS lease_quotation_vehicles_quotation_id_fkey;
ALTER TABLE lease_contract_vehicles DROP CONSTRAINT IF EXISTS lease_contract_vehicles_contract_id_fkey;
ALTER TABLE lease_invoice_lines DROP CONSTRAINT IF EXISTS lease_invoice_lines_invoice_id_fkey;

ALTER TABLE lease_quotation_items
  ADD CONSTRAINT lease_quotation_items_quotation_tenant_fkey
  FOREIGN KEY (quotation_id, tenant_id) REFERENCES lease_quotations(id, tenant_id);

ALTER TABLE lease_quotation_vehicles
  ADD CONSTRAINT lease_quotation_vehicles_quotation_tenant_fkey
  FOREIGN KEY (quotation_id, tenant_id) REFERENCES lease_quotations(id, tenant_id);

ALTER TABLE lease_contract_vehicles
  ADD CONSTRAINT lease_contract_vehicles_contract_tenant_fkey
  FOREIGN KEY (contract_id, tenant_id) REFERENCES lease_contracts_v2(id, tenant_id);

ALTER TABLE lease_invoice_lines
  ADD CONSTRAINT lease_invoice_lines_invoice_tenant_fkey
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES lease_invoices(id, tenant_id);

-- Tenant-scoped business uniqueness
ALTER TABLE lease_quotations DROP CONSTRAINT IF EXISTS lease_quotations_quotation_number_key;
ALTER TABLE lease_contracts_v2 DROP CONSTRAINT IF EXISTS lease_contracts_v2_contract_number_key;
ALTER TABLE lease_invoices DROP CONSTRAINT IF EXISTS lease_invoices_invoice_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_quotations_tenant_number
  ON lease_quotations(tenant_id, quotation_number)
  WHERE quotation_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_contracts_v2_tenant_number
  ON lease_contracts_v2(tenant_id, contract_number)
  WHERE contract_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_invoices_tenant_number
  ON lease_invoices(tenant_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- B. Rental domain — add tenant_id (including inspections, claims, rate events)
-- Backfill: single operational tenant fallback (STS); multi-tenant raises NOTICE
-- Children prefer parent booking/customer/invoice tenant when available.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_bookings ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_rate_quotes ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_extensions ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_payments ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_ancillaries ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_additional_charges ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_invoice_line_items ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rental_invoice_payments ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE vehicle_inspections ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE damage_claims ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE rate_events ADD COLUMN IF NOT EXISTS tenant_id TEXT;

DO $$
DECLARE
  default_tenant TEXT;
  tenant_count INT;
BEGIN
  SELECT COUNT(*) INTO tenant_count FROM tenants;
  SELECT id INTO default_tenant FROM tenants ORDER BY created_at NULLS LAST LIMIT 1;

  IF default_tenant IS NULL THEN
    RAISE EXCEPTION 'TENANT-001: no tenant found for Rental backfill';
  END IF;

  IF tenant_count > 1 THEN
    RAISE NOTICE 'TENANT-001: % tenants present — assigning unmapped Rental orphans to %; review before production',
      tenant_count, default_tenant;
  END IF;

  -- Parents first
  UPDATE rental_customers SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_bookings SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_rate_quotes SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_ancillaries SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rate_events SET tenant_id = default_tenant WHERE tenant_id IS NULL;

  -- Prefer parent booking tenant for booking-scoped children
  UPDATE rental_agreements a
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE a.booking_id = b.id AND a.tenant_id IS NULL;

  UPDATE rental_vehicle_exchanges e
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE e.booking_id = b.id AND e.tenant_id IS NULL;

  UPDATE rental_extensions x
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE x.booking_id = b.id AND x.tenant_id IS NULL;

  UPDATE rental_payments p
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE p.booking_id = b.id AND p.tenant_id IS NULL;

  UPDATE rental_additional_charges c
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE c.booking_id = b.id AND c.tenant_id IS NULL;

  UPDATE vehicle_inspections v
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE v.booking_id = b.id AND v.tenant_id IS NULL;

  UPDATE damage_claims d
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE d.booking_id = b.id AND d.tenant_id IS NULL;

  UPDATE rental_invoices i
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE i.booking_id = b.id AND i.tenant_id IS NULL;

  -- Invoice children from invoice
  UPDATE rental_invoice_line_items li
  SET tenant_id = inv.tenant_id
  FROM rental_invoices inv
  WHERE li.invoice_id = inv.id AND li.tenant_id IS NULL;

  UPDATE rental_invoice_payments pay
  SET tenant_id = inv.tenant_id
  FROM rental_invoices inv
  WHERE pay.invoice_id = inv.id AND pay.tenant_id IS NULL;

  -- Residual orphans → default tenant
  UPDATE rental_agreements SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_vehicle_exchanges SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_extensions SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_payments SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_additional_charges SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE vehicle_inspections SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE damage_claims SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_invoices SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_invoice_line_items SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_invoice_payments SET tenant_id = default_tenant WHERE tenant_id IS NULL;
END $$;

DO $$
DECLARE n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT 1 FROM rental_customers WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_bookings WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_agreements WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_invoices WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM vehicle_inspections WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM damage_claims WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rate_events WHERE tenant_id IS NULL
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'TENANT-001: % rental/related rows still NULL tenant_id', n;
  END IF;
END $$;

ALTER TABLE rental_customers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_bookings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_rate_quotes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_agreements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_vehicle_exchanges ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_extensions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_payments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_ancillaries ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_additional_charges ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_invoices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_invoice_line_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rental_invoice_payments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vehicle_inspections ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE damage_claims ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rate_events ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rental_customers_tenant_id ON rental_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_bookings_tenant_id ON rental_bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_rate_quotes_tenant_id ON rental_rate_quotes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_agreements_tenant_id ON rental_agreements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_vehicle_exchanges_tenant_id ON rental_vehicle_exchanges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_extensions_tenant_id ON rental_extensions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_tenant_id ON rental_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_ancillaries_tenant_id ON rental_ancillaries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_additional_charges_tenant_id ON rental_additional_charges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_tenant_id ON rental_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_line_items_tenant_id ON rental_invoice_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_payments_tenant_id ON rental_invoice_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_tenant_id ON vehicle_inspections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_damage_claims_tenant_id ON damage_claims(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rate_events_tenant_id ON rate_events(tenant_id);

-- Parent composite unique targets for Rental FKs
CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_bookings_id_tenant ON rental_bookings(id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_customers_id_tenant ON rental_customers(id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_invoices_id_tenant ON rental_invoices(id, tenant_id);

-- Tenant-scoped business uniqueness for rental refs
ALTER TABLE rental_bookings DROP CONSTRAINT IF EXISTS rental_bookings_booking_ref_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_bookings_tenant_ref
  ON rental_bookings(tenant_id, booking_ref)
  WHERE booking_ref IS NOT NULL;

ALTER TABLE rental_invoice_payments DROP CONSTRAINT IF EXISTS rental_invoice_payments_receipt_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_invoice_payments_tenant_receipt
  ON rental_invoice_payments(tenant_id, receipt_no)
  WHERE receipt_no IS NOT NULL;

-- Composite parent/child FKs where booking_id / invoice_id present
ALTER TABLE rental_agreements DROP CONSTRAINT IF EXISTS rental_agreements_booking_id_fkey;
ALTER TABLE rental_additional_charges DROP CONSTRAINT IF EXISTS rental_additional_charges_booking_id_fkey;
ALTER TABLE vehicle_inspections DROP CONSTRAINT IF EXISTS vehicle_inspections_booking_id_fkey;
ALTER TABLE damage_claims DROP CONSTRAINT IF EXISTS damage_claims_booking_id_fkey;
ALTER TABLE rental_invoice_line_items DROP CONSTRAINT IF EXISTS rental_invoice_line_items_invoice_id_fkey;
ALTER TABLE rental_invoice_payments DROP CONSTRAINT IF EXISTS rental_invoice_payments_invoice_id_fkey;

-- Only add composite FKs when column exists and types match (best-effort)
DO $$
BEGIN
  BEGIN
    ALTER TABLE rental_agreements
      ADD CONSTRAINT rental_agreements_booking_tenant_fkey
      FOREIGN KEY (booking_id, tenant_id) REFERENCES rental_bookings(id, tenant_id);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'TENANT-001: skip rental_agreements composite FK: %', SQLERRM;
  END;
  BEGIN
    ALTER TABLE vehicle_inspections
      ADD CONSTRAINT vehicle_inspections_booking_tenant_fkey
      FOREIGN KEY (booking_id, tenant_id) REFERENCES rental_bookings(id, tenant_id);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'TENANT-001: skip vehicle_inspections composite FK: %', SQLERRM;
  END;
  BEGIN
    ALTER TABLE damage_claims
      ADD CONSTRAINT damage_claims_booking_tenant_fkey
      FOREIGN KEY (booking_id, tenant_id) REFERENCES rental_bookings(id, tenant_id);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'TENANT-001: skip damage_claims composite FK: %', SQLERRM;
  END;
  BEGIN
    ALTER TABLE rental_invoice_line_items
      ADD CONSTRAINT rental_invoice_line_items_invoice_tenant_fkey
      FOREIGN KEY (invoice_id, tenant_id) REFERENCES rental_invoices(id, tenant_id);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'TENANT-001: skip rental_invoice_line_items composite FK: %', SQLERRM;
  END;
  BEGIN
    ALTER TABLE rental_invoice_payments
      ADD CONSTRAINT rental_invoice_payments_invoice_tenant_fkey
      FOREIGN KEY (invoice_id, tenant_id) REFERENCES rental_invoices(id, tenant_id);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'TENANT-001: skip rental_invoice_payments composite FK: %', SQLERRM;
  END;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C. RLS USING + WITH CHECK (fail-closed; no tenant_id IS NULL)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'lease_quotation_items',
    'lease_quotation_vehicles',
    'lease_contract_vehicles',
    'lease_invoice_lines',
    'rental_customers',
    'rental_bookings',
    'rental_rate_quotes',
    'rental_agreements',
    'rental_vehicle_exchanges',
    'rental_extensions',
    'rental_payments',
    'rental_ancillaries',
    'rental_additional_charges',
    'rental_invoices',
    'rental_invoice_line_items',
    'rental_invoice_payments',
    'vehicle_inspections',
    'damage_claims',
    'rate_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      || 'USING ('
      ||   'current_setting(''app.tenant_id'', true) = ''*'' '
      ||   'OR tenant_id::text = current_setting(''app.tenant_id'', true)'
      || ') '
      || 'WITH CHECK ('
      ||   'current_setting(''app.tenant_id'', true) = ''*'' '
      ||   'OR tenant_id::text = current_setting(''app.tenant_id'', true)'
      || ')',
      t
    );
  END LOOP;
END $$;

-- Cross-tenant parent/child mismatch assertion (must be 0)
DO $$
DECLARE n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM lease_quotation_items i
  JOIN lease_quotations q ON q.id = i.quotation_id
  WHERE i.tenant_id <> q.tenant_id;
  IF n > 0 THEN RAISE EXCEPTION 'TENANT-001: % quotation item parent mismatches', n; END IF;

  SELECT COUNT(*) INTO n FROM lease_quotation_vehicles v
  JOIN lease_quotations q ON q.id = v.quotation_id
  WHERE v.tenant_id <> q.tenant_id;
  IF n > 0 THEN RAISE EXCEPTION 'TENANT-001: % quotation vehicle parent mismatches', n; END IF;

  SELECT COUNT(*) INTO n FROM lease_contract_vehicles v
  JOIN lease_contracts_v2 c ON c.id = v.contract_id
  WHERE v.tenant_id <> c.tenant_id;
  IF n > 0 THEN RAISE EXCEPTION 'TENANT-001: % contract vehicle parent mismatches', n; END IF;

  SELECT COUNT(*) INTO n FROM lease_invoice_lines l
  JOIN lease_invoices inv ON inv.id = l.invoice_id
  WHERE l.tenant_id <> inv.tenant_id;
  IF n > 0 THEN RAISE EXCEPTION 'TENANT-001: % invoice line parent mismatches', n; END IF;

  SELECT COUNT(*) INTO n FROM vehicle_inspections v
  JOIN rental_bookings b ON b.id = v.booking_id
  WHERE v.tenant_id <> b.tenant_id;
  IF n > 0 THEN RAISE EXCEPTION 'TENANT-001: % inspection parent mismatches', n; END IF;

  SELECT COUNT(*) INTO n FROM damage_claims d
  JOIN rental_bookings b ON b.id = d.booking_id
  WHERE d.tenant_id <> b.tenant_id;
  IF n > 0 THEN RAISE EXCEPTION 'TENANT-001: % damage claim parent mismatches', n; END IF;
END $$;
