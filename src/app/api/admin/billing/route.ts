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
import { getTenantBilling } from '@/lib/billing';
import { getUsage } from '@/lib/plan-usage';
import { getLimits } from '@/lib/plan-limits';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

  const [billing, usage] = await Promise.all([
    getTenantBilling(tenantId),
    getUsage(tenantId),
  ]);
  if (!billing) return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });

  const limits = getLimits(billing.plan);

  return NextResponse.json({
    ok: true,
    billing,
    usage,
    limits: {
      maxUsers:            isFinite(limits.maxUsers)            ? limits.maxUsers            : null,
      maxVehicles:         isFinite(limits.maxVehicles)         ? limits.maxVehicles         : null,
      maxBookingsPerMonth: isFinite(limits.maxBookingsPerMonth) ? limits.maxBookingsPerMonth : null,
      sso:      limits.sso,
      apiKeys:  limits.apiKeys,
      branding: limits.branding,
    },
  });
}
