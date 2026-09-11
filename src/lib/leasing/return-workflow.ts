import type { TxClient } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { computeAndInvoiceMileageOverage, type MileageOverageContract } from '@/lib/leasing/mileage-overage';
import { getInvoiceOutstandingBalance } from '@/lib/leasing/invoice-balance';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

/** 1-5 star scale — matches ConditionSelector in src/app/leasing/handover/page.tsx. */
export const RETURN_CLEARANCE_MIN_CONDITION_SCORE = 4;

type HandoverRow = {
  id: string;
  handover_type: string;
  status: string;
  contract_id: string | null;
  vehicle_id: string | null;
  vehicle_no: string;
  handover_date: string;
  odometer_reading: number | null;
  condition_score: number | null;
  no_damage_confirmed: boolean | null;
  damage_notes: string | null;
  signed_by: string | null;
  occurrence_id: string | null;
};

async function readHandoverRow(tx: TxClient, tenantId: string, handoverId: string): Promise<HandoverRow | null> {
  const rows = await tx.$queryRawUnsafe<HandoverRow[]>(
    `SELECT id, handover_type, status, contract_id, vehicle_id, vehicle_no, handover_date,
            odometer_reading, condition_score, no_damage_confirmed, damage_notes, signed_by, occurrence_id
       FROM leasing_handovers WHERE id = $1::uuid AND tenant_id = $2`,
    handoverId,
    tenantId,
  );
  return rows[0] ?? null;
}

// ============================================================
// Phase 1 — physical link. Called from the handover's own PATCH COMPLETE
// transaction. Cheap: resolve identity, insert a minimal return row, close
// the allocation occurrence, end the LeaseContractVehicle allocation.
// Never blocks the handover's own completion — a resolution failure here
// just means no return row gets created; the orphaned-handover sweep
// exists for exactly that case.
// ============================================================

export async function linkReturnFromHandover(
  tx: TxClient,
  tenantId: string,
  handoverId: string,
): Promise<{ id: string } | null> {
  const existing = await tx.leaseVehicleReturn.findFirst({
    where: { tenantId, handoverId },
    select: { id: true },
  });
  if (existing) return existing; // idempotent — already linked

  const handover = await readHandoverRow(tx, tenantId, handoverId);
  if (!handover || handover.handover_type !== 'RETURN' || handover.status !== 'COMPLETED') {
    return null;
  }
  if (!handover.contract_id) {
    void logAudit({
      tenantId,
      entityType: 'LeaseVehicleReturn',
      entityId: handoverId,
      action: 'SKIP',
      details: 'RETURN handover has no contract_id — return workflow not triggered.',
    });
    return null;
  }

  const contract = await tx.leaseContract2.findFirst({
    where: { id: handover.contract_id, tenantId },
    select: { id: true, contractNumber: true },
  });
  if (!contract) return null;

  let vehicleId = handover.vehicle_id;
  if (!vehicleId && handover.vehicle_no) {
    const v = await tx.vehicle.findFirst({
      where: { tenantId, licensePlate: handover.vehicle_no },
      select: { id: true },
    });
    vehicleId = v?.id ?? null;
  }
  if (!vehicleId) {
    void logAudit({
      tenantId,
      entityType: 'LeaseVehicleReturn',
      entityId: handoverId,
      action: 'SKIP',
      details: 'RETURN handover has no resolvable vehicle — return workflow not triggered.',
    });
    return null;
  }

  const contractVehicle = await tx.leaseContractVehicle.findFirst({
    where: { tenantId, contractId: contract.id, vehicleId },
  });
  if (!contractVehicle) {
    void logAudit({
      tenantId,
      entityType: 'LeaseVehicleReturn',
      entityId: handoverId,
      action: 'SKIP',
      details: 'RETURN handover vehicle is not an allocated LeaseContractVehicle on this contract.',
    });
    return null;
  }

  let occurrenceId = handover.occurrence_id;
  if (!occurrenceId) {
    const occ = await tx.leaseAllocationOccurrence.findFirst({
      where: { tenantId, contractVehicleId: contractVehicle.id, vehicleId, status: 'ACTIVE' },
    });
    occurrenceId = occ?.id ?? null;
  }

  const returnDate = new Date(handover.handover_date);

  const created = await tx.leaseVehicleReturn.create({
    data: {
      tenantId,
      contractNumber: contract.contractNumber ?? '',
      contractId: contract.id,
      allocationOccurrenceId: occurrenceId,
      vehicleId,
      handoverId,
      returnDate,
      mileage: handover.odometer_reading ?? 0,
      condition: handover.no_damage_confirmed === true ? 'Good' : handover.damage_notes ? 'Fair' : 'Good',
      damages: handover.damage_notes,
      inspector: handover.signed_by ?? 'Unknown',
      linkedAt: new Date(),
      processingStatus: 'PENDING',
    },
  });

  // Physical facts, committed now, independent of financial processing —
  // a later financial `cancel` never reverts these.
  if (occurrenceId) {
    await tx.leaseAllocationOccurrence.updateMany({
      where: { id: occurrenceId, tenantId, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: returnDate, endReason: 'RETURN' },
    });
  }
  await tx.leaseContractVehicle.update({
    where: { id: contractVehicle.id },
    data: { status: 'RETURNED' },
  });

  return created;
}

// ============================================================
// Phase 2 — billing/clearance. Separate transaction from Phase 1. Each
// sub-step checks its own completion marker before acting, so a retry
// after a partial failure never redoes completed work.
// ============================================================

export async function processReturn(tx: TxClient, tenantId: string, returnId: string): Promise<void> {
  const ret = await tx.leaseVehicleReturn.findFirst({ where: { id: returnId, tenantId } });
  if (!ret || !ret.contractId) {
    throw new Error(`processReturn: return ${returnId} not found or has no contractId`);
  }

  const contract = await tx.leaseContract2.findFirst({
    where: { id: ret.contractId, tenantId },
    select: {
      id: true,
      contractNumber: true,
      lesseeId: true,
      startDate: true,
      endDate: true,
      mileageCap: true,
      mileageOverageRate: true,
      currency: true,
    },
  });
  if (!contract) {
    throw new Error(`processReturn: contract ${ret.contractId} not found`);
  }

  // ── Mileage overage (idempotent: skip if already done) ──────────────────
  if (!ret.mileageReadingId) {
    const reading = await tx.leaseMileageReading.create({
      data: {
        tenantId,
        contractId: contract.id,
        contractVehicleId: null,
        vehicleId: ret.vehicleId,
        readingDate: ret.returnDate,
        mileage: ret.mileage,
        readingType: 'RETURN',
        source: 'MANUAL',
        notes: `Auto-created by return workflow for return ${ret.id}`,
      },
    });

    const result = await computeAndInvoiceMileageOverage(tx, {
      tenantId,
      contract: contract as MileageOverageContract,
      readingType: 'RETURN',
      mileage: ret.mileage,
      readingDate: ret.returnDate,
      vehicleId: ret.vehicleId,
    });

    await tx.leaseVehicleReturn.update({
      where: { id: ret.id },
      data: {
        mileageReadingId: reading.id,
        deliveryMileage: result.deliveryMileage,
        mileageOverageId: (result.overage?.id as string | undefined) ?? null,
        overageInvoiceId: (result.invoice?.id as string | undefined) ?? null,
        mileageAssessment: result.reason === 'NO_MILEAGE_CAP' || result.reason === 'NO_DELIVERY_READING' ? 'REVIEW_REQUIRED' : 'OK',
      },
    });
  }

  // ── Vehicle clearance (pure recompute — always safe to rerun) ───────────
  const handover = ret.handoverId ? await readHandoverRow(tx, tenantId, ret.handoverId) : null;
  await assessVehicleClearance(tx, tenantId, ret.id, handover);

  await tx.leaseVehicleReturn.update({
    where: { id: ret.id },
    data: { processingStatus: 'PROCESSED' },
  });
}

/**
 * Resilient wrapper for real callers (handover route, sweep): Phase 2 runs
 * in its own transaction; on failure, a SEPARATE transaction records
 * processingStatus: 'FAILED' with the error and an incremented attempt
 * count, so the failure is durable and the sweep can find and retry it —
 * a failure here never re-touches Phase 1's already-committed physical
 * facts.
 */
export async function attemptProcessReturn(tenantId: string, returnId: string): Promise<void> {
  try {
    await withTenantRls(prisma, tenantId, (tx) => processReturn(tx, tenantId, returnId));
  } catch (err) {
    captureException(err, { context: 'leasing.return-workflow.processReturn', extra: { returnId } });
    await withTenantRls(prisma, tenantId, (tx) =>
      tx.leaseVehicleReturn.updateMany({
        where: { id: returnId, tenantId },
        data: {
          processingStatus: 'FAILED',
          processingAttempts: { increment: 1 },
          lastProcessingError: err instanceof Error ? err.message : String(err),
        },
      }),
    );
  }
}

// ============================================================
// Vehicle clearance — six checks, evaluated at clearance-processing time
// (now(), not the physical return date). Missing evidence is PENDING, a
// confirmed problem is HOLD; only all-pass is CLEARED.
// ============================================================

export async function assessVehicleClearance(
  tx: TxClient,
  tenantId: string,
  returnId: string,
  handover: HandoverRow | null,
): Promise<void> {
  const ret = await tx.leaseVehicleReturn.findFirst({ where: { id: returnId, tenantId } });
  if (!ret || !ret.vehicleId) return;

  const vehicle = await tx.vehicle.findFirst({
    where: { id: ret.vehicleId, tenantId },
    select: { id: true, status: true, lifecycleStage: true, registrationExpiry: true, insuranceExpiry: true, mulkiyaExpiry: true },
  });
  if (!vehicle) return;

  const now = new Date();
  const noDamageConfirmed = handover?.no_damage_confirmed ?? null;
  const conditionScore = handover?.condition_score ?? null;

  // Check 6 — terminal lifecycle state, evaluated first: never auto-cleared
  // or auto-put-in-maintenance regardless of the other checks.
  const terminal =
    vehicle.status === 'SOLD' || vehicle.status === 'INACTIVE' ||
    vehicle.lifecycleStage === 'DECOMMISSIONED' || vehicle.lifecycleStage === 'SOLD';
  if (terminal) {
    await tx.leaseVehicleReturn.update({ where: { id: ret.id }, data: { vehicleClearanceStatus: 'HOLD' } });
    return;
  }

  const openMaintenance = await tx.maintenanceRequest.findFirst({
    where: {
      tenantId,
      vehicleId: ret.vehicleId,
      deletedAt: null,
      WorkOrder: { status: { notIn: ['COMPLETED', 'INVOICE_SUBMITTED', 'SUBMIT_INVOICE'] } },
    },
    select: { id: true },
  });

  const complianceDates = [vehicle.registrationExpiry, vehicle.insuranceExpiry, vehicle.mulkiyaExpiry];
  const hasMissingCompliance = complianceDates.some((d) => d === null);
  const hasExpiredCompliance = complianceDates.some((d) => d !== null && d < now);

  const confirmedProblem =
    noDamageConfirmed === false ||
    (conditionScore !== null && conditionScore < RETURN_CLEARANCE_MIN_CONDITION_SCORE) ||
    Boolean(openMaintenance) ||
    hasExpiredCompliance;

  const missingEvidence = noDamageConfirmed === null || conditionScore === null || hasMissingCompliance;

  let clearanceStatus: 'CLEARED' | 'HOLD' | 'PENDING';
  if (confirmedProblem) {
    clearanceStatus = 'HOLD';
  } else if (missingEvidence) {
    clearanceStatus = 'PENDING';
  } else {
    clearanceStatus = 'CLEARED';
  }

  await tx.leaseVehicleReturn.update({
    where: { id: ret.id },
    data: { vehicleClearanceStatus: clearanceStatus, clearedAt: clearanceStatus === 'CLEARED' ? now : null },
  });

  if (clearanceStatus === 'HOLD') {
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: 'MAINTENANCE' } });
    return;
  }
  if (clearanceStatus === 'PENDING') {
    await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: 'PENDING_INSPECTION' } });
    return;
  }

  // CLEARED — verify no other ACTIVE occurrence already reserves this
  // vehicle on a different contract, and don't clobber an existing
  // RESERVED status, before writing AVAILABLE.
  const otherReservation = await tx.leaseAllocationOccurrence.findFirst({
    where: { tenantId, vehicleId: vehicle.id, status: 'ACTIVE', contractId: { not: ret.contractId ?? undefined } },
    select: { id: true },
  });
  if (otherReservation || vehicle.status === 'RESERVED') {
    return; // preserve existing reservation
  }
  await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: 'AVAILABLE', lifecycleStage: null } });
}

/** Manual override — requires an authenticated, permission-checked actor at the route layer. */
export async function manuallyClearVehicle(tx: TxClient, tenantId: string, returnId: string, clearedBy: string): Promise<void> {
  const ret = await tx.leaseVehicleReturn.findFirst({ where: { id: returnId, tenantId } });
  if (!ret || !ret.vehicleId) throw new Error(`Return ${returnId} not found or has no vehicle`);
  await tx.leaseVehicleReturn.update({
    where: { id: ret.id },
    data: { vehicleClearanceStatus: 'CLEARED', clearedBy, clearedAt: new Date() },
  });
  const vehicle = await tx.vehicle.findFirst({ where: { id: ret.vehicleId, tenantId }, select: { status: true } });
  if (vehicle && vehicle.status !== 'RESERVED') {
    await tx.vehicle.update({ where: { id: ret.vehicleId }, data: { status: 'AVAILABLE', lifecycleStage: null } });
  }
}

export async function manuallyHoldVehicle(tx: TxClient, tenantId: string, returnId: string, heldBy: string): Promise<void> {
  const ret = await tx.leaseVehicleReturn.findFirst({ where: { id: returnId, tenantId } });
  if (!ret || !ret.vehicleId) throw new Error(`Return ${returnId} not found or has no vehicle`);
  await tx.leaseVehicleReturn.update({
    where: { id: ret.id },
    data: { vehicleClearanceStatus: 'HOLD', clearedBy: heldBy, clearedAt: null },
  });
  await tx.vehicle.update({ where: { id: ret.vehicleId }, data: { status: 'MAINTENANCE' } });
}

// ============================================================
// Shared settlement-liability evaluator — the one function both
// settle_deposit and closure call, so a liability is never counted twice
// (once as a raw estimate, again as its posted invoice balance).
// ============================================================

export type LiabilityItem = {
  type: 'DAMAGE' | 'MILEAGE_OVERAGE' | 'TRAFFIC_FINE' | 'OTHER_INVOICE';
  sourceId: string;
  state: 'UNPOSTED_APPROVED' | 'INVOICED' | 'PAID' | 'WAIVED' | 'DISPUTED';
  amount: number;
};

export type SettlementEvaluation = {
  items: LiabilityItem[];
  outstandingTotal: number;
  unpostedTotal: number;
  hasDisputedHold: boolean;
  blockers: string[];
};

/**
 * Scoped to a single return (via opts.returnId) for settle_deposit / per-
 * return status, or contract-wide (opts omitted) for closure's
 * completeness check. Contract-wide "other outstanding invoices" (e.g.
 * unpaid rent) always count regardless of scope — the whole contract owing
 * money blocks every return's settlement equally, not just one vehicle's.
 */
export async function evaluateContractSettlementLiabilities(
  tx: TxClient,
  tenantId: string,
  contractId: string,
  opts: { returnId?: string } = {},
): Promise<SettlementEvaluation> {
  const items: LiabilityItem[] = [];
  const countedInvoiceIds = new Set<string>();

  const returns = opts.returnId
    ? await tx.leaseVehicleReturn.findMany({ where: { id: opts.returnId, tenantId, contractId } })
    : await tx.leaseVehicleReturn.findMany({ where: { tenantId, contractId } });

  for (const ret of returns) {
    if (ret.chargeApprovalStatus === 'APPROVED' && ret.approvedDamageCost != null) {
      if (ret.damageInvoiceId) {
        const balance = await getInvoiceOutstandingBalance(tx, tenantId, ret.damageInvoiceId);
        items.push({ type: 'DAMAGE', sourceId: ret.id, state: balance <= 0.005 ? 'PAID' : 'INVOICED', amount: balance });
        countedInvoiceIds.add(ret.damageInvoiceId);
      } else {
        items.push({ type: 'DAMAGE', sourceId: ret.id, state: 'UNPOSTED_APPROVED', amount: Number(ret.approvedDamageCost) });
      }
    } else if (ret.chargeApprovalStatus === 'WAIVED') {
      items.push({ type: 'DAMAGE', sourceId: ret.id, state: 'WAIVED', amount: 0 });
    }

    if (ret.overageInvoiceId) {
      const balance = await getInvoiceOutstandingBalance(tx, tenantId, ret.overageInvoiceId);
      items.push({ type: 'MILEAGE_OVERAGE', sourceId: ret.id, state: balance <= 0.005 ? 'PAID' : 'INVOICED', amount: balance });
      countedInvoiceIds.add(ret.overageInvoiceId);
    }
  }

  const fineWhere = opts.returnId
    ? { tenantId, contractId, vehicleId: returns[0]?.vehicleId ?? undefined, billedToLessee: true }
    : { tenantId, contractId, billedToLessee: true };
  const fines = await tx.leaseTrafficFine.findMany({ where: fineWhere });
  for (const fine of fines) {
    const amount = Number(fine.finalAmount ?? fine.fineAmount);
    if (fine.billingStatus === 'DISPUTED') {
      items.push({ type: 'TRAFFIC_FINE', sourceId: fine.id, state: 'DISPUTED', amount });
    } else if (fine.billingStatus === 'PAID' || fine.billingStatus === 'ABSORBED') {
      items.push({ type: 'TRAFFIC_FINE', sourceId: fine.id, state: fine.billingStatus === 'PAID' ? 'PAID' : 'WAIVED', amount: 0 });
    } else if (fine.billingStatus === 'INVOICED') {
      // LeaseTrafficFine has no invoiceId to look up a live balance —
      // treat the raw amount as outstanding unless paidDate is set.
      items.push({ type: 'TRAFFIC_FINE', sourceId: fine.id, state: fine.paidDate ? 'PAID' : 'INVOICED', amount: fine.paidDate ? 0 : amount });
    } else {
      // PENDING — approved/known fine, not yet posted to an invoice.
      items.push({ type: 'TRAFFIC_FINE', sourceId: fine.id, state: 'UNPOSTED_APPROVED', amount });
    }
  }

  // Other outstanding invoices tied to this contract via LeaseInvoiceLine,
  // not already counted as damage/overage above (the double-counting fix).
  const lines = await tx.leaseInvoiceLine.findMany({
    where: { tenantId, contractId },
    select: { invoiceId: true },
    distinct: ['invoiceId'],
  });
  for (const line of lines) {
    if (countedInvoiceIds.has(line.invoiceId)) continue;
    const invoice = await tx.leaseInvoice.findFirst({ where: { id: line.invoiceId, tenantId }, select: { status: true } });
    if (!invoice || invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') continue;
    const balance = await getInvoiceOutstandingBalance(tx, tenantId, line.invoiceId);
    items.push({ type: 'OTHER_INVOICE', sourceId: line.invoiceId, state: balance <= 0.005 ? 'PAID' : 'INVOICED', amount: balance });
  }

  const outstandingTotal = items.filter((i) => i.state === 'INVOICED').reduce((sum, i) => sum + i.amount, 0);
  const unpostedTotal = items.filter((i) => i.state === 'UNPOSTED_APPROVED').reduce((sum, i) => sum + i.amount, 0);
  const hasDisputedHold = items.some((i) => i.state === 'DISPUTED');

  const blockers: string[] = [];
  if (unpostedTotal > 0) blockers.push(`${unpostedTotal.toFixed(2)} in approved charges not yet posted or waived`);
  if (outstandingTotal > 0) blockers.push(`${outstandingTotal.toFixed(2)} outstanding on posted invoices`);
  if (hasDisputedHold) blockers.push('one or more disputed items require review');

  return { items, outstandingTotal, unpostedTotal, hasDisputedHold, blockers };
}

/**
 * finance_security_deposits.contract_id is operator-typed free text (no
 * contract picker in that module's UI) — there's no guaranteed FK match
 * between a LeaseContract2 and its deposit row. Tries the real contractId
 * first, then falls back to the human-entered contractNumber.
 */
export async function findDepositForContract(
  tx: TxClient,
  tenantId: string,
  contract: { id: string; contractNumber: string | null },
): Promise<{ id: string } | null> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM finance_security_deposits
      WHERE tenant_id = $1 AND (contract_id = $2 OR contract_id = $3)
      ORDER BY created_at DESC LIMIT 1`,
    tenantId,
    contract.id,
    contract.contractNumber ?? '',
  );
  return rows[0] ?? null;
}

/**
 * Recomputed after every mutating event (settle_deposit, record-payment,
 * correct/reversal) — financialSettlementStatus is a cached display
 * convenience derived here, never hand-set inline elsewhere. Closure
 * re-runs the evaluator directly rather than trusting this cached field.
 */
export async function recomputeSettlementStatus(tx: TxClient, tenantId: string, returnId: string): Promise<SettlementEvaluation | null> {
  const ret = await tx.leaseVehicleReturn.findFirst({ where: { id: returnId, tenantId }, select: { contractId: true } });
  if (!ret?.contractId) return null;

  const evaluation = await evaluateContractSettlementLiabilities(tx, tenantId, ret.contractId, { returnId });
  const cleared = evaluation.unpostedTotal === 0 && evaluation.outstandingTotal === 0 && !evaluation.hasDisputedHold;

  await tx.leaseVehicleReturn.update({
    where: { id: returnId },
    data: { financialSettlementStatus: cleared ? 'CLEARED' : 'AWAITING_PAYMENT' },
  });

  return evaluation;
}
