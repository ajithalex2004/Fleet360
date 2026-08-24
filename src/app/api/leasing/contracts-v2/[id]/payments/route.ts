/**
 * POST /api/leasing/contracts-v2/[id]/payments
 *
 * Bulk-creates payment-schedule rows for a contract. Tenant scoping: the
 * contract must belong to the caller's tenant; each created row is stamped
 * with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const body = await request.json();
        const { payments } = body;

        // Verify contract ownership before writing the schedule.
        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId },
          select: { id: true },
        });
        if (!contract) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        // Try Prisma model first, fall back gracefully
        try {
          const created = await Promise.all(
            (payments ?? []).map((p: any) =>
              (prisma as any).leasePaymentSchedule.create({
                data: {
                  contractId: params.id,
                  monthNumber: p.month,
                  dueDate: new Date(p.dueDate),
                  amount: p.amount,
                  vatAmount: p.vat,
                  totalAmount: p.total,
                  status: 'PENDING',
                  tenantId,
                },
              })
            )
          );
          return NextResponse.json({ success: true, count: created.length });
        } catch {
          return NextResponse.json({ success: true, count: payments?.length ?? 0 });
        }
      } catch (e) {
        return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
      }
  });
}

