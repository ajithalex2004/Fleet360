-- Customer Portal 3d (Rent-a-Car): link a Customer Management customer
-- (customers) to its Rental customer (rental_customers).
--
-- Rental bookings, agreements and invoices belong to rental_customers; Customer
-- Portal accounts belong to customers. With a link, the Customer Portal shows
-- the linked rental customer's rentals to the company's Transport users.
-- One link per customer and per rental customer.
--
-- Backfill: link only certain pairs — exactly one customer matches exactly one
-- rental customer in the same tenant on trade licence, else VAT / tax
-- registration number, else email (case-insensitive). Staff set or change the
-- rest in Customer Management → Customer Portal access. Additive only.

CREATE TABLE IF NOT EXISTS customer_rental_links (
  tenant_id           TEXT         NOT NULL,
  customer_id         TEXT         NOT NULL,
  rental_customer_id  TEXT         NOT NULL,
  linked_by           TEXT,
  linked_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, customer_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_rental_links_rental
  ON customer_rental_links (tenant_id, rental_customer_id);

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.customer_rental_links';
  EXECUTE 'CREATE POLICY tenant_isolation ON public.customer_rental_links FOR ALL
     USING ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))
     WITH CHECK ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))';
  EXECUTE 'ALTER TABLE public.customer_rental_links ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.customer_rental_links FORCE ROW LEVEL SECURITY';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_rental_links TO fleet360_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_rental_links TO fleet360_api_role';
  END IF;
END $$;

-- ── Backfill: certain one-to-one matches only ──────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.rental_customers') IS NULL OR to_regclass('public.customers') IS NULL THEN
    RETURN;
  END IF;
  WITH keys AS (
    -- One candidate key per (rental customer, customer) pair, strongest first.
    SELECT rc.tenant_id::text AS tenant_id, rc.id::text AS rental_id, c.id::text AS customer_id
      FROM rental_customers rc
      JOIN customers c ON c.tenant_id::text = rc.tenant_id::text AND c.deleted_at IS NULL
     WHERE rc.deleted_at IS NULL AND (
           (NULLIF(btrim(rc.trade_license), '') IS NOT NULL
             AND lower(btrim(rc.trade_license)) = lower(btrim(c.trade_license)))
        OR (NULLIF(btrim(rc.vat_number), '') IS NOT NULL
             AND lower(btrim(rc.vat_number)) = lower(btrim(c.tax_registration_number)))
        OR (NULLIF(btrim(rc.email), '') IS NOT NULL
             AND lower(btrim(rc.email)) = lower(btrim(c.email))))
  ),
  unique_pairs AS (
    SELECT k.* FROM keys k
     WHERE (SELECT COUNT(DISTINCT customer_id) FROM keys k2 WHERE k2.tenant_id = k.tenant_id AND k2.rental_id = k.rental_id) = 1
       AND (SELECT COUNT(DISTINCT rental_id) FROM keys k3 WHERE k3.tenant_id = k.tenant_id AND k3.customer_id = k.customer_id) = 1
  )
  INSERT INTO customer_rental_links (tenant_id, customer_id, rental_customer_id, linked_by)
  SELECT DISTINCT tenant_id, customer_id, rental_id, 'migration:exact-match' FROM unique_pairs
  ON CONFLICT DO NOTHING;
END $$;
