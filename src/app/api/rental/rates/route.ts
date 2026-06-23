import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { attachTenantToEntity, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { pricingRuleToRow, rowToCamel } from '@/lib/pricing-rule-helpers';
import { ensureRentalGovernance } from '@/lib/rental-governance';

export async function GET(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const sp = req.nextUrl.searchParams;
    const ctx = requireOperationalContext(req, 'rac', { requestedTenantId: sp.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;

    const vehicleCategory = sp.get('vehicleCategory') ?? '';
    const customerType = sp.get('customerType') ?? '';
    const channel = sp.get('channel') ?? '';
    const isActiveParam = sp.get('isActive') ?? '';
    const { take, skip, page, limit } = paginate(sp, 100);

    const conditions = [`(tenant_id::text = $1 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')`];
    const args: unknown[] = [ctx.tenantId];
    if (vehicleCategory) { args.push(vehicleCategory); conditions.push(`vehicle_category = $${args.length}`); }
    if (customerType) { args.push(customerType); conditions.push(`customer_type = $${args.length}`); }
    if (channel) { args.push(channel); conditions.push(`channel = $${args.length}`); }
    if (isActiveParam) { args.push(isActiveParam === 'true'); conditions.push(`is_active = $${args.length}`); }

    const where = conditions.join(' AND ');
    const dataParams = [...args, take, skip];
    const [dataRows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT *
           FROM pricing_rules
          WHERE ${where}
          ORDER BY priority DESC, vehicle_category ASC, created_at DESC
          LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM pricing_rules
          WHERE ${where}`,
        ...args,
      ),
    ]);

    return NextResponse.json(
      paginatedResponse(dataRows.map(rowToCamel), Number(countRows[0]?.count ?? 0), page, limit),
    );
  } catch (error) {
    console.error('[rental/rates] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch pricing rules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    if (!body.vehicleCategory || body.baseDailyRate === undefined) {
      return NextResponse.json({ error: 'vehicleCategory and baseDailyRate are required' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const { cols, params, values } = pricingRuleToRow(body, id, now);

    await prisma.$executeRawUnsafe(
      `INSERT INTO pricing_rules (${cols}) VALUES (${params})`,
      ...values,
    );
    await attachTenantToEntity('pricing_rules', id, ctx.tenantId);

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM pricing_rules
        WHERE id = $1
          AND tenant_id::text = $2
        LIMIT 1`,
      id,
      ctx.tenantId,
    );
    const created = rowToCamel(rows[0] ?? { id });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'PricingRule',
      entityId: id,
      action: 'CREATE',
      after: created,
      summary: `Created pricing rule for ${String(body.vehicleCategory)}.`,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('[rental/rates] POST error:', error);
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}
