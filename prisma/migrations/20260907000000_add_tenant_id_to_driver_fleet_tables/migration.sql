-- Give six driver/fleet tables the tenant column they never had.
--
-- driver_documents, driver_shifts, vehicle_documents, fuel_cards, fuel_logs
-- and traffic_fines had no tenant_id at all — not in the database, not in
-- schema.prisma. Their endpoints could not be tenant-scoped because there was
-- nothing to filter on, and no RLS policy could be written against them for
-- the same reason. Scoping through the parent was not available either: the
-- Prisma models carry driver_id / vehicle_id columns but declare no relation,
-- so `where: { driver: { tenantId } }` does not compile.
--
-- The practical effect today is nothing, because all six tables are empty. The
-- effect the moment any of these features is used is that every tenant's
-- driver documents, shift records, vehicle documents, fuel cards, fuel logs
-- and traffic fines sit in one undifferentiated pool, readable by any
-- authenticated caller — the endpoints list them with no predicate at all.
--
-- Empty is the cheapest possible moment to fix this: NOT NULL needs no
-- backfill and no default, and there is no existing data to mis-assign.
--
-- text, not uuid: drivers.id, vehicles.id and their tenant_id columns are all
-- text, and this schema already has uuid-vs-text mismatches that surface as
-- 42883 "operator does not exist" at runtime. Matching the parents is what
-- keeps a future join or foreign key working.
--
-- NOT included, deliberately: foreign keys on driver_id / vehicle_id. These
-- tables have no foreign keys at all today, so those ids are unenforced
-- references. Adding them is worth doing and safe while the tables are empty,
-- but it is a data-integrity change with its own cascade semantics to decide,
-- not part of making the rows tenant-scoped.
--
-- Idempotent throughout.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'driver_documents', 'driver_shifts', 'vehicle_documents',
    'fuel_cards', 'fuel_logs', 'traffic_fines'
  ] LOOP

    -- 1. The column.
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id text', t);

    -- 2. NOT NULL only while the table is empty. If rows appeared between
    --    writing and running this, leave it nullable rather than fail the
    --    migration — a half-applied migration is worse than a nullable column.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = t AND column_name = 'tenant_id'
                      AND is_nullable = 'NO') THEN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', t);
      IF NOT FOUND THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);
      ELSE
        RAISE NOTICE '% is not empty — tenant_id left nullable', t;
      END IF;
    END IF;

    -- 3. Index it. Every query these tables serve will filter on it.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_tenant_id ON public.%I (tenant_id)', t, t);

    -- 4. RLS. Enabled AND forced — FORCE binds the table owner too, without
    --    which an owner-run query silently bypasses the policy. USING gates
    --    reads, WITH CHECK blocks cross-tenant writes; both are required.
    --    Matches the policy shape used in
    --    20260904000000_add_tenant_id_to_lease_rental_children.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($pol$
      CREATE POLICY tenant_isolation ON public.%I FOR ALL
      USING (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      )
      WITH CHECK (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      )
    $pol$, t);

    RAISE NOTICE 'tenant_id + index + RLS applied to %', t;
  END LOOP;
END $$;
