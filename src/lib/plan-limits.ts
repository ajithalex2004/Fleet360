/**
 * Plan limits + gating helpers.
 *
 * Pure module — no DB calls. Combine with usage counters and the
 * tenant's current plan (from /api/auth/me header x-tenant-plan)
 * to enforce quotas.
 *
 * Limits intentionally generous so trial doesn't hard-block early
 * exploration. Adjust per business reality.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PlanCode } from '@/lib/billing';

export interface PlanLimits {
  maxUsers:               number;
  maxVehicles:            number;
  maxBookingsPerMonth:    number;
  /** Modules gated behind higher plans — others unlock everywhere. */
  premiumModules:         readonly string[];
  /** Whether a tenant on this plan can configure SSO. */
  sso:                    boolean;
  /** Whether a tenant on this plan can issue API keys. */
  apiKeys:                boolean;
  /** Whether a tenant on this plan can white-label. */
  branding:               boolean;
}

export const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  TRIAL: {
    maxUsers:            5,
    maxVehicles:         10,
    maxBookingsPerMonth: 200,
    premiumModules:      [],
    sso:                 false,
    apiKeys:             false,
    branding:            false,
  },
  STANDARD: {
    maxUsers:            25,
    maxVehicles:         100,
    maxBookingsPerMonth: 5_000,
    premiumModules:      [],
    sso:                 false,
    apiKeys:             true,
    branding:            false,
  },
  PROFESSIONAL: {
    maxUsers:            200,
    maxVehicles:         1_000,
    maxBookingsPerMonth: 50_000,
    premiumModules:      [],
    sso:                 true,
    apiKeys:             true,
    branding:            true,
  },
  ENTERPRISE: {
    maxUsers:            Number.POSITIVE_INFINITY,
    maxVehicles:         Number.POSITIVE_INFINITY,
    maxBookingsPerMonth: Number.POSITIVE_INFINITY,
    premiumModules:      [],
    sso:                 true,
    apiKeys:             true,
    branding:            true,
  },
};

const PLAN_RANK: Record<PlanCode, number> = { TRIAL: 0, STANDARD: 1, PROFESSIONAL: 2, ENTERPRISE: 3 };

export function planAtLeast(actual: PlanCode, minimum: PlanCode): boolean {
  return PLAN_RANK[actual] >= PLAN_RANK[minimum];
}

export function getLimits(plan: PlanCode): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.TRIAL;
}

// ── Route-level gating ──────────────────────────────────────────────────────

/**
 * Returns null when the caller's plan meets `minimumPlan`, otherwise a
 * 402 NextResponse the route handler should return immediately.
 *
 *   const gate = requirePlan(req, 'PROFESSIONAL');
 *   if (gate) return gate;
 */
export function requirePlan(req: NextRequest, minimumPlan: PlanCode): NextResponse | null {
  const plan = (req.headers.get('x-tenant-plan') ?? 'TRIAL') as PlanCode;
  if (planAtLeast(plan, minimumPlan)) return null;

  return NextResponse.json(
    {
      ok: false,
      error: 'Payment Required',
      message: `This feature requires the ${minimumPlan} plan or higher. You're on ${plan}.`,
      currentPlan: plan,
      requiredPlan: minimumPlan,
      upgradeUrl: '/admin/billing',
    },
    { status: 402 },
  );
}

/**
 * Quota-style gate. Returns null when usage < limit, else a 402 NextResponse
 * with details so the client can render a sensible upgrade prompt.
 */
export function requireUnderQuota(opts: {
  plan:       PlanCode;
  resource:   keyof Pick<PlanLimits, 'maxUsers' | 'maxVehicles' | 'maxBookingsPerMonth'>;
  current:    number;
}): NextResponse | null {
  const limit = getLimits(opts.plan)[opts.resource];
  if (opts.current < limit) return null;

  return NextResponse.json(
    {
      ok: false,
      error: 'Quota Exceeded',
      message: `Your ${opts.plan} plan is limited to ${limit} ${humanResource(opts.resource)}. Currently at ${opts.current}.`,
      resource: opts.resource,
      current: opts.current,
      limit,
      currentPlan: opts.plan,
      upgradeUrl: '/admin/billing',
    },
    { status: 402 },
  );
}

function humanResource(r: string): string {
  switch (r) {
    case 'maxUsers':            return 'users';
    case 'maxVehicles':         return 'vehicles';
    case 'maxBookingsPerMonth': return 'bookings/month';
    default:                    return r;
  }
}
