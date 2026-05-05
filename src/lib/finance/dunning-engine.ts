/**
 * Dunning engine — generic AR collections logic.
 *
 * Lives in finance/ rather than leasing/ because dunning is a
 * cross-product Finance concern. The leasing module wires this engine
 * up to LeaseInvoice rows; future modules (RAC, school bus, logistics)
 * can reuse the same engine on their own invoice tables.
 *
 * Three escalation buckets:
 *   30-day reminder  → friendly email
 *   60-day notice    → firm email + finance copied
 *   90-day final     → final notice, escalation flag set
 *
 * The engine is pure logic — it classifies rows and decides actions.
 * The caller is responsible for actually sending emails / writing
 * activity rows / updating invoice status. This keeps the engine
 * testable without DB or SMTP dependencies.
 */

export type DunningBucket =
  | 'CURRENT'      // not yet due
  | 'GRACE'        // 1–14 days past due (no action yet)
  | 'REMINDER_30'  // 15–44 days past due — first reminder
  | 'NOTICE_60'    // 45–74 days past due — firm notice
  | 'FINAL_90'     // 75+ days past due — final notice / legal flag
  | 'PAID'         // already settled
  | 'CANCELLED';   // void

export interface InvoiceForDunning {
  id: string;
  invoiceNo: string | null;
  lesseeId: string;
  contractId?: string | null;
  totalAmount: number;
  paidAmount?: number | null;
  currency: string;
  dueDate: Date;
  paidAt?: Date | null;
  status: string; // DRAFT | SENT | PAID | OVERDUE | CANCELLED
}

export interface DunningClassification {
  invoiceId: string;
  bucket: DunningBucket;
  daysOverdue: number;
  outstandingAmount: number;
  /** What the engine recommends: notify | none. */
  action: 'send_reminder_30' | 'send_notice_60' | 'send_final_90' | 'mark_overdue' | 'none';
  /** Severity for any alert/email created: WARNING | ERROR */
  severity: 'INFO' | 'WARNING' | 'ERROR';
}

const GRACE_DAYS = 14;
const BUCKET_30 = 15;
const BUCKET_60 = 45;
const BUCKET_90 = 75;

/** Classify a single invoice into a dunning bucket. Pure function. */
export function classify(invoice: InvoiceForDunning, asOf: Date = new Date()): DunningClassification {
  const outstanding =
    invoice.paidAmount != null
      ? Math.max(0, Number(invoice.totalAmount) - Number(invoice.paidAmount))
      : Number(invoice.totalAmount);

  if (invoice.status === 'PAID' || (invoice.paidAt && outstanding <= 0)) {
    return {
      invoiceId: invoice.id,
      bucket: 'PAID',
      daysOverdue: 0,
      outstandingAmount: 0,
      action: 'none',
      severity: 'INFO',
    };
  }

  if (invoice.status === 'CANCELLED') {
    return {
      invoiceId: invoice.id,
      bucket: 'CANCELLED',
      daysOverdue: 0,
      outstandingAmount: 0,
      action: 'none',
      severity: 'INFO',
    };
  }

  const days = Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86400000);

  if (days < 0) {
    return {
      invoiceId: invoice.id,
      bucket: 'CURRENT',
      daysOverdue: 0,
      outstandingAmount: outstanding,
      action: 'none',
      severity: 'INFO',
    };
  }

  if (days < GRACE_DAYS) {
    return {
      invoiceId: invoice.id,
      bucket: 'GRACE',
      daysOverdue: days,
      outstandingAmount: outstanding,
      // Mark OVERDUE in the invoice status if we haven't already
      action: invoice.status === 'OVERDUE' ? 'none' : 'mark_overdue',
      severity: 'INFO',
    };
  }

  if (days < BUCKET_60) {
    return {
      invoiceId: invoice.id,
      bucket: 'REMINDER_30',
      daysOverdue: days,
      outstandingAmount: outstanding,
      action: 'send_reminder_30',
      severity: 'WARNING',
    };
  }

  if (days < BUCKET_90) {
    return {
      invoiceId: invoice.id,
      bucket: 'NOTICE_60',
      daysOverdue: days,
      outstandingAmount: outstanding,
      action: 'send_notice_60',
      severity: 'WARNING',
    };
  }

  return {
    invoiceId: invoice.id,
    bucket: 'FINAL_90',
    daysOverdue: days,
    outstandingAmount: outstanding,
    action: 'send_final_90',
    severity: 'ERROR',
  };
}

/* ── Aging-bucket roll-up (for AR aging dashboard) ───────────────────────── */

export interface AgingBuckets {
  current: number;        // outstanding, not yet due
  d1to30: number;         // 1–30 days past due
  d31to60: number;        // 31–60
  d61to90: number;        // 61–90
  d90plus: number;        // 90+
  total: number;
}

export function emptyAgingBuckets(): AgingBuckets {
  return { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, total: 0 };
}

export function addToAging(buckets: AgingBuckets, c: DunningClassification): void {
  if (c.bucket === 'PAID' || c.bucket === 'CANCELLED') return;
  buckets.total += c.outstandingAmount;
  if (c.daysOverdue <= 0) {
    buckets.current += c.outstandingAmount;
    return;
  }
  if (c.daysOverdue <= 30) buckets.d1to30 += c.outstandingAmount;
  else if (c.daysOverdue <= 60) buckets.d31to60 += c.outstandingAmount;
  else if (c.daysOverdue <= 90) buckets.d61to90 += c.outstandingAmount;
  else buckets.d90plus += c.outstandingAmount;
}

/** Convenience: classify a list of invoices and roll up aging totals together. */
export function classifyMany(
  invoices: InvoiceForDunning[],
  asOf: Date = new Date(),
): { classifications: DunningClassification[]; aging: AgingBuckets } {
  const classifications = invoices.map(i => classify(i, asOf));
  const aging = emptyAgingBuckets();
  classifications.forEach(c => addToAging(aging, c));
  return { classifications, aging };
}

/** Map bucket → activity_type used in LeaseDunningActivity. */
export function activityTypeFor(bucket: DunningBucket): string {
  switch (bucket) {
    case 'REMINDER_30':
      return 'EMAIL';      // friendly reminder
    case 'NOTICE_60':
      return 'EMAIL';      // firmer notice
    case 'FINAL_90':
      return 'LETTER';     // final formal notice (could escalate to LEGAL)
    default:
      return 'EMAIL';
  }
}
