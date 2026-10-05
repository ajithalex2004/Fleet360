/**
 * Approval levels. Pure: shared by the workflow engine (src/lib/workflow-db.ts),
 * the approvals API and the tests.
 *
 * A workflow's steps are its levels, passed in step order. Each level may
 * carry a condition (Admin > Workflows, "Only when"): it applies to an
 * approval only when the condition holds for what is being approved, so a
 * small estimate can need one approval and a large one several. Values come
 * from the approval's context (the record's amount, …), read by the server.
 * A condition on a value the context doesn't have keeps the level: an
 * approval is never skipped for want of data.
 *
 * A level that requires all approvers is approved once every approver it was
 * sent to has approved; otherwise the first approval decides. Any rejection
 * rejects the level (and the approval).
 */

export type WorkflowContext = Record<string, unknown>;

export const CONDITION_OPERATORS = ['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ'] as const;
export type ConditionOperator = typeof CONDITION_OPERATORS[number];

export interface StepCondition {
  field: string;
  operator: ConditionOperator;
  value: string | number;
}

/** The condition stored on a step, or null when it has none (or it is unreadable). */
export function parseStepCondition(json: string | null | undefined): StepCondition | null {
  if (!json || !json.trim()) return null;
  try {
    const c = JSON.parse(json) as Partial<StepCondition>;
    if (!c || typeof c.field !== 'string' || !c.field.trim()) return null;
    if (!CONDITION_OPERATORS.includes(c.operator as ConditionOperator)) return null;
    if (c.value === undefined || c.value === null || String(c.value).trim() === '') return null;
    return { field: c.field.trim(), operator: c.operator as ConditionOperator, value: c.value };
  } catch {
    return null;
  }
}

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** The context's value for a condition field; `amount` and `totalValue` stand in for each other. */
export function contextValue(ctx: WorkflowContext, field: string): unknown {
  if (ctx[field] !== undefined && ctx[field] !== null && ctx[field] !== '') return ctx[field];
  if (field === 'totalValue') return ctx.amount;
  if (field === 'amount') return ctx.totalValue;
  return undefined;
}

/**
 * Whether a level applies. No condition, an unreadable one, or a value the
 * context doesn't have: it applies.
 */
export function conditionApplies(conditionJson: string | null | undefined, ctx: WorkflowContext): boolean {
  const c = parseStepCondition(conditionJson);
  if (!c) return true;
  const raw = contextValue(ctx, c.field);
  if (raw === undefined || raw === null || raw === '') return true;
  const a = toNumber(raw);
  const b = toNumber(c.value);
  if (a !== null && b !== null) {
    switch (c.operator) {
      case 'GT': return a > b;
      case 'GTE': return a >= b;
      case 'LT': return a < b;
      case 'LTE': return a <= b;
      case 'EQ': return a === b;
      case 'NEQ': return a !== b;
    }
  }
  const sa = String(raw).trim().toLowerCase();
  const sb = String(c.value).trim().toLowerCase();
  if (c.operator === 'EQ') return sa === sb;
  if (c.operator === 'NEQ') return sa !== sb;
  return true; // an ordering on text: keep the level
}

/** One approver's decision on a level. */
export interface LevelDecision {
  email: string;
  action: 'APPROVE' | 'REJECT';
  at?: string;
  comments?: string | null;
  /** A tenant administrator deciding for the level. */
  override?: boolean;
}

/** Decisions stored on a step instance; anything malformed is dropped. */
export function parseDecisions(value: unknown): LevelDecision[] {
  const list = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  if (!Array.isArray(list)) return [];
  return list
    .filter((d): d is LevelDecision => !!d && typeof d.email === 'string' && (d.action === 'APPROVE' || d.action === 'REJECT'))
    .map((d) => ({ ...d, email: d.email.toLowerCase() }));
}

/**
 * A level's state from its decisions:
 *   REJECTED  any approver (or an administrator) rejected;
 *   APPROVED  an administrator approved, or: requiring all approvers, every
 *             one it was sent to approved; otherwise, anyone approved;
 *   PENDING   still waiting, with who is left.
 */
export function levelOutcome(args: {
  requireAll: boolean;
  approverEmails: string[];
  decisions: LevelDecision[];
}): { status: 'APPROVED' | 'REJECTED' } | { status: 'PENDING'; waitingFor: string[] } {
  const { decisions } = args;
  if (decisions.some((d) => d.action === 'REJECT')) return { status: 'REJECTED' };
  if (decisions.some((d) => d.override && d.action === 'APPROVE')) return { status: 'APPROVED' };
  const approved = new Set(decisions.filter((d) => d.action === 'APPROVE').map((d) => d.email));
  const approvers = [...new Set(args.approverEmails.map((e) => e.toLowerCase()))];
  if (args.requireAll && approvers.length > 0) {
    const waitingFor = approvers.filter((e) => !approved.has(e));
    return waitingFor.length ? { status: 'PENDING', waitingFor } : { status: 'APPROVED' };
  }
  return approved.size > 0 ? { status: 'APPROVED' } : { status: 'PENDING', waitingFor: approvers };
}

/** Hours from a step or workflow setting; non-positive or missing → fallback. */
export const positiveHours = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
