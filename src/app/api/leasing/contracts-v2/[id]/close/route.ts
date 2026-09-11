export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/contracts-v2/[id]/close — explicit contract closure.
 *
 * Never fires implicitly from a single return's settlement. Requires
 * EVERY LeaseAllocationOccurrence on the contract to be accounted for:
 * ENDED occurrences need a linked LeaseVehicleReturn with
 * financialSettlementStatus CLEARED (re-checked fresh via the shared
 * evaluator, not trusted from cache); ACTIVE or RECONCILIATION_REQUIRED
 * occurrences block outright.
 *
 * closure_reason is EARLY_TERMINATED only when an EXECUTED
 * LeaseEarlyTermination exists for this contract — and in that case
 * LeaseContract2.status is left untouched (it's already TERMINATED from
 * the termination's own EXECUTED step, and stays that way permanently).
 * Only a normal end-of-term closure (no executed termination) writes the
 * new COMPLETED status — a genuinely new fact, not a second value
 * competing with TERMINATED.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withContractLock } from '@/lib/leasing/contract-lock';
import { evaluateContractSettlementLiabilities, findDepositForContract } from '@/lib/leasing/return-workflow';
import { lockDepositRow, requestRefund, SecurityDepositError } from '@/lib/finance/security-deposit';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  const actor = req.headers.get('x-user-id') ?? 'staff';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const contract = await tx.leaseContract2.findFirst({ where: { id: params.id, tenantId } });
      if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

      const existingClosure = await tx.leaseContractClosure.findFirst({ where: { contractId: contract.id, tenantId } });
      if (existingClosure) {
        return NextResponse.json({ error: `Contract already closed (${existingClosure.closureReason})` }, { status: 409 });
      }

      const result = await withContractLock(tx, tenantId, contract.id, async () => {
        const occurrences = await tx.leaseAllocationOccurrence.findMany({ where: { contractId: contract.id, tenantId } });

        const blockers: string[] = [];
        for (const occ of occurrences) {
          if (occ.status === 'ACTIVE') {
            blockers.push(`Vehicle ${occ.vehicleId} allocation (occurrence ${occ.id}) is still ACTIVE — not yet returned`);
            continue;
          }
          if (occ.status === 'RECONCILIATION_REQUIRED') {
            blockers.push(`Occurrence ${occ.id} requires manual reconciliation before closure`);
            continue;
          }
          const ret = await tx.leaseVehicleReturn.findFirst({ where: { allocationOccurrenceId: occ.id, tenantId } });
          if (!ret) {
            blockers.push(`Occurrence ${occ.id} (ENDED) has no linked return record`);
            continue;
          }
          const evaluation = await evaluateContractSettlementLiabilities(tx, tenantId, contract.id, { returnId: ret.id });
          const cleared = evaluation.unpostedTotal === 0 && evaluation.outstandingTotal === 0 && !evaluation.hasDisputedHold;
          if (!cleared) {
            blockers.push(`Return ${ret.id} (occurrence ${occ.id}) not settled: ${evaluation.blockers.join('; ')}`);
          }
        }

        if (blockers.length > 0) {
          return NextResponse.json({ error: 'Contract cannot close — outstanding allocations', blockers }, { status: 409 });
        }

        const hasExecutedTermination = await tx.leaseEarlyTermination.findFirst({
          where: { contractId: contract.id, tenantId, status: 'EXECUTED' },
        });

        const deposit = await findDepositForContract(tx, tenantId, contract);
        let refundRequestedAmount: number | null = null;
        if (deposit) {
          const row = await lockDepositRow(tx, tenantId, deposit.id);
          const remaining = Number(row.collected_amount) - Number(row.total_deducted) - Number(row.reserved_amount);
          if (remaining > 0.005) {
            try {
              await requestRefund(tx, tenantId, deposit.id, remaining, actor);
              refundRequestedAmount = remaining;
            } catch (e) {
              if (!(e instanceof SecurityDepositError)) throw e;
            }
          }
        }

        const closureReason = hasExecutedTermination ? 'EARLY_TERMINATED' : 'COMPLETED';
        const closure = await tx.leaseContractClosure.create({
          data: {
            tenantId,
            contractId: contract.id,
            closureReason,
            earlyTerminationId: hasExecutedTermination?.id ?? null,
            depositId: deposit?.id ?? null,
            refundRequestedAmount,
            status: refundRequestedAmount ? 'PENDING_REFUND' : 'FINAL',
            closedBy: actor,
          },
        });

        if (!hasExecutedTermination) {
          await tx.leaseContract2.update({ where: { id: contract.id }, data: { status: 'COMPLETED' } });
        }

        return NextResponse.json(closure, { status: 201 });
      });

      void logAudit({
        tenantId,
        userId: actor,
        entityType: 'LeaseContract2',
        entityId: contract.id,
        action: 'UPDATE',
        details: `Contract closure attempt (${contract.contractNumber ?? contract.id})`,
      });

      return result;
    } catch (e) {
      captureException(e, { context: 'leasing.contracts-v2.close' });
      if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error('[contracts-v2 close]', e);
      return NextResponse.json({ error: 'Failed to close contract' }, { status: 500 });
    }
  });
}
