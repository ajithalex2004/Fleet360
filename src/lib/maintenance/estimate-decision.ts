/**
 * Recording an estimate decision on a maintenance request, inside the
 * caller's tenant transaction. Shared by the estimate decision API (a
 * direct decision under the approval rules) and the approval workflow
 * (src/lib/workflow/subjects.ts), which applies its final outcome here.
 */
import type { Prisma } from '@prisma/client';
import { ESTIMATION_APPROVED, PENDING_ESTIMATION_APPROVAL, UNDER_ESTIMATION, statusKey } from './approval-rules';
import type { publishEstimationApproved } from './publish-event';

type Tx = Prisma.TransactionClient;
export type EstimationApprovedPayload = Parameters<typeof publishEstimationApproved>[2];

/** A request waiting for estimate approval, with its quotations. */
export async function loadPendingEstimate(tx: Tx, tenantId: string, requestId: string) {
  const mr = await tx.maintenanceRequest.findFirst({
    where: { id: requestId, tenantId, deletedAt: null },
    select: { id: true, status: true, vehicleId: true, estimatedCost: true, workOrderNo: true },
  });
  if (!mr || statusKey(mr.status) !== statusKey(PENDING_ESTIMATION_APPROVAL)) return { mr, quotations: [] as QuotationAmount[] };
  const rows = await tx.quotation.findMany({
    where: { tenantId, maintenanceRequestId: requestId, deletedAt: null },
    select: { id: true, grandTotal: true, totalCost: true, garageId: true },
  });
  const quotations = rows.map((q) => ({ id: q.id, garageId: q.garageId, amount: Number(q.grandTotal ?? q.totalCost ?? NaN) }));
  return { mr, quotations };
}

export interface QuotationAmount { id: string; garageId: string | null; amount: number }

/**
 * The quotation an approval workflow approves: the one matching the
 * request's estimated cost, else the cheapest with an amount.
 */
export function quotationForApproval(quotations: QuotationAmount[], estimatedCost: unknown): QuotationAmount | null {
  const priced = quotations.filter((q) => Number.isFinite(q.amount));
  const cost = Number(estimatedCost);
  if (Number.isFinite(cost)) {
    const match = priced.find((q) => Math.abs(q.amount - cost) < 0.005);
    if (match) return match;
  }
  return [...priced].sort((a, b) => a.amount - b.amount)[0] ?? null;
}

/**
 * Approves `quotation` for the request: it becomes APPROVED and the others
 * REJECTED; the request moves to Estimation Approved with the quotation's
 * amount and garage, and the approval is recorded. Returns the event to
 * publish once the transaction commits.
 */
export async function recordEstimateApproval(tx: Tx, args: {
  tenantId: string; requestId: string; vehicleId: string | null;
  quotation: QuotationAmount; actor: string; comments?: string | null;
  /** How it was approved, for the request's record: rule or workflow. */
  basis: { rule?: { id: string; name: string } | null; roles?: string[]; workflow?: string | null };
}): Promise<EstimationApprovedPayload> {
  const { tenantId, requestId, quotation, actor } = args;
  const now = new Date();
  const comments = args.comments?.trim() || null;
  await tx.quotation.updateMany({ where: { tenantId, maintenanceRequestId: requestId, deletedAt: null, id: { not: quotation.id } }, data: { status: 'REJECTED' } });
  await tx.quotation.updateMany({ where: { tenantId, id: quotation.id }, data: { status: 'APPROVED' } });
  await tx.maintenanceRequest.updateMany({
    where: { id: requestId, tenantId },
    data: {
      status: ESTIMATION_APPROVED,
      estimatedCost: quotation.amount,
      ...(quotation.garageId ? { garageId: quotation.garageId } : {}),
      estimateApproval: JSON.stringify({
        quotationId: quotation.id, amount: quotation.amount, approvedBy: actor, roles: args.basis.roles ?? [],
        approvedAt: now.toISOString(), rule: args.basis.rule ?? null, workflow: args.basis.workflow ?? null, comments,
      }),
    },
  });
  const basis = args.basis.workflow
    ? ` through the "${args.basis.workflow}" approval workflow`
    : args.basis.rule ? ` under rule "${args.basis.rule.name}"` : '';
  await tx.statusHistory.create({
    data: {
      tenantId, maintenanceRequestId: requestId, status: ESTIMATION_APPROVED, date: now, actor,
      note: `Estimate approved (AED ${quotation.amount.toLocaleString('en-AE')})${basis}${comments ? `: ${comments}` : ''}`,
    },
  });
  const garage = quotation.garageId
    ? await tx.garage.findFirst({ where: { id: quotation.garageId }, select: { name: true } }).catch(() => null)
    : null;
  return {
    requestId, vehicleId: args.vehicleId ?? '', tenantId,
    garageId: quotation.garageId ?? null, garageName: garage?.name ?? null,
    estimatedCost: quotation.amount, currency: 'AED', approvedBy: actor, approvedAt: now.toISOString(),
  };
}

/** Rejects every quotation and returns the request to Under Estimation with the reason. */
export async function recordEstimateRejection(tx: Tx, args: {
  tenantId: string; requestId: string; actor: string; reason: string;
}) {
  const { tenantId, requestId } = args;
  await tx.quotation.updateMany({ where: { tenantId, maintenanceRequestId: requestId, deletedAt: null }, data: { status: 'REJECTED' } });
  await tx.maintenanceRequest.updateMany({ where: { id: requestId, tenantId }, data: { status: UNDER_ESTIMATION } });
  await tx.statusHistory.create({
    data: { tenantId, maintenanceRequestId: requestId, status: UNDER_ESTIMATION, date: new Date(), note: `Estimates rejected: ${args.reason}`, actor: args.actor },
  });
}
