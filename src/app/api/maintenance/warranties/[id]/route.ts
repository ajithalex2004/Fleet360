export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

// PATCH /api/maintenance/warranties/[id]
// Body: { isActive: boolean } — activate or deactivate a warranty.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive (true or false) is required' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      // RLS scopes the lookup to this tenant's warranties.
      const existing = await tx.vehicleWarranty.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return NextResponse.json({ error: 'Warranty not found' }, { status: 404 });

      const warranty = await tx.vehicleWarranty.update({
        where: { id },
        data: { isActive: body.isActive },
        include: { claims: { orderBy: { createdAt: 'desc' } } },
      });
      return NextResponse.json(JSON.parse(JSON.stringify(warranty)));
    } catch (e) {
      console.error('Failed to update warranty:', e);
      return NextResponse.json({ error: 'Failed to update warranty' }, { status: 500 });
    }
  });
}
