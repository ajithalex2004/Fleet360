export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { executeFleetExpirySweep } from '@/lib/fleet/expiry-grounding-engine';

/**
 * GET /api/fleet/documents/sweep
 * Returns the current fleet compliance health matrix and grounded vehicles (dry run).
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const gracePeriod = parseInt(sp.get('mulkiyaGracePeriodDays') ?? '30', 10);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const summary = await executeFleetExpirySweep(tx, tenantId, {
        mulkiyaGracePeriodDays: gracePeriod,
        dryRun: true,
      });

      return NextResponse.json(summary);
    } catch (err) {
      console.error('[fleet-documents-sweep] GET failed:', err);
      return NextResponse.json(
        { error: 'Failed to evaluate fleet document compliance' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/fleet/documents/sweep
 * Triggers an active fleet-wide expiry sweep and auto-grounds non-compliant assets in DB.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      let gracePeriod = 30;
      try {
        const body = await req.json();
        if (typeof body.mulkiyaGracePeriodDays === 'number') {
          gracePeriod = body.mulkiyaGracePeriodDays;
        }
      } catch {
        // Fallback to default 30 days
      }

      const summary = await executeFleetExpirySweep(tx, tenantId, {
        mulkiyaGracePeriodDays: gracePeriod,
        dryRun: false,
      });

      return NextResponse.json({
        success: true,
        summary,
        message: `Sweep completed. ${summary.newlyGroundedCount} vehicle(s) grounded, ${summary.newlyRestoredCount} restored.`,
      });
    } catch (err) {
      console.error('[fleet-documents-sweep] POST failed:', err);
      return NextResponse.json(
        { error: 'Failed to execute fleet expiry sweep' },
        { status: 500 }
      );
    }
  });
}
