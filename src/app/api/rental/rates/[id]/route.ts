import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { pricingRuleUpdateSet, rowToCamel } from '@/lib/pricing-rule-helpers';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM pricing_rules WHERE id = $1", params.id
    );
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rowToCamel(rows[0]));
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch rule' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();
    const now  = new Date().toISOString();

    const { setClauses, values, nextIdx } = pricingRuleUpdateSet(body, now);
    values.push(params.id);
    await prisma.$executeRawUnsafe(
      "UPDATE pricing_rules SET " + setClauses + " WHERE id = $" + nextIdx,
      ...values
    );
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM pricing_rules WHERE id = $1", params.id
    );
    return NextResponse.json(rowToCamel(rows[0]));
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to update rule' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    await prisma.$executeRawUnsafe(
      "DELETE FROM pricing_rules WHERE id = $1", params.id
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
