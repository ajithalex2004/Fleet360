/**
 * Column types of the Fleet, hours-of-service and vehicle-type tables, for
 * casting query parameters. Prisma binds a JS string as text, and Postgres
 * will not assign text to a uuid, timestamptz, date, numeric, int, boolean
 * or jsonb column, so every create in these routes failed with 42804.
 *
 * Taken from the table definitions in src/lib/fleet/schema.ts and
 * src/lib/fleet/hos-schema.ts; text columns need no cast and are not listed.
 * Same approach as src/lib/assets/sql-cast.ts.
 */
const COLUMN_TYPES: Record<string, Record<string, string>> = {
  fleet_allocations: { id: 'uuid', allocation_date: 'timestamptz', expected_return_date: 'timestamptz', actual_return_date: 'timestamptz', mileage_at_allocation: 'int', mileage_at_return: 'int', created_at: 'timestamptz', updated_at: 'timestamptz' },
  fleet_lifecycle_events: { id: 'uuid', event_date: 'timestamptz', cost: 'numeric', metadata: 'jsonb', created_at: 'timestamptz', updated_at: 'timestamptz' },
  fleet_transfers: { id: 'uuid', transfer_date: 'timestamptz', mileage_at_transfer: 'int', created_at: 'timestamptz', updated_at: 'timestamptz' },
  fleet_nui_reasons: { id: 'uuid', is_billable: 'boolean', is_active: 'boolean', created_at: 'timestamptz', updated_at: 'timestamptz' },
  fleet_vehicle_insurance: { id: 'uuid', vehicle_id: 'uuid', start_date: 'date', end_date: 'date', premium_amount: 'numeric', coverage_amount: 'numeric', deductible: 'numeric', renewal_reminder_days: 'int', created_at: 'timestamptz', updated_at: 'timestamptz' },
  fleet_work_orders: { id: 'uuid', vehicle_id: 'uuid', scheduled_date: 'timestamptz', start_date: 'timestamptz', end_date: 'timestamptz', odometer_at_entry: 'int', authorized_po_amount: 'numeric', actual_cost: 'numeric', variance: 'numeric', variance_alert: 'boolean', line_items: 'jsonb', created_at: 'timestamptz', updated_at: 'timestamptz' },
  hos_logs: { id: 'uuid', started_at: 'timestamptz', ended_at: 'timestamptz', duration_mins: 'int', created_at: 'timestamptz', updated_at: 'timestamptz' },
  hos_violations: { id: 'uuid', occurred_at: 'timestamptz', hours_exceeded: 'numeric', acknowledged_at: 'timestamptz', resolved_at: 'timestamptz', created_at: 'timestamptz' },
  vehicle_types: { id: 'uuid', num_passengers: 'int', max_speed_kmh: 'int', fuel_efficiency_kml: 'numeric', cost_per_km: 'numeric', idle_fuel_consumption: 'numeric', co2_emission_factor: 'numeric', is_active: 'boolean', deleted_at: 'timestamptz', created_at: 'timestamptz', updated_at: 'timestamptz' },
};

/** `::type` for a parameter bound to `table.column`, or '' for text columns. */
export function sqlCast(table: string, column: string): string {
  const t = COLUMN_TYPES[table]?.[column];
  return t ? `::${t}` : '';
}
