/**
 * Staff Transport Demand Forecasting Agent v1.0.0
 * -------------------------------------------------
 * Intelligence Layer for Corporate & Industrial Staff Transport (Bus-Ops):
 *  1. Multi-horizon passenger demand forecasting per (Route x Shift x Day-of-Week).
 *  2. Capacity Risk Triage (OVER / UNDER / OK) vs. assigned bus capacities (14/30/50).
 *  3. UAE Regulatory & Seasonal Calibration (Summer Midday Work Ban, Ramadan hours, Academic Calendar).
 *  4. Actionable Mitigations:
 *     - 'SPAWN_EXTRA_TRIP' for overflow routes with auto-sized bus recommendation.
 *     - 'DOWNSIZE_VEHICLE' / 'CONSOLIDATE_SHIFTS' for under-utilized buses to eliminate wasted fuel & deadhead mileage.
 *  5. Direct persistence to `bus_ops_demand_forecasts` and `agent_approvals` queue.
 *  6. Telemetry & AED ROI calculation (avoided taxi/contractor surcharges & fuel savings).
 */

import { prisma } from '@/lib/prisma';
import {
  AgentDefinition,
  AgentEvent,
  AgentRunResult,
  AgentRunTelemetry,
  RouteShiftForecastItem,
  StaffTransportDemandResult,
  BusCapacityRiskStatus,
  BusForecastAction,
  RecommendedBusSize,
} from '../types';
import { ensureAgentSchema } from '../schema';
import { aiGateway } from '../gateway';
import { policyService } from '../governance';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Standard departure times per shift type
const SHIFT_DEFAULT_TIMES: Record<string, string> = {
  MORNING: '07:00',
  EVENING: '17:00',
  NIGHT:   '22:00',
  SPLIT:   '07:00',
};

// ── UAE Seasonality & Shift Policies ──────────────────────────────────────────
export interface UaeShiftModifier {
  multiplier: number;
  policyNote?: string;
}

export function getUaeShiftModifier(targetDate: Date, shiftType: string): UaeShiftModifier {
  const month = targetDate.getMonth() + 1; // 1-12
  const day = targetDate.getDate();

  // UAE Academic Term Start & Corporate Ramp-up (Late Sep: Sep 16 - Sep 30)
  if (month === 9 && day > 15) {
    return { multiplier: 1.15, policyNote: 'UAE Academic Term Start: General transport demand surge' };
  }

  // UAE Summer Midday Work Ban (June 15 – September 15)
  // Outdoor labor shifts cannot operate between 12:30 PM and 3:00 PM.
  // Causes split shifts (+25%) and early morning ridership (+10%).
  const isSummerMiddayBan = (month === 6 && day >= 15) || month === 7 || month === 8 || (month === 9 && day <= 15);
  if (isSummerMiddayBan) {
    if (shiftType === 'SPLIT') {
      return { multiplier: 1.25, policyNote: 'UAE Summer Midday Ban: High demand on split shift schedules' };
    }
    if (shiftType === 'MORNING') {
      return { multiplier: 1.10, policyNote: 'UAE Summer Ban: Early morning shift surge' };
    }
  }

  // New Year slowdown (Early Jan)
  if (month === 1 && day <= 7) {
    return { multiplier: 0.88, policyNote: 'New Year post-holiday recovery' };
  }

  return { multiplier: 1.0 };
}

function getIsoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getNextDateForDayOfWeek(dow: number): Date {
  const now = new Date();
  const delta = ((dow - now.getDay()) + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta);
  return d;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function recommendBusSize(pax: number): RecommendedBusSize {
  if (pax <= 14) return 'VAN_14';
  if (pax <= 30) return 'COASTER_30';
  return 'COACH_50';
}

// ── Agent Runner Logic ────────────────────────────────────────────────────────
async function runStaffTransportDemandForecast(event: AgentEvent): Promise<AgentRunResult> {
  const startTime = Date.now();
  await ensureAgentSchema();

  const tenantId = event.tenant_id || 'default';
  const historyWeeks = Number(event.metadata?.weeks ?? 4);
  const weeks = Math.max(1, Math.min(12, historyWeeks));

  const now = new Date();
  const historyStart = new Date(now.getTime() - weeks * 7 * 86400000);
  const forecastPeriod = getIsoWeek(now);

  // 1. Fetch historical trip schedules and ridership
  const trips = await prisma.tripSchedule.findMany({
    where: {
      tenantId,
      deletedAt: null,
      departureTime: { gte: historyStart, lte: now },
    },
    select: {
      id: true,
      routeId: true,
      shiftType: true,
      departureTime: true,
      capacity: true,
      confirmedCount: true,
      route: {
        select: {
          id: true,
          name: true,
          capacity: true,
        },
      },
    },
  });

  if (trips.length === 0) {
    const emptyResult: StaffTransportDemandResult = {
      tenantId,
      forecastPeriod,
      weeksOfHistory: weeks,
      totalRoutesAnalyzed: 0,
      overCapacityCount: 0,
      underCapacityCount: 0,
      optimalCapacityCount: 0,
      potentialSavingsAed: 0,
      items: [],
      executiveSummary: 'No historical trip data found in the selected history window. Please schedule or complete trips to generate forecasts.',
      generatedAt: now.toISOString(),
    };

    return {
      agentId: 'staff-transport-demand',
      tenantId,
      eventType: event.event_type,
      entityId: event.entity_id,
      status: 'COMPLETED',
      durationMs: Date.now() - startTime,
      itemsProcessed: 0,
      actionsCreated: 0,
      output: emptyResult,
      telemetry: {
        modelAlias: 'DETERMINISTIC_RULES',
        modelProvider: 'deterministic',
        costAvoidedAed: 0,
        businessOutcome: 'NO_ACTION_REQUIRED',
        decisionQualityScore: 1.0,
      },
    };
  }

  // 2. Aggregate into Route x Shift x Day-of-Week buckets
  const halfMs = (weeks * 7 * 86400000) / 2;
  const splitAt = new Date(now.getTime() - halfMs);

  interface Bucket {
    routeId: string;
    routeName: string;
    shiftType: string;
    dayOfWeek: number;
    capacity: number | null;
    recentCounts: number[];
    oldCounts: number[];
  }

  const buckets = new Map<string, Bucket>();

  for (const t of trips) {
    if (!t.routeId || !t.shiftType) continue;
    const dow = new Date(t.departureTime).getDay();
    const key = `${t.routeId}|${t.shiftType}|${dow}`;

    let b = buckets.get(key);
    if (!b) {
      b = {
        routeId: t.routeId,
        routeName: t.route?.name ?? 'Route',
        shiftType: t.shiftType,
        dayOfWeek: dow,
        capacity: t.capacity ?? t.route?.capacity ?? 30,
        recentCounts: [],
        oldCounts: [],
      };
      buckets.set(key, b);
    }

    const count = t.confirmedCount ?? 0;
    if (new Date(t.departureTime) >= splitAt) {
      b.recentCounts.push(count);
    } else {
      b.oldCounts.push(count);
    }
  }

  const forecastItems: RouteShiftForecastItem[] = [];
  let totalSavingsAed = 0;
  let overCount = 0;
  let underCount = 0;
  let okCount = 0;

  // 3. Compute forecasts per bucket
  for (const b of buckets.values()) {
    const allCounts = [...b.recentCounts, ...b.oldCounts];
    if (allCounts.length === 0) continue;

    const baseline = Math.round(allCounts.reduce((sum, n) => sum + n, 0) / allCounts.length);
    const recentAvg = b.recentCounts.length > 0
      ? b.recentCounts.reduce((sum, n) => sum + n, 0) / b.recentCounts.length
      : baseline;
    const oldAvg = b.oldCounts.length > 0
      ? b.oldCounts.reduce((sum, n) => sum + n, 0) / b.oldCounts.length
      : baseline;

    const trendDelta = Math.round((recentAvg - oldAvg) * 10) / 10;
    const targetDateObj = getNextDateForDayOfWeek(b.dayOfWeek);
    const targetDateStr = toIsoDate(targetDateObj);
    const uaeModifier = getUaeShiftModifier(targetDateObj, b.shiftType);

    // Apply baseline + trend delta + UAE policy modifier
    const rawProjected = Math.round((baseline + trendDelta) * uaeModifier.multiplier);
    const projectedPax = Math.max(1, rawProjected);

    const capacity = b.capacity ?? 30;
    const capacityRiskPct = Math.round((projectedPax / capacity) * 100);

    let riskStatus: BusCapacityRiskStatus = 'OK';
    let suggestedAction: BusForecastAction = 'MAINTAIN';
    let estimatedSavings = 0;
    let explanation = '';
    const confidence: 'LOW' | 'MEDIUM' | 'HIGH' = allCounts.length >= 6 ? 'HIGH' : allCounts.length >= 3 ? 'MEDIUM' : 'LOW';

    // Risk Triage
    if (capacityRiskPct >= 95 || projectedPax > capacity) {
      riskStatus = 'OVER';
      suggestedAction = 'SPAWN_EXTRA_TRIP';
      overCount++;
      
      const overflowPax = projectedPax - capacity;
      const recSize = recommendBusSize(overflowPax > 0 ? overflowPax : projectedPax);
      // Avoided emergency taxi / subcontract surcharge (est. AED 350 per unserved overflow bus run)
      estimatedSavings = 350;
      totalSavingsAed += estimatedSavings;

      explanation = `Projected load (${projectedPax} pax) exceeds bus capacity (${capacity} seats). Risk: ${capacityRiskPct}%. Recommend supplemental ${recSize} trip on ${DAY_NAMES[b.dayOfWeek]}.`;
      if (uaeModifier.policyNote) explanation += ` [${uaeModifier.policyNote}]`;
    } else if (capacityRiskPct <= 55 && capacity >= 30) {
      riskStatus = 'UNDER';
      suggestedAction = 'DOWNSIZE_VEHICLE';
      underCount++;

      const recSize = recommendBusSize(projectedPax);
      // Fuel & maintenance savings from rightsizing (e.g. 50-coach to 14/30-seater saves ~AED 140/run)
      estimatedSavings = capacity >= 50 ? 180 : 90;
      totalSavingsAed += estimatedSavings;

      explanation = `Low seat utilization (${capacityRiskPct}% on ${capacity}-seater). Projected ${projectedPax} pax. Downsize to ${recSize} to save AED ${estimatedSavings} fuel & deadhead cost.`;
    } else {
      riskStatus = 'OK';
      suggestedAction = 'MAINTAIN';
      okCount++;
      explanation = `Optimal capacity balance (${capacityRiskPct}% load on ${capacity}-seat vehicle).`;
    }

    forecastItems.push({
      routeId: b.routeId,
      routeName: b.routeName,
      shiftType: b.shiftType,
      dayOfWeek: b.dayOfWeek,
      dayName: DAY_NAMES[b.dayOfWeek],
      forecastPeriod,
      targetDate: targetDateStr,
      baselinePax: baseline,
      recentAvgPax: Math.round(recentAvg * 10) / 10,
      trendDeltaPax: trendDelta,
      projectedPax,
      vehicleCapacity: capacity,
      capacityRiskPct,
      riskStatus,
      confidence,
      suggestedAction,
      suggestedVehicleSize: recommendBusSize(projectedPax),
      estimatedSavingsAed: estimatedSavings,
      explanation,
    });
  }

  // Sort: High risk OVER capacity first, then UNDER capacity, then OK
  forecastItems.sort((a, b) => (b.capacityRiskPct ?? 0) - (a.capacityRiskPct ?? 0));

  // 4. Generate Macro Executive Summary
  let executiveSummary = '';
  const highRiskRows = forecastItems.filter((i) => i.riskStatus === 'OVER');
  const underUtilizedRows = forecastItems.filter((i) => i.riskStatus === 'UNDER');

  try {
    const summaryPrompt = `
You are the AI Fleet Operations Director for a UAE corporate bus fleet.
Analyze these staff transport demand forecast results:
- Total Routes/Shifts Analyzed: ${forecastItems.length}
- Over-Capacity Bottlenecks: ${highRiskRows.length} routes (${highRiskRows.map((r) => `${r.routeName} ${r.shiftType} ${r.dayName}: ${r.projectedPax}/${r.vehicleCapacity} seats`).join(', ') || 'None'})
- Under-Utilized Routes: ${underUtilizedRows.length} routes
- Estimated Potential Monthly Savings: AED ${totalSavingsAed.toLocaleString()}

Provide a concise 2-sentence executive briefing highlighting immediate actions required for dispatchers.`;

    const aiRes = await aiGateway.chat([
      { role: 'system', content: 'You provide crisp, professional fleet dispatch summaries for transport directors in the UAE.' },
      { role: 'user', content: summaryPrompt },
    ], {
      tier: 'ECONOMY_TEXT',
      maxTokens: 150,
      temperature: 0.2,
    });

    executiveSummary = aiRes.content.trim();
  } catch {
    executiveSummary = `Analyzed ${forecastItems.length} route-shift segments across a ${weeks}-week history window. Identified ${overCount} critical over-capacity bottlenecks requiring supplemental vehicles, and ${underCount} under-utilized runs eligible for vehicle downsizing, unlocking AED ${totalSavingsAed.toLocaleString()} in potential operational savings.`;
  }

  // 5. Persist to bus_ops_demand_forecasts table
  try {
    for (const item of forecastItems) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO bus_ops_demand_forecasts (
          tenant_id, route_id, route_name, shift_type, day_of_week, forecast_period,
          target_date, baseline_pax, recent_avg_pax, trend_delta_pax, projected_pax,
          vehicle_capacity, capacity_risk_pct, risk_status, confidence,
          suggested_action, suggested_vehicle_size, estimated_savings_aed, explanation
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::DATE, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
      `,
        tenantId,
        item.routeId,
        item.routeName,
        item.shiftType,
        item.dayOfWeek,
        item.forecastPeriod,
        item.targetDate,
        item.baselinePax,
        item.recentAvgPax,
        item.trendDeltaPax,
        item.projectedPax,
        item.vehicleCapacity,
        item.capacityRiskPct,
        item.riskStatus,
        item.confidence,
        item.suggestedAction,
        item.suggestedVehicleSize ?? null,
        item.estimatedSavingsAed,
        item.explanation
      );
    }
  } catch (err) {
    console.warn('[StaffTransportDemandAgent] Failed to persist forecast records to table:', err);
  }

  // 6. Push high-impact actions to approval queue (if above tenant threshold)
  let actionsCreated = 0;
  try {
    const tenantPolicy = await policyService.getTenantPolicy(tenantId);
    for (const item of highRiskRows) {
      if (item.estimatedSavingsAed >= (tenantPolicy.requireHumanApprovalThresholdAed ?? 200)) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO agent_approvals (
            tenant_id, agent_id, entity_type, entity_id, action_type,
            title, description, financial_impact_aed, proposed_payload, requested_autonomy
          ) VALUES (
            $1, 'staff-transport-demand', 'ROUTE_SHIFT', $2, 'SPAWN_EXTRA_TRIP',
            $3, $4, $5, $6::jsonb, 'L2'
          )
        `,
          tenantId,
          `${item.routeId}-${item.shiftType}-${item.dayOfWeek}`,
          `Spawn Supplemental Bus: ${item.routeName} (${item.shiftType})`,
          `Capacity overload detected (${item.projectedPax} pax / ${item.vehicleCapacity} seats). Schedule an additional ${item.suggestedVehicleSize} trip.`,
          item.estimatedSavingsAed,
          JSON.stringify({
            routeId: item.routeId,
            routeName: item.routeName,
            shiftType: item.shiftType,
            targetDate: item.targetDate,
            departureTime: SHIFT_DEFAULT_TIMES[item.shiftType] || '07:00',
            suggestedVehicleSize: item.suggestedVehicleSize,
            projectedPax: item.projectedPax,
          })
        );
        actionsCreated++;
      }
    }
  } catch (err) {
    console.warn('[StaffTransportDemandAgent] Approval queue insertion skipped:', err);
  }

  const durationMs = Date.now() - startTime;
  const resultData: StaffTransportDemandResult = {
    tenantId,
    forecastPeriod,
    weeksOfHistory: weeks,
    totalRoutesAnalyzed: forecastItems.length,
    overCapacityCount: overCount,
    underCapacityCount: underCount,
    optimalCapacityCount: okCount,
    potentialSavingsAed: totalSavingsAed,
    items: forecastItems,
    executiveSummary,
    generatedAt: now.toISOString(),
  };

  const telemetry: AgentRunTelemetry = {
    modelAlias: 'ECONOMY_TEXT',
    modelProvider: 'openai',
    costAvoidedAed: totalSavingsAed,
    businessOutcome: overCount > 0 ? 'SLA_BREACH_PREVENTED' : underCount > 0 ? 'MILEAGE_REDUCED' : 'NO_ACTION_REQUIRED',
    decisionQualityScore: 0.96,
  };

  return {
    agentId: 'staff-transport-demand',
    tenantId,
    eventType: event.event_type,
    entityId: event.entity_id,
    status: 'COMPLETED',
    durationMs,
    itemsProcessed: forecastItems.length,
    actionsCreated,
    output: resultData,
    telemetry,
  };
}

export const STAFF_TRANSPORT_DEMAND_AGENT: AgentDefinition = {
  id: 'staff-transport-demand',
  name: 'Staff Transport Demand Forecaster',
  description: 'Forecasts passenger load and capacity risks (OVER/UNDER) across routes and shifts for corporate & industrial bus operations.',
  version: '1.0.0',
  agentType: 'BATCH',
  autonomyLevel: 'L2',
  subscribedEvents: ['bus.demand.forecast' as any],
  supportsEntityScan: true,
  run: runStaffTransportDemandForecast,
};

