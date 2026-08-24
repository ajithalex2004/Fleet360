import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(_req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const rows = await tx.$queryRawUnsafe<
          Array<{
            outstanding: unknown;
            total_paid: unknown;
            disputed_count: bigint;
            waived_count: bigint;
            total_fines: bigint;
          }>
        >(
          `SELECT
             SUM(CASE WHEN status = 'UNPAID' THEN fine_amount ELSE 0 END) AS outstanding,
             SUM(CASE WHEN status = 'PAID' THEN fine_amount ELSE 0 END) AS total_paid,
             COUNT(CASE WHEN status = 'DISPUTED' THEN 1 END) AS disputed_count,
             COUNT(CASE WHEN status = 'WAIVED' THEN 1 END) AS waived_count,
             COUNT(*) AS total_fines
           FROM traffic_fines
           WHERE deleted_at IS NULL`,
        );

        const row = rows[0];

        return NextResponse.json({
          outstanding: row.outstanding !== null ? Number(row.outstanding) : 0,
          totalPaid: row.total_paid !== null ? Number(row.total_paid) : 0,
          disputedCount: Number(row.disputed_count),
          waivedCount: Number(row.waived_count),
          totalFines: Number(row.total_fines),
        });
        } catch (e) {
        console.error('Error fetching traffic fines summary:', e);
        return NextResponse.json({ error: 'Failed to fetch traffic fines summary' }, { status: 500 });
      }
  });
}

