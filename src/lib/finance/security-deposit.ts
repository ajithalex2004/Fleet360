import type { TxClient } from '@/lib/rls';
import { applyInvoicePayment } from '@/lib/leasing/invoice-balance';

export class SecurityDepositError extends Error {}

type DepositRow = {
  id: string;
  tenant_id: string;
  collected_amount: string;
  total_deducted: string;
  reserved_amount: string;
  refunded_amount: string;
  refund_status: string | null;
  refund_requested_amount: string | null;
  status: string;
};

/** SELECT ... FOR UPDATE — real row lock, not just an app-level re-check. */
export async function lockDepositRow(tx: TxClient, tenantId: string, depositId: string): Promise<DepositRow> {
  const rows = await tx.$queryRawUnsafe<DepositRow[]>(
    `SELECT * FROM finance_security_deposits WHERE id = $1::uuid AND tenant_id = $2 FOR UPDATE`,
    depositId,
    tenantId,
  );
  const row = rows[0];
  if (!row) {
    throw new SecurityDepositError(`Deposit not found: ${depositId}`);
  }
  return row;
}

function availableBalance(row: DepositRow): number {
  return Number(row.collected_amount) - Number(row.total_deducted) - Number(row.reserved_amount);
}

/**
 * Extracted from finance/deposits/route.ts PATCH action=add_deduction.
 * Behavior-preserving except the available-balance check now nets out
 * reserved_amount, so funds reserved by requestRefund can't also be
 * deducted — the earlier route had no refund-reservation concept to net
 * out at all.
 */
export async function addDeduction(
  tx: TxClient,
  tenantId: string,
  depositId: string,
  args: { description: string; amount: number; category?: string; date?: string },
): Promise<Record<string, unknown>> {
  const row = await lockDepositRow(tx, tenantId, depositId);
  const amount = Number(args.amount);
  if (amount > availableBalance(row) + 0.005) {
    throw new SecurityDepositError(
      `Deduction of ${amount} exceeds available deposit balance of ${availableBalance(row)}`,
    );
  }

  const deduction = {
    id: crypto.randomUUID(),
    description: args.description,
    amount,
    date: args.date ?? new Date().toISOString().split('T')[0],
    category: args.category ?? 'DAMAGE',
  };

  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `UPDATE finance_security_deposits
        SET deductions     = deductions || $3::jsonb,
            total_deducted = total_deducted + $4,
            status         = CASE
              WHEN (collected_amount - total_deducted - $4) <= 0 THEN 'FORFEITED'
              ELSE 'PARTIALLY_REFUNDED'
            END,
            updated_at     = NOW()
      WHERE id = $1::uuid AND tenant_id = $2
      RETURNING *`,
    depositId,
    tenantId,
    JSON.stringify([deduction]),
    amount,
  );
  return rows[0];
}

/** Extracted from finance/deposits/route.ts PATCH action=forfeit. Unchanged. */
export async function forfeitDeposit(
  tx: TxClient,
  tenantId: string,
  depositId: string,
  args: { reason?: string },
): Promise<Record<string, unknown>> {
  await lockDepositRow(tx, tenantId, depositId);
  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `UPDATE finance_security_deposits
        SET status = 'FORFEITED', forfeiture_reason = $3, updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2
      RETURNING *`,
    depositId,
    tenantId,
    args.reason ?? 'Contract default',
  );
  return rows[0];
}

/**
 * Applies deposit funds against a specific invoice — the recorded
 * allocation point 5 of the return-workflow revision requires. Always:
 * (1) deduct from the deposit via addDeduction, (2) insert the
 * lease_deposit_applications ledger row linking deposit ↔ invoice ↔ return,
 * (3) recompute the invoice's status via applyInvoicePayment (pure
 * recompute — the ledger row above is the only actual "posting").
 */
export async function applyDepositToInvoice(
  tx: TxClient,
  tenantId: string,
  args: {
    depositId: string;
    returnId: string;
    invoiceId: string;
    amount: number;
    applicationType: 'OVERAGE_INVOICE' | 'DAMAGE' | 'TERMINATION_PENALTY' | 'FINE';
    appliedBy: string;
    description: string;
  },
): Promise<Record<string, unknown>> {
  await addDeduction(tx, tenantId, args.depositId, {
    description: args.description,
    amount: args.amount,
    category: args.applicationType,
  });

  const applicationId = crypto.randomUUID();
  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `INSERT INTO lease_deposit_applications
       (id, tenant_id, deposit_id, return_id, invoice_id, applied_amount, application_type, applied_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    applicationId,
    tenantId,
    args.depositId,
    args.returnId,
    args.invoiceId,
    args.amount,
    args.applicationType,
    args.appliedBy,
  );

  await applyInvoicePayment(tx, tenantId, args.invoiceId);
  return rows[0];
}

/**
 * Atomically restores the deposit ledger, re-derives the affected
 * invoice's balance (which rises back up automatically since
 * getInvoiceOutstandingBalance only sums non-reversed rows), and marks the
 * application reversed_at/by/reason — reversed, never deleted. Other
 * non-reversed applications and any independent customer payment on the
 * same invoice are untouched by construction (only this one row's
 * contribution drops out of the sum).
 */
export async function reverseDepositApplication(
  tx: TxClient,
  tenantId: string,
  applicationId: string,
  args: { reason?: string; reversedBy: string },
): Promise<Record<string, unknown>> {
  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM lease_deposit_applications WHERE id = $1 AND tenant_id = $2 AND reversed_at IS NULL`,
    applicationId,
    tenantId,
  );
  const application = rows[0];
  if (!application) {
    throw new SecurityDepositError(`Deposit application not found or already reversed: ${applicationId}`);
  }

  await lockDepositRow(tx, tenantId, application.deposit_id as string);

  await tx.$executeRawUnsafe(
    `UPDATE lease_deposit_applications SET reversed_at = NOW(), reversed_by = $3, reversal_reason = $4 WHERE id = $1 AND tenant_id = $2`,
    applicationId,
    tenantId,
    args.reversedBy,
    args.reason ?? null,
  );
  await tx.$executeRawUnsafe(
    `UPDATE finance_security_deposits
        SET total_deducted = total_deducted - $3, updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    application.deposit_id,
    tenantId,
    application.applied_amount,
  );

  if (application.invoice_id) {
    await applyInvoicePayment(tx, tenantId, application.invoice_id as string);
  }

  return application;
}

/**
 * Reserves `amount` against the deposit's available balance so a
 * concurrent addDeduction can't spend funds already earmarked for a
 * refund. This is the ONLY refund-initiating call in the return-workflow —
 * contract closure calls this and nothing else; recordRefundDetails and
 * executeRefund only ever act on a refund this call already started.
 */
export async function requestRefund(
  tx: TxClient,
  tenantId: string,
  depositId: string,
  amount: number,
  requestedBy: string,
): Promise<Record<string, unknown>> {
  const row = await lockDepositRow(tx, tenantId, depositId);
  if (amount > availableBalance(row) + 0.005) {
    throw new SecurityDepositError(
      `Refund request of ${amount} exceeds available deposit balance of ${availableBalance(row)}`,
    );
  }
  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `UPDATE finance_security_deposits
        SET reserved_amount         = reserved_amount + $3,
            refund_status           = 'REQUESTED',
            refund_requested_amount = $3,
            refund_requested_by     = $4,
            refund_requested_at     = NOW(),
            updated_at              = NOW()
      WHERE id = $1::uuid AND tenant_id = $2
      RETURNING *`,
    depositId,
    tenantId,
    amount,
    requestedBy,
  );
  return rows[0];
}

/** Records how a previously-requested refund was (or will be) sent. */
export async function recordRefundDetails(
  tx: TxClient,
  tenantId: string,
  depositId: string,
  args: { method: string; reference?: string; recordedBy: string },
): Promise<Record<string, unknown>> {
  const row = await lockDepositRow(tx, tenantId, depositId);
  if (row.refund_status !== 'REQUESTED') {
    throw new SecurityDepositError(
      `Cannot record refund details — refund_status is ${row.refund_status ?? 'null'}, expected REQUESTED`,
    );
  }
  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `UPDATE finance_security_deposits
        SET refund_method      = $3,
            refund_reference   = $4,
            refund_recorded_by = $5,
            refund_recorded_at = NOW(),
            refund_status      = 'RECORDED',
            updated_at         = NOW()
      WHERE id = $1::uuid AND tenant_id = $2
      RETURNING *`,
    depositId,
    tenantId,
    args.method,
    args.reference ?? null,
    args.recordedBy,
  );
  return rows[0];
}

/**
 * Idempotent: if the refund is already EXECUTED, returns the current row
 * as a no-op instead of erroring or re-paying — a retried request can't
 * double-execute the same refund.
 */
export async function executeRefund(
  tx: TxClient,
  tenantId: string,
  depositId: string,
  executedBy: string,
): Promise<Record<string, unknown>> {
  const row = await lockDepositRow(tx, tenantId, depositId);
  if (row.refund_status === 'EXECUTED') {
    return row;
  }
  if (row.refund_status !== 'RECORDED') {
    throw new SecurityDepositError(
      `Cannot execute refund — refund_status is ${row.refund_status ?? 'null'}, expected RECORDED`,
    );
  }
  const requestedAmount = Number(row.refund_requested_amount ?? 0);

  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `UPDATE finance_security_deposits
        SET refunded_amount = refunded_amount + $3,
            reserved_amount = GREATEST(0, reserved_amount - $3),
            refund_amount   = refunded_amount + $3,
            refund_date     = COALESCE(refund_date, CURRENT_DATE),
            refund_status   = 'EXECUTED',
            status          = CASE
              WHEN (collected_amount - total_deducted - (refunded_amount + $3)) <= 0 THEN 'FULLY_REFUNDED'
              ELSE 'PARTIALLY_REFUNDED'
            END,
            updated_at      = NOW()
      WHERE id = $1::uuid AND tenant_id = $2
      RETURNING *`,
    depositId,
    tenantId,
    requestedAmount,
    executedBy,
  );

  // Hook back to contract closure: a closure record sitting at
  // PENDING_REFUND because it was waiting on exactly this deposit's
  // refund now finalizes.
  await tx.$executeRawUnsafe(
    `UPDATE lease_contract_closures
        SET status = 'FINAL', updated_at = NOW()
      WHERE tenant_id = $1 AND deposit_id = $2 AND status = 'PENDING_REFUND'`,
    tenantId,
    depositId,
  );

  return rows[0];
}

/**
 * Allowed only pre-execution — a post-EXECUTED clawback is an out-of-scope
 * manual finance process, not handled here.
 */
export async function cancelRefundRequest(
  tx: TxClient,
  tenantId: string,
  depositId: string,
  args: { reason?: string; cancelledBy: string },
): Promise<Record<string, unknown>> {
  const row = await lockDepositRow(tx, tenantId, depositId);
  if (row.refund_status !== 'REQUESTED' && row.refund_status !== 'RECORDED') {
    throw new SecurityDepositError(
      `Cannot cancel refund — refund_status is ${row.refund_status ?? 'null'}, expected REQUESTED or RECORDED`,
    );
  }
  const requestedAmount = Number(row.refund_requested_amount ?? 0);
  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
    `UPDATE finance_security_deposits
        SET reserved_amount = GREATEST(0, reserved_amount - $3),
            refund_status   = 'CANCELLED',
            notes           = COALESCE(notes || E'\\n', '') || 'Refund cancelled by ' || $4 || COALESCE(': ' || $5, ''),
            updated_at      = NOW()
      WHERE id = $1::uuid AND tenant_id = $2
      RETURNING *`,
    depositId,
    tenantId,
    requestedAmount,
    args.cancelledBy,
    args.reason ?? null,
  );
  return rows[0];
}
