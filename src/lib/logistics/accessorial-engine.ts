/**
 * Accessorial rule engine — interprets the auto_apply_rule JSONB blob on
 * each logistics_accessorial_catalog entry and decides, for a given
 * shipment, whether the charge applies and at what amount.
 *
 * Why this exists:
 *   The catalog table already stores fuel / customs / waiting / multi-drop
 *   accessorials, but they're never auto-applied. Operators forget to add
 *   them at booking time and the platform silently loses 5-15% of every
 *   invoice. Auto-applying them at createShipmentOrder time closes that
 *   leak — but only if the rule language is expressive enough to cover
 *   the real cases (fuel as % of base, customs only when crossing borders,
 *   waiting only if pickup window is tight, etc).
 *
 * Architecture mirrors rate-engine.ts:
 *   - Pure evaluator (this file)            ← Day 1
 *   - Wire into createShipmentOrder         ← Day 2
 *   - UI for editing rules                  ← Day 3
 *
 * The evaluator is intentionally pure (no DB, no fetch). It takes a
 * single rule and a shipment context and returns a verdict. The caller
 * fetches the catalog separately and iterates. Keeps tests fast and
 * isolated from DB cold-starts.
 */

// ── Rule schema ────────────────────────────────────────────────────────────

export type RuleType = 'flat' | 'percentage' | 'per_km' | 'per_kg' | 'per_stop';

export type PercentageBasis = 'base_rate' | 'cargo_value' | 'subtotal';

/**
 * Predicate that must be true for the rule to fire. Every field is
 * optional — an empty conditions object means "always applies". Multiple
 * fields are AND-ed.
 */
export interface AccessorialConditions {
  minDistanceKm?: number;
  maxDistanceKm?: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  minStops?: number;
  /** If set, the shipment's vehicleType (case-insensitive) must be in this list. */
  vehicleTypes?: string[];
  /** Same for shipment_type / service type. */
  shipmentTypes?: string[];
  /** Require the hazmat flag to be true (omit to ignore hazmat status). */
  requiresHazmat?: boolean;
  /** Require the customs flag to be true. */
  requiresCustoms?: boolean;
  /** Origin & destination country differ. Used for cross-border customs/duty rules. */
  requiresCrossBorder?: boolean;
}

interface BaseRule {
  /** Optional gate. Rule fires only if every predicate is satisfied. */
  conditions?: AccessorialConditions;
  /** Whether the resulting charge is subject to VAT/tax. Defaults to true. */
  taxable?: boolean;
  /** Currency override. Defaults to the catalog entry's currency. */
  currency?: string;
}

export interface FlatRule extends BaseRule {
  type: 'flat';
  amount: number;
}

export interface PercentageRule extends BaseRule {
  type: 'percentage';
  /** Which number on the shipment the percentage applies to. */
  basis: PercentageBasis;
  percentage: number;
}

export interface PerKmRule extends BaseRule {
  type: 'per_km';
  rate: number;
  /** First N km are free. */
  freeKm?: number;
  /** Cap the chargeable distance. */
  maxKm?: number;
}

export interface PerKgRule extends BaseRule {
  type: 'per_kg';
  rate: number;
  /** First N kg are free (often the dead-weight included in base rate). */
  freeKg?: number;
}

export interface PerStopRule extends BaseRule {
  type: 'per_stop';
  rate: number;
  /** Don't charge for the first stop (since that's the original delivery). */
  excludeFirst?: boolean;
}

export type AccessorialRule = FlatRule | PercentageRule | PerKmRule | PerKgRule | PerStopRule;

// ── Context the evaluator sees ─────────────────────────────────────────────

/**
 * Snapshot of the shipment the rule is being evaluated against. Built by
 * the API endpoint that's about to call createShipmentOrder, using the
 * rate-engine quote result + the operator's input.
 */
export interface AccessorialContext {
  /** The contract base rate (before fuel) — needed for percentage rules with basis='base_rate'. */
  baseRate?: number | null;
  /** subtotal = base + fuel surcharge (rate-engine's result.subtotal). */
  subtotal?: number | null;
  /** Cargo declared value for percentage-of-cargo accessorials (insurance, customs duty). */
  cargoValue?: number | null;
  distanceKm?: number | null;
  weightKg?: number | null;
  /** Number of stops including origin + destination. */
  stopsCount?: number | null;
  vehicleType?: string | null;
  shipmentType?: string | null;
  isHazmat?: boolean;
  requiresCustoms?: boolean;
  originCountry?: string | null;
  destinationCountry?: string | null;
}

// ── Verdict ────────────────────────────────────────────────────────────────

export interface RuleVerdict {
  applies: boolean;
  /** Computed charge — always 0 when applies=false. Rounded to 2dp. */
  amount: number;
  currency: string | null;
  taxable: boolean;
  /** Human-readable explanation, used in audit metadata + operator UI. */
  reason: string;
}

const NO_APPLY = (reason: string, currency: string | null = null): RuleVerdict => ({
  applies: false,
  amount: 0,
  currency,
  taxable: false,
  reason,
});

// ── Conditions check ──────────────────────────────────────────────────────

export function conditionsHold(
  conditions: AccessorialConditions | undefined,
  ctx: AccessorialContext,
): { ok: true } | { ok: false; reason: string } {
  if (!conditions) return { ok: true };

  if (conditions.minDistanceKm != null) {
    if ((ctx.distanceKm ?? 0) < conditions.minDistanceKm) {
      return { ok: false, reason: `distance ${ctx.distanceKm ?? 0}km below min ${conditions.minDistanceKm}` };
    }
  }
  if (conditions.maxDistanceKm != null) {
    if ((ctx.distanceKm ?? 0) > conditions.maxDistanceKm) {
      return { ok: false, reason: `distance ${ctx.distanceKm}km exceeds max ${conditions.maxDistanceKm}` };
    }
  }
  if (conditions.minWeightKg != null) {
    if ((ctx.weightKg ?? 0) < conditions.minWeightKg) {
      return { ok: false, reason: `weight ${ctx.weightKg ?? 0}kg below min ${conditions.minWeightKg}` };
    }
  }
  if (conditions.maxWeightKg != null) {
    if ((ctx.weightKg ?? 0) > conditions.maxWeightKg) {
      return { ok: false, reason: `weight ${ctx.weightKg}kg exceeds max ${conditions.maxWeightKg}` };
    }
  }
  if (conditions.minStops != null) {
    if ((ctx.stopsCount ?? 0) < conditions.minStops) {
      return { ok: false, reason: `stops ${ctx.stopsCount ?? 0} below min ${conditions.minStops}` };
    }
  }
  if (conditions.vehicleTypes?.length) {
    const v = ctx.vehicleType?.toUpperCase() ?? '';
    if (!conditions.vehicleTypes.some(t => t.toUpperCase() === v)) {
      return { ok: false, reason: `vehicle "${ctx.vehicleType}" not in [${conditions.vehicleTypes.join(',')}]` };
    }
  }
  if (conditions.shipmentTypes?.length) {
    const s = ctx.shipmentType?.toUpperCase() ?? '';
    if (!conditions.shipmentTypes.some(t => t.toUpperCase() === s)) {
      return { ok: false, reason: `shipment type "${ctx.shipmentType}" not in [${conditions.shipmentTypes.join(',')}]` };
    }
  }
  if (conditions.requiresHazmat === true && !ctx.isHazmat) {
    return { ok: false, reason: 'shipment is not hazmat' };
  }
  if (conditions.requiresCustoms === true && !ctx.requiresCustoms) {
    return { ok: false, reason: 'customs not required' };
  }
  if (conditions.requiresCrossBorder === true) {
    const o = ctx.originCountry?.toUpperCase();
    const d = ctx.destinationCountry?.toUpperCase();
    if (!o || !d || o === d) {
      return { ok: false, reason: 'not a cross-border shipment' };
    }
  }
  return { ok: true };
}

// ── Type guards ───────────────────────────────────────────────────────────

/**
 * Validates that an unknown JSONB blob (from the DB) is a usable rule.
 * Returns the rule on success or null on failure — the caller treats null
 * as "no auto-apply rule for this catalog entry, skip".
 */
export function parseRule(raw: unknown): AccessorialRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== 'string') return null;

  switch (r.type) {
    case 'flat':
      if (typeof r.amount !== 'number') return null;
      return r as unknown as FlatRule;
    case 'percentage':
      if (typeof r.percentage !== 'number') return null;
      if (r.basis !== 'base_rate' && r.basis !== 'cargo_value' && r.basis !== 'subtotal') return null;
      return r as unknown as PercentageRule;
    case 'per_km':
      if (typeof r.rate !== 'number') return null;
      return r as unknown as PerKmRule;
    case 'per_kg':
      if (typeof r.rate !== 'number') return null;
      return r as unknown as PerKgRule;
    case 'per_stop':
      if (typeof r.rate !== 'number') return null;
      return r as unknown as PerStopRule;
    default:
      return null;
  }
}

// ── Evaluator ─────────────────────────────────────────────────────────────

/**
 * Evaluate a single rule against the shipment context. Returns the
 * verdict. NEVER throws — invalid rule shapes become non-applying
 * verdicts so a bad row in the catalog can't take down shipment creation.
 */
export function evaluateRule(rule: AccessorialRule, ctx: AccessorialContext): RuleVerdict {
  const gate = conditionsHold(rule.conditions, ctx);
  if (!gate.ok) return NO_APPLY(gate.reason, rule.currency ?? null);

  const taxable = rule.taxable !== false;
  const currency = rule.currency ?? null;

  let amount = 0;
  let reason = '';

  switch (rule.type) {
    case 'flat':
      amount = rule.amount;
      reason = `flat ${rule.amount}`;
      break;

    case 'percentage': {
      const basisValue = pickBasis(rule.basis, ctx);
      if (basisValue == null) return NO_APPLY(`basis "${rule.basis}" not available on shipment`, currency);
      amount = basisValue * rule.percentage / 100;
      reason = `${rule.percentage}% of ${rule.basis}=${basisValue}`;
      break;
    }

    case 'per_km': {
      const dist = ctx.distanceKm ?? 0;
      const free = rule.freeKm ?? 0;
      const chargeable = Math.max(0, dist - free);
      const capped = rule.maxKm != null ? Math.min(chargeable, rule.maxKm - free) : chargeable;
      amount = Math.max(0, capped) * rule.rate;
      reason = `${rule.rate}/km × ${Math.max(0, capped)}km (dist=${dist}, free=${free}${rule.maxKm ? `, cap=${rule.maxKm}` : ''})`;
      break;
    }

    case 'per_kg': {
      const wt = ctx.weightKg ?? 0;
      const chargeable = Math.max(0, wt - (rule.freeKg ?? 0));
      amount = chargeable * rule.rate;
      reason = `${rule.rate}/kg × ${chargeable}kg`;
      break;
    }

    case 'per_stop': {
      const stops = ctx.stopsCount ?? 0;
      const chargeable = rule.excludeFirst ? Math.max(0, stops - 1) : stops;
      amount = chargeable * rule.rate;
      reason = `${rule.rate}/stop × ${chargeable} stops`;
      break;
    }
  }

  amount = round2(Math.max(0, amount));
  if (amount === 0) return NO_APPLY(`${reason} → amount 0`, currency);

  return { applies: true, amount, currency, taxable, reason };
}

function pickBasis(basis: PercentageBasis, ctx: AccessorialContext): number | null {
  switch (basis) {
    case 'base_rate':   return ctx.baseRate ?? null;
    case 'cargo_value': return ctx.cargoValue ?? null;
    case 'subtotal':    return ctx.subtotal ?? null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Top-level: evaluate a catalog batch against a single shipment ──────────

export interface CatalogEntry {
  id: string;
  code: string;
  name: string;
  chargeType: string | null;
  defaultAmount: number | null;
  currency: string;
  taxable: boolean;
  autoApplyRule: unknown;
  status: string;
}

export interface AppliedAccessorial {
  catalogId: string;
  code: string;
  name: string;
  chargeType: string | null;
  amount: number;
  currency: string;
  taxable: boolean;
  reason: string;
}

/**
 * Given the full catalog and a shipment context, return the list of
 * accessorials that should be auto-applied. Each item carries the
 * computed amount and the human-readable reason for audit.
 *
 * Filters:
 *   - status !== 'ACTIVE' → skipped
 *   - autoApplyRule missing or unparseable → skipped (use the catalog
 *     entry for manual add via UI; auto-apply requires explicit opt-in)
 *   - rule returns applies=false → skipped
 */
export function applyAccessorialCatalog(
  catalog: CatalogEntry[],
  ctx: AccessorialContext,
): AppliedAccessorial[] {
  const applied: AppliedAccessorial[] = [];
  for (const entry of catalog) {
    if (entry.status !== 'ACTIVE') continue;
    const rule = parseRule(entry.autoApplyRule);
    if (!rule) continue;
    const verdict = evaluateRule(rule, ctx);
    if (!verdict.applies) continue;
    applied.push({
      catalogId: entry.id,
      code: entry.code,
      name: entry.name,
      chargeType: entry.chargeType,
      amount: verdict.amount,
      currency: verdict.currency ?? entry.currency ?? 'AED',
      taxable: verdict.taxable,
      reason: verdict.reason,
    });
  }
  return applied;
}

// ─────────────────────────────────────────────────────────────────────────────
// Day-2 wiring: load catalog + apply + persist to logistics_freight_charges.
// Kept under a clear divider so the pure evaluator above remains DB-free
// and unit-testable without mocks.
// ─────────────────────────────────────────────────────────────────────────────

import { listAccessorialCatalog, addShipmentAccessorialCharge } from './domain';

/** UAE-standard 5% VAT. Switched off per-rule via taxable=false. */
const DEFAULT_VAT_RATE = 0.05;

export interface AutoApplyResult {
  applied: AppliedAccessorial[];
  /** IDs of freight_charges rows written (one per applied accessorial). */
  chargeIds: string[];
  /** Sum of all auto-applied amounts (pre-tax). */
  totalAmount: number;
  /** Sum of computed VAT/tax across applied charges. */
  totalTax: number;
}

/**
 * Load the tenant's accessorial catalog, evaluate every rule against the
 * given shipment context, and write a freight_charges row for each one
 * that fires. Idempotent only by virtue of the caller calling it ONCE
 * per shipment — no dedup against existing freight_charges rows.
 *
 * Best-effort: a row insert failing does NOT abort the others. We log
 * and continue. The auto-applier is a margin-recovery aid, not a hard
 * invariant — a single failed insert shouldn't reject the whole booking.
 */
export async function applyAutoAccessorialsToShipment(args: {
  tenantId: string;
  shipmentOrderId: string;
  actorUserId: string;
  context: AccessorialContext;
}): Promise<AutoApplyResult> {
  const rawCatalog = await listAccessorialCatalog({
    tenantId: args.tenantId,
    status: 'ACTIVE',
    limit: 500,
  });

  // Map the domain shape → CatalogEntry shape the pure evaluator expects.
  const catalog: CatalogEntry[] = rawCatalog.map(r => ({
    id: r.id,
    code: r.code,
    name: r.name,
    chargeType: r.chargeType,
    defaultAmount: r.defaultAmount,
    currency: r.currency,
    taxable: r.taxable,
    autoApplyRule: r.autoApplyRule,
    status: r.status,
  }));

  const applied = applyAccessorialCatalog(catalog, args.context);

  const chargeIds: string[] = [];
  let totalAmount = 0;
  let totalTax = 0;

  for (const a of applied) {
    const taxAmount = a.taxable ? round2(a.amount * DEFAULT_VAT_RATE) : 0;
    try {
      const charge = await addShipmentAccessorialCharge({
        tenantId: args.tenantId,
        shipmentOrderId: args.shipmentOrderId,
        catalogId: a.catalogId,
        code: a.code,
        name: a.name,
        chargeSide: 'CUSTOMER',
        quantity: 1,
        unitRate: a.amount,
        amount: a.amount,
        taxAmount,
        currency: a.currency,
        actorUserId: args.actorUserId,
        metadata: {
          autoApplied: true,
          reason: a.reason,
          chargeType: a.chargeType,
        },
      });
      const id = (charge as { id?: string })?.id;
      if (id) chargeIds.push(id);
      totalAmount += a.amount;
      totalTax += taxAmount;
    } catch (e) {
      // Non-fatal: log and keep going. One bad rule shouldn't sink booking.
      console.error('[applyAutoAccessorials] failed to write', a.code, e instanceof Error ? e.message : e);
    }
  }

  return {
    applied,
    chargeIds,
    totalAmount: round2(totalAmount),
    totalTax: round2(totalTax),
  };
}
