import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { captureException } from '@/lib/sentry';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { STAFF_TRANSPORT_DEMAND_AGENT } from '@/lib/agents/staff-transport-demand/agent';
import { StaffTransportDemandResult } from '@/lib/agents/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    const sp = req.nextUrl.searchParams;
    const weeks = Math.max(1, Math.min(12, Number(sp.get('weeks') ?? 4)));

    try {
      const agentRun = await STAFF_TRANSPORT_DEMAND_AGENT.run({
        agent_id: 'staff-transport-demand',
        tenant_id: tenantId,
        event_type: 'bus.demand.forecast',
        metadata: { weeks },
      });

      const output = agentRun.output as StaffTransportDemandResult | null;
      if (!output) {
        return NextResponse.json({
          weeksOfHistory: weeks,
          runAt: new Date().toISOString(),
          rows: [],
          warning: 'No forecast output generated.',
        });
      }

      // Map to legacy rows format for backward compatibility while providing full agent intelligence
      const rows = (output.items || []).map((item) => ({
        routeId: item.routeId,
        routeName: item.routeName,
        shiftType: item.shiftType,
        dayOfWeek: item.dayOfWeek,
        baseline: item.baselinePax,
        trendDelta: item.trendDeltaPax,
        trailingWeeks: weeks,
        capacity: item.vehicleCapacity,
        capacityRiskPct: item.capacityRiskPct,
        aiAnnotation: {
          confidence: item.confidence,
          risk: item.riskStatus,
          rationale: item.explanation,
        },
        suggestedAction: item.suggestedAction,
        suggestedVehicleSize: item.suggestedVehicleSize,
        estimatedSavingsAed: item.estimatedSavingsAed,
        targetDate: item.targetDate,
      }));

      return NextResponse.json({
        weeksOfHistory: weeks,
        runAt: output.generatedAt,
        rows,
        agentSummary: {
          totalRoutesAnalyzed: output.totalRoutesAnalyzed,
          overCapacityCount: output.overCapacityCount,
          underCapacityCount: output.underCapacityCount,
          optimalCapacityCount: output.optimalCapacityCount,
          potentialSavingsAed: output.potentialSavingsAed,
          executiveSummary: output.executiveSummary,
          durationMs: agentRun.durationMs,
        },
      });
    } catch (err) {
      captureException(err, { context: 'bus-ops.demand-forecast' });
      return NextResponse.json({ error: 'Staff Transport Demand Forecast failed' }, { status: 500 });
    }
  });
}


