export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/schedules/sweep-sla
 *
 * Background Sweep for Shift Arrival SLA Monitoring.
 * Evaluates all running commuter trips in the tenant, calculates destination
 * ETAs, and raises AlertEngine notifications for AT_RISK and SLA_BREACH trips.
 *
 * Auth: Tenant session or CRON_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { evaluateTenantSla } from '@/lib/bus-ops/sla-monitor';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;

  try {
    const summary = await evaluateTenantSla(tenantId, {
      raiseAlerts: true,
      statusFilter: ['IN_TRANSIT', 'DEPARTED', 'SCHEDULED'],
    });

    void logAudit({
      tenantId,
      action: 'SWEEP_SHIFT_SLA',
      entityType: 'TripSchedule',
      entityId: 'BATCH',
      details: {
        totalActiveTrips: summary.totalActiveTrips,
        atRiskCount: summary.atRiskCount,
        breachCount: summary.breachCount,
        onTimeCount: summary.onTimeCount,
        impactedPassengers: summary.totalImpactedPassengers,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Shift SLA sweep completed for ${summary.totalActiveTrips} active trips.`,
      summary,
    });
  } catch (err) {
    console.error('[api/bus-ops/schedules/sweep-sla POST]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Shift SLA sweep failed' },
      { status: 500 },
    );
  }
}
