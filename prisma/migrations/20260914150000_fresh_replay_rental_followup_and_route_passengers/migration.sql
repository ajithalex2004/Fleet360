-- Follow-up to 20260914140000 (#74), and rescopes route_passengers (#75)
-- into the same migration. Both found by the systematic fresh-replay audit
-- (#77). Entirely additive/idempotent, same as every migration in this
-- series — no already-applied migration is edited.
--
-- PART 1 — the gap in 20260914140000 itself
--
-- That migration's corrected backfill assumes rental_extensions,
-- rental_payments, and rental_additional_charges already have a tenant_id
-- column — true on every live environment, but only true on a fresh replay
-- if 20260815140000 actually ran. Option A's own design has that migration
-- SKIPPED (prisma migrate resolve --applied), not run, on a fresh DB, so its
-- `ADD COLUMN IF NOT EXISTS tenant_id` never happens — and because Prisma
-- applies a whole migration file as one transaction, 20260914140000 failing
-- on that backfill rolls back everything else in the file too: the 5 table
-- creations and the 19-table RLS ensure. This migration is self-sufficient —
-- it redoes all of 20260914140000's work (safe no-op on every real
-- environment, where it already succeeded) plus the actual fix (adding the
-- missing columns first).
--
-- PART 2 — route_passengers (#75), folded in rather than its own PR
--
-- Same untracked-legacy-table pattern as trip_schedules (#70) and the 5
-- rental tables (#73/#74): route_passengers exists live, but no tracked
-- migration creates it. Two tracked migrations reference it
-- (20260816000000_route_consolidation_phase2_schema,
-- 20260818100000_fleet_routing_foundation) and both fail on a fresh replay
-- as a result — taking 8 more tables down with them, since each is one
-- transaction. This migration recreates route_passengers with its exact
-- live DDL (pg_dump'd from production), closes the live tenant_id-IS-NULL
-- RLS escape it still carried (per #75 — currently dormant, 0 NULL rows,
-- but live), and redoes the 8 downstream tables' creation + RLS exactly as
-- their original (already-applied-everywhere) migrations defined them.
--
-- A fresh database still needs three manual steps before this migration's
-- effects apply (unchanged from #74/#75's own documentation, now
-- consolidated):
--   npx prisma migrate resolve --applied 20260815140000_tenant_001_leasing_rental_isolation
--   npx prisma migrate resolve --applied 20260816000000_route_consolidation_phase2_schema
--   npx prisma migrate resolve --applied 20260818100000_fleet_routing_foundation
-- 20260914140000 itself does not need skipping — it errors cleanly and
-- rolls back cleanly, so `migrate deploy` can just retry it after this
-- migration's fix is in place. (It's still safe to re-run standalone here
-- regardless, since every statement in it is idempotent.)

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1a — redo 20260914140000's 5 table creations (verbatim, idempotent)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rental_rate_quotes (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    booking_id text,
    vehicle_category text NOT NULL,
    pickup_date timestamp with time zone NOT NULL,
    dropoff_date timestamp with time zone NOT NULL,
    total_days integer NOT NULL,
    total_hours integer,
    applied_rule_id text,
    currency text DEFAULT 'AED'::text,
    base_rental_charge numeric NOT NULL,
    insurance_plan_code text,
    insurance_charge numeric DEFAULT 0,
    extras text,
    discount_pct numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    tax_pct numeric DEFAULT 5,
    tax_amount numeric DEFAULT 0,
    total_amount numeric NOT NULL,
    breakdown text,
    expires_at timestamp with time zone,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_rate_quotes_booking_id ON public.rental_rate_quotes USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_rental_rate_quotes_tenant_id ON public.rental_rate_quotes USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_vehicle_exchanges (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    agreement_id text NOT NULL REFERENCES public.rental_agreements(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    from_vehicle_id text NOT NULL,
    to_vehicle_id text NOT NULL,
    exchange_date timestamp with time zone NOT NULL,
    reason text,
    mileage_at_exchange integer,
    fuel_at_exchange integer,
    rate_difference numeric,
    authorized_by text,
    notes text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_vehicle_exchanges_agreement_id ON public.rental_vehicle_exchanges USING btree (agreement_id);
CREATE INDEX IF NOT EXISTS idx_rental_vehicle_exchanges_tenant ON public.rental_vehicle_exchanges USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_invoices (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    invoice_no text NOT NULL UNIQUE,
    agreement_id text NOT NULL REFERENCES public.rental_agreements(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    customer_id text NOT NULL,
    invoice_type text DEFAULT 'STANDARD'::text,
    invoice_date timestamp with time zone NOT NULL,
    due_date timestamp with time zone NOT NULL,
    period_from timestamp with time zone,
    period_to timestamp with time zone,
    currency text DEFAULT 'AED'::text,
    subtotal numeric NOT NULL,
    discount_amount numeric DEFAULT 0,
    taxable_amount numeric DEFAULT 0,
    tax_rate numeric DEFAULT 5,
    tax_amount numeric DEFAULT 0,
    total_amount numeric NOT NULL,
    paid_amount numeric DEFAULT 0,
    balance_due numeric,
    status text DEFAULT 'DRAFT'::text,
    is_corporate boolean DEFAULT false,
    corporate_account_id text,
    billing_mode text DEFAULT 'SEPARATE'::text,
    payment_terms_days integer DEFAULT 30,
    sent_at timestamp with time zone,
    paid_at timestamp with time zone,
    voided_at timestamp with time zone,
    void_reason text,
    parent_invoice_id text,
    notes text,
    internal_notes text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_agreement_id ON public.rental_invoices USING btree (agreement_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_corporate_account_id ON public.rental_invoices USING btree (corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_customer_id ON public.rental_invoices USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_deleted_at ON public.rental_invoices USING btree (deleted_at);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_due_date ON public.rental_invoices USING btree (due_date);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_status ON public.rental_invoices USING btree (status);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_tenant_id ON public.rental_invoices USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_invoice_line_items (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    invoice_id text NOT NULL REFERENCES public.rental_invoices(id) ON UPDATE CASCADE ON DELETE CASCADE,
    line_type text NOT NULL,
    description text NOT NULL,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    unit_label text DEFAULT 'day'::text,
    discount_pct numeric DEFAULT 0,
    taxable boolean DEFAULT true,
    amount numeric NOT NULL,
    sort_order integer DEFAULT 0,
    reference_id text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_line_items_invoice_id ON public.rental_invoice_line_items USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_line_items_tenant ON public.rental_invoice_line_items USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_invoice_payments (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    invoice_id text NOT NULL REFERENCES public.rental_invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    receipt_no text UNIQUE,
    amount numeric NOT NULL,
    currency text DEFAULT 'AED'::text,
    payment_method text,
    reference_no text,
    notes text,
    received_by text,
    paid_at timestamp(6) with time zone NOT NULL,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_payments_invoice_id ON public.rental_invoice_payments USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_payments_tenant ON public.rental_invoice_payments USING btree (tenant_id);

DO $$
DECLARE
  tbl text;
  targets text[] := ARRAY[
    'rental_rate_quotes', 'rental_vehicle_exchanges', 'rental_invoices',
    'rental_invoice_line_items', 'rental_invoice_payments'
  ];
BEGIN
  FOREACH tbl IN ARRAY targets LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', tbl);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1b — the actual fix: add every column 20260815140000 would have
-- added, before anything backfills against them. IF NOT EXISTS — no-op on
-- every live environment, where these already exist via the untracked
-- legacy path. Widened beyond the 3 tables #74 originally covered: a real
-- fresh-replay run (verified below) showed rental_agreements itself is
-- ALSO a cascade victim — it's in 20260815140000's same ADD COLUMN list,
-- and it's the join target for #74's own corrected backfill, so #74's fix
-- silently depended on a column that a genuinely fresh replay doesn't have
-- either. Covers every pre-existing table from that migration's list; the
-- 5 tables created fresh in Part 1a already have tenant_id inline.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.rental_customers          ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.rental_bookings           ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.rental_agreements         ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.rental_ancillaries        ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.rental_extensions         ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.rental_payments           ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.rental_additional_charges ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.vehicle_inspections       ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.damage_claims             ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE public.rate_events               ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1c — redo the full backfill chain, matching 20260815140000's own
-- sequence exactly except for the 5 corrected joins (agreement_id, not
-- booking_id — see #73/#74). No-op wherever tenant_id is already set,
-- which is every real environment; only fires against rows that exist with
-- a genuinely NULL tenant_id (a truly fresh DB has none yet either — this
-- is what makes later data, inserted after a fresh bootstrap, safe too).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  default_tenant TEXT;
BEGIN
  SELECT id INTO default_tenant FROM tenants ORDER BY created_at NULLS LAST LIMIT 1;
  IF default_tenant IS NULL THEN
    RETURN; -- nothing to backfill against yet (no tenant rows) — later inserts will already carry tenant_id
  END IF;

  -- Root tables — no parent to join through, same as 20260815140000.
  UPDATE rental_customers   SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_bookings    SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rental_ancillaries SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  UPDATE rate_events        SET tenant_id = default_tenant WHERE tenant_id IS NULL;

  -- rental_agreements — correctly joined via booking_id in the original
  -- migration (not one of the 5 wrong-join tables); rental_bookings is
  -- backfilled above so this can now resolve. tenant_id is uuid on this
  -- table (confirmed live), unlike every other table backfilled here —
  -- explicit cast, since Postgres has no implicit text->uuid assignment
  -- and validates the statement's types at parse time regardless of
  -- whether any row actually matches the WHERE clause.
  UPDATE rental_agreements a
  SET tenant_id = b.tenant_id::uuid
  FROM rental_bookings b
  WHERE a.booking_id = b.id AND a.tenant_id IS NULL;

  -- vehicle_inspections — also correctly joined via booking_id; tenant_id
  -- is text here, no cast needed.
  UPDATE vehicle_inspections v
  SET tenant_id = b.tenant_id
  FROM rental_bookings b
  WHERE v.booking_id = b.id AND v.tenant_id IS NULL;

  -- damage_claims — also correctly joined via booking_id; tenant_id is
  -- uuid here too (confirmed live), same cast as rental_agreements.
  UPDATE damage_claims d
  SET tenant_id = b.tenant_id::uuid
  FROM rental_bookings b
  WHERE d.booking_id = b.id AND d.tenant_id IS NULL;

  -- Residual orphans (no matching parent found) fall back to the default
  -- tenant, same as 20260815140000's own final pass.
  UPDATE rental_agreements   SET tenant_id = default_tenant::uuid WHERE tenant_id IS NULL;
  UPDATE vehicle_inspections SET tenant_id = default_tenant       WHERE tenant_id IS NULL;
  UPDATE damage_claims       SET tenant_id = default_tenant::uuid WHERE tenant_id IS NULL;
END $$;

-- The 5 corrected joins (#73/#74) — through rental_agreements, not
-- rental_bookings. Runs after the block above so rental_agreements.tenant_id
-- is populated by the time these fire.
UPDATE rental_extensions x
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE x.agreement_id = a.id AND x.tenant_id IS NULL;

UPDATE rental_payments p
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE p.agreement_id = a.id AND p.tenant_id IS NULL;

UPDATE rental_additional_charges c
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE c.agreement_id = a.id AND c.tenant_id IS NULL;

UPDATE rental_vehicle_exchanges e
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE e.agreement_id = a.id AND e.tenant_id IS NULL;

UPDATE rental_invoices i
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE i.agreement_id = a.id AND i.tenant_id IS NULL;

DO $$
DECLARE n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT 1 FROM rental_extensions WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_payments WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_additional_charges WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_vehicle_exchanges WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_invoices WHERE tenant_id IS NULL
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'issue #77 followup backfill: % rows still have NULL tenant_id after the corrected join — orphaned from rental_agreements, needs manual review', n;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1d — redo the 19-table RLS ensure (from 20260914140000, with one
-- fix: also skip a table that exists but has no tenant_id column yet,
-- instead of trying to build a policy against a column that isn't there.
-- Found by the same fresh-replay test as Part 1b/1c — lease_quotation_items
-- (a lease, not rental, table — a different cascade entirely, out of scope
-- for this migration to chase further) hits exactly this on a genuinely
-- fresh replay. Matches the guard pattern already used elsewhere in this
-- codebase (e.g. 20260910000008). No-op on live, where all 19 already have
-- the column.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t       text;
  coltype text;
  expr    text;
  targets text[] := ARRAY[
    'lease_quotation_items', 'lease_quotation_vehicles', 'lease_contract_vehicles',
    'lease_invoice_lines', 'rental_customers', 'rental_bookings', 'rental_rate_quotes',
    'rental_agreements', 'rental_vehicle_exchanges', 'rental_extensions', 'rental_payments',
    'rental_ancillaries', 'rental_additional_charges', 'rental_invoices',
    'rental_invoice_line_items', 'rental_invoice_payments', 'vehicle_inspections',
    'damage_claims', 'rate_events'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'SKIP % — does not exist', t;
      CONTINUE;
    END IF;

    SELECT data_type INTO coltype
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id';

    IF coltype IS NULL THEN
      RAISE NOTICE 'SKIP % — no tenant_id column (separate cascade, not this migration''s scope)', t;
      CONTINUE;
    END IF;

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
      t, expr, expr
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2a — route_passengers, exact live DDL (pg_dump'd from production).
-- Policy is TIGHTENED (no tenant_id-IS-NULL escape) per #75 — 0 live rows
-- have a NULL tenant_id today, so this is safe; matches the pattern already
-- used for every other table this session (20260910000000 and after).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.route_passengers (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    tenant_id text NOT NULL,
    route_id uuid NOT NULL,
    staff_member_id uuid NOT NULL,
    pickup_stop_id uuid,
    pickup_time text,
    dropoff_stop_id uuid,
    dropoff_time text,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    notes text,
    created_by text,
    earliest_pickup text,
    latest_pickup text,
    required_arrival_time text,
    pickup_buffer_min integer
);
CREATE INDEX IF NOT EXISTS idx_route_passengers_deleted   ON public.route_passengers USING btree (deleted_at);
CREATE INDEX IF NOT EXISTS idx_route_passengers_route     ON public.route_passengers USING btree (route_id);
CREATE INDEX IF NOT EXISTS idx_route_passengers_staff     ON public.route_passengers USING btree (staff_member_id);
CREATE INDEX IF NOT EXISTS idx_route_passengers_status    ON public.route_passengers USING btree (status);
CREATE INDEX IF NOT EXISTS idx_route_passengers_tenant    ON public.route_passengers USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_route_passengers_tenant_id ON public.route_passengers USING btree (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_passengers TO fleet360_app;

ALTER TABLE public.route_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_passengers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.route_passengers;
CREATE POLICY tenant_isolation ON public.route_passengers FOR ALL
  USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- transport_enrollments — also referenced by 20260816000000 (the FK on
-- route_consolidation_enrollment_migrations below) and, like
-- route_passengers, never created by any tracked migration. Only surfaced
-- once route_passengers was fixed — the original CREATE TABLE failed on
-- route_passengers' FK first, masking this second untracked dependency.
-- Exact live DDL (pg_dump'd from production); policy left as-is (not
-- tightened) — out of scope here, same as the fleet_optimization tables.
CREATE TABLE IF NOT EXISTS public.transport_enrollments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    tenant_id text NOT NULL,
    employee_id text NOT NULL REFERENCES workforce.employees(id) ON DELETE CASCADE,
    default_route_id text,
    default_stop_id text,
    default_stop_name text,
    shift_type text,
    transport_type text DEFAULT 'BUS'::text,
    is_active boolean DEFAULT true NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transport_enrollments_active ON public.transport_enrollments USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_transport_enrollments_route ON public.transport_enrollments USING btree (default_route_id);
CREATE INDEX IF NOT EXISTS idx_transport_enrollments_tenant ON public.transport_enrollments USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_transport_enrollments_tenant_id ON public.transport_enrollments USING btree (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transport_enrollments_employee ON public.transport_enrollments USING btree (employee_id) WHERE (deleted_at IS NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_enrollments TO fleet360_app;

ALTER TABLE public.transport_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transport_enrollments;
CREATE POLICY tenant_isolation ON public.transport_enrollments
  USING (tenant_id IS NULL OR current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id IS NULL OR current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2b — redo 20260816000000's route-consolidation tables (verbatim,
-- idempotent). Strict RLS predicate matches the original exactly — these
-- are genuinely new tables with no legacy rows to accommodate.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bus_routes
  ADD COLUMN IF NOT EXISTS retired_reason TEXT,
  ADD COLUMN IF NOT EXISTS retired_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_by     TEXT;

CREATE INDEX IF NOT EXISTS idx_bus_routes_retired_reason
  ON public.bus_routes(retired_reason)
  WHERE retired_reason IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.route_consolidations (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  recommendation_id         TEXT NOT NULL,
  idempotency_key           TEXT NOT NULL,
  merged_route_id           TEXT REFERENCES public.bus_routes(id) ON DELETE RESTRICT,
  status                    TEXT NOT NULL
                              CHECK (status IN ('APPLIED', 'REVERTED')),
  objective_snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_state_hash        TEXT NOT NULL,
  applied_at                TIMESTAMPTZ NOT NULL,
  applied_by                TEXT NOT NULL,
  reverted_at               TIMESTAMPTZ,
  reverted_by               TEXT,
  revert_reason             TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ,
  CONSTRAINT route_consolidations_reverted_when_reverted
    CHECK ((status = 'REVERTED') = (reverted_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consolidations_tenant_idem
  ON public.route_consolidations(tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consolidations_tenant_rec_active
  ON public.route_consolidations(tenant_id, recommendation_id)
  WHERE status = 'APPLIED';
CREATE INDEX IF NOT EXISTS idx_route_consolidations_tenant_status
  ON public.route_consolidations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_route_consolidations_tenant_merged_route
  ON public.route_consolidations(tenant_id, merged_route_id);
CREATE INDEX IF NOT EXISTS idx_route_consolidations_applied_at
  ON public.route_consolidations(applied_at)
  WHERE status = 'APPLIED';

CREATE TABLE IF NOT EXISTS public.route_consolidation_sources (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  consolidation_id          TEXT NOT NULL REFERENCES public.route_consolidations(id) ON DELETE CASCADE,
  source_route_id           TEXT NOT NULL REFERENCES public.bus_routes(id) ON DELETE RESTRICT,
  source_route_updated_at   TIMESTAMPTZ,
  sequence                  INT NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consolidation_sources_pair
  ON public.route_consolidation_sources(consolidation_id, source_route_id);
CREATE INDEX IF NOT EXISTS idx_route_consolidation_sources_tenant_source
  ON public.route_consolidation_sources(tenant_id, source_route_id);
CREATE INDEX IF NOT EXISTS idx_route_consolidation_sources_consolidation
  ON public.route_consolidation_sources(consolidation_id);

CREATE TABLE IF NOT EXISTS public.route_consolidation_enrollment_migrations (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  consolidation_id          TEXT NOT NULL REFERENCES public.route_consolidations(id) ON DELETE CASCADE,
  route_passenger_id        UUID REFERENCES public.route_passengers(id) ON DELETE RESTRICT,
  transport_enrollment_id   TEXT REFERENCES public.transport_enrollments(id) ON DELETE RESTRICT,
  source_route_id           TEXT NOT NULL REFERENCES public.bus_routes(id) ON DELETE RESTRICT,
  target_route_id           TEXT NOT NULL REFERENCES public.bus_routes(id) ON DELETE RESTRICT,
  old_pickup_stop_id        TEXT,
  new_pickup_stop_id        TEXT,
  old_dropoff_stop_id       TEXT,
  new_dropoff_stop_id       TEXT,
  mapping_method            TEXT NOT NULL
                              CHECK (mapping_method IN ('EXACT_STOP', 'EXACT_PLACE_ID', 'OPERATOR_RESOLVED')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT route_consol_enroll_migration_xor
    CHECK (
      (route_passenger_id IS NOT NULL AND transport_enrollment_id IS NULL)
      OR (route_passenger_id IS NULL AND transport_enrollment_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consol_enroll_mig_rp
  ON public.route_consolidation_enrollment_migrations(consolidation_id, route_passenger_id)
  WHERE route_passenger_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consol_enroll_mig_te
  ON public.route_consolidation_enrollment_migrations(consolidation_id, transport_enrollment_id)
  WHERE transport_enrollment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_route_consol_enroll_mig_consolidation
  ON public.route_consolidation_enrollment_migrations(consolidation_id);
CREATE INDEX IF NOT EXISTS idx_route_consol_enroll_mig_tenant
  ON public.route_consolidation_enrollment_migrations(tenant_id);

DO $$
DECLARE
  t    text;
  tbls text[] := ARRAY[
    'route_consolidations', 'route_consolidation_sources',
    'route_consolidation_enrollment_migrations'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = current_setting(''app.tenant_id'', TRUE)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', TRUE))',
      t
    );
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2c — redo 20260818100000's fleet-routing tables (verbatim,
-- idempotent). Policies match the original exactly, including its
-- tenant_id-IS-NULL branch — unlike route_passengers above, these are
-- genuinely new tables with no live rows to have audited for #75, so this
-- migration doesn't unilaterally tighten them; that's a separate decision.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bus_routes
  ADD COLUMN IF NOT EXISTS pickup_buffer_min INTEGER;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_pickup_buffer_min     INTEGER,
  ADD COLUMN IF NOT EXISTS default_required_arrival_time TEXT;

CREATE TABLE IF NOT EXISTS public.fleet_route_matrix_cache (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id         TEXT        NOT NULL,
  cache_key         TEXT        NOT NULL,
  origins_hash      TEXT        NOT NULL,
  destinations_hash TEXT        NOT NULL,
  routing_mode      TEXT        NOT NULL,
  traffic_bucket    TEXT        NOT NULL,
  route_modifiers   TEXT        NOT NULL,
  api_version       TEXT        NOT NULL,
  origins           JSONB       NOT NULL,
  destinations      JSONB       NOT NULL,
  matrix            JSONB       NOT NULL,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fleet_route_matrix_tenant_key
  ON public.fleet_route_matrix_cache (tenant_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_fleet_route_matrix_computed
  ON public.fleet_route_matrix_cache (computed_at);

CREATE TABLE IF NOT EXISTS public.fleet_optimization_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  tenant_id       TEXT        NOT NULL,
  created_by      TEXT        NOT NULL,
  status          TEXT        NOT NULL,
  status_reason   TEXT,
  target_date     DATE        NOT NULL,
  input_snapshot  JSONB       NOT NULL,
  raw_response    JSONB,
  metrics         JSONB,
  error_message   TEXT,
  published_at    TIMESTAMPTZ,
  published_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_tenant      ON public.fleet_optimization_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_target_date ON public.fleet_optimization_runs (target_date);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_status      ON public.fleet_optimization_runs (status);

CREATE TABLE IF NOT EXISTS public.fleet_optimization_run_routes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id           TEXT        NOT NULL,
  run_id              UUID        NOT NULL REFERENCES public.fleet_optimization_runs(id) ON DELETE CASCADE,
  vehicle_id          TEXT        NOT NULL,
  driver_id           TEXT,
  sequence_in_run     INTEGER     NOT NULL,
  total_distance_km   DOUBLE PRECISION NOT NULL,
  total_duration_min  INTEGER     NOT NULL,
  total_passengers    INTEGER     NOT NULL,
  encoded_polyline    TEXT        NOT NULL,
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_route_run     ON public.fleet_optimization_run_routes (run_id);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_route_vehicle ON public.fleet_optimization_run_routes (tenant_id, vehicle_id);

CREATE TABLE IF NOT EXISTS public.fleet_optimization_run_stops (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id        TEXT        NOT NULL,
  run_route_id     UUID        NOT NULL REFERENCES public.fleet_optimization_run_routes(id) ON DELETE CASCADE,
  sequence         INTEGER     NOT NULL,
  stop_id          TEXT,
  lat              DOUBLE PRECISION NOT NULL,
  lng              DOUBLE PRECISION NOT NULL,
  label            TEXT        NOT NULL,
  arrival_time     TIMESTAMPTZ NOT NULL,
  departure_time   TIMESTAMPTZ NOT NULL,
  passenger_count  INTEGER     NOT NULL,
  passenger_ids    JSONB       NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_stop_route_seq ON public.fleet_optimization_run_stops (run_route_id, sequence);

CREATE TABLE IF NOT EXISTS public.fleet_optimization_run_unassigned (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id      TEXT        NOT NULL,
  run_id         UUID        NOT NULL REFERENCES public.fleet_optimization_runs(id) ON DELETE CASCADE,
  passenger_id   TEXT,
  stop_lat       DOUBLE PRECISION NOT NULL,
  stop_lng       DOUBLE PRECISION NOT NULL,
  stop_label     TEXT        NOT NULL,
  reason         TEXT        NOT NULL,
  reason_detail  TEXT
);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_unassigned_run ON public.fleet_optimization_run_unassigned (run_id);

DO $$
DECLARE
  t    text;
  tbls text[] := ARRAY[
    'fleet_route_matrix_cache', 'fleet_optimization_runs', 'fleet_optimization_run_routes',
    'fleet_optimization_run_stops', 'fleet_optimization_run_unassigned'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON public.%I '
      || 'USING (tenant_id IS NULL OR current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (tenant_id IS NULL OR current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
      t, t
    );
  END LOOP;
END $$;
