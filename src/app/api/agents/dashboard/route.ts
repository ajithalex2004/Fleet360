export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/dashboard
 * -------------------------
 * Returns comprehensive AI Platform Executive Dashboard telemetry for the tenant,
 * including cost vs avoided cost ROI, routing matrix cache hits, capability tier
 * distributions, HITL approval queue stats, policy budgets, and quality benchmark metrics.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { aiDashboardService } from '@/lib/agents/dashboard';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async () => {
      const data = await aiDashboardService.getTenantDashboard(tenantId);
      return NextResponse.json({ ok: true, data });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to load AI dashboard metrics' },
      { status: 500 },
    );
  }
}
