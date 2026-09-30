export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { logAudit } from '@/lib/audit';
import { parseClaimStatusChange } from '@/lib/maintenance/warranty';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// PATCH /api/maintenance/warranty-claims/[id]
// Body: { status: 'APPROVED' | 'REJECTED' | 'PAID', approvedAmount? }
// PENDING -> APPROVED | REJECTED, APPROVED -> PAID. Approving records the
// approved amount (the claimed amount by default); approved and paid
// claims together can't exceed the warranty's claim limit.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let audit: Parameters<typeof logAudit>[0] | null = null;
  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      // RLS scopes the lookup to this tenant's claims.
      const claim = await tx.warrantyClaim.findUnique({ where: { id }, include: { VehicleWarranty: true } });
      if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

      const change = parseClaimStatusChange(
        { status: claim.status, claimedAmount: num(claim.claimedAmount), approvedAmount: num(claim.approvedAmount) },
        body,
      );
      if (!change.ok) return NextResponse.json({ error: change.error }, { status: 409 });

      const limit = num(claim.VehicleWarranty.maxClaimAmount);
      if (change.data.status === 'APPROVED' && limit !== null && change.data.approvedAmount !== null) {
        const others = await tx.warrantyClaim.findMany({
          where: { warrantyId: claim.warrantyId, id: { not: id }, status: { in: ['APPROVED', 'PAID'] } },
          select: { approvedAmount: true, claimedAmount: true },
        });
        const used = others.reduce((s, c) => s + (num(c.approvedAmount) ?? num(c.claimedAmount) ?? 0), 0);
        if (used + change.data.approvedAmount > limit) {
          return NextResponse.json(
            { error: `Approving this would exceed the warranty's claim limit (AED ${limit.toLocaleString()}; AED ${used.toLocaleString()} already approved).` },
            { status: 409 },
          );
        }
      }

      const updated = await tx.warrantyClaim.update({
        where: { id },
        data: { status: change.data.status, approvedAmount: change.data.approvedAmount },
      });
      audit = {
        tenantId,
        userId: request.headers.get('x-user-id') ?? 'system',
        userRole: request.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'WarrantyClaim',
        entityId: id,
        action: 'UPDATE',
        details: `Warranty claim ${claim.status} -> ${change.data.status}${change.data.approvedAmount !== null ? ` (AED ${change.data.approvedAmount})` : ''}`,
      };
      return NextResponse.json(JSON.parse(JSON.stringify(updated)));
    } catch (e) {
      console.error('Failed to update warranty claim:', e);
      return NextResponse.json({ error: 'Failed to update claim' }, { status: 500 });
    }
  });
  if (audit) await logAudit(audit);
  return response;
}
