/**
 * Column types of the Assets, BLE and SPM tables, for casting query
 * parameters. Prisma binds a JS string as text, and Postgres will not assign
 * text to a uuid, timestamptz, numeric, boolean, jsonb or array column, so
 * dynamic UPDATEs cast each value to its column's type.
 *
 * Taken from the table definitions in src/lib/assets/schema.ts,
 * src/lib/assets/ble-hw-schema.ts and src/lib/assets/spm-schema.ts; text
 * columns need no cast and are not listed.
 */
const COLUMN_TYPES: Record<string, Record<string, string>> = {
  asset_categories: { created_at: 'timestamptz', id: 'uuid', is_active: 'boolean', parent_id: 'uuid', sort_order: 'int', updated_at: 'timestamptz' },
  asset_movements: { created_at: 'timestamptz', id: 'uuid', lat: 'numeric', lng: 'numeric', moved_at: 'timestamptz', quantity: 'numeric' },
  asset_registry: { allocated_stock: 'numeric', available_stock: 'numeric', category_id: 'uuid', created_at: 'timestamptz', current_stock: 'numeric', id: 'uuid', is_active: 'boolean', is_ble_tracked: 'boolean', is_restricted: 'boolean', is_serialized: 'boolean', reorder_quantity: 'numeric', reorder_threshold: 'numeric', requires_calibration: 'boolean', total_value_aed: 'numeric', unit_cost_aed: 'numeric', updated_at: 'timestamptz' },
  ble_detections: { battery_pct: 'int', created_at: 'timestamptz', detected_at: 'timestamptz', id: 'uuid', raw_payload: 'jsonb', rssi: 'int', tx_power: 'int' },
  ble_gateways: { alert_on_offline: 'boolean', created_at: 'timestamptz', id: 'uuid', last_heartbeat: 'timestamptz', lat: 'numeric', lng: 'numeric', offline_threshold_min: 'int', tags_visible: 'int', updated_at: 'timestamptz' },
  ble_movement_alerts: { acknowledged_at: 'timestamptz', created_at: 'timestamptz', detected_at: 'timestamptz', id: 'uuid' },
  ble_tags: { battery_pct: 'int', created_at: 'timestamptz', id: 'uuid', last_lat: 'numeric', last_lng: 'numeric', last_seen_at: 'timestamptz', replaced_at: 'timestamptz', signal_rssi: 'int', updated_at: 'timestamptz' },
  ble_zone_rules: { alert_on_violation: 'boolean', allowed_categories: 'text[]', allowed_domains: 'text[]', created_at: 'timestamptz', id: 'uuid', is_active: 'boolean', updated_at: 'timestamptz' },
  field_dispatch: { accepted_at: 'timestamptz', created_at: 'timestamptz', dispatched_at: 'timestamptz', id: 'uuid', updated_at: 'timestamptz' },
  field_dispatch_items: { asset_id: 'uuid', dispatch_id: 'uuid', id: 'uuid', quantity_accepted: 'numeric', quantity_consumed: 'numeric', quantity_dispatched: 'numeric', quantity_returned: 'numeric', unit_cost_aed: 'numeric' },
  hva_assets: { calibration_due_date: 'date', calibration_interval_days: 'int', created_at: 'timestamptz', current_value_aed: 'numeric', custody_start_date: 'date', id: 'uuid', insurance_expiry: 'date', insurance_premium_aed: 'numeric', last_calibration_date: 'date', last_lat: 'numeric', last_lng: 'numeric', last_seen_at: 'timestamptz', purchase_cost_aed: 'numeric', purchase_date: 'date', registry_id: 'uuid', updated_at: 'timestamptz', warranty_expiry: 'date', year: 'int' },
  medical_assets: { created_at: 'timestamptz', expiry_date: 'date', id: 'uuid', is_restricted: 'boolean', last_count_date: 'date', last_count_qty: 'numeric', last_sealed_at: 'timestamptz', manufacture_date: 'date', quantity: 'numeric', registry_id: 'uuid', unit_cost_aed: 'numeric', updated_at: 'timestamptz', variance_qty: 'numeric' },
  medical_seal_logs: { action_at: 'timestamptz', created_at: 'timestamptz', id: 'uuid', medical_asset_id: 'uuid', quantity_at_action: 'numeric', quantity_expected: 'numeric', variance_qty: 'numeric' },
  personnel_stock: { asset_id: 'uuid', id: 'uuid', last_updated: 'timestamptz', quantity_on_hand: 'numeric', unit_cost_aed: 'numeric' },
  return_request_items: { asset_id: 'uuid', id: 'uuid', is_restored: 'boolean', quantity_returned: 'numeric', restore_to_stock: 'boolean', return_id: 'uuid', unit_cost_aed: 'numeric' },
  return_requests: { created_at: 'timestamptz', id: 'uuid', requested_at: 'timestamptz', restoration_at: 'timestamptz', reviewed_at: 'timestamptz', updated_at: 'timestamptz' },
  spm_audit_logs: { cycles_checked: 'int', cycles_skipped: 'int', id: 'uuid', run_at: 'timestamptz', run_duration_ms: 'int', summary: 'jsonb', tickets_generated: 'int' },
  spm_checklist_templates: { created_at: 'timestamptz', cycle_id: 'uuid', id: 'uuid', is_mandatory: 'boolean', item_order: 'int' },
  spm_cycles: { asset_id: 'uuid', created_at: 'timestamptz', estimated_duration_mins: 'int', first_run_at: 'timestamptz', id: 'uuid', interval_days: 'int', last_run_at: 'timestamptz', next_run_at: 'timestamptz', updated_at: 'timestamptz' },
  spm_notifications: { created_at: 'timestamptz', cycle_id: 'uuid', id: 'uuid', is_read: 'boolean', read_at: 'timestamptz', ticket_id: 'uuid' },
  spm_ticket_checks: { checked_at: 'timestamptz', id: 'uuid', is_checked: 'boolean', is_mandatory: 'boolean', item_order: 'int', template_id: 'uuid', ticket_id: 'uuid' },
  spm_tickets: { asset_id: 'uuid', completed_at: 'timestamptz', completion_photos: 'text[]', created_at: 'timestamptz', cycle_id: 'uuid', id: 'uuid', scheduled_date: 'timestamptz', started_at: 'timestamptz', updated_at: 'timestamptz' },
  stock_transactions: { asset_id: 'uuid', created_at: 'timestamptz', id: 'uuid', performed_at: 'timestamptz', quantity_after: 'numeric', quantity_before: 'numeric', quantity_change: 'numeric', total_value_aed: 'numeric', unit_cost_aed: 'numeric' },
};

/** `::type` for a column, or '' when the column is text or unknown. */
export function sqlCast(table: string, column: string): string {
  const type = COLUMN_TYPES[table]?.[column];
  return type ? `::${type}` : '';
}
