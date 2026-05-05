import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { pricingRuleToRow, rowToCamel } from '@/lib/pricing-rule-helpers';

// GET  /api/rental/rates  — list pricing rules (paginated, filterable)
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const vehicleCategory = sp.get('vehicleCategory') ?? '';
    const customerType    = sp.get('customerType') ?? '';
    const channel         = sp.get('channel') ?? '';
    const isActiveParam   = sp.get('isActive') ?? '';
    const { take, skip, page, limit } = paginate(sp, 100);

    let where = 'WHERE 1=1';
    const args: any[] = [];
    let idx = 1;

    if (vehicleCategory) { where += ' AND vehicle_category = $' + idx++; args.push(vehicleCategory); }
    if (customerType)    { where += ' AND customer_type = $'    + idx++; args.push(customerType); }
    if (channel)         { where += ' AND channel = $'          + idx++; args.push(channel); }
    if (isActiveParam)   { where += ' AND is_active = $'        + idx++; args.push(isActiveParam === 'true'); }

    const [dataRows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        "SELECT * FROM pricing_rules " + where +
        " ORDER BY priority DESC, vehicle_category ASC" +
        " LIMIT $" + idx + " OFFSET $" + (idx + 1),
        ...args, take, skip
      ),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        "SELECT COUNT(*) AS count FROM pricing_rules " + where,
        ...args
      ),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    return NextResponse.json(paginatedResponse(dataRows.map(rowToCamel), total, page, limit));
  } catch (e: any) {
    console.error('Failed to fetch pricing rules:', e);
    return NextResponse.json({ error: 'Failed to fetch pricing rules' }, { status: 500 });
  }
}

// POST /api/rental/rates  — create a pricing rule
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.vehicleCategory || body.baseDailyRate === undefined) {
      return NextResponse.json({ error: 'vehicleCategory and baseDailyRate are required' }, { status: 400 });
    }

    const id  = crypto.randomUUID();
    const now = new Date().toISOString();

    const { cols, params, values } = pricingRuleToRow(body, id, now);
    await prisma.$executeRawUnsafe(
      "INSERT INTO pricing_rules (" + cols + ") VALUES (" + params + ")",
      ...values
    );

    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM pricing_rules WHERE id = $1", id
    );
    return NextResponse.json(rowToCamel(rows[0]), { status: 201 });
  } catch (e: any) {
    console.error('Failed to create pricing rule:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to create rule' }, { status: 500 });
  }
}
