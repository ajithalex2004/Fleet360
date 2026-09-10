export const dynamic = 'force-dynamic';

/**
 * /api/agents/admin/leaderboard
 * -----------------------------
 * GET: Returns cross-tenant AI token usage, spend, ROI, and governance quota metrics.
 *      Restricted to SUPER_ADMIN role.
 * PUT/PATCH: Updates daily/monthly budget quota, autonomy ceiling, or trips/resets
 *      the circuit breaker for a specified tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { aiDashboardService } from '@/lib/agents/dashboard';
import { policyService } from '@/lib/agents/governance';

export async function GET(req: NextRequest) {
  const role = req.headers.get('x-user-role') ?? req.headers.get('x-role');
  const userId = req.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Cross-tenant leaderboard is exclusively for Super Admin
  if (role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Super Admin access required for cross-tenant AI telemetry' },
      { status: 403 },
    );
  }

  try {
    return await withPlatformAdmin(prisma, async () => {
      const leaderboard = await aiDashboardService.getSuperAdminCrossTenantLeaderboard();
      return NextResponse.json({ ok: true, data: leaderboard });
    });
  } catch (err: any) {
    console.error('[SUPER_ADMIN_AI_LEADERBOARD_GET]', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to load cross-tenant leaderboard' },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const role = req.headers.get('x-user-role') ?? req.headers.get('x-role');
  const userId = req.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Super Admin access required to modify tenant AI quotas' },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const { targetTenantId, updates } = body;

    if (!targetTenantId) {
      return NextResponse.json(
        { error: 'targetTenantId is required to update AI policy' },
        { status: 400 },
      );
    }

    return await withPlatformAdmin(prisma, async () => {
      const updatedPolicy = await policyService.updateTenantPolicy(targetTenantId, updates || {});
      return NextResponse.json({
        ok: true,
        message: `Tenant ${targetTenantId} AI governance policy updated successfully`,
        data: updatedPolicy,
      });
    });
  } catch (err: any) {
    console.error('[SUPER_ADMIN_AI_POLICY_UPDATE]', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to update tenant AI policy' },
      { status: 500 },
    );
  }
}
