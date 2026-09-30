/**
 * Maintenance estimate approval rules. Pure: shared by the rules API, the
 * estimate decision API and the maintenance-request update route.
 *
 * A rule covers a cost band [minCost, maxCost] (maxCost null = no upper
 * limit). For an estimate in the band:
 *   - the approver must hold one of requiredRoles (role codes); an empty
 *     list means anyone who may approve estimates;
 *   - autoApprove approves it as soon as it is submitted for approval.
 * When bands overlap the narrowest (then highest minimum) applies. With no
 * active rule for a cost, approval works as it did before rules existed.
 */

export interface ApprovalRuleRow {
  id: string;
  name: string;
  minCost: number;
  maxCost: number | null;
  requiredRoles: string[];
  autoApprove: boolean;
  isActive: boolean;
}

export interface ApprovalRuleInput {
  name?: string;
  minCost?: number;
  maxCost?: number | null;
  requiredRoles?: string[];
  autoApprove?: boolean;
  isActive?: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const MAX_COST = 1_000_000_000;
const ROLE_CODE = /^[A-Z0-9_]{2,64}$/;

const money = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_COST ? Math.round(n * 100) / 100 : NaN;
};

/** Checks a rule body; on update (`partial`) only the fields sent. Never returns tenantId or ids. */
export function parseApprovalRuleInput(body: unknown, partial: boolean): Result<ApprovalRuleInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const out: ApprovalRuleInput = {};

  if (b.name !== undefined || !partial) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return { ok: false, error: 'Rule name is required' };
    out.name = name.slice(0, 120);
  }
  const min = money(b.minCost);
  if (Number.isNaN(min) || min === null) return { ok: false, error: 'Minimum cost must be a positive amount' };
  if (min !== undefined) out.minCost = min;
  else if (!partial) out.minCost = 0;
  const max = money(b.maxCost);
  if (Number.isNaN(max)) return { ok: false, error: 'Maximum cost must be a positive amount, or empty for no limit' };
  if (max !== undefined) out.maxCost = max;
  else if (!partial) out.maxCost = null;
  if (out.minCost !== undefined && out.maxCost != null && out.maxCost < out.minCost) {
    return { ok: false, error: 'Maximum cost must be at least the minimum' };
  }
  if (b.requiredRoles !== undefined || !partial) {
    const roles = b.requiredRoles ?? [];
    if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string' || !ROLE_CODE.test(r))) {
      return { ok: false, error: 'Approver roles must be role codes' };
    }
    out.requiredRoles = [...new Set(roles as string[])].slice(0, 20);
  }
  for (const key of ['autoApprove', 'isActive'] as const) {
    if (b[key] === undefined) { if (!partial) out[key] = key === 'isActive'; continue; }
    if (typeof b[key] !== 'boolean') return { ok: false, error: `${key} must be true or false` };
    out[key] = b[key] as boolean;
  }
  if (out.autoApprove && out.requiredRoles && out.requiredRoles.length > 0) {
    return { ok: false, error: 'A rule either approves automatically or names approver roles, not both' };
  }
  return { ok: true, data: out };
}

/** The active rule covering `cost`, or null. */
export function ruleForCost(rules: ApprovalRuleRow[], cost: number | null | undefined): ApprovalRuleRow | null {
  if (cost == null || !Number.isFinite(cost)) return null;
  const matching = rules.filter((r) => r.isActive && cost >= r.minCost && (r.maxCost == null || cost <= r.maxCost));
  const width = (r: ApprovalRuleRow) => (r.maxCost == null ? Infinity : r.maxCost - r.minCost);
  return matching.sort((a, b) => width(a) - width(b) || b.minCost - a.minCost)[0] ?? null;
}

/**
 * Whether someone holding `roleCodes` may approve an estimate of `cost`.
 * Allowed when no rule covers the cost or the rule names no roles.
 */
export function checkApprover(rules: ApprovalRuleRow[], cost: number | null | undefined, roleCodes: string[]):
  { ok: true; rule: ApprovalRuleRow | null } | { ok: false; rule: ApprovalRuleRow; error: string } {
  const rule = ruleForCost(rules, cost);
  if (!rule || rule.requiredRoles.length === 0) return { ok: true, rule };
  const held = new Set(roleCodes.map((r) => r.toUpperCase()));
  if (rule.requiredRoles.some((r) => held.has(r.toUpperCase()))) return { ok: true, rule };
  return {
    ok: false,
    rule,
    error: `Estimates in "${rule.name}" must be approved by: ${rule.requiredRoles.join(', ')}`,
  };
}

/** The rule that auto-approves an estimate of `cost`, or null. */
export const autoApproveRule = (rules: ApprovalRuleRow[], cost: number | null | undefined) => {
  const rule = ruleForCost(rules, cost);
  return rule?.autoApprove ? rule : null;
};

/** Normalised status text: "Estimation Approved", "ESTIMATION_APPROVED" → "estimation approved". */
export const statusKey = (s: unknown) => (typeof s === 'string' ? s.replace(/[_-]+/g, ' ').trim().toLowerCase() : '');
export const ESTIMATION_APPROVED = 'Estimation Approved';
export const PENDING_ESTIMATION_APPROVAL = 'Pending Estimation Approval';
export const UNDER_ESTIMATION = 'Under Estimation';
