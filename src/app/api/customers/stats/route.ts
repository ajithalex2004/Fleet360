import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const rows = await tx.$queryRawUnsafe(`
          SELECT
            COUNT(*)                                                   as total,
            COUNT(*) FILTER (WHERE status = 'ACTIVE')                 as active,
            COUNT(*) FILTER (WHERE status = 'INACTIVE')               as inactive,
            COUNT(*) FILTER (WHERE customer_type = 'WALK_IN')         as walk_in,
            COUNT(*) FILTER (WHERE customer_type = 'VIP')             as vip,
            COUNT(*) FILTER (WHERE customer_type = 'CORPORATE')       as corporate,
            COUNT(*) FILTER (WHERE customer_type = 'INTERNAL')        as internal
          FROM customers WHERE deleted_at IS NULL
        `);
        const r = (rows as any[])[0];
        return NextResponse.json({
          total:    Number(r?.total    ?? 0),
          active:   Number(r?.active   ?? 0),
          inactive: Number(r?.inactive ?? 0),
          walkIn:   Number(r?.walk_in  ?? 0),
          vip:      Number(r?.vip      ?? 0),
          corporate:Number(r?.corporate?? 0),
          internal: Number(r?.internal ?? 0),
        });
        } catch (e: any) {
        console.error('stats error:', e);
        return NextResponse.json({ error: 'Failed', total:0, active:0, inactive:0, walkIn:0, vip:0, corporate:0, internal:0 }, { status: 200 });
      }
  });
}

