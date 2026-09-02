export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { getCsatAndFcrAnalytics } from '@/lib/service-tickets/csat-analytics-engine';

export const runtime = 'nodejs';

/**
 * GET /api/service-tickets/analytics/csat
 * Returns CSAT and First-Contact Resolution (FCR) analytics for dispatchers & managers
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const analytics = await getCsatAndFcrAnalytics(tenantId);
      return NextResponse.json({ ok: true, analytics });
    } catch (err) {
      console.error('GET /api/service-tickets/analytics/csat error:', err);
      return NextResponse.json(
        { error: 'Failed to fetch CSAT analytics' },
        { status: 500 }
      );
    }
  });
}
