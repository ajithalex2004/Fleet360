import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn } from '@/lib/cross-module-governance';

let ensured = false;
let ensurePromise: Promise<void> | null = null;
const SOFT_DELETE_TABLES = new Set(['rental_customers', 'rental_invoices', 'rate_events', 'rental_ancillaries']);

export async function ensureRentalGovernance() {
  if (ensured) return;
  if (ensurePromise) {
    await ensurePromise;
    return;
  }

  ensurePromise = (async () => {
    await ensureOperationalTenantColumn('rental_customers');
    await ensureOperationalTenantColumn('rental_bookings');
    await ensureOperationalTenantColumn('rental_agreements');
    await ensureOperationalTenantColumn('rental_invoices');
    await ensureOperationalTenantColumn('pricing_rules');
    await ensureOperationalTenantColumn('rate_events');
    await ensureOperationalTenantColumn('rental_ancillaries');
    await ensureOperationalTenantColumn('rental_rate_quotes');

    await prisma.$executeRawUnsafe(`
      UPDATE rental_agreements ra
         SET tenant_id = rb.tenant_id
        FROM rental_bookings rb
       WHERE ra.booking_id = rb.id
         AND ra.tenant_id IS NULL
         AND rb.tenant_id IS NOT NULL
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      UPDATE rental_invoices ri
         SET tenant_id = ra.tenant_id
        FROM rental_agreements ra
       WHERE ri.agreement_id = ra.id
         AND ri.tenant_id IS NULL
         AND ra.tenant_id IS NOT NULL
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      UPDATE rental_invoices ri
         SET tenant_id = rc.tenant_id
        FROM rental_customers rc
       WHERE ri.customer_id = rc.id
         AND ri.tenant_id IS NULL
         AND rc.tenant_id IS NOT NULL
    `).catch(() => {});

    const pricingTenantTypeRows = await prisma.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(
      `SELECT data_type, udt_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'pricing_rules'
          AND column_name = 'tenant_id'
        LIMIT 1`,
    ).catch(() => []);
    const pricingTenantUdt = pricingTenantTypeRows[0]?.udt_name;
    if (!pricingTenantUdt || pricingTenantUdt === 'text' || pricingTenantUdt === 'varchar') {
      await prisma.$executeRawUnsafe(`
        UPDATE pricing_rules
           SET tenant_id = 'GLOBAL'
         WHERE tenant_id IS NULL
      `).catch(() => {});
    }
  })();

  try {
    await ensurePromise;
    ensured = true;
  } finally {
    ensurePromise = null;
  }
}

export async function rentalEntityVisible(
  table: 'rental_customers' | 'rental_agreements' | 'rental_invoices' | 'pricing_rules' | 'rate_events' | 'rental_ancillaries',
  id: string,
  tenantId: string,
  options: { includeDeleted?: boolean; allowGlobalPricing?: boolean; includeGlobal?: boolean } = {},
) {
  const deletedClause = options.includeDeleted || !SOFT_DELETE_TABLES.has(table) ? '' : 'AND deleted_at IS NULL';
  const visibilityClause = (table === 'pricing_rules' && options.allowGlobalPricing) || options.includeGlobal
    ? `AND (
         tenant_id::text = $2
         OR tenant_id IS NULL
         OR tenant_id::text = 'GLOBAL'
       )`
    : 'AND tenant_id::text = $2';

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text
       FROM ${table}
      WHERE id = $1
        ${visibilityClause}
        ${deletedClause}
      LIMIT 1`,
    id,
    tenantId,
  ).catch(() => []);

  return rows.length > 0;
}
