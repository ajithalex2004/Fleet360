/**
 * Plan limits + gating helpers.
 *
 * Re-exports from @/lib/plans which is the canonical reader. The data
 * lives in the `platform_plans` table and is admin-editable via
 * /admin/platform-plans. This module keeps its public API stable so
 * existing route handlers don't have to change.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLimits as _getLimits, planAtLeast as _planAtLeast } from '@/lib/plans';
import type { PlanLimits } from '@/lib/plans';

export type { PlanLimits };

/**
 * Re-export the limits table. Kept as a `Record<string, PlanLimits>` for
 * back-compat with any caller that did `PLAN_LIMITS[code]`. The four
 * canonical codes (TRIAL / STANDARD / PROFESSIONAL / ENTERPRISE) are
 * always present; the rest come from whatever's in the DB cache.
 */
export const PLAN_LIMITS: Record<string, PlanLimits> = new Proxy(
  {} as Record<string, PlanLimits>,
  {
    get: (_target, prop: string) => _getLimits(prop),
  },
);

export function planAtLeast(actual: string, minimum: string): boolean {
  return _planAtLeast(actual, minimum);
}

export function getLimits(plan: string): PlanLimits {
  return _getLimits(plan);
}

// ── Route-level gating ──────────────────────────────────────────────────────

/**
 * Returns null when the caller's plan meets `minimumPlan`, otherwise a
 * 402 NextResponse the route handler should return immediately.
 *
 *   const gate = requirePlan(req, 'PROFESSIONAL');
 *   if (gate) return gate;
 */
export function requirePlan(req: NextRequest, minimumPlan: string): NextResponse | null {
  const plan = (req.headers.get('x-tenant-plan') ?? 'TRIAL');
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
  plan:       string;
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
