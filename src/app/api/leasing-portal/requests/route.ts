/**
 * POST /api/leasing-portal/requests
 *
 * Self-service renewal/termination REQUEST — an expression of intent,
 * not a priced transaction. LeaseRenewal needs a staff-computed
 * proposedMonthlyRate and LeaseEarlyTermination needs staff-computed
 * penalty/settlement figures, neither of which a lessee should be
 * filling in themselves. So this raises a LeaseAlert (CUSTOM type) that
 * puts the request in front of staff on the existing Alerts page; staff
 * then create the properly-priced LeaseRenewal or LeaseEarlyTermination
 * through the existing admin flows.
 *
 * Body: { contractId, type: 'RENEWAL' | 'TERMINATION', notes? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function POST(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const body = await req.json().catch(() => ({})) as {
      contractId?: string;
      type?: 'RENEWAL' | 'TERMINATION';
      notes?: string;
    };
    const contractId = String(body.contractId ?? '');
    const type = body.type;
    if (!contractId || (type !== 'RENEWAL' && type !== 'TERMINATION')) {
      return NextResponse.json({ error: 'contractId and type (RENEWAL|TERMINATION) are required' }, { status: 400 });
    }

    const contract = await prisma.leaseContract2.findFirst({
      where: { id: contractId, tenantId: ctx.tenantId, lesseeId: ctx.lesseeId },
      select: { id: true, contractNumber: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not your contract' }, { status: 403 });
    }

    const title = type === 'RENEWAL'
      ? `Renewal requested for ${contract.contractNumber ?? contractId}`
      : `Early termination requested for ${contract.contractNumber ?? contractId}`;
    const notes = body.notes?.trim();

    const alert = await withTenantRls(prisma, ctx.tenantId, async (tx) =>
      tx.leaseAlert.create({
        data: {
          contractId,
          alertType: 'CUSTOM',
          severity: 'WARNING',
          title,
          message: `Lessee requested a ${type.toLowerCase()} via the self-service portal.${notes ? ` Notes: ${notes}` : ''} Follow up to create the priced ${type === 'RENEWAL' ? 'renewal proposal' : 'early termination'} record.`,
          status: 'OPEN',
          tenantId: ctx.tenantId,
        },
      }),
    );

    return NextResponse.json({ ok: true, alertId: alert.id }, { status: 201 });
  } catch (e) {
    console.error('[leasing-portal/requests]', e);
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
  }
}
