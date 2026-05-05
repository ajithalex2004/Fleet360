import { prisma } from '@/lib/prisma';

const _g = globalThis as { _assetsSchemaInit?: Promise<void> };

// Singleton: runs once per server process, concurrent callers wait on same Promise
export function ensureAssetsSchema(): Promise<void> {
  if (_g._assetsSchemaInit) return _g._assetsSchemaInit;
  _g._assetsSchemaInit = _doInit().catch((e) => {
    delete _g._assetsSchemaInit;
    throw e;
  });
  return _g._assetsSchemaInit;
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      -- asset_categories
      CREATE TABLE IF NOT EXISTS asset_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        parent_id UUID,
        domain TEXT NOT NULL DEFAULT 'GENERAL',
        icon TEXT DEFAULT '📦',
        color TEXT DEFAULT '#6366f1',
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- asset_registry
      CREATE TABLE IF NOT EXISTS asset_registry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        asset_no TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category_id UUID,
        subcategory TEXT,
        domain TEXT NOT NULL DEFAULT 'GENERAL',
        asset_type TEXT NOT NULL DEFAULT 'CONSUMABLE',
        oem_part_number TEXT,
        manufacturer TEXT,
        model TEXT,
        unit_of_measure TEXT DEFAULT 'UNIT',
        current_stock NUMERIC(12,3) DEFAULT 0,
        allocated_stock NUMERIC(12,3) DEFAULT 0,
        available_stock NUMERIC(12,3) GENERATED ALWAYS AS (current_stock - allocated_stock) STORED,
        reorder_threshold NUMERIC(12,3) DEFAULT 0,
        reorder_quantity NUMERIC(12,3) DEFAULT 0,
        unit_cost_aed NUMERIC(12,2) DEFAULT 0,
        total_value_aed NUMERIC(12,2) GENERATED ALWAYS AS (current_stock * unit_cost_aed) STORED,
        warehouse_location TEXT,
        bin_location TEXT,
        is_serialized BOOLEAN DEFAULT FALSE,
        is_restricted BOOLEAN DEFAULT FALSE,
        requires_calibration BOOLEAN DEFAULT FALSE,
        is_ble_tracked BOOLEAN DEFAULT FALSE,
        ble_tag_id TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'IN_STOCK',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- hva_assets
      CREATE TABLE IF NOT EXISTS hva_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        asset_no TEXT NOT NULL,
        registry_id UUID,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        serial_number TEXT,
        oem_part_number TEXT,
        manufacturer TEXT,
        model TEXT,
        year INT,
        domain TEXT DEFAULT 'GENERAL',
        purchase_date DATE,
        purchase_cost_aed NUMERIC(14,2) DEFAULT 0,
        current_value_aed NUMERIC(14,2) DEFAULT 0,
        depreciation_method TEXT DEFAULT 'STRAIGHT_LINE',
        assigned_vehicle_id TEXT,
        assigned_entity_id TEXT,
        assigned_entity_type TEXT,
        custodian_name TEXT,
        custodian_id TEXT,
        custodian_department TEXT,
        custody_start_date DATE,
        insurance_policy_no TEXT,
        insurance_provider TEXT,
        insurance_expiry DATE,
        insurance_premium_aed NUMERIC(12,2),
        last_calibration_date DATE,
        calibration_due_date DATE,
        calibration_interval_days INT DEFAULT 365,
        calibration_provider TEXT,
        calibration_cert_no TEXT,
        warranty_expiry DATE,
        condition TEXT DEFAULT 'GOOD',
        ble_tag_id TEXT,
        location_zone TEXT,
        last_lat NUMERIC(10,7),
        last_lng NUMERIC(10,7),
        last_seen_at TIMESTAMPTZ,
        status TEXT DEFAULT 'ACTIVE',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- medical_assets
      CREATE TABLE IF NOT EXISTS medical_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        asset_no TEXT NOT NULL,
        registry_id UUID,
        name TEXT NOT NULL,
        category TEXT,
        asset_type TEXT DEFAULT 'SUPPLY',
        is_restricted BOOLEAN DEFAULT FALSE,
        controlled_substance_level TEXT,
        batch_number TEXT,
        lot_number TEXT,
        manufacture_date DATE,
        expiry_date DATE,
        quantity NUMERIC(12,3) DEFAULT 0,
        unit TEXT DEFAULT 'UNIT',
        unit_cost_aed NUMERIC(12,2) DEFAULT 0,
        storage_requirement TEXT,
        storage_location TEXT,
        current_seal_no TEXT,
        last_sealed_at TIMESTAMPTZ,
        last_sealed_by TEXT,
        last_count_date DATE,
        last_count_qty NUMERIC(12,3),
        variance_qty NUMERIC(12,3) DEFAULT 0,
        variance_reason TEXT,
        domain TEXT DEFAULT 'AMBULANCE',
        assigned_vehicle_id TEXT,
        status TEXT DEFAULT 'ACTIVE',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- medical_seal_logs
      CREATE TABLE IF NOT EXISTS medical_seal_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        medical_asset_id UUID NOT NULL,
        action TEXT NOT NULL,
        seal_number TEXT,
        action_by TEXT NOT NULL,
        action_at TIMESTAMPTZ DEFAULT NOW(),
        quantity_at_action NUMERIC(12,3),
        quantity_expected NUMERIC(12,3),
        variance_qty NUMERIC(12,3) DEFAULT 0,
        witness_name TEXT,
        reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ble_tags
      CREATE TABLE IF NOT EXISTS ble_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        tag_mac TEXT NOT NULL,
        tag_name TEXT,
        assigned_asset_id TEXT,
        assigned_asset_type TEXT,
        assigned_asset_name TEXT,
        battery_pct INT DEFAULT 100,
        signal_rssi INT,
        last_seen_at TIMESTAMPTZ,
        last_gateway_id TEXT,
        last_location_zone TEXT,
        last_lat NUMERIC(10,7),
        last_lng NUMERIC(10,7),
        firmware_version TEXT,
        status TEXT DEFAULT 'ACTIVE',
        replacement_tag_id TEXT,
        replaced_at TIMESTAMPTZ,
        replacement_reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- ble_gateways
      CREATE TABLE IF NOT EXISTS ble_gateways (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        gateway_code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        location_type TEXT NOT NULL DEFAULT 'DEPOT',
        vehicle_id TEXT,
        location_name TEXT NOT NULL,
        location_zone TEXT,
        lat NUMERIC(10,7),
        lng NUMERIC(10,7),
        ip_address TEXT,
        firmware_version TEXT,
        tags_visible INT DEFAULT 0,
        last_heartbeat TIMESTAMPTZ,
        status TEXT DEFAULT 'ONLINE',
        alert_on_offline BOOLEAN DEFAULT TRUE,
        offline_threshold_min INT DEFAULT 15,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- asset_movements
      CREATE TABLE IF NOT EXISTS asset_movements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        asset_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        asset_name TEXT,
        asset_no TEXT,
        movement_type TEXT NOT NULL,
        from_location TEXT,
        from_custodian TEXT,
        to_location TEXT,
        to_custodian TEXT,
        quantity NUMERIC(12,3),
        reference_type TEXT,
        reference_id TEXT,
        reference_no TEXT,
        moved_by TEXT NOT NULL DEFAULT 'system',
        moved_at TIMESTAMPTZ DEFAULT NOW(),
        lat NUMERIC(10,7),
        lng NUMERIC(10,7),
        gateway_id TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- stock_transactions
      CREATE TABLE IF NOT EXISTS stock_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        asset_id UUID NOT NULL,
        asset_name TEXT,
        asset_no TEXT,
        transaction_type TEXT NOT NULL,
        quantity_before NUMERIC(12,3) DEFAULT 0,
        quantity_change NUMERIC(12,3) NOT NULL,
        quantity_after NUMERIC(12,3) DEFAULT 0,
        unit_cost_aed NUMERIC(12,2) DEFAULT 0,
        total_value_aed NUMERIC(12,2) DEFAULT 0,
        reference_type TEXT,
        reference_id TEXT,
        reference_no TEXT,
        from_location TEXT,
        to_location TEXT,
        performed_by TEXT NOT NULL DEFAULT 'system',
        performed_at TIMESTAMPTZ DEFAULT NOW(),
        domain TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- field_dispatch
      CREATE TABLE IF NOT EXISTS field_dispatch (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        dispatch_no TEXT NOT NULL,
        from_warehouse TEXT NOT NULL,
        technician_id TEXT,
        technician_name TEXT NOT NULL,
        technician_phone TEXT,
        status TEXT DEFAULT 'PENDING',
        dispatched_by TEXT,
        dispatched_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        work_order_no TEXT,
        domain TEXT DEFAULT 'GENERAL',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- field_dispatch_items
      CREATE TABLE IF NOT EXISTS field_dispatch_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dispatch_id UUID NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        asset_id UUID NOT NULL,
        asset_name TEXT,
        asset_no TEXT,
        quantity_dispatched NUMERIC(12,3) NOT NULL,
        quantity_accepted NUMERIC(12,3) DEFAULT 0,
        quantity_consumed NUMERIC(12,3) DEFAULT 0,
        quantity_returned NUMERIC(12,3) DEFAULT 0,
        unit_cost_aed NUMERIC(12,2) DEFAULT 0,
        notes TEXT
      );

      -- personnel_stock
      CREATE TABLE IF NOT EXISTS personnel_stock (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        technician_id TEXT NOT NULL,
        technician_name TEXT NOT NULL,
        asset_id UUID NOT NULL,
        asset_name TEXT,
        asset_no TEXT,
        quantity_on_hand NUMERIC(12,3) DEFAULT 0,
        unit_cost_aed NUMERIC(12,2) DEFAULT 0,
        last_dispatch_id TEXT,
        last_updated TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, technician_id, asset_id)
      );

      -- return_requests
      CREATE TABLE IF NOT EXISTS return_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        return_no TEXT NOT NULL,
        technician_id TEXT,
        technician_name TEXT NOT NULL,
        technician_phone TEXT,
        from_dispatch_id TEXT,
        status TEXT DEFAULT 'PENDING',
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_by TEXT,
        reviewed_at TIMESTAMPTZ,
        restoration_approved_by TEXT,
        restoration_at TIMESTAMPTZ,
        domain TEXT DEFAULT 'GENERAL',
        reason TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- return_request_items
      CREATE TABLE IF NOT EXISTS return_request_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        return_id UUID NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        asset_id UUID NOT NULL,
        asset_name TEXT,
        asset_no TEXT,
        quantity_returned NUMERIC(12,3) NOT NULL,
        condition TEXT DEFAULT 'GOOD',
        is_restored BOOLEAN DEFAULT FALSE,
        restore_to_stock BOOLEAN DEFAULT TRUE,
        unit_cost_aed NUMERIC(12,2) DEFAULT 0,
        reason TEXT,
        notes TEXT
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_asset_categories_tenant ON asset_categories(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_asset_categories_domain ON asset_categories(domain);
      CREATE INDEX IF NOT EXISTS idx_asset_categories_parent ON asset_categories(parent_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_registry_tenant_no ON asset_registry(tenant_id, asset_no);
      CREATE INDEX IF NOT EXISTS idx_asset_registry_tenant ON asset_registry(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_asset_registry_domain ON asset_registry(domain);
      CREATE INDEX IF NOT EXISTS idx_asset_registry_status ON asset_registry(status);
      CREATE INDEX IF NOT EXISTS idx_asset_registry_category ON asset_registry(category_id);
      CREATE INDEX IF NOT EXISTS idx_asset_registry_active ON asset_registry(is_active);

      CREATE INDEX IF NOT EXISTS idx_hva_assets_tenant ON hva_assets(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_hva_assets_status ON hva_assets(status);
      CREATE INDEX IF NOT EXISTS idx_hva_assets_domain ON hva_assets(domain);
      CREATE INDEX IF NOT EXISTS idx_hva_assets_calibration ON hva_assets(calibration_due_date);
      CREATE INDEX IF NOT EXISTS idx_hva_assets_insurance ON hva_assets(insurance_expiry);

      CREATE INDEX IF NOT EXISTS idx_medical_assets_tenant ON medical_assets(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_medical_assets_status ON medical_assets(status);
      CREATE INDEX IF NOT EXISTS idx_medical_assets_expiry ON medical_assets(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_medical_assets_domain ON medical_assets(domain);

      CREATE INDEX IF NOT EXISTS idx_medical_seal_logs_asset ON medical_seal_logs(medical_asset_id);
      CREATE INDEX IF NOT EXISTS idx_medical_seal_logs_tenant ON medical_seal_logs(tenant_id);

      CREATE INDEX IF NOT EXISTS idx_ble_tags_tenant ON ble_tags(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ble_tags_mac ON ble_tags(tag_mac);
      CREATE INDEX IF NOT EXISTS idx_ble_tags_status ON ble_tags(status);
      CREATE INDEX IF NOT EXISTS idx_ble_tags_asset ON ble_tags(assigned_asset_id);

      CREATE INDEX IF NOT EXISTS idx_ble_gateways_tenant ON ble_gateways(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ble_gateways_status ON ble_gateways(status);

      CREATE INDEX IF NOT EXISTS idx_asset_movements_tenant ON asset_movements(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_asset_movements_asset ON asset_movements(asset_id);
      CREATE INDEX IF NOT EXISTS idx_asset_movements_type ON asset_movements(asset_type);
      CREATE INDEX IF NOT EXISTS idx_asset_movements_moved_at ON asset_movements(moved_at);

      CREATE INDEX IF NOT EXISTS idx_stock_transactions_tenant ON stock_transactions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_stock_transactions_asset ON stock_transactions(asset_id);
      CREATE INDEX IF NOT EXISTS idx_stock_transactions_type ON stock_transactions(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_stock_transactions_performed_at ON stock_transactions(performed_at);

      CREATE INDEX IF NOT EXISTS idx_field_dispatch_tenant ON field_dispatch(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_field_dispatch_status ON field_dispatch(status);
      CREATE INDEX IF NOT EXISTS idx_field_dispatch_technician ON field_dispatch(technician_id);

      CREATE INDEX IF NOT EXISTS idx_field_dispatch_items_dispatch ON field_dispatch_items(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_field_dispatch_items_asset ON field_dispatch_items(asset_id);

      CREATE INDEX IF NOT EXISTS idx_personnel_stock_tenant ON personnel_stock(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_personnel_stock_technician ON personnel_stock(technician_id);
      CREATE INDEX IF NOT EXISTS idx_personnel_stock_asset ON personnel_stock(asset_id);

      CREATE INDEX IF NOT EXISTS idx_return_requests_tenant ON return_requests(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests(status);
      CREATE INDEX IF NOT EXISTS idx_return_request_items_return ON return_request_items(return_id);
    END
    $DDL$
  `);
}
