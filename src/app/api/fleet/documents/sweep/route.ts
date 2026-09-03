export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { executeFleetExpirySweep } from '@/lib/fleet/expiry-grounding-engine';
import { notifyGroundingChanges } from '@/lib/fleet/expiry-grounding-notify';
import { captureException } from '@/lib/sentry';

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

  let gracePeriod = 30;
  try {
    const body = await req.json();
    if (typeof body.mulkiyaGracePeriodDays === 'number') {
      gracePeriod = body.mulkiyaGracePeriodDays;
    }
  } catch {
    // Fallback to default 30 days
  }

  let summary;
  try {
    summary = await withTenantRls(prisma, tenantId, (tx) =>
      executeFleetExpirySweep(tx, tenantId, {
        mulkiyaGracePeriodDays: gracePeriod,
        dryRun: false,
      }),
    );
  } catch (err) {
    console.error('[fleet-documents-sweep] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to execute fleet expiry sweep' },
      { status: 500 }
    );
  }

  // Notifications run after the RLS transaction has committed — grounding a
  // vehicle used to be a silent status flip with no alert and no email, so a
  // dispatcher could plan a route around a vehicle that had already been
  // pulled from service. Both an in-app Alert and a staff email fire here;
  // best-effort, and deliberately outside withTenantRls so neither the
  // outbox insert nor the SMTP round-trip shares a connection with (and
  // risks poisoning) the sweep's own transaction.
  await notifyGroundingChanges(tenantId, summary.vehicleRecords).catch((err) => {
    captureException(err, { context: 'fleet.expiry-sweep.notify', tags: { tenantId } });
  });

  return NextResponse.json({
    success: true,
    summary,
    message: `Sweep completed. ${summary.newlyGroundedCount} vehicle(s) grounded, ${summary.newlyRestoredCount} restored.`,
  });
}
