import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { pricingRuleToRow, rowToCamel } from '@/lib/pricing-rule-helpers';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const rows = await tx.$queryRawUnsafe<any[]>(
          "SELECT * FROM pricing_rules ORDER BY created_at DESC"
        );
        return NextResponse.json(rows.map(rowToCamel));
      } catch (e: any) {
        console.error('Error fetching pricing rules:', e);
        return NextResponse.json({ error: 'Failed to fetch pricing rules' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const id   = crypto.randomUUID();
        const now  = new Date().toISOString();

        const { cols, params, values } = pricingRuleToRow(body, id, now);
        await tx.$executeRawUnsafe(
          "INSERT INTO pricing_rules (" + cols + ") VALUES (" + params + ")",
          ...values
        );
        const rows = await tx.$queryRawUnsafe<any[]>(
          "SELECT * FROM pricing_rules WHERE id = $1", id
        );
        return NextResponse.json(rowToCamel(rows[0]), { status: 201 });
        } catch (e: any) {
        console.error('Error creating pricing rule:', e);
        return NextResponse.json({ error: e.message ?? 'Failed to create pricing rule' }, { status: 500 });
      }
  });
}

