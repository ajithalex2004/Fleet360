-- Carrier mobile-app devices, carrier live presence, and load broadcasts.
--
-- src/lib/logistics/domain.ts used to create these four tables at request time
-- (ensureCarrierAppAndBroadcastSchema), called from every carrier-app device,
-- presence and load-broadcast function, and silently retried on failure. That
-- tripped the runtime-DDL guard (scripts/check-no-runtime-ddl.mjs), and where
-- the runtime role lacked CREATE the features had no tables at all. Moved here
-- verbatim: same columns, types, defaults and keys.
--
-- Row level security is deliberately NOT added here: the request-time DDL
-- never enabled it, and this migration only relocates that DDL. Enabling
-- tenant_isolation on these tables (as 20261001090000 did for the other
-- logistics tables) is a separate, reviewed change.
--
-- fleet360_app's privileges come from the default privileges on public
-- (20260910000010_grant_app_role_schema_access).
--
-- IF NOT EXISTS: a no-op where the request-time DDL already created them.

CREATE TABLE IF NOT EXISTS logistics_carrier_app_devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  driver_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  platform TEXT,
  push_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_carrier_presence (
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  driver_id TEXT,
  vehicle_id TEXT,
  vehicle_type TEXT,
  availability TEXT NOT NULL DEFAULT 'IDLE',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  speed_kph DOUBLE PRECISION,
  battery_pct DOUBLE PRECISION,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, carrier_id)
);

CREATE TABLE IF NOT EXISTS logistics_load_broadcasts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  rfq_id TEXT,
  status TEXT NOT NULL DEFAULT 'BROADCASTING',
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  radius_km DOUBLE PRECISION,
  vehicle_type TEXT,
  response_deadline_min INTEGER NOT NULL DEFAULT 10,
  auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  assigned_offer_id TEXT,
  assigned_carrier_id TEXT,
  created_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logistics_load_broadcast_offers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  broadcast_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  rfq_id TEXT,
  carrier_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OFFERED',
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  distance_km DOUBLE PRECISION,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
