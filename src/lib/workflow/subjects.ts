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
        context: { amount: num(r.total_amount), vendor: r.vendor_name, sourceModule: r.module },
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
        context: { amount: num(r.total_amount), extensionDays: num(r.extension_days), duration: num(r.extension_days) },
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

  LEASE_QUOTATION: {
    module: 'LEASING', procedure: 'QUOTATION_APPROVAL', label: 'Lease quotation',
    async load(tx, tenantId, id) {
      const q = await tx.leaseQuotation.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { quotationNumber: true, status: true, totalContractValue: true, totalMonthlyRate: true, durationMonths: true, _count: { select: { vehicles: true } } },
      });
      const stage = quotationApprovalStage(q?.status);
      if (!q || !stage) return null;
      return {
        procedure: stage.procedure,
        referenceNumber: q.quotationNumber ?? id,
        context: {
          stage: q.status, amount: num(q.totalContractValue), totalValue: num(q.totalContractValue),
          monthlyRate: num(q.totalMonthlyRate), duration: num(q.durationMonths), vehicleCount: q._count.vehicles,
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
