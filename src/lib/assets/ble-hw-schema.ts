import { prisma } from '@/lib/prisma';

const _g = globalThis as { _bleHwSchemaInit?: Promise<void> };

// Singleton: runs once per server process, concurrent callers wait on same Promise
export function ensureBleHwSchema(): Promise<void> {
  if (_g._bleHwSchemaInit) return _g._bleHwSchemaInit;
  _g._bleHwSchemaInit = _doInit().catch((e) => {
    delete _g._bleHwSchemaInit;
    throw e;
  });
  return _g._bleHwSchemaInit;
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      -- ── Column additions to ble_gateways ──────────────────────────────────────
      ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
      ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS api_key_prefix TEXT;
      ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ;
      ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS total_detections BIGINT DEFAULT 0;
      ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS last_detection_at TIMESTAMPTZ;
      ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS supported_protocols TEXT[];
      ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS tag_model TEXT;

      -- ── Column additions to ble_tags ──────────────────────────────────────────
      ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS tag_type TEXT DEFAULT 'GENERIC';
      ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS tag_model TEXT;
      ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS advertisement_interval_ms INT;
      ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS current_gateway_id TEXT;
      ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS current_gateway_zone TEXT;
      ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS tx_power INT;

      -- ── ble_detections ────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS ble_detections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        gateway_id TEXT NOT NULL,
        gateway_code TEXT,
        gateway_zone TEXT,
        tag_mac TEXT NOT NULL,
        tag_id TEXT,
        asset_name TEXT,
        rssi INT,
        tx_power INT,
        battery_pct INT,
        raw_payload JSONB,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ── ble_zone_rules ────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS ble_zone_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        gateway_id TEXT NOT NULL,
        gateway_code TEXT,
        gateway_zone TEXT,
        rule_name TEXT,
        allowed_domains TEXT[],
        allowed_categories TEXT[],
        alert_on_violation BOOLEAN DEFAULT TRUE,
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        is_active BOOLEAN DEFAULT TRUE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ── ble_movement_alerts ───────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS ble_movement_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        detection_id TEXT,
        tag_mac TEXT NOT NULL,
        tag_id TEXT,
        asset_name TEXT,
        asset_no TEXT,
        asset_domain TEXT,
        from_gateway_id TEXT,
        from_zone TEXT,
        to_gateway_id TEXT NOT NULL,
        to_zone TEXT NOT NULL,
        rule_id TEXT,
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        status TEXT NOT NULL DEFAULT 'OPEN',
        acknowledged_by TEXT,
        acknowledged_at TIMESTAMPTZ,
        resolution_notes TEXT,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ── Indexes: ble_detections ───────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_ble_detections_tenant ON ble_detections(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ble_detections_gateway ON ble_detections(gateway_id);
      CREATE INDEX IF NOT EXISTS idx_ble_detections_tag_mac ON ble_detections(tag_mac);
      CREATE INDEX IF NOT EXISTS idx_ble_detections_detected_at ON ble_detections(detected_at);

      -- ── Indexes: ble_zone_rules ───────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_ble_zone_rules_tenant ON ble_zone_rules(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ble_zone_rules_gateway ON ble_zone_rules(gateway_id);

      -- ── Indexes: ble_movement_alerts ──────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_tenant ON ble_movement_alerts(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_gateway ON ble_movement_alerts(to_gateway_id);
      CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_tag_mac ON ble_movement_alerts(tag_mac);
      CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_detected_at ON ble_movement_alerts(detected_at);
      CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_status ON ble_movement_alerts(status);
      CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_severity ON ble_movement_alerts(severity);
    END
    $DDL$
  `);
}
