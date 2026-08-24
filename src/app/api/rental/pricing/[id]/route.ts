import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { pricingRuleUpdateSet, rowToCamel } from '@/lib/pricing-rule-helpers';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const rows = await tx.$queryRawUnsafe<any[]>(
          "SELECT * FROM pricing_rules WHERE id = $1", params.id
        );
        if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(rowToCamel(rows[0]));
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const now  = new Date().toISOString();
        const { setClauses, values, nextIdx } = pricingRuleUpdateSet(body, now);
        values.push(params.id);
        await tx.$executeRawUnsafe(
          "UPDATE pricing_rules SET " + setClauses + " WHERE id = $" + nextIdx,
          ...values
        );
        const rows = await tx.$queryRawUnsafe<any[]>(
          "SELECT * FROM pricing_rules WHERE id = $1", params.id
        );
        return NextResponse.json(rowToCamel(rows[0]));
      } catch (e) {
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  return PATCH(req, props);
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        await tx.$executeRawUnsafe(
          "DELETE FROM pricing_rules WHERE id = $1", params.id
        );
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

