/**
 * GET /api/admin/billing
 *
 * Returns the current tenant's billing snapshot: plan, Stripe sub status,
 * trial/period end, current usage, and limits for the active plan.
 *
 * Auth: any authenticated user in the tenant. (UI restricts the page to
 * TENANT_ADMIN, but the data is non-sensitive aggregates.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCanonicalBillingAccount } from '@/lib/canonical-billing';
import { getUsage } from '@/lib/plan-usage';
import { getLimits } from '@/lib/plan-limits';

export const runtime = 'nodejs';

const BILLING_TTL_MS = 60_000;
const billingCache = new Map<string, { ts: number; body: unknown }>();

export async function GET(req: NextRequest) {
  try {
    const started = Date.now();
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

    const cached = billingCache.get(tenantId);
    if (cached && Date.now() - cached.ts < BILLING_TTL_MS) {
      return NextResponse.json(cached.body, {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
          'X-Fleet360-Cache': 'hit',
          'X-Fleet360-Query-Ms': String(Date.now() - started),
        },
      });
    }

    const [billing, usage] = await Promise.all([
      getCanonicalBillingAccount(tenantId),
      getUsage(tenantId),
    ]);
    if (!billing) return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });

    const limits = getLimits(billing.effectivePlan);

    const body = {
      ok: true,
      billing: {
        tenantId: billing.tenantId,
        tenantName: billing.tenantName,
        plan: billing.effectivePlan,
        effectivePlan: billing.effectivePlan,
        billingModel: billing.billingModel,
        billingStatus: billing.billingStatus,
        stripeCustomerId: billing.stripeCustomerId,
        stripeSubscriptionId: billing.stripeSubscriptionId,
        subscriptionStatus: billing.subscriptionStatus,
        currentPeriodEnd: billing.currentPeriodEnd,
        trialEndsAt: billing.trialEndsAt,
        billingEmail: billing.billingEmail,
        moduleMrr: billing.moduleMrr,
        moduleArr: billing.moduleArr,
        activeModuleSubscriptions: billing.activeModuleSubscriptions,
      },
      canonicalBilling: billing,
      usage,
      limits: {
        maxUsers:            isFinite(limits.maxUsers)            ? limits.maxUsers            : null,
        maxVehicles:         isFinite(limits.maxVehicles)         ? limits.maxVehicles         : null,
        maxBookingsPerMonth: isFinite(limits.maxBookingsPerMonth) ? limits.maxBookingsPerMonth : null,
        sso:      limits.sso,
        apiKeys:  limits.apiKeys,
        branding: limits.branding,
      },
    };
    billingCache.set(tenantId, { ts: Date.now(), body });

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        'X-Fleet360-Cache': 'miss',
        'X-Fleet360-Query-Ms': String(Date.now() - started),
      },
    });
  } catch (e) {
    console.error('[GET /api/admin/billing] error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'Failed', detail: msg }, { status: 500 });
  }
}
