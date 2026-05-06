-- Wave 5: BLE gateway-ready stub.
--
-- Inverts the boarding flow: passengers wear small BLE ID tags
-- (always-broadcasting); each bus has a BLE gateway (always-scanning) that
-- batches BOARD/ALIGHT events to the server. No phone needed in the
-- critical path — same UX for iOS and Android staff.
--
-- The existing BoardingEvent table already supports method='BLE_GATEWAY'
-- without a schema change.

-- ── BLE gateway hardware mounted in each bus ─────────────────────────────
-- One gateway per vehicle. The gateway authenticates against /api/bus-ops/
-- gateway/events via HMAC-SHA256 using BLE_GATEWAY_SHARED_SECRET (v1.0)
-- — upgrade to per-gateway secrets when rotating individual devices
-- becomes necessary in production.
CREATE TABLE IF NOT EXISTS "ble_gateways" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMPTZ  DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ,
  "vehicle_id"      UUID         NOT NULL UNIQUE,
  "gateway_id"      TEXT         NOT NULL UNIQUE,    -- device identifier (vendor MAC or registered alias)
  "model"           TEXT,                            -- e.g. "Minew G1", "Cassia X1000"
  "rssi_threshold_dbm" INT       DEFAULT -75,        -- below this is "out of range"
  "presence_grace_seconds" INT   DEFAULT 10,         -- how long absent before alighting
  "is_active"       BOOLEAN      DEFAULT TRUE,
  "last_seen_at"    TIMESTAMPTZ,
  "last_event_at"   TIMESTAMPTZ,
  "notes"           TEXT
);
CREATE INDEX IF NOT EXISTS "idx_ble_gateways_gateway_id"
  ON "ble_gateways" ("gateway_id");

-- ── BLE ID tags worn / carried by staff ──────────────────────────────────
-- Each staff member is issued one tag (keyring, badge-card, wristband).
-- The tag broadcasts a unique advertising ID continuously; the bus gateway
-- detects it within ~5m. Replaces phone-as-scanner for the high-trust path.
CREATE TABLE IF NOT EXISTS "staff_ble_tags" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMPTZ  DEFAULT NOW(),
  "staff_member_id" UUID         NOT NULL UNIQUE,
  "tag_id"          TEXT         NOT NULL UNIQUE,    -- gateway-readable advertising ID (MAC or namespace+instance)
  "form_factor"     TEXT,                            -- KEYRING|CARD|WRISTBAND|FOB
  "issued_at"       TIMESTAMPTZ  DEFAULT NOW(),
  "battery_replaced_at" TIMESTAMPTZ,
  "is_active"       BOOLEAN      DEFAULT TRUE,
  "notes"           TEXT
);
CREATE INDEX IF NOT EXISTS "idx_staff_ble_tags_tag_id"
  ON "staff_ble_tags" ("tag_id");

-- ── Tag presence cache for hysteresis (set by ingest endpoint) ───────────
-- Used by the raw-scan ingest path to detect alighting (tag stops being
-- seen). Pre-processed BOARD/ALIGHT events from on-device gateway logic
-- bypass this and write straight to BoardingEvent.
CREATE TABLE IF NOT EXISTS "ble_gateway_presence" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "gateway_id"      TEXT         NOT NULL,
  "vehicle_id"      UUID         NOT NULL,
  "tag_id"          TEXT         NOT NULL,
  "schedule_id"     UUID,                            -- bound to active trip when seen
  "passenger_id"    UUID,
  "staff_member_id" UUID,
  "first_seen_at"   TIMESTAMPTZ  NOT NULL,
  "last_seen_at"    TIMESTAMPTZ  NOT NULL,
  "last_rssi_dbm"   INT,
  "is_present"      BOOLEAN      NOT NULL DEFAULT TRUE,
  "alighted_at"     TIMESTAMPTZ,
  CONSTRAINT "uniq_ble_presence" UNIQUE ("gateway_id", "tag_id", "schedule_id")
);
CREATE INDEX IF NOT EXISTS "idx_ble_gateway_presence_schedule"
  ON "ble_gateway_presence" ("schedule_id");
