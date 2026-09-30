-- Assets module tables (asset register, HVA and medical assets, BLE tags,
-- movements, stock, field dispatch, returns) and the SPM planned-maintenance
-- tables.
--
-- These were only ever created at request time by ensureAssetsSchema,
-- ensureBleHwSchema and ensureSpmSchema (src/lib/assets/). The runtime role
-- may not run DDL, so on a fresh install they never existed and the whole
-- Assets module failed. Production already has them (created when the app
-- still connected as the owner), so every statement here is a no-op there:
-- the table, index and column statements are copied verbatim from those
-- three files and are all IF NOT EXISTS, and the policies below are replaced
-- with the identical standard rule 20260902000000_p0_apply_rls_all_tables
-- gave them. The runtime role is granted the same table access
-- 20261009090000_missing_module_tables gives the tables it creates; default
-- privileges do not reach these. Safe to re-run.

-- ── Assets core (src/lib/assets/schema.ts) ──
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

-- ── BLE hardware (src/lib/assets/ble-hw-schema.ts) ──
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS api_key_prefix TEXT;
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ;
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS total_detections BIGINT DEFAULT 0;
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS last_detection_at TIMESTAMPTZ;
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS supported_protocols TEXT[];
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS tag_model TEXT;
ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS tag_type TEXT DEFAULT 'GENERIC';
ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS tag_model TEXT;
ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS advertisement_interval_ms INT;
ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS current_gateway_id TEXT;
ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS current_gateway_zone TEXT;
ALTER TABLE ble_tags ADD COLUMN IF NOT EXISTS tx_power INT;
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
CREATE INDEX IF NOT EXISTS idx_ble_detections_tenant ON ble_detections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ble_detections_gateway ON ble_detections(gateway_id);
CREATE INDEX IF NOT EXISTS idx_ble_detections_tag_mac ON ble_detections(tag_mac);
CREATE INDEX IF NOT EXISTS idx_ble_detections_detected_at ON ble_detections(detected_at);
CREATE INDEX IF NOT EXISTS idx_ble_zone_rules_tenant ON ble_zone_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ble_zone_rules_gateway ON ble_zone_rules(gateway_id);
CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_tenant ON ble_movement_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_gateway ON ble_movement_alerts(to_gateway_id);
CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_tag_mac ON ble_movement_alerts(tag_mac);
CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_detected_at ON ble_movement_alerts(detected_at);
CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_status ON ble_movement_alerts(status);
CREATE INDEX IF NOT EXISTS idx_ble_movement_alerts_severity ON ble_movement_alerts(severity);

-- ── SPM (src/lib/assets/spm-schema.ts) ──
CREATE TABLE IF NOT EXISTS spm_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    cycle_code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    asset_id UUID,
    asset_name TEXT,
    asset_no TEXT,
    asset_category TEXT,
    asset_location TEXT,
    asset_domain TEXT,
    maintenance_type TEXT NOT NULL DEFAULT 'PREVENTIVE',
    interval_days INT NOT NULL DEFAULT 30,
    first_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    priority TEXT NOT NULL DEFAULT 'MEDIUM',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    assigned_to TEXT,
    estimated_duration_mins INT DEFAULT 60,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS spm_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    ticket_code TEXT NOT NULL,
    cycle_id UUID NOT NULL,
    cycle_name TEXT,
    asset_id UUID,
    asset_name TEXT,
    asset_no TEXT,
    asset_category TEXT,
    asset_location TEXT,
    asset_domain TEXT,
    maintenance_type TEXT,
    triggered_by TEXT NOT NULL DEFAULT 'SCHEDULER',
    status TEXT NOT NULL DEFAULT 'OPEN',
    priority TEXT NOT NULL DEFAULT 'MEDIUM',
    assigned_to TEXT,
    scheduled_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    findings TEXT,
    resolution_notes TEXT,
    technician_notes TEXT,
    completion_photos TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
CREATE UNIQUE INDEX IF NOT EXISTS spm_tickets_cycle_day_key
  ON spm_tickets (cycle_id, ((scheduled_date AT TIME ZONE 'UTC')::date));
CREATE TABLE IF NOT EXISTS spm_checklist_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    cycle_id UUID NOT NULL,
    item_order INT DEFAULT 0,
    description TEXT NOT NULL,
    is_mandatory BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS spm_ticket_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    ticket_id UUID NOT NULL,
    template_id UUID,
    item_order INT DEFAULT 0,
    description TEXT NOT NULL,
    is_mandatory BOOLEAN DEFAULT TRUE,
    is_checked BOOLEAN DEFAULT FALSE,
    checked_at TIMESTAMPTZ,
    checked_by TEXT,
    notes TEXT
  );
CREATE TABLE IF NOT EXISTS spm_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    run_at TIMESTAMPTZ DEFAULT NOW(),
    triggered_by TEXT NOT NULL DEFAULT 'MANUAL',
    cycles_checked INT DEFAULT 0,
    tickets_generated INT DEFAULT 0,
    cycles_skipped INT DEFAULT 0,
    run_duration_ms INT,
    summary JSONB
  );
CREATE INDEX IF NOT EXISTS idx_spm_cycles_tenant ON spm_cycles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spm_cycles_status ON spm_cycles(status);
CREATE INDEX IF NOT EXISTS idx_spm_cycles_next_run ON spm_cycles(next_run_at);
CREATE INDEX IF NOT EXISTS idx_spm_cycles_asset_id ON spm_cycles(asset_id);
CREATE INDEX IF NOT EXISTS idx_spm_cycles_priority ON spm_cycles(priority);
CREATE INDEX IF NOT EXISTS idx_spm_tickets_tenant ON spm_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spm_tickets_cycle_id ON spm_tickets(cycle_id);
CREATE INDEX IF NOT EXISTS idx_spm_tickets_status ON spm_tickets(status);
CREATE INDEX IF NOT EXISTS idx_spm_tickets_scheduled_date ON spm_tickets(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_spm_tickets_priority ON spm_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_spm_tickets_asset_id ON spm_tickets(asset_id);
CREATE INDEX IF NOT EXISTS idx_spm_checklist_templates_cycle ON spm_checklist_templates(cycle_id);
CREATE INDEX IF NOT EXISTS idx_spm_checklist_templates_tenant ON spm_checklist_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spm_ticket_checks_ticket ON spm_ticket_checks(ticket_id);
CREATE INDEX IF NOT EXISTS idx_spm_ticket_checks_tenant ON spm_ticket_checks(tenant_id);
CREATE TABLE IF NOT EXISTS spm_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    ticket_id UUID,
    cycle_id UUID,
    user_id TEXT NOT NULL,
    user_name TEXT,
    user_email TEXT,
    type TEXT NOT NULL DEFAULT 'TICKET_ASSIGNED',
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
ALTER TABLE spm_cycles ADD COLUMN IF NOT EXISTS assigned_to_user_id TEXT;
ALTER TABLE spm_cycles ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;
ALTER TABLE spm_tickets ADD COLUMN IF NOT EXISTS assigned_to_user_id TEXT;
ALTER TABLE spm_tickets ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;
CREATE INDEX IF NOT EXISTS idx_spm_audit_logs_tenant ON spm_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spm_audit_logs_run_at ON spm_audit_logs(run_at);
CREATE INDEX IF NOT EXISTS idx_spm_notifications_tenant ON spm_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_spm_notifications_user_id ON spm_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_spm_notifications_ticket_id ON spm_notifications(ticket_id);
CREATE INDEX IF NOT EXISTS idx_spm_notifications_is_read ON spm_notifications(is_read);

-- ── Runtime role access and row level security (standard tenant_isolation rule) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_categories TO fleet360_app;
ALTER TABLE IF EXISTS public.asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.asset_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.asset_categories;
CREATE POLICY tenant_isolation ON public.asset_categories FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_registry TO fleet360_app;
ALTER TABLE IF EXISTS public.asset_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.asset_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.asset_registry;
CREATE POLICY tenant_isolation ON public.asset_registry FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hva_assets TO fleet360_app;
ALTER TABLE IF EXISTS public.hva_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hva_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.hva_assets;
CREATE POLICY tenant_isolation ON public.hva_assets FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medical_assets TO fleet360_app;
ALTER TABLE IF EXISTS public.medical_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.medical_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.medical_assets;
CREATE POLICY tenant_isolation ON public.medical_assets FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medical_seal_logs TO fleet360_app;
ALTER TABLE IF EXISTS public.medical_seal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.medical_seal_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.medical_seal_logs;
CREATE POLICY tenant_isolation ON public.medical_seal_logs FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ble_tags TO fleet360_app;
ALTER TABLE IF EXISTS public.ble_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ble_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.ble_tags;
CREATE POLICY tenant_isolation ON public.ble_tags FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_movements TO fleet360_app;
ALTER TABLE IF EXISTS public.asset_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.asset_movements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.asset_movements;
CREATE POLICY tenant_isolation ON public.asset_movements FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transactions TO fleet360_app;
ALTER TABLE IF EXISTS public.stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.stock_transactions;
CREATE POLICY tenant_isolation ON public.stock_transactions FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_dispatch TO fleet360_app;
ALTER TABLE IF EXISTS public.field_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.field_dispatch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.field_dispatch;
CREATE POLICY tenant_isolation ON public.field_dispatch FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_dispatch_items TO fleet360_app;
ALTER TABLE IF EXISTS public.field_dispatch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.field_dispatch_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.field_dispatch_items;
CREATE POLICY tenant_isolation ON public.field_dispatch_items FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personnel_stock TO fleet360_app;
ALTER TABLE IF EXISTS public.personnel_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.personnel_stock FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.personnel_stock;
CREATE POLICY tenant_isolation ON public.personnel_stock FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_requests TO fleet360_app;
ALTER TABLE IF EXISTS public.return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.return_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.return_requests;
CREATE POLICY tenant_isolation ON public.return_requests FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_request_items TO fleet360_app;
ALTER TABLE IF EXISTS public.return_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.return_request_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.return_request_items;
CREATE POLICY tenant_isolation ON public.return_request_items FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spm_cycles TO fleet360_app;
ALTER TABLE IF EXISTS public.spm_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.spm_cycles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.spm_cycles;
CREATE POLICY tenant_isolation ON public.spm_cycles FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spm_checklist_templates TO fleet360_app;
ALTER TABLE IF EXISTS public.spm_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.spm_checklist_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.spm_checklist_templates;
CREATE POLICY tenant_isolation ON public.spm_checklist_templates FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spm_ticket_checks TO fleet360_app;
ALTER TABLE IF EXISTS public.spm_ticket_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.spm_ticket_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.spm_ticket_checks;
CREATE POLICY tenant_isolation ON public.spm_ticket_checks FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spm_audit_logs TO fleet360_app;
ALTER TABLE IF EXISTS public.spm_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.spm_audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.spm_audit_logs;
CREATE POLICY tenant_isolation ON public.spm_audit_logs FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spm_notifications TO fleet360_app;
ALTER TABLE IF EXISTS public.spm_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.spm_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.spm_notifications;
CREATE POLICY tenant_isolation ON public.spm_notifications FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
