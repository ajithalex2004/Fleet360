export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/preventive-maintenance/forecasts
 * --------------------------------------------------
 * Returns active vehicle PM forecasts, projected days until due, and lowest-impact slots.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const urgency = req.nextUrl.searchParams.get('urgency');
      const filterUrgency = urgency && urgency !== 'ALL' ? `AND urgency_level = $2` : '';
      const params = urgency && urgency !== 'ALL' ? [tenantId, urgency] : [tenantId];

      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          id::text,
          vehicle_id::text,
          vehicle_code,
          license_plate,
          make,
          model,
          current_odometer_km::float8,
          current_engine_hours::float8,
          daily_avg_km::float8,
          daily_avg_engine_hours::float8,
          target_service_threshold,
          target_trigger_type,
          remaining_km::float8,
          remaining_engine_hours::float8,
          estimated_days_to_due,
          projected_due_date::text,
          urgency_level,
          forecast_narrative,
          recommended_slot,
          operational_impact_score::float8,
          status,
          updated_at::text
        FROM preventive_maintenance_forecasts
        WHERE tenant_id = $1
          ${filterUrgency}
        ORDER BY estimated_days_to_due ASC, operational_impact_score ASC
        LIMIT 100
      `, ...params);

      const forecasts = (rows || []).map((r) => ({
        id: r.id,
        vehicleId: r.vehicle_id,
        vehicleCode: r.vehicle_code,
        licensePlate: r.license_plate,
        make: r.make,
        model: r.model,
        currentOdometerKm: r.current_odometer_km,
        currentEngineHours: r.current_engine_hours,
        dailyAvgKm: r.daily_avg_km,
        dailyAvgEngineHours: r.daily_avg_engine_hours,
        targetServiceThreshold: r.target_service_threshold,
        targetTriggerType: r.target_trigger_type,
        remainingKm: r.remaining_km,
        remainingEngineHours: r.remaining_engine_hours,
        estimatedDaysToDue: r.estimated_days_to_due,
        projectedDueDate: r.projected_due_date,
        urgencyLevel: r.urgency_level,
        forecastNarrative: r.forecast_narrative,
        recommendedSlot: typeof r.recommended_slot === 'string' ? JSON.parse(r.recommended_slot) : r.recommended_slot || {},
        operationalImpactScore: r.operational_impact_score,
        status: r.status,
        updatedAt: r.updated_at,
      }));

      const summary = {
        totalForecasts: forecasts.length,
        overdueCount: forecasts.filter((f) => f.urgencyLevel === 'OVERDUE').length,
        dueSoonCount: forecasts.filter((f) => f.urgencyLevel === 'DUE_SOON').length,
        upcomingCount: forecasts.filter((f) => f.urgencyLevel === 'UPCOMING').length,
        normalCount: forecasts.filter((f) => f.urgencyLevel === 'NORMAL').length,
      };

      return NextResponse.json({
        success: true,
        summary,
        forecasts,
      });
    } catch (err: any) {
      console.error('[PM-Agent Forecasts API] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
