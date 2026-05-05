import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const results: string[] = [];
  const run = async (label: string, sql: string) => {
    try { await prisma.$executeRawUnsafe(sql); results.push('OK: ' + label); }
    catch (e: any) { results.push('SKIP: ' + label + ' — ' + (e.message ?? '').slice(0, 120)); }
  };

  // ── vehicle_types (new comprehensive master table) ────────────────────────
  await run('create vehicle_types', `CREATE TABLE IF NOT EXISTS vehicle_types (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    code TEXT UNIQUE NOT NULL,
    make TEXT,
    model TEXT,
    name TEXT NOT NULL,
    description TEXT,
    vehicle_group TEXT DEFAULT 'PASSENGER',
    vehicle_class TEXT DEFAULT 'SEDAN',
    transmission_type TEXT DEFAULT 'AUTOMATIC',
    fuel_type TEXT DEFAULT 'PETROL',
    num_passengers INT DEFAULT 5,
    max_speed_kmh DECIMAL,
    fuel_efficiency_kml DECIMAL,
    cost_per_km DECIMAL DEFAULT 0,
    idle_fuel_consumption DECIMAL,
    co2_emission_factor DECIMAL,
    is_active BOOLEAN DEFAULT true,
    notes TEXT
  )`);
  await run('idx_vt_code',     "CREATE INDEX IF NOT EXISTS idx_vehicle_types_code ON vehicle_types(code)");
  await run('idx_vt_group',    "CREATE INDEX IF NOT EXISTS idx_vehicle_types_group ON vehicle_types(vehicle_group)");
  await run('idx_vt_active',   "CREATE INDEX IF NOT EXISTS idx_vehicle_types_is_active ON vehicle_types(is_active)");

  // ── vehicles enhancements ─────────────────────────────────────────────────
  await run('vehicles.vehicle_code',       "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_code TEXT UNIQUE");
  await run('vehicles.chassis_no',         "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassis_no TEXT");
  await run('vehicles.color',              "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color TEXT");
  await run('vehicles.year_of_manufacture',"ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS year_of_manufacture INT");
  await run('vehicles.registration_no',    "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_no TEXT");
  await run('vehicles.plate_number',       "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_number TEXT");
  await run('vehicles.plate_code',         "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_code TEXT");
  await run('vehicles.plate_category',     "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS plate_category TEXT DEFAULT 'PRIVATE'");
  await run('vehicles.emirate',            "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS emirate TEXT DEFAULT 'DUBAI'");
  await run('vehicles.vehicle_type_id',    "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_type_id TEXT REFERENCES vehicle_types(id)");
  await run('vehicles.vehicle_usage',      "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_usage TEXT DEFAULT 'RENTAL'");
  await run('vehicles.hierarchy_id',       "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS hierarchy_id TEXT");
  await run('vehicles.hierarchy_name',     "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS hierarchy_name TEXT");
  await run('vehicles.branch_id',          "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS branch_id TEXT");
  await run('vehicles.branch_name',        "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS branch_name TEXT");
  await run('vehicles.device_id',          "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS device_id TEXT");
  await run('vehicles.sim_card_no',        "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS sim_card_no TEXT");
  await run('vehicles.stop_mode_freq',     "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS stop_mode_comm_frequency TEXT");
  await run('vehicles.lifecycle_stage',    "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT DEFAULT 'ACTIVE'");
  await run('vehicles.purchase_date',      "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMPTZ");
  await run('vehicles.purchase_price',     "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_price DECIMAL");
  await run('vehicles.odometer_reading',   "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS odometer_reading INT DEFAULT 0");
  await run('vehicles.fuel_level',         "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_level INT DEFAULT 100");
  await run('vehicles.acquisition_type',   "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS acquisition_type TEXT DEFAULT 'PURCHASE'");
  await run('vehicles.assigned_driver_id', "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS assigned_driver_id TEXT");
  await run('vehicles.registration_expiry2',"ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_expiry_date TIMESTAMPTZ");
  await run('vehicles.insurance_expiry2',  "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS insurance_expiry_date TIMESTAMPTZ");
  await run('vehicles.notes',              "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes TEXT");
  await run('vehicles.category',           "ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS category TEXT");
  await run('idx_vehicles_code',           "CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_code ON vehicles(vehicle_code)");
  await run('idx_vehicles_type_id',        "CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_type_id ON vehicles(vehicle_type_id)");
  await run('idx_vehicles_usage',          "CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_usage ON vehicles(vehicle_usage)");
  await run('idx_vehicles_lifecycle',      "CREATE INDEX IF NOT EXISTS idx_vehicles_lifecycle_stage ON vehicles(lifecycle_stage)");
  await run('idx_vehicles_branch',         "CREATE INDEX IF NOT EXISTS idx_vehicles_branch_id ON vehicles(branch_id)");

  // ── fleet_lifecycle_events ────────────────────────────────────────────────
  await run('create fleet_lifecycle_events', `CREATE TABLE IF NOT EXISTS fleet_lifecycle_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    event_type TEXT NOT NULL,
    event_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT,
    reference_no TEXT,
    performed_by TEXT,
    from_stage TEXT,
    to_stage TEXT,
    cost DECIMAL DEFAULT 0,
    metadata TEXT,
    notes TEXT
  )`);
  await run('idx_lifecycle_vehicle',  "CREATE INDEX IF NOT EXISTS idx_fleet_lifecycle_vehicle_id ON fleet_lifecycle_events(vehicle_id)");
  await run('idx_lifecycle_type',     "CREATE INDEX IF NOT EXISTS idx_fleet_lifecycle_event_type ON fleet_lifecycle_events(event_type)");
  await run('idx_lifecycle_date',     "CREATE INDEX IF NOT EXISTS idx_fleet_lifecycle_event_date ON fleet_lifecycle_events(event_date)");

  // ── fleet_allocations ─────────────────────────────────────────────────────
  await run('create fleet_allocations', `CREATE TABLE IF NOT EXISTS fleet_allocations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    allocated_to_type TEXT NOT NULL,
    allocated_to_id TEXT,
    allocated_to_name TEXT NOT NULL,
    allocation_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_return_date TIMESTAMPTZ,
    actual_return_date TIMESTAMPTZ,
    status TEXT DEFAULT 'ACTIVE',
    purpose TEXT,
    authorized_by TEXT,
    mileage_at_allocation INT,
    mileage_at_return INT,
    notes TEXT
  )`);
  await run('idx_alloc_vehicle', "CREATE INDEX IF NOT EXISTS idx_fleet_allocations_vehicle_id ON fleet_allocations(vehicle_id)");
  await run('idx_alloc_status',  "CREATE INDEX IF NOT EXISTS idx_fleet_allocations_status ON fleet_allocations(status)");

  // ── fleet_transfers ───────────────────────────────────────────────────────
  await run('create fleet_transfers', `CREATE TABLE IF NOT EXISTS fleet_transfers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    transfer_no TEXT UNIQUE,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    from_branch_id TEXT,
    from_branch_name TEXT,
    to_branch_id TEXT,
    to_branch_name TEXT NOT NULL,
    transfer_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    requested_by TEXT,
    approved_by TEXT,
    status TEXT DEFAULT 'PENDING',
    mileage_at_transfer INT,
    fuel_level_at_transfer INT,
    reason TEXT,
    notes TEXT
  )`);
  await run('idx_transfer_vehicle', "CREATE INDEX IF NOT EXISTS idx_fleet_transfers_vehicle_id ON fleet_transfers(vehicle_id)");
  await run('idx_transfer_status',  "CREATE INDEX IF NOT EXISTS idx_fleet_transfers_status ON fleet_transfers(status)");

  // ── fleet_vehicle_insurance ───────────────────────────────────────────────
  await run('create fleet_vehicle_insurance', `CREATE TABLE IF NOT EXISTS fleet_vehicle_insurance (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    policy_number TEXT NOT NULL,
    insurer TEXT NOT NULL,
    policy_type TEXT DEFAULT 'COMPREHENSIVE',
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    premium_amount DECIMAL NOT NULL DEFAULT 0,
    coverage_amount DECIMAL DEFAULT 0,
    deductible DECIMAL DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    renewal_reminder_days INT DEFAULT 30,
    document_url TEXT,
    notes TEXT
  )`);
  await run('idx_ins_vehicle',  "CREATE INDEX IF NOT EXISTS idx_fleet_insurance_vehicle_id ON fleet_vehicle_insurance(vehicle_id)");
  await run('idx_ins_status',   "CREATE INDEX IF NOT EXISTS idx_fleet_insurance_status ON fleet_vehicle_insurance(status)");
  await run('idx_ins_end_date', "CREATE INDEX IF NOT EXISTS idx_fleet_insurance_end_date ON fleet_vehicle_insurance(end_date)");

  // ── fleet_work_orders ─────────────────────────────────────────────────────
  await run('create fleet_work_orders', `CREATE TABLE IF NOT EXISTS fleet_work_orders (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    wo_number TEXT UNIQUE NOT NULL,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    wo_type TEXT DEFAULT 'PREVENTIVE',
    status TEXT DEFAULT 'DRAFT',
    priority TEXT DEFAULT 'MEDIUM',
    garage_name TEXT,
    garage_contact TEXT,
    assigned_to TEXT,
    scheduled_date TIMESTAMPTZ,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    odometer_at_entry INT,
    authorized_po_amount DECIMAL DEFAULT 0,
    actual_cost DECIMAL DEFAULT 0,
    variance DECIMAL DEFAULT 0,
    variance_alert BOOLEAN DEFAULT false,
    description TEXT,
    findings TEXT,
    actions_taken TEXT,
    line_items TEXT,
    requested_by TEXT,
    approved_by TEXT,
    notes TEXT
  )`);
  await run('idx_wo_vehicle', "CREATE INDEX IF NOT EXISTS idx_fleet_wo_vehicle_id ON fleet_work_orders(vehicle_id)");
  await run('idx_wo_status',  "CREATE INDEX IF NOT EXISTS idx_fleet_wo_status ON fleet_work_orders(status)");
  await run('idx_wo_type',    "CREATE INDEX IF NOT EXISTS idx_fleet_wo_type ON fleet_work_orders(wo_type)");

  // ── garage_inventory ──────────────────────────────────────────────────────
  await run('create garage_inventory', `CREATE TABLE IF NOT EXISTS garage_inventory (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    part_code TEXT UNIQUE NOT NULL,
    part_name TEXT NOT NULL,
    category TEXT,
    unit TEXT DEFAULT 'EACH',
    quantity_on_hand DECIMAL DEFAULT 0,
    reserved_quantity DECIMAL DEFAULT 0,
    unit_cost DECIMAL DEFAULT 0,
    total_value DECIMAL DEFAULT 0,
    min_stock_level DECIMAL DEFAULT 0,
    reorder_quantity DECIMAL DEFAULT 0,
    supplier TEXT,
    supplier_part_no TEXT,
    location TEXT,
    is_active BOOLEAN DEFAULT true,
    notes TEXT
  )`);
  await run('idx_gi_code',    "CREATE INDEX IF NOT EXISTS idx_garage_inventory_part_code ON garage_inventory(part_code)");
  await run('idx_gi_cat',     "CREATE INDEX IF NOT EXISTS idx_garage_inventory_category ON garage_inventory(category)");

  // ── vehicle_registrations ─────────────────────────────────────────────────
  await run('create vehicle_registrations', `CREATE TABLE IF NOT EXISTS vehicle_registrations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    registration_type TEXT DEFAULT 'RENEWAL',
    registration_no TEXT,
    registration_date TIMESTAMPTZ,
    expiry_date TIMESTAMPTZ NOT NULL,
    authority TEXT DEFAULT 'RTA',
    emirate TEXT DEFAULT 'DUBAI',
    fee_amount DECIMAL DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE',
    mulkiya_no TEXT,
    notes TEXT
  )`);
  await run('idx_reg_vehicle',  "CREATE INDEX IF NOT EXISTS idx_vehicle_registrations_vehicle_id ON vehicle_registrations(vehicle_id)");
  await run('idx_reg_expiry',   "CREATE INDEX IF NOT EXISTS idx_vehicle_registrations_expiry_date ON vehicle_registrations(expiry_date)");
  await run('idx_reg_status',   "CREATE INDEX IF NOT EXISTS idx_vehicle_registrations_status ON vehicle_registrations(status)");

  const ok   = results.filter(r => r.startsWith('OK')).length;
  const skip = results.filter(r => r.startsWith('SKIP')).length;
  return NextResponse.json({ ok, skip, results });
}

export async function GET() {
  return NextResponse.json({ message: 'POST to this endpoint to run Fleet Phase 1 migration' });
}
