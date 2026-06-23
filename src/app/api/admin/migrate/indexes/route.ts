import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

const INDEXES = [
  // MaintenanceRequest
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_maintenance_requests_vehicle_id ON maintenance_requests(vehicle_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_maintenance_requests_driver_id ON maintenance_requests(driver_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_maintenance_requests_garage_id ON maintenance_requests(garage_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_maintenance_requests_status ON maintenance_requests(status)',
  // Quotations
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotation_labors_quotation_id ON quotation_labors(quotation_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotation_parts_quotation_id ON quotation_parts(quotation_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_maintenance_request_id ON quotations(maintenance_request_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_garage_id ON quotations(garage_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_status ON quotations(status)',
  // Invoices
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_garage_id ON invoices(garage_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status)',
  // Leasing
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lease_contracts_lessee_id ON lease_contracts(lessee_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lease_contracts_vehicle_id ON lease_contracts(vehicle_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lease_contracts_status ON lease_contracts(status)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lease_contracts_deleted_at ON lease_contracts(deleted_at)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lease_payments_contract_id ON lease_payments(contract_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lease_payments_status ON lease_payments(status)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lease_payments_due_date ON lease_payments(due_date)',
  // Rental
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_bookings_customer_id ON rental_bookings(customer_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_bookings_vehicle_id ON rental_bookings(vehicle_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_bookings_status ON rental_bookings(status)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_bookings_pickup_date ON rental_bookings(pickup_date)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_bookings_deleted_at ON rental_bookings(deleted_at)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_agreements_customer_id ON rental_agreements(customer_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_agreements_vehicle_id ON rental_agreements(vehicle_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rental_agreements_status ON rental_agreements(status)',
  // Fleet
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_documents_vehicle_id ON vehicle_documents(vehicle_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_documents_status ON vehicle_documents(status)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_documents_expiry_date ON vehicle_documents(expiry_date)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_logs_vehicle_id ON fuel_logs(vehicle_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_logs_driver_id ON fuel_logs(driver_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_logs_fuel_date ON fuel_logs(fuel_date)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_traffic_fines_vehicle_id ON traffic_fines(vehicle_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_traffic_fines_driver_id ON traffic_fines(driver_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_traffic_fines_status ON traffic_fines(status)',
  // Drivers
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driver_documents_driver_id ON driver_documents(driver_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driver_documents_expiry_date ON driver_documents(expiry_date)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driver_shifts_driver_id ON driver_shifts(driver_id)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_driver_shifts_shift_date ON driver_shifts(shift_date)',
];

export async function POST(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'edit', 'platform');
  if (auth instanceof NextResponse) return auth;
  const approval = await requireDangerApproval(req, auth.ctx, 'migrate.indexes', {
    targetType: 'Migration',
    targetId: 'indexes',
    summary: 'Run admin index migration.',
  });
  if (approval) return approval;

  const results: { index: string; status: 'created' | 'skipped'; error?: string }[] = [];
  for (const sql of INDEXES) {
    const name = sql.match(/IF NOT EXISTS (\S+)/)?.[1] ?? sql;
    try {
      await prisma.$executeRawUnsafe(sql);
      results.push({ index: name, status: 'created' });
    } catch (e: any) {
      results.push({ index: name, status: 'skipped', error: e.message?.slice(0, 80) });
    }
  }
  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  await recordAdminChange({
    req,
    ctx: auth.ctx,
    tenantId: null,
    entityType: 'Migration',
    entityId: 'indexes',
    action: 'UPDATE',
    after: { created, skipped, results },
    summary: `Ran index migration: ${created} created, ${skipped} skipped.`,
  });
  return NextResponse.json({ created, skipped, results });
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'platform');
  if (auth instanceof NextResponse) return auth;

  // Check which indexes already exist
  const rows = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%'
    ORDER BY indexname
  `;
  return NextResponse.json({ count: rows.length, indexes: rows.map(r => r.indexname) });
}
