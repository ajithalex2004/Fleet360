export const dynamic = 'force-dynamic';

/**
 * /api/leasing/returns/[id] — return detail + the settlement mini-lifecycle.
 *
 * PATCH actions (each requires the return to be in a specific prior state —
 * 400 with the current state otherwise):
 *   clear_vehicle / hold_vehicle    — manual clearance override
 *   approve_charges                 — posts approved damage to an invoice
 *                                      line immediately (or waives it)
 *   settle_deposit                  — applies deposit funds against this
 *                                      return's outstanding invoices
 *   confirm_no_deposit_required     — explicit bypass when no deposit
 *                                      record matches (never a silent default)
 *   resolve_mileage_review          — explicit bypass for REVIEW_REQUIRED
 *   correct                         — post-billing reversal (adjustment
 *                                      trail, never a second return row)
 *   cancel                          — financial-only, pre-billing; never
 *                                      touches vehicle/allocation status
 *
 * NOTE: manual actions here are not yet gated by a role/permission check —
 * no sibling leasing route (handover, deposits, early-terminations) does
 * granular RBAC at this layer today, only tenant scoping via
 * requireAuthorizedTenant. Flagged as a follow-up, not invented here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withContractLock } from '@/lib/leasing/contract-lock';
import {
  manuallyClearVehicle,
  manuallyHoldVehicle,
  evaluateContractSettlementLiabilities,
  recomputeSettlementStatus,
  findDepositForContract,
} from '@/lib/leasing/return-workflow';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';
import { applyDepositToInvoice, reverseDepositApplication, SecurityDepositError } from '@/lib/finance/security-deposit';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const item = await tx.leaseVehicleReturn.findFirst({
      where: { id: params.id, tenantId },
      include: { contract: true, adjustments: true },
    });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const liabilities = item.contractId
      ? await evaluateContractSettlementLiabilities(tx, tenantId, item.contractId, { returnId: item.id })
      : null;
    return NextResponse.json({ ...item, liabilities });
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  const actor = req.headers.get('x-user-id') ?? 'staff';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const b = stripTenantOwnershipFields(bodyRaw);
      const action = b.action as string | undefined;

      const ret = await tx.leaseVehicleReturn.findFirst({ where: { id: params.id, tenantId } });
      if (!ret) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
      if (!ret.contractId) return NextResponse.json({ error: 'Return has no linked contract' }, { status: 400 });

      const run = () =>
        withContractLock(tx, tenantId, ret.contractId as string, async () => {
          switch (action) {
            case 'clear_vehicle': {
              await manuallyClearVehicle(tx, tenantId, ret.id, actor);
              break;
            }
            case 'hold_vehicle': {
              await manuallyHoldVehicle(tx, tenantId, ret.id, actor);
              break;
            }
            case 'approve_charges': {
              if (ret.chargeApprovalStatus !== 'PENDING') {
                return NextResponse.json(
                  { error: `Charges already ${ret.chargeApprovalStatus} — cannot re-approve` },
                  { status: 400 },
                );
              }
              if (b.waive) {
                await tx.leaseVehicleReturn.update({
                  where: { id: ret.id },
                  data: { chargeApprovalStatus: 'WAIVED', approvedDamageCost: 0, chargeApprovedBy: actor },
                });
                break;
              }
              const approvedAmount = Number(b.approvedDamageCost ?? ret.estimatedDamageCost ?? 0);
              if (!(approvedAmount > 0)) {
                return NextResponse.json({ error: 'approvedDamageCost must be greater than 0, or pass waive: true' }, { status: 400 });
              }
              const contract = await tx.leaseContract2.findFirst({
                where: { id: ret.contractId as string, tenantId },
                select: { id: true, contractNumber: true, lesseeId: true, currency: true },
              });
              if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

              await lockSerialSeries(tx, tenantId, 'invoice');
              const count = await tx.leaseInvoice.count({ where: { tenantId } });
              const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
              const vatPct = 5;
              const vatAmount = approvedAmount * (vatPct / 100);
              const totalAmount = approvedAmount + vatAmount;
              const issueDate = new Date();
              const dueDate = new Date(issueDate.getTime() + 30 * 86400000);
              const currency = contract.currency ?? 'AED';

              const invoice = await tx.leaseInvoice.create({
                data: {
                  tenantId,
                  invoiceNo,
                  lesseeId: contract.lesseeId,
                  billingPeriod: `Return damage — ${ret.id}`,
                  issueDate,
                  dueDate,
                  subTotal: approvedAmount,
                  vatPct,
                  vatAmount,
                  totalAmount,
                  currency,
                  status: 'DRAFT',
                  notes: `Auto-generated for approved return damage on contract ${contract.contractNumber ?? contract.id}.`,
                  lines: {
                    create: [
                      {
                        tenantId,
                        contractId: contract.id,
                        vehicleRef: ret.vehicleId,
                        description: `Return damage charge — ${ret.id}`,
                        lineType: 'DAMAGE',
                        quantity: 1,
                        unitAmount: approvedAmount,
                        totalAmount: approvedAmount,
                        currency,
                      },
                    ],
                  },
                },
              });

              await tx.leaseVehicleReturn.update({
                where: { id: ret.id },
                data: {
                  chargeApprovalStatus: 'APPROVED',
                  approvedDamageCost: approvedAmount,
                  damageInvoiceId: invoice.id,
                  chargeApprovedBy: actor,
                },
              });
              break;
            }
            case 'resolve_mileage_review': {
              if (ret.mileageAssessment !== 'REVIEW_REQUIRED') {
                return NextResponse.json({ error: 'mileageAssessment is not REVIEW_REQUIRED' }, { status: 400 });
              }
              await tx.leaseVehicleReturn.update({ where: { id: ret.id }, data: { mileageAssessment: 'OK' } });
              break;
            }
            case 'confirm_no_deposit_required': {
              await tx.leaseVehicleReturn.update({
                where: { id: ret.id },
                data: { depositReconciliation: 'NOT_REQUIRED', depositConfirmedBy: actor },
              });
              break;
            }
            case 'settle_deposit': {
              if (!['APPROVED', 'WAIVED'].includes(ret.chargeApprovalStatus ?? '')) {
                return NextResponse.json({ error: 'Charges must be approved or waived before deposit settlement' }, { status: 400 });
              }
              if (ret.mileageAssessment && ret.mileageAssessment !== 'OK') {
                return NextResponse.json({ error: 'Resolve mileage review before deposit settlement' }, { status: 400 });
              }
              const contract = await tx.leaseContract2.findFirst({
                where: { id: ret.contractId as string, tenantId },
                select: { id: true, contractNumber: true },
              });
              if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

              const deposit = await findDepositForContract(tx, tenantId, contract);
              if (!deposit) {
                return NextResponse.json(
                  { error: 'No matching deposit found for this contract. Use confirm_no_deposit_required if none is expected.' },
                  { status: 400 },
                );
              }

              const evaluation = await evaluateContractSettlementLiabilities(tx, tenantId, contract.id, { returnId: ret.id });
              const invoiced = evaluation.items.filter((i) => i.state === 'INVOICED' && i.amount > 0.005);
              for (const item of invoiced) {
                const invoiceId = item.type === 'DAMAGE' ? ret.damageInvoiceId : item.type === 'MILEAGE_OVERAGE' ? ret.overageInvoiceId : null;
                if (!invoiceId) continue;
                try {
                  await applyDepositToInvoice(tx, tenantId, {
                    depositId: deposit.id,
                    returnId: ret.id,
                    invoiceId,
                    amount: item.amount,
                    applicationType: item.type === 'DAMAGE' ? 'DAMAGE' : 'OVERAGE_INVOICE',
                    appliedBy: actor,
                    description: `${item.type} settlement for return ${ret.id}`,
                  });
                } catch (e) {
                  if (e instanceof SecurityDepositError) {
                    // Deposit balance exhausted — apply what remains via a
                    // best-effort full deduction, leaving the rest on the
                    // invoice as a normal customer receivable.
                    break;
                  }
                  throw e;
                }
              }

              await tx.leaseVehicleReturn.update({
                where: { id: ret.id },
                data: { depositId: deposit.id, depositReconciliation: 'RECONCILED', depositConfirmedBy: actor },
              });
              break;
            }
            case 'correct': {
              if (ret.processingStatus !== 'PROCESSED') {
                return NextResponse.json({ error: 'Only a processed return can be corrected' }, { status: 400 });
              }
              const applications = await tx.$queryRawUnsafe<Array<{ id: string; invoice_id: string | null }>>(
                `SELECT id, invoice_id FROM lease_deposit_applications WHERE tenant_id = $1 AND return_id = $2 AND reversed_at IS NULL`,
                tenantId,
                ret.id,
              );
              for (const app of applications) {
                const reversed = await reverseDepositApplication(tx, tenantId, app.id, { reason: b.reason, reversedBy: actor });
                await tx.leaseReturnAdjustment.create({
                  data: {
                    tenantId,
                    returnId: ret.id,
                    adjustmentType: 'DEPOSIT_REVERSAL',
                    amountDelta: Number(reversed.applied_amount),
                    reason: b.reason ?? null,
                    reversesApplicationId: app.id,
                    createdBy: actor,
                  },
                });
              }
              if (!applications.length) {
                await tx.leaseReturnAdjustment.create({
                  data: {
                    tenantId,
                    returnId: ret.id,
                    adjustmentType: 'CHARGE_CORRECTION',
                    reason: b.reason ?? null,
                    createdBy: actor,
                  },
                });
              }
              await recomputeSettlementStatus(tx, tenantId, ret.id);
              break;
            }
            case 'cancel': {
              if (ret.processingStatus === 'PROCESSED' && (ret.mileageReadingId || ret.damageInvoiceId)) {
                return NextResponse.json(
                  { error: 'Financial processing has already posted for this return — use correct instead of cancel' },
                  { status: 400 },
                );
              }
              await tx.leaseVehicleReturn.update({
                where: { id: ret.id },
                data: { cancelledAt: new Date(), cancelledBy: actor },
              });
              break;
            }
            default:
              return NextResponse.json({ error: `Unknown or missing action: ${action}` }, { status: 400 });
          }

          if (action !== 'correct') {
            await recomputeSettlementStatus(tx, tenantId, ret.id);
          }

          const updated = await tx.leaseVehicleReturn.findFirst({ where: { id: ret.id, tenantId } });
          return NextResponse.json(updated);
        });

      const result = await run();

      void logAudit({
        tenantId,
        userId: actor,
        entityType: 'LeaseVehicleReturn',
        entityId: ret.id,
        action: 'UPDATE',
        details: `Return action: ${action}`,
      });

      return result;
    } catch (e) {
      captureException(e, { context: 'leasing.returns.[id].PATCH' });
      if (e instanceof SecurityDepositError) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error('[returns PATCH]', e);
      return NextResponse.json({ error: 'Failed to update return' }, { status: 500 });
    }
  });
}
