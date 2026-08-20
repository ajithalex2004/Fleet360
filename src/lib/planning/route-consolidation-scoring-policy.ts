/**
 * Route Consolidation — tenant-editable scoring policy.
 *
 * Resolves the active `RouteConsolidationScoringPolicy` row for a tenant,
 * falling back to `DEFAULT_SCORING_POLICY` when none exists yet (fresh
 * tenants, or before an admin has ever saved custom weights).
 *
 * Versioning is effective-dating, not destructive edits: `activatePolicy`
 * deactivates the current active row (isActive=false, effectiveTo=now())
 * and inserts a new one, so a policy referenced by a past
 * `RouteConsolidation.objectiveSnapshot` always describes a shape that
 * still exists historically.
 *
 * The scorer (Stage 4) only ever sees the resolved `ScoringPolicy` shape —
 * it doesn't know or care whether the values came from DB or defaults.
 */

import type { PrismaClient } from '@prisma/client';

// ── Public shape ────────────────────────────────────────────────────────────

export interface ScoringPolicyReferences {
  distanceReferenceKm: number;
  timeReferenceMinutes: number;
  passengerImpactReferenceMinutes: number;
  detourReferenceMinutes: number;
  pcePenaltyReference: number;
}

export interface ScoringPolicyBenefitWeights {
  distance: number;
  time: number;
  resourceRelease: number;
}

export interface ScoringPolicyImpactWeights {
  passengerImpact: number;
  detour: number;
  /** Absorbs the old standalone λ multiplier — kept inside the [0,1] impact group. */
  pcePenalty: number;
}

export interface ScoringPolicy {
  /** null when serving DEFAULT_SCORING_POLICY (no DB row exists for the tenant yet). */
  id: string | null;
  name: string;
  calculationVersion: string;
  references: ScoringPolicyReferences;
  benefitWeights: ScoringPolicyBenefitWeights;
  impactWeights: ScoringPolicyImpactWeights;
}

// ── Code-level fallback ─────────────────────────────────────────────────────
//
// Product defaults for a tenant that has never configured its own policy.
// Reference values are deliberately round starting guesses, not tuned
// against real usage data (none exists yet) — expect these to need
// revisiting once tenants have a few weeks of real consolidation history.
// Bump calculationVersion whenever these defaults change so any snapshot
// captured under the old defaults stays distinguishable.

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  id: null,
  name: 'Fleet360 default',
  calculationVersion: 'route-consolidation-v1',
  references: {
    distanceReferenceKm: 50,
    timeReferenceMinutes: 60,
    passengerImpactReferenceMinutes: 300,
    detourReferenceMinutes: 30,
    pcePenaltyReference: 100,
  },
  benefitWeights: {
    distance: 0.4,
    time: 0.3,
    resourceRelease: 0.3,
  },
  impactWeights: {
    passengerImpact: 0.4,
    detour: 0.3,
    pcePenalty: 0.3,
  },
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/** Read-through resolve: active DB policy for the tenant, else the code default. */
export async function resolveScoringPolicy(
  prisma: PrismaClient,
  tenantId: string,
): Promise<ScoringPolicy> {
  const row = await prisma.routeConsolidationScoringPolicy.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!row) return DEFAULT_SCORING_POLICY;

  return {
    id: row.id,
    name: row.name,
    calculationVersion: row.calculationVersion,
    references: {
      distanceReferenceKm: row.distanceReferenceKm,
      timeReferenceMinutes: row.timeReferenceMinutes,
      passengerImpactReferenceMinutes: row.passengerImpactReferenceMinutes,
      detourReferenceMinutes: row.detourReferenceMinutes,
      pcePenaltyReference: row.pcePenaltyReference,
    },
    benefitWeights: {
      distance: row.distanceWeight,
      time: row.timeWeight,
      resourceRelease: row.resourceReleaseWeight,
    },
    impactWeights: {
      passengerImpact: row.passengerImpactWeight,
      detour: row.detourWeight,
      pcePenalty: row.pcePenaltyWeight,
    },
  };
}

// ── Validation ───────────────────────────────────────────────────────────────
//
// Enforced at the application layer, not a DB CHECK constraint — summing
// floats to exactly 1.0 in SQL is unreliable across client float encodings.

const WEIGHT_SUM_TOLERANCE = 0.001;

export interface ScoringPolicyInput {
  name: string;
  references: ScoringPolicyReferences;
  benefitWeights: ScoringPolicyBenefitWeights;
  impactWeights: ScoringPolicyImpactWeights;
}

/** Returns an error message, or null when the input is valid. */
export function validateScoringPolicyInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'body must be an object';
  const b = input as Record<string, unknown>;

  if (typeof b.name !== 'string' || !b.name.trim()) return 'name is required';

  const refs = b.references as Partial<ScoringPolicyReferences> | undefined;
  if (!refs || typeof refs !== 'object') return 'references is required';
  for (const key of [
    'distanceReferenceKm', 'timeReferenceMinutes', 'passengerImpactReferenceMinutes',
    'detourReferenceMinutes', 'pcePenaltyReference',
  ] as const) {
    const v = refs[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      return `references.${key} must be a positive number`;
    }
  }

  const benefit = b.benefitWeights as Partial<ScoringPolicyBenefitWeights> | undefined;
  if (!benefit || typeof benefit !== 'object') return 'benefitWeights is required';
  for (const key of ['distance', 'time', 'resourceRelease'] as const) {
    const v = benefit[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `benefitWeights.${key} must be a non-negative number`;
    }
  }
  const benefitSum = benefit.distance! + benefit.time! + benefit.resourceRelease!;
  if (Math.abs(benefitSum - 1) > WEIGHT_SUM_TOLERANCE) {
    return `benefitWeights must sum to 1.0 (got ${benefitSum})`;
  }

  const impact = b.impactWeights as Partial<ScoringPolicyImpactWeights> | undefined;
  if (!impact || typeof impact !== 'object') return 'impactWeights is required';
  for (const key of ['passengerImpact', 'detour', 'pcePenalty'] as const) {
    const v = impact[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `impactWeights.${key} must be a non-negative number`;
    }
  }
  const impactSum = impact.passengerImpact! + impact.detour! + impact.pcePenalty!;
  if (Math.abs(impactSum - 1) > WEIGHT_SUM_TOLERANCE) {
    return `impactWeights must sum to 1.0 (got ${impactSum})`;
  }

  return null;
}

// ── Activation (versioned write) ──────────────────────────────────────────────

export async function activateScoringPolicy(
  prisma: PrismaClient,
  args: { tenantId: string; input: ScoringPolicyInput; calculationVersion: string; userId: string | null },
): Promise<ScoringPolicy> {
  const { tenantId, input, calculationVersion, userId } = args;

  const row = await prisma.$transaction(async (tx) => {
    await tx.routeConsolidationScoringPolicy.updateMany({
      where: { tenantId, isActive: true },
      data: { isActive: false, effectiveTo: new Date() },
    });
    return tx.routeConsolidationScoringPolicy.create({
      data: {
        tenantId,
        name: input.name.trim(),
        calculationVersion,
        distanceReferenceKm: input.references.distanceReferenceKm,
        timeReferenceMinutes: input.references.timeReferenceMinutes,
        passengerImpactReferenceMinutes: input.references.passengerImpactReferenceMinutes,
        detourReferenceMinutes: input.references.detourReferenceMinutes,
        pcePenaltyReference: input.references.pcePenaltyReference,
        distanceWeight: input.benefitWeights.distance,
        timeWeight: input.benefitWeights.time,
        resourceReleaseWeight: input.benefitWeights.resourceRelease,
        passengerImpactWeight: input.impactWeights.passengerImpact,
        detourWeight: input.impactWeights.detour,
        pcePenaltyWeight: input.impactWeights.pcePenalty,
        isActive: true,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  });

  return {
    id: row.id,
    name: row.name,
    calculationVersion: row.calculationVersion,
    references: {
      distanceReferenceKm: row.distanceReferenceKm,
      timeReferenceMinutes: row.timeReferenceMinutes,
      passengerImpactReferenceMinutes: row.passengerImpactReferenceMinutes,
      detourReferenceMinutes: row.detourReferenceMinutes,
      pcePenaltyReference: row.pcePenaltyReference,
    },
    benefitWeights: {
      distance: row.distanceWeight,
      time: row.timeWeight,
      resourceRelease: row.resourceReleaseWeight,
    },
    impactWeights: {
      passengerImpact: row.passengerImpactWeight,
      detour: row.detourWeight,
      pcePenalty: row.pcePenaltyWeight,
    },
  };
}
