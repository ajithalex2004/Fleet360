import { NextRequest, NextResponse } from 'next/server';
import {
  ensureOperationalTenantColumn,
  entityBelongsToTenant,
  requireOperationalContext,
  type OperationalContext,
} from '@/lib/cross-module-governance';
import { prisma } from '@/lib/prisma';

let deviceInfraEnsured = false;

export async function ensureBusOpsDeviceInfra() {
  if (deviceInfraEnsured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ble_gateways (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      vehicle_id TEXT NOT NULL UNIQUE,
      gateway_id TEXT NOT NULL UNIQUE,
      model TEXT,
      rssi_threshold_dbm INT DEFAULT -75,
      presence_grace_seconds INT DEFAULT 10,
      is_active BOOLEAN DEFAULT TRUE,
      last_seen_at TIMESTAMPTZ,
      last_event_at TIMESTAMPTZ,
      notes TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS gateway_id TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS model TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS rssi_threshold_dbm INT DEFAULT -75`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS presence_grace_seconds INT DEFAULT 10`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS notes TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ALTER COLUMN gateway_code DROP NOT NULL`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ALTER COLUMN name DROP NOT NULL`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE ble_gateways ALTER COLUMN location_name DROP NOT NULL`).catch(() => {});
  await prisma.$executeRawUnsafe(`UPDATE ble_gateways SET gateway_id = gateway_code WHERE gateway_id IS NULL AND gateway_code IS NOT NULL`).catch(() => {});
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_ble_gateways_gateway_id`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS uniq_ble_gateways_vehicle_id`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_ble_gateways_vehicle_id ON ble_gateways(vehicle_id)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ble_gateways_gateway_id ON ble_gateways(gateway_id)`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS staff_ble_tags (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      staff_member_id TEXT NOT NULL UNIQUE,
      tag_id TEXT NOT NULL UNIQUE,
      form_factor TEXT,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      battery_replaced_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT TRUE,
      notes TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_ble_tags_staff_member_id ON staff_ble_tags(staff_member_id)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_ble_tags_tag_id ON staff_ble_tags(tag_id)`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ble_gateway_presence (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      gateway_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      schedule_id TEXT,
      passenger_id TEXT,
      staff_member_id TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      last_rssi_dbm INT,
      is_present BOOLEAN NOT NULL DEFAULT TRUE,
      alighted_at TIMESTAMPTZ
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_ble_presence ON ble_gateway_presence(gateway_id, tag_id, schedule_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ble_gateway_presence_schedule ON ble_gateway_presence(schedule_id)`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS vehicle_beacons (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      vehicle_id TEXT NOT NULL UNIQUE,
      ble_uuid TEXT NOT NULL,
      major INT,
      minor INT,
      is_active BOOLEAN DEFAULT TRUE,
      notes TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_vehicle_beacons_vehicle_id ON vehicle_beacons(vehicle_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vehicle_beacons_ble_uuid ON vehicle_beacons(ble_uuid)`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS staff_rfid_tags (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      staff_member_id TEXT NOT NULL UNIQUE,
      tag_uid TEXT NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      is_active BOOLEAN DEFAULT TRUE,
      notes TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_rfid_tags_staff_member_id ON staff_rfid_tags(staff_member_id)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_rfid_tags_tag_uid ON staff_rfid_tags(tag_uid)`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS boarding_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      schedule_id TEXT NOT NULL,
      passenger_id TEXT,
      staff_member_id TEXT,
      method TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'BOARD',
      identifier TEXT,
      stop_id TEXT,
      performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      performed_by TEXT,
      raw_payload JSONB
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_boarding_events_schedule_id ON boarding_events(schedule_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_boarding_events_passenger_id ON boarding_events(passenger_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_boarding_events_staff_member_id ON boarding_events(staff_member_id)`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bus_pretrip_checks (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      schedule_id TEXT NOT NULL,
      vehicle_id TEXT,
      driver_id TEXT,
      performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      performed_by TEXT,
      check_items JSONB NOT NULL,
      overall_pass BOOLEAN NOT NULL DEFAULT TRUE,
      fail_count INT NOT NULL DEFAULT 0,
      notes TEXT,
      signature_data TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_bus_pretrip_checks_schedule_id ON bus_pretrip_checks(schedule_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_bus_pretrip_checks_performed_at ON bus_pretrip_checks(performed_at)`);
  deviceInfraEnsured = true;
}

export async function requireBusOpsContext(req: NextRequest, options: { write?: boolean } = {}) {
  await ensureBusOpsDeviceInfra();
  const ctx = requireOperationalContext(req, 'bus_ops', options);
  if (ctx instanceof NextResponse) return ctx;
  return ctx;
}

export async function requireBusEntity(
  ctx: OperationalContext,
  table: 'trip_schedules' | 'trip_passengers' | 'staff_members' | 'bus_routes' | 'vehicles',
  id: string,
  label: string,
) {
  await ensureOperationalTenantColumn(table);
  const belongs = await entityBelongsToTenant(table, id, ctx.tenantId, { activeOnly: table !== 'trip_passengers' });
  return belongs
    ? null
    : NextResponse.json({ error: `${label} not found for tenant` }, { status: 404 });
}
