/**
 * Approvals Inbox rows: a pending level with where it stands against its
 * SLA (sla.ts) and a few highlights of what is being approved, read from
 * the approval's context (what the levels' conditions see).
 */
import { slaStatus, SLA_RANK, type SlaStatus } from './sla';

export interface InboxSource {
  stepInstanceId: string;
  workflowInstanceId: string;
  dueAt: Date | string | null;
  receivedAt: Date | string;
  openedAt?: Date | string | null;
  escalatedAt?: Date | string | null;
  escalationHours?: number | null;
  escalationEmail?: string | null;
  contextJson?: unknown;
}

export interface Highlight { label: string; value: string }

// Context fields worth showing first, in this order; the rest are skipped.
const HIGHLIGHT_FIELDS: Array<[string, string]> = [
  ['amount', 'Amount'],
  ['requestType', 'Request type'],
  ['serviceType', 'Service'],
  ['category', 'Category'],
  ['customerName', 'Customer'],
  ['vendorName', 'Vendor'],
  ['customerType', 'Customer type'],
  ['branch', 'Branch'],
  ['rentalDays', 'Days'],
  ['deductionPct', 'Deduction %'],
];

const MAX_HIGHLIGHTS = 3;

export function contextHighlights(context: unknown): Highlight[] {
  if (!context || typeof context !== 'object') return [];
  const ctx = context as Record<string, unknown>;
  const out: Highlight[] = [];
  for (const [key, label] of HIGHLIGHT_FIELDS) {
    const v = ctx[key];
    if (v == null || v === '' || typeof v === 'object') continue;
    const value = key === 'amount' && Number.isFinite(Number(v))
      ? Number(v).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(v).replace(/_/g, ' ');
    out.push({ label, value });
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

export type InboxItem<T extends InboxSource> = Omit<T, 'contextJson' | 'escalationEmail'> & {
  sla: SlaStatus;
  highlights: Highlight[];
  escalationContact: boolean;
};

export function toInboxItem<T extends InboxSource>(row: T, now = Date.now()): InboxItem<T> {
  const { contextJson, escalationEmail, ...rest } = row;
  return {
    ...rest,
    sla: slaStatus({
      dueAt: row.dueAt, openedAt: row.openedAt ?? row.receivedAt, escalatedAt: row.escalatedAt,
      escalationHours: row.escalationHours, escalates: !!escalationEmail?.trim(),
    }, now),
    highlights: contextHighlights(contextJson),
    escalationContact: !!escalationEmail?.trim(),
  };
}

/** Most urgent first; within a state, the soonest due (then the oldest). */
export function byUrgency<T extends { sla: SlaStatus; receivedAt: Date | string }>(a: T, b: T): number {
  const r = SLA_RANK[a.sla.state] - SLA_RANK[b.sla.state];
  if (r) return r;
  const ha = a.sla.hoursLeft ?? Infinity;
  const hb = b.sla.hoursLeft ?? Infinity;
  if (ha !== hb) return ha - hb;
  return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
}

export function slaSummary(items: Array<{ sla: SlaStatus }>) {
  const count = (s: string) => items.filter((i) => i.sla.state === s).length;
  return {
    total: items.length,
    dueSoon: count('DUE_SOON'),
    overdue: count('OVERDUE'),
    escalated: count('ESCALATED'),
  };
}
