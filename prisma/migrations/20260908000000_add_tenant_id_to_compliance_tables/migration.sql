-- Give compliance_documents and insurance_policies the tenant column they lack.
--
-- Same situation as the six driver/fleet tables in 20260907000000: their
-- endpoints list rows with no predicate, there is nothing to filter on, and no
-- RLS policy can be written. Both tables are empty, so NOT NULL needs no
-- backfill and there is no existing data to mis-assign.
--
-- text, matching the majority of this schema. Note bookings.tenant_id is uuid
-- and vat_returns.tenant_id is text — the inconsistency is pre-existing and is
-- what produces 42883 "operator does not exist: uuid = text" at runtime when a
-- raw query crosses the two. Nothing here joins those tables, so this stays
-- with text rather than propagating a second convention.
--
-- Idempotent.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_documents', 'insurance_policies'] LOOP

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id text', t);

    -- NOT NULL only while empty; if rows appeared, leave it nullable rather
    -- than fail half-way through the loop.
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

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_tenant_id ON public.%I (tenant_id)', t, t);

    -- RLS enabled AND forced; USING gates reads, WITH CHECK blocks
    -- cross-tenant writes. Same shape as 20260904000000 and 20260907000000.
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
