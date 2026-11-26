-- Customer Portal 3c: Transport requests raised by customers.
--
--  customer_transport_requests   one row per request a customer submits for a
--  Transport category (Rent-a-Car, Logistics, …). `form_values` holds the
--  answers to the category's form (src/lib/transport-catalog), checked on the
--  server before saving. A few answers are copied to columns for lists and
--  search. `routed_*` points at the record the request created in its own
--  module (e.g. a Logistics shipping request); until a category is routed,
--  staff handle the request in Booking Portal → Customer requests.
--  `lifecycle` is the stage history shown to the customer: [{status, at, by}].
--
-- Request number: TR-<customer code>-YYNNNN, one yearly series per tenant.
-- Additive only.

CREATE TABLE IF NOT EXISTS customer_transport_requests (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT         NOT NULL,
  customer_id           TEXT         NOT NULL,
  request_no            TEXT         NOT NULL,
  category              TEXT         NOT NULL CHECK (category IN ('RAC', 'LEASING', 'LIMOUSINE', 'STAFF_TRANSPORT',
                                                                  'EXECUTIVE', 'LOGISTICS', 'SCHOOL_BUS', 'RECOVERY')),
  status                TEXT         NOT NULL DEFAULT 'SUBMITTED'
                          CHECK (status IN ('PENDING_APPROVAL', 'SUBMITTED', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS',
                                            'COMPLETED', 'REJECTED', 'CANCELLED')),
  form_values           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  pickup                TEXT,
  dropoff               TEXT,
  service_date          DATE,
  service_time          TEXT,
  vehicle_category      TEXT,
  requested_by_user_id  TEXT,
  requested_by_name     TEXT,
  assigned_driver_name  TEXT,
  assigned_driver_phone TEXT,
  assigned_vehicle      TEXT,
  routed_module         TEXT,
  routed_record_id      TEXT,
  routed_record_ref     TEXT,
  customer_note         TEXT,
  staff_note            TEXT,
  lifecycle             JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_transport_requests_no
  ON customer_transport_requests (tenant_id, request_no);
CREATE INDEX IF NOT EXISTS idx_customer_transport_requests_customer
  ON customer_transport_requests (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_transport_requests_status
  ON customer_transport_requests (tenant_id, status, created_at DESC);

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.customer_transport_requests';
  EXECUTE 'CREATE POLICY tenant_isolation ON public.customer_transport_requests FOR ALL
     USING ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))
     WITH CHECK ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))';
  EXECUTE 'ALTER TABLE public.customer_transport_requests ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.customer_transport_requests FORCE ROW LEVEL SECURITY';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_transport_requests TO fleet360_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_transport_requests TO fleet360_api_role';
  END IF;
END $$;
