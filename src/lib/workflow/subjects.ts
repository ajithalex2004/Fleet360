/**
 * Records that can go through an approval workflow (Admin > Workflows), by
 * the workflow's reference type. For each:
 *   - the module and procedure a company defines its workflow under;
 *   - load: what is being approved, read from the record by the server (its
 *     amount and other values the levels' conditions use), or null when the
 *     record isn't waiting for this approval;
 *   - apply: the workflow's final outcome on the record, once (it does
 *     nothing when the record has moved on meanwhile);
 *   - row: the record as its module's API returns it.
 * Without an active workflow of its own for the procedure, a company's
 * records are approved in their module as before.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import { bookingRequestType, transferScope, type WorkflowContext } from './levels';
import { cancelRefundRequest, recordRefundDetails } from '@/lib/finance/security-deposit';
import {
  loadPendingEstimate, quotationForApproval, recordEstimateApproval, recordEstimateRejection,
  type EstimationApprovedPayload,
} from '@/lib/maintenance/estimate-decision';

type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;

export interface WorkflowOutcome {
  tenantId: string;
  instanceId: string;
  referenceType: string;
  referenceId: string;
  status: 'APPROVED' | 'REJECTED';
  /** Who made the final decision. */
  actorEmail: string;
  comments: string;
  /** The context the approval started with (subjects store what they need to apply it). */
  context: WorkflowContext;
}

export interface Loaded {
  referenceNumber: string;
  context: WorkflowContext;
  /** When the procedure depends on the record's stage (lease quotations). */
  procedure?: string;
}

export interface ApprovalSubject {
  module: string;
  procedure: string;
  label: string;
  load(tx: Tx, tenantId: string, id: string): Promise<Loaded | null>;
  /** May return work to run once the transaction commits (events). */
  apply(tx: Tx, o: WorkflowOutcome): Promise<void | (() => Promise<void>)>;
  row(tx: Tx, tenantId: string, id: string): Promise<Row | null>;
}

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : undefined;
};
const reasonOf = (o: WorkflowOutcome) => o.comments?.trim() || 'Rejected in the approval workflow';

/** A raw-SQL table's row (tables with a deleted_at column pass `soft`). */
const sqlRow = (table: string, soft = true) => async (tx: Tx, tenantId: string, id: string) => {
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `SELECT * FROM ${table} WHERE id::text = $1 AND tenant_id::text = $2${soft ? ' AND deleted_at IS NULL' : ''}`, id, tenantId);
  return rows[0] ?? null;
};

/** One row in `status` (else null), for load(). */
async function rowIn(tx: Tx, table: string, tenantId: string, id: string, statuses: string[], soft = true) {
  const row = await sqlRow(table, soft)(tx, tenantId, id);
  return row && statuses.includes(String(row.status)) ? row : null;
}

// Lease quotation stages that wait for an approval, and where approval takes them.
const QUOTATION_STAGES: Record<string, { procedure: string; next: string }> = {
  PENDING_APPROVAL:        { procedure: 'QUOTATION_APPROVAL', next: 'DRAFT_APPROVED' },
  PENDING_CREDIT_APPROVAL: { procedure: 'CREDIT_APPROVAL',    next: 'CREDIT_APPROVED' },
  PO_PREPARATION:          { procedure: 'PO_REQUEST',         next: 'PO_PREPARED' },
};
export const quotationApprovalStage = (status: string | null | undefined) => QUOTATION_STAGES[status ?? ''] ?? null;

export const APPROVAL_SUBJECTS: Record<string, ApprovalSubject> = {
  maintenance_estimate: {
    module: 'MAINTENANCE', procedure: 'ESTIMATE_APPROVAL', label: 'Maintenance estimate',
    async load(tx, tenantId, id) {
      const { mr, quotations } = await loadPendingEstimate(tx, tenantId, id);
      if (!mr || !quotations.length) return null;
      const chosen = quotationForApproval(quotations, mr.estimatedCost);
      if (!chosen) return null;
      return {
        referenceNumber: mr.workOrderNo || `MR-${id.slice(0, 8).toUpperCase()}`,
        context: {
          amount: chosen.amount, quotationId: chosen.id, garageId: chosen.garageId, vehicleId: mr.vehicleId,
          requestType: mr.maintenanceType,
        },
      };
    },
    async apply(tx, o) {
      const { mr, quotations } = await loadPendingEstimate(tx, o.tenantId, o.referenceId);
      if (!mr) return;
      if (o.status === 'REJECTED') {
        await recordEstimateRejection(tx, { tenantId: o.tenantId, requestId: o.referenceId, actor: o.actorEmail, reason: reasonOf(o) });
        return;
      }
      const quotation = quotations.find((q) => q.id === o.context.quotationId);
      if (!quotation) {
        console.warn(`[Workflow] Estimate approved but quotation ${String(o.context.quotationId)} is no longer on request ${o.referenceId}`);
        return;
      }
      const workflow = await tx.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT d.name FROM "WorkflowInstance" i JOIN "WorkflowDefinition" d ON d.id = i."workflowId" WHERE i.id = $1`, o.instanceId);
      const event: EstimationApprovedPayload = await recordEstimateApproval(tx, {
        tenantId: o.tenantId, requestId: o.referenceId, vehicleId: mr.vehicleId, quotation,
        actor: o.actorEmail, comments: o.comments, basis: { workflow: workflow[0]?.name ?? 'approval' },
      });
      return async () => {
        const { publishEstimationApproved } = await import('@/lib/maintenance/publish-event');
        await runAsTenant(o.tenantId, () => publishEstimationApproved(o.referenceId, o.tenantId, event));
      };
    },
    async row(tx, tenantId, id) {
      return tx.maintenanceRequest.findFirst({ where: { id, tenantId } }) as Promise<Row | null>;
    },
  },

  finance_expense: {
    module: 'FINANCE', procedure: 'EXPENSE_APPROVAL', label: 'Expense',
    async load(tx, tenantId, id) {
      const r = await rowIn(tx, 'finance_expenses', tenantId, id, ['SUBMITTED']);
      return r && {
        referenceNumber: String(r.expense_no ?? id),
        context: { amount: num(r.total_amount), category: r.category, requestType: r.category, costCentre: r.cost_centre },
      };
    },
    async apply(tx, o) {
      if (o.status === 'APPROVED') {
        await tx.$executeRawUnsafe(
          `UPDATE finance_expenses SET status='APPROVED', approved_by=$1, approved_at=NOW(), updated_at=NOW()
            WHERE id::text=$2 AND tenant_id=$3 AND status='SUBMITTED' AND deleted_at IS NULL`,
          o.actorEmail, o.referenceId, o.tenantId);
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE finance_expenses SET status='REJECTED', rejected_by=$1, rejected_at=NOW(), rejection_reason=$2, updated_at=NOW()
            WHERE id::text=$3 AND tenant_id=$4 AND status='SUBMITTED' AND deleted_at IS NULL`,
          o.actorEmail, reasonOf(o), o.referenceId, o.tenantId);
      }
    },
    row: sqlRow('finance_expenses'),
  },

  finance_payable: {
    module: 'FINANCE', procedure: 'PAYABLE_APPROVAL', label: 'Payable (purchase / vendor bill)',
    async load(tx, tenantId, id) {
      const r = await rowIn(tx, 'finance_payables', tenantId, id, ['SUBMITTED']);
      return r && {
        referenceNumber: String(r.payable_number ?? id),
        context: {
          amount: num(r.total_amount), vendor: r.vendor_name, sourceModule: r.module,
          sourceType: r.source_type, costCentre: r.cost_centre,
        },
      };
    },
    async apply(tx, o) {
      if (o.status === 'APPROVED') {
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables SET status='APPROVED', approved_by=$1, approved_at=NOW(), updated_at=NOW()
            WHERE id::text=$2 AND tenant_id=$3 AND status='SUBMITTED'`,
          o.actorEmail, o.referenceId, o.tenantId);
      } else {
        // Payables have no rejected state: back to draft for correction.
        await tx.$executeRawUnsafe(
          `UPDATE finance_payables SET status='DRAFT', updated_at=NOW(),
                  notes = concat_ws(E'\\n', NULLIF(notes, ''), $1::text)
            WHERE id::text=$2 AND tenant_id=$3 AND status='SUBMITTED'`,
          `Returned by ${o.actorEmail}: ${reasonOf(o)}`, o.referenceId, o.tenantId);
      }
    },
    row: sqlRow('finance_payables'),
  },

  finance_journal: {
    module: 'FINANCE', procedure: 'JOURNAL_APPROVAL', label: 'Journal entry',
    async load(tx, tenantId, id) {
      const r = await rowIn(tx, 'finance_journal_entries', tenantId, id, ['SUBMITTED']);
      return r && { referenceNumber: String(r.je_number ?? id), context: { amount: num(r.total_debit), sourceType: r.source_type } };
    },
    async apply(tx, o) {
      if (o.status === 'APPROVED') {
        await tx.$executeRawUnsafe(
          `UPDATE finance_journal_entries SET status='APPROVED', approved_by=$1, approved_at=NOW(), updated_at=NOW()
            WHERE id::text=$2 AND tenant_id=$3 AND status='SUBMITTED'`,
          o.actorEmail, o.referenceId, o.tenantId);
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE finance_journal_entries SET status='DRAFT', updated_at=NOW(),
                  notes = concat_ws(E'\\n', NULLIF(notes, ''), $1::text)
            WHERE id::text=$2 AND tenant_id=$3 AND status='SUBMITTED'`,
          `Returned by ${o.actorEmail}: ${reasonOf(o)}`, o.referenceId, o.tenantId);
      }
    },
    row: sqlRow('finance_journal_entries'),
  },

  leasing_amendment: {
    module: 'LEASING', procedure: 'AMENDMENT_APPROVAL', label: 'Lease amendment',
    async load(tx, tenantId, id) {
      const r = await rowIn(tx, 'leasing_amendments', tenantId, id, ['SUBMITTED']);
      const impact = num(r?.total_impact);
      return r && {
        referenceNumber: String(r.amendment_no ?? id),
        context: {
          amount: impact === undefined ? undefined : Math.abs(impact),
          amendmentType: r.amendment_type, requestType: r.amendment_type,
        },
      };
    },
    async apply(tx, o) {
      if (o.status === 'APPROVED') {
        await tx.$executeRawUnsafe(
          `UPDATE leasing_amendments SET status='APPROVED', approved_by=$1, approved_at=NOW(), updated_at=NOW()
            WHERE id::text=$2 AND tenant_id=$3 AND status='SUBMITTED'`,
          o.actorEmail, o.referenceId, o.tenantId);
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE leasing_amendments SET status='REJECTED', rejected_by=$1, rejected_at=NOW(), rejection_reason=$2, updated_at=NOW()
            WHERE id::text=$3 AND tenant_id=$4 AND status='SUBMITTED'`,
          o.actorEmail, reasonOf(o), o.referenceId, o.tenantId);
      }
    },
    row: sqlRow('leasing_amendments'),
  },

  rental_transfer: {
    module: 'RAC', procedure: 'TRANSFER_APPROVAL', label: 'Vehicle transfer',
    async load(tx, tenantId, id) {
      const r = await rowIn(tx, 'rental_vehicle_transfers', tenantId, id, ['REQUESTED'], false);
      return r && {
        referenceNumber: String(r.transfer_no ?? id),
        context: {
          fromBranch: r.from_branch_name, toBranch: r.to_branch_name, fromEmirate: r.from_emirate, toEmirate: r.to_emirate,
          emirateScope: transferScope(r.from_emirate, r.to_emirate),
        },
      };
    },
    async apply(tx, o) {
      if (o.status === 'APPROVED') {
        await tx.$executeRawUnsafe(
          `UPDATE rental_vehicle_transfers SET status='APPROVED', approved_by=$1, approved_at=NOW(), updated_at=NOW()
            WHERE id::text=$2 AND tenant_id::text=$3 AND status='REQUESTED'`,
          o.actorEmail, o.referenceId, o.tenantId);
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE rental_vehicle_transfers SET status='CANCELLED', cancelled_reason=$1, updated_at=NOW()
            WHERE id::text=$2 AND tenant_id::text=$3 AND status='REQUESTED'`,
          reasonOf(o), o.referenceId, o.tenantId);
      }
    },
    row: sqlRow('rental_vehicle_transfers', false),
  },

  rental_renewal: {
    module: 'RAC', procedure: 'RENEWAL_APPROVAL', label: 'Rental renewal',
    async load(tx, tenantId, id) {
      const r = await rowIn(tx, 'rental_renewals', tenantId, id, ['PENDING']);
      return r && {
        referenceNumber: String(r.renewal_no ?? id),
        context: {
          amount: num(r.total_amount), extensionDays: num(r.extension_days), duration: num(r.extension_days),
          dailyRate: num(r.daily_rate), depositTopUp: num(r.deposit_top_up),
        },
      };
    },
    async apply(tx, o) {
      await tx.$executeRawUnsafe(
        `UPDATE rental_renewals SET status=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW(),
                notes = CASE WHEN $1 = 'REJECTED' THEN concat_ws(E'\\n', NULLIF(notes, ''), $3::text) ELSE notes END
          WHERE id::text=$4 AND tenant_id::text=$5 AND status='PENDING' AND deleted_at IS NULL`,
        o.status, o.actorEmail, `Rejected: ${reasonOf(o)}`, o.referenceId, o.tenantId);
    },
    row: sqlRow('rental_renewals'),
  },

  booking: {
    module: 'BOOKING', procedure: 'BOOKING_APPROVAL', label: 'Booking',
    async load(tx, tenantId, id) {
      const b = await tx.booking.findFirst({ where: { id, tenantId } });
      if (!b || b.status !== 'PENDING') return null;
      let notes: Record<string, unknown> = {};
      try { notes = b.notes ? JSON.parse(b.notes) : {}; } catch { notes = {}; }
      return {
        referenceNumber: b.bookingRef ?? id,
        context: {
          amount: num(notes.totalFareAed), serviceType: b.serviceType, vehicleCategory: b.vehicleCategory,
          costCenter: notes.costCenter,
          requestType: bookingRequestType(b.serviceType, notes),
        },
      };
    },
    async apply(tx, o) {
      await tx.booking.updateMany({
        where: { id: o.referenceId, tenantId: o.tenantId, status: 'PENDING' },
        data: o.status === 'APPROVED'
          ? { status: 'CONFIRMED', approvedBy: o.actorEmail, approvedAt: new Date() }
          : { status: 'CANCELLED' },
      });
    },
    async row(tx, tenantId, id) {
      return tx.booking.findFirst({ where: { id, tenantId } }) as Promise<Row | null>;
    },
  },

  leasing_contract: {
    module: 'LEASING', procedure: 'CONTRACT_APPROVAL', label: 'Lease contract',
    async load(tx, tenantId, id) {
      const c = await tx.leaseContract2.findFirst({
        where: { id, tenantId, deletedAt: null, status: 'PENDING_APPROVAL' },
        select: {
          contractNumber: true, totalContractValue: true, monthlyRate: true, startDate: true, endDate: true,
          leaseType: true, agreementType: true, securityDeposit: true, _count: { select: { vehicles: true } },
          lessee: { select: { type: true, creditAssessments: {
            where: { tenantId, status: 'ACTIVE' }, orderBy: { assessmentDate: 'desc' }, take: 1,
            select: { creditScore: true, riskRating: true },
          } } },
        },
      });
      if (!c) return null;
      const months = Math.max(1, Math.round((c.endDate.getTime() - c.startDate.getTime()) / (30.44 * 86400000)));
      const total = num(c.totalContractValue) ?? Math.round(Number(c.monthlyRate) * months * 100) / 100;
      const credit = c.lessee?.creditAssessments[0];
      return {
        referenceNumber: c.contractNumber ?? id,
        context: {
          amount: total, totalValue: total, monthlyRate: num(c.monthlyRate), duration: months,
          vehicleCount: c._count.vehicles, leaseType: c.leaseType, agreementType: c.agreementType,
          securityDeposit: num(c.securityDeposit), customerType: c.lessee?.type,
          creditScore: credit?.creditScore ?? undefined, riskRating: credit?.riskRating,
        },
      };
    },
    async apply(tx, o) {
      await tx.leaseContract2.updateMany({
        where: { id: o.referenceId, tenantId: o.tenantId, status: 'PENDING_APPROVAL', deletedAt: null },
        data: o.status === 'APPROVED'
          ? { status: 'APPROVED', approvedBy: o.actorEmail, approvedAt: new Date() }
          : { status: 'DRAFT' },
      });
      if (o.status !== 'APPROVED') {
        await tx.$executeRawUnsafe(
          `UPDATE lease_contracts_v2 SET notes = concat_ws(E'\n', NULLIF(notes, ''), $1::text)
            WHERE id::text = $2 AND tenant_id = $3`,
          `Returned by ${o.actorEmail}: ${reasonOf(o)}`, o.referenceId, o.tenantId);
      }
    },
    async row(tx, tenantId, id) {
      return tx.leaseContract2.findFirst({ where: { id, tenantId } }) as Promise<Row | null>;
    },
  },

  leasing_early_termination: {
    module: 'LEASING', procedure: 'EARLY_TERMINATION', label: 'Early termination',
    async load(tx, tenantId, id) {
      const t = await tx.leaseEarlyTermination.findFirst({
        where: { id, tenantId, status: 'PENDING_APPROVAL' },
        select: {
          terminationNo: true, remainingMonths: true, monthlyRate: true, penaltyPct: true, penaltyAmount: true,
          outstandingPayments: true, depositRefund: true, totalSettlement: true,
          contract: { select: { leaseType: true, agreementType: true, lessee: { select: { type: true } } } },
        },
      });
      if (!t) return null;
      return {
        referenceNumber: t.terminationNo ?? id,
        context: {
          // What the customer settles (penalty + outstanding − deposit refund).
          amount: num(t.totalSettlement), totalSettlement: num(t.totalSettlement),
          penaltyAmount: num(t.penaltyAmount), penaltyPct: num(t.penaltyPct), remainingMonths: t.remainingMonths,
          monthlyRate: num(t.monthlyRate), outstandingPayments: num(t.outstandingPayments), depositRefund: num(t.depositRefund),
          leaseType: t.contract?.leaseType, agreementType: t.contract?.agreementType, customerType: t.contract?.lessee?.type,
        },
      };
    },
    async apply(tx, o) {
      if (o.status === 'APPROVED') {
        await tx.leaseEarlyTermination.updateMany({
          where: { id: o.referenceId, tenantId: o.tenantId, status: 'PENDING_APPROVAL' },
          data: { status: 'APPROVED', approvedBy: o.actorEmail, approvedAt: new Date() },
        });
        return;
      }
      const t = await tx.leaseEarlyTermination.findFirst({ where: { id: o.referenceId, tenantId: o.tenantId }, select: { notes: true } });
      const note = `Rejected by ${o.actorEmail}: ${reasonOf(o)}`;
      await tx.leaseEarlyTermination.updateMany({
        where: { id: o.referenceId, tenantId: o.tenantId, status: 'PENDING_APPROVAL' },
        data: { status: 'CANCELLED', notes: t?.notes ? `${t.notes}\n${note}` : note },
      });
    },
    async row(tx, tenantId, id) {
      return tx.leaseEarlyTermination.findFirst({ where: { id, tenantId } }) as Promise<Row | null>;
    },
  },

  leasing_vehicle_addition: {
    module: 'LEASING', procedure: 'VEHICLE_ADDITION', label: 'Vehicle added to a lease contract',
    async load(tx, tenantId, id) {
      const v = await tx.leaseContractVehicle.findFirst({
        where: { id, tenantId, status: 'PENDING_APPROVAL' },
        select: {
          vehicleType: true, make: true, model: true, licensePlate: true, monthlyRate: true,
          contract: { select: {
            contractNumber: true, monthlyRate: true, endDate: true, leaseType: true, agreementType: true,
            _count: { select: { vehicles: { where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] } } } } },
            lessee: { select: { type: true, creditAssessments: {
              where: { tenantId, status: 'ACTIVE' }, orderBy: { assessmentDate: 'desc' }, take: 1,
              select: { creditScore: true, riskRating: true },
            } } },
          } },
        },
      });
      if (!v) return null;
      const rate = num(v.monthlyRate) ?? 0;
      const remainingMonths = Math.max(0, Math.round((v.contract.endDate.getTime() - Date.now()) / (30.44 * 86400000)));
      const contractRate = num(v.contract.monthlyRate);
      const credit = v.contract.lessee?.creditAssessments[0];
      return {
        referenceNumber: `${v.contract.contractNumber ?? 'Contract'} + ${v.licensePlate ?? v.vehicleType}`,
        context: {
          // What the addition adds to the contract: its rate for the rest of the term.
          amount: Math.round(rate * remainingMonths * 100) / 100, monthlyRate: rate, remainingMonths,
          rateDiscountPct: contractRate && contractRate > 0 ? Math.round((1 - rate / contractRate) * 1000) / 10 : undefined,
          vehicleType: v.vehicleType, vehicleCount: v.contract._count.vehicles,
          leaseType: v.contract.leaseType, agreementType: v.contract.agreementType,
          customerType: v.contract.lessee?.type, creditScore: credit?.creditScore ?? undefined, riskRating: credit?.riskRating,
        },
      };
    },
    async apply(tx, o) {
      const v = await tx.leaseContractVehicle.findFirst({
        where: { id: o.referenceId, tenantId: o.tenantId, status: 'PENDING_APPROVAL' },
        select: { id: true, contractId: true, vehicleId: true },
      });
      if (!v) return;
      if (o.status !== 'APPROVED') {
        await tx.leaseContractVehicle.updateMany({ where: { id: v.id, tenantId: o.tenantId }, data: { status: 'REJECTED' } });
        return;
      }
      await tx.leaseContractVehicle.updateMany({ where: { id: v.id, tenantId: o.tenantId }, data: { status: 'ACTIVE' } });
      // Allocate the fleet vehicle, as an addition without approval does.
      const fleet = v.vehicleId ? await tx.vehicle.findFirst({ where: { id: v.vehicleId, tenantId: o.tenantId }, select: { id: true } }) : null;
      if (fleet) {
        await tx.vehicle.update({ where: { id: fleet.id }, data: { status: 'RESERVED', lifecycleStage: 'ALLOCATED' } });
        await tx.leaseAllocationOccurrence.create({
          data: { tenantId: o.tenantId, contractId: v.contractId, contractVehicleId: v.id, vehicleId: fleet.id, sequenceNo: 1, startedAt: new Date(), status: 'ACTIVE' },
        });
      }
    },
    async row(tx, tenantId, id) {
      return tx.leaseContractVehicle.findFirst({ where: { id, tenantId } }) as Promise<Row | null>;
    },
  },

  finance_deposit_refund: {
    module: 'RAC', procedure: 'REFUND_APPROVAL', label: 'Security deposit refund',
    async load(tx, tenantId, id) {
      const rows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT deposit_no, contract_type, customer_name, branch, collected_amount, total_deducted,
                refund_requested_amount, refund_method
           FROM finance_security_deposits WHERE id::text = $1 AND tenant_id = $2 AND refund_status = 'REQUESTED'`,
        id, tenantId);
      const r = rows[0];
      if (!r) return null;
      const collected = num(r.collected_amount) ?? 0;
      const deducted = num(r.total_deducted) ?? 0;
      return {
        referenceNumber: String(r.deposit_no ?? id),
        context: {
          amount: num(r.refund_requested_amount), depositAmount: collected, deductions: deducted,
          deductionPct: collected > 0 ? Math.round((deducted / collected) * 1000) / 10 : undefined,
          contractType: r.contract_type, branch: r.branch, refundMethod: r.refund_method, customer: r.customer_name,
        },
      };
    },
    async apply(tx, o) {
      // Approved: the refund is recorded with how it is to be paid (set when
      // requested), ready for finance to pay; rejected: the request is
      // cancelled and its amount released.
      const rows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT refund_status, refund_method, refund_reference FROM finance_security_deposits WHERE id::text = $1 AND tenant_id = $2`,
        o.referenceId, o.tenantId);
      if (rows[0]?.refund_status !== 'REQUESTED') return;
      if (o.status === 'APPROVED') {
        await recordRefundDetails(tx, o.tenantId, o.referenceId, {
          method: String(rows[0].refund_method ?? 'BANK_TRANSFER'),
          reference: rows[0].refund_reference ? String(rows[0].refund_reference) : undefined,
          recordedBy: o.actorEmail,
        });
      } else {
        await cancelRefundRequest(tx, o.tenantId, o.referenceId, { reason: `rejected: ${reasonOf(o)}`, cancelledBy: o.actorEmail });
      }
    },
    row: sqlRow('finance_security_deposits', false),
  },

  rental_damage_claim: {
    module: 'RAC', procedure: 'DAMAGE_CLAIM', label: 'Damage claim',
    async load(tx, tenantId, id) {
      const c = await tx.damageClaim.findFirst({
        where: { id, tenantId, status: 'PENDING_APPROVAL' },
        select: {
          estimatedCost: true, actualCost: true, insuranceClaim: true, billedToCustomer: true,
          booking: { select: { bookingRef: true, vehicleCategory: true, customer: { select: { customerType: true } } } },
        },
      });
      if (!c) return null;
      const estimated = num(c.estimatedCost);
      const actual = num(c.actualCost);
      return {
        referenceNumber: `Damage ${c.booking?.bookingRef ?? id.slice(0, 8)}`,
        context: {
          amount: actual ?? estimated, estimatedCost: estimated, actualCost: actual,
          costOverEstimatePct: actual !== undefined && estimated ? Math.round(((actual - estimated) / estimated) * 1000) / 10 : undefined,
          insuranceClaim: c.insuranceClaim ? 'YES' : 'NO', chargeCustomer: c.billedToCustomer ? 'YES' : 'NO',
          customerType: c.booking?.customer?.customerType, vehicleCategory: c.booking?.vehicleCategory,
        },
      };
    },
    async apply(tx, o) {
      if (o.status === 'APPROVED') {
        await tx.damageClaim.updateMany({ where: { id: o.referenceId, tenantId: o.tenantId, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED' } });
        return;
      }
      const c = await tx.damageClaim.findFirst({ where: { id: o.referenceId, tenantId: o.tenantId }, select: { description: true } });
      const note = `[Returned by ${o.actorEmail}: ${reasonOf(o)}]`;
      await tx.damageClaim.updateMany({
        where: { id: o.referenceId, tenantId: o.tenantId, status: 'PENDING_APPROVAL' },
        data: { status: 'ASSESSED', description: c?.description ? `${c.description}\n${note}` : note },
      });
    },
    async row(tx, tenantId, id) {
      return tx.damageClaim.findFirst({ where: { id, tenantId } }) as Promise<Row | null>;
    },
  },

  LEASE_QUOTATION: {
    module: 'LEASING', procedure: 'QUOTATION_APPROVAL', label: 'Lease quotation',
    async load(tx, tenantId, id) {
      const q = await tx.leaseQuotation.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: {
          quotationNumber: true, status: true, totalContractValue: true, totalMonthlyRate: true, durationMonths: true,
          leaseType: true, markupPct: true, securityDeposit: true, _count: { select: { vehicles: true } },
          // The customer, and their current credit assessment.
          lessee: { select: { type: true, creditAssessments: {
            where: { tenantId, status: 'ACTIVE' }, orderBy: { assessmentDate: 'desc' }, take: 1,
            select: { creditScore: true, riskRating: true },
          } } },
        },
      });
      const stage = quotationApprovalStage(q?.status);
      if (!q || !stage) return null;
      const credit = q.lessee?.creditAssessments[0];
      return {
        procedure: stage.procedure,
        referenceNumber: q.quotationNumber ?? id,
        context: {
          stage: q.status, amount: num(q.totalContractValue), totalValue: num(q.totalContractValue),
          monthlyRate: num(q.totalMonthlyRate), duration: num(q.durationMonths), vehicleCount: q._count.vehicles,
          leaseType: q.leaseType, markupPct: num(q.markupPct), securityDeposit: num(q.securityDeposit),
          customerType: q.lessee?.type, creditScore: credit?.creditScore ?? undefined, riskRating: credit?.riskRating,
        },
      };
    },
    async apply(tx, o) {
      const stage = quotationApprovalStage(String(o.context.stage ?? ''));
      if (!stage) return;
      await tx.leaseQuotation.updateMany({
        where: { id: o.referenceId, tenantId: o.tenantId, status: String(o.context.stage), deletedAt: null },
        data: { status: o.status === 'APPROVED' ? stage.next : 'REJECTED', updatedAt: new Date() },
      });
    },
    async row(tx, tenantId, id) {
      return tx.leaseQuotation.findFirst({ where: { id, tenantId } }) as Promise<Row | null>;
    },
  },
};

/**
 * Workflow procedures modules start approvals under, by module, for Admin >
 * Workflows. A level's Request Type condition reads context.requestType: a
 * maintenance request's type, an expense's category, a lease amendment's
 * type, a booking's trip / shift / shipment type (else its service type).
 */
export const SUBJECT_PROCEDURES = Object.values(APPROVAL_SUBJECTS).map((s) => ({ module: s.module, procedure: s.procedure, label: s.label }));

/**
 * Applies a completed workflow's outcome to its record, as the tenant.
 * Reference types no module handles (approvals started by hand) are left alone.
 */
export async function applyWorkflowOutcome(o: WorkflowOutcome): Promise<void> {
  const subject = APPROVAL_SUBJECTS[o.referenceType];
  if (!subject) return;
  const after = await runAsTenant(o.tenantId, () => withTenantRls(prisma, o.tenantId, (tx) => subject.apply(tx, o)));
  if (after) {
    await after().catch((e) => console.warn(`[Workflow] After ${o.referenceType} ${o.status}:`, e instanceof Error ? e.message : e));
  }
}
