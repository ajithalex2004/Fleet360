-- Repair a missing historical prerequisite without changing applied migrations.
-- TENANT-001 (20260815140000) ALTERs this table; its first tracked CREATE used
-- to sort a month later. This NEW migration intentionally sorts immediately
-- before that first use. Existing environments apply it as a pending migration.
-- The definition matches 20260915250000's canonical quote snapshot table.
-- Existing tables and their data/policies are left untouched. Later corrective
-- migrations still handle the OTHER legacy rental/lease dependencies.

DO $$
BEGIN
  IF to_regclass('public.rental_rate_quotes') IS NULL THEN
    CREATE TABLE public.rental_rate_quotes (
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

    CREATE INDEX idx_rental_rate_quotes_booking_id
      ON public.rental_rate_quotes (booking_id);
    CREATE INDEX idx_rental_rate_quotes_tenant_id
      ON public.rental_rate_quotes (tenant_id);

    -- Protect the table even if bootstrap stops before later RLS migrations.
    ALTER TABLE public.rental_rate_quotes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.rental_rate_quotes FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON public.rental_rate_quotes FOR ALL
      USING (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      )
      WITH CHECK (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      );
  END IF;
END $$;

-- Do not silently accept a conflicting relation or column shape on upgrade.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'rental_rate_quotes'
      AND c.relkind = 'r'
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('id', 'text', 'NO'), ('tenant_id', 'text', 'NO'),
      ('vehicle_category', 'text', 'NO'),
      ('pickup_date', 'timestamp with time zone', 'NO'),
      ('dropoff_date', 'timestamp with time zone', 'NO'),
      ('total_days', 'integer', 'NO'),
      ('base_rental_charge', 'numeric', 'NO'), ('total_amount', 'numeric', 'NO')
    ) AS expected(name, type_name, nullable)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = 'rental_rate_quotes'
      AND c.column_name = expected.name
    WHERE c.column_name IS NULL OR c.data_type <> expected.type_name
      OR c.is_nullable <> expected.nullable
  ) THEN
    RAISE EXCEPTION 'rental_rate_quotes prerequisite: incompatible existing table; review schema drift before retrying';
  END IF;
END $$;
