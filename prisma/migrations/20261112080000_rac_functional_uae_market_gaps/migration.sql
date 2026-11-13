-- ============================================================================
-- RAC Functional, Operational & UAE Market Gaps (Section 6: 6.1 - 6.5)
-- ============================================================================

-- 1. Walk-In Direct Checkout: relax rental_agreements.booking_id NOT NULL constraint
DO $$
BEGIN
  IF to_regclass('public.rental_agreements') IS NOT NULL THEN
    ALTER TABLE public.rental_agreements ALTER COLUMN booking_id DROP NOT NULL;
  END IF;
END $$;

-- 2. UAE KYC, Residency, Passport, Tourist IDP & Age fields on rental_customers
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS emirates_id TEXT;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS emirates_id_expiry TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS passport_expiry TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS visa_type TEXT DEFAULT 'RESIDENT';
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS international_permit_no TEXT;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS international_permit_expiry TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS license_issuing_country TEXT;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS license_issue_date TIMESTAMPTZ;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS date_of_birth TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rental_customers_tenant_emirates_id
  ON public.rental_customers (tenant_id, emirates_id)
  WHERE emirates_id IS NOT NULL AND deleted_at IS NULL;

-- 3. Ancillaries & Additional Drivers JSON snapshots on rental_bookings
ALTER TABLE IF EXISTS public.rental_bookings ADD COLUMN IF NOT EXISTS ancillaries JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.rental_bookings ADD COLUMN IF NOT EXISTS additional_drivers JSONB DEFAULT '[]'::jsonb;

-- 4. Mid-Rental Vehicle Swap split odometer / fuel / inspection columns on rental_vehicle_exchanges
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS exchange_no TEXT;
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS from_mileage_in INTEGER;
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS from_fuel_in INTEGER;
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS to_mileage_out INTEGER;
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS to_fuel_out INTEGER;
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS from_vehicle_status_after TEXT DEFAULT 'MAINTENANCE';
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS inspection_out_id TEXT;
ALTER TABLE IF EXISTS public.rental_vehicle_exchanges ADD COLUMN IF NOT EXISTS inspection_in_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_vehicle_exchanges_tenant_no
  ON public.rental_vehicle_exchanges (tenant_id, exchange_no)
  WHERE exchange_no IS NOT NULL;

-- 5. Traffic Fines double-billing prevention columns (symmetrical with toll_transactions)
ALTER TABLE IF EXISTS public.traffic_fines ADD COLUMN IF NOT EXISTS is_billed_to_customer BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS public.traffic_fines ADD COLUMN IF NOT EXISTS billed_invoice_id TEXT;

CREATE INDEX IF NOT EXISTS idx_traffic_fines_unbilled_agreement
  ON public.traffic_fines (tenant_id, rental_agreement_id, is_billed_to_customer)
  WHERE rental_agreement_id IS NOT NULL;

-- 6. OTA Channel ARI Sync & Pricing Markup columns on rental_channel_configs
ALTER TABLE IF EXISTS public.rental_channel_configs ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(6,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.rental_channel_configs ADD COLUMN IF NOT EXISTS default_markup_pct NUMERIC(6,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.rental_channel_configs ADD COLUMN IF NOT EXISTS auto_confirm BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS public.rental_channel_configs ADD COLUMN IF NOT EXISTS outbound_webhook_url TEXT;
ALTER TABLE IF EXISTS public.rental_channel_configs ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

-- 7. Incremental Pre-Auth Hold & Gateway Metadata columns on rac_card_preauths
ALTER TABLE IF EXISTS public.rac_card_preauths ADD COLUMN IF NOT EXISTS incremental_amount NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS public.rac_card_preauths ADD COLUMN IF NOT EXISTS gateway_metadata JSONB DEFAULT '{}'::jsonb;

-- 8. Additional Drivers table (KYC + fee ledger per booking / agreement)
CREATE TABLE IF NOT EXISTS public.rental_additional_drivers (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   TEXT         NOT NULL,
  booking_id                  TEXT,
  agreement_id                TEXT,
  full_name                   TEXT         NOT NULL,
  nationality                 TEXT,
  date_of_birth               TIMESTAMPTZ,
  emirates_id                 TEXT,
  passport_no                 TEXT,
  driving_license_no          TEXT         NOT NULL,
  license_issuing_country     TEXT,
  license_expiry              TIMESTAMPTZ  NOT NULL,
  international_permit_no     TEXT,
  international_permit_expiry TIMESTAMPTZ,
  daily_fee                   NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_fee                   NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_additional_drivers_tenant ON public.rental_additional_drivers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_additional_drivers_booking ON public.rental_additional_drivers (tenant_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rental_additional_drivers_agreement ON public.rental_additional_drivers (tenant_id, agreement_id) WHERE agreement_id IS NOT NULL;

-- 9. UAE Regulatory Renter Reporting ledger (RTA Tarrashud / Dubai Police / Abu Dhabi ITC)
CREATE TABLE IF NOT EXISTS public.rental_regulatory_reports (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT         NOT NULL,
  agreement_id        TEXT         NOT NULL,
  authority           TEXT         NOT NULL DEFAULT 'RTA_TARRASHUD',
  event_type          TEXT         NOT NULL,
  status              TEXT         NOT NULL DEFAULT 'QUEUED',
  external_ref        TEXT,
  manifest_payload    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  response_payload    JSONB,
  error_message       TEXT,
  submitted_by        TEXT,
  submitted_at        TIMESTAMPTZ,
  acknowledged_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_regulatory_reports_tenant ON public.rental_regulatory_reports (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_regulatory_reports_agreement ON public.rental_regulatory_reports (tenant_id, agreement_id, event_type);

-- 10. Stateful Cross-Border NOC Permits (Oman / KSA / GCC)
CREATE TABLE IF NOT EXISTS public.rental_cross_border_permits (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                TEXT         NOT NULL,
  permit_no                TEXT         NOT NULL,
  booking_id               TEXT,
  agreement_id             TEXT,
  customer_id              TEXT         NOT NULL,
  vehicle_id               TEXT         NOT NULL,
  destination_country      TEXT         NOT NULL,
  border_post              TEXT,
  departure_date           TIMESTAMPTZ  NOT NULL,
  return_date              TIMESTAMPTZ  NOT NULL,
  orange_card_policy_no    TEXT,
  orange_card_fee          NUMERIC(10,2) NOT NULL DEFAULT 0,
  permit_fee               NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_fee                NUMERIC(10,2) NOT NULL DEFAULT 0,
  mulkiya_verified         BOOLEAN      NOT NULL DEFAULT TRUE,
  insurance_verified       BOOLEAN      NOT NULL DEFAULT TRUE,
  status                   TEXT         NOT NULL DEFAULT 'ISSUED',
  issued_by                TEXT,
  revoked_at               TIMESTAMPTZ,
  notes                    TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, permit_no)
);
CREATE INDEX IF NOT EXISTS idx_rental_cross_border_permits_tenant ON public.rental_cross_border_permits (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rental_cross_border_permits_vehicle ON public.rental_cross_border_permits (tenant_id, vehicle_id, departure_date, return_date);
CREATE INDEX IF NOT EXISTS idx_rental_cross_border_permits_agreement ON public.rental_cross_border_permits (tenant_id, agreement_id) WHERE agreement_id IS NOT NULL;

-- 11. Remote Starter-Kill Immobilizer Audit & Safety Interlock Ledger
CREATE TABLE IF NOT EXISTS public.rental_immobilizer_commands (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT         NOT NULL,
  vehicle_id              TEXT         NOT NULL,
  agreement_id            TEXT,
  action                  TEXT         NOT NULL,
  status                  TEXT         NOT NULL DEFAULT 'PENDING_SAFE_STOP',
  reason                  TEXT         NOT NULL,
  speed_at_request_kmh    NUMERIC(8,2) DEFAULT 0,
  ignition_at_request     BOOLEAN      DEFAULT FALSE,
  safety_interlock_passed BOOLEAN      NOT NULL DEFAULT FALSE,
  requested_by            TEXT         NOT NULL,
  approved_by             TEXT,
  provider_command_ref    TEXT,
  executed_at             TIMESTAMPTZ,
  restored_at             TIMESTAMPTZ,
  notes                   TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_immobilizer_commands_tenant ON public.rental_immobilizer_commands (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_immobilizer_commands_vehicle ON public.rental_immobilizer_commands (tenant_id, vehicle_id, status);

-- 12. Enable & Force Tenant Row-Level Security on all new RAC tables
DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'rental_additional_drivers',
    'rental_regulatory_reports',
    'rental_cross_border_permits',
    'rental_immobilizer_commands'
  ] LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', v_tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I FOR ALL ' ||
        'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id::text = current_setting(''app.tenant_id'', true)) ' ||
        'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id::text = current_setting(''app.tenant_id'', true))',
        v_tbl
      );
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', v_tbl);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_api_role', v_tbl);
      END IF;
    END IF;
  END LOOP;
END $$;
