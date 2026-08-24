/**
 * Public plan catalog.
 *
 * GET /api/platform/plans
 *   → { plans: PlanCatalogEntry[] }   active plans only, sorted by sort_order
 *
 * Used by the /onboarding page to render the pricing cards. The marketing
 * copy (name, price, description, "Popular" highlight) and quotas are
 * all admin-editable via /admin/platform-plans.
 *
 * Public — no auth required. The plans are public marketing data; no
 * tenant context, no sensitive info. The in-memory cache in lib/plans
 * gives us sub-ms origin responses; the `s-maxage` header lets the CDN
 * serve at the edge.
 */

import { NextResponse } from 'next/server';
import { listPlans } from '@/lib/plans';
import { publicCacheControl } from '@/lib/server-cache';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(): Promise<NextResponse> {
  const plans = await listPlans({ activeOnly: true });
  return NextResponse.json({ plans }, {
    headers: { 'Cache-Control': publicCacheControl() },
  });
}
