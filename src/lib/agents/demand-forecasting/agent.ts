/**
 * Demand Forecasting Agent (Phase 7 Loop Elimination & Macro Executive Summary)
 * -----------------------------------------------------------------------------
 * Builds 4-week rolling demand forecasts per vehicle type + branch.
 * Optimizations:
 *  1. Loop Elimination: Eliminates per-segment LLM calls. All segment narratives
 *     are generated with deterministic statistical precision in 0ms without token usage.
 *  2. Consolidated Executive Summary: Generates a single fleet-wide macro narrative
 *     per forecast run using aiGateway ECONOMY_TEXT rather than hundreds of loops.
 *  3. Telemetry: Tracks token savings and avoided costs in AED.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult, AgentRunTelemetry } from '../types';
import { aiGateway } from '../gateway';

interface WeeklyDemand {
  week: string;
  vehicleType: string | null;
  branchId: string | null;
  count: number;
}

interface ForecastOutput {
  forecastPeriod: string;
  vehicleType: string | null;
  branchId: string | null;
  segment: string;
  historicalAvg: number;
  forecastValue: number;
  ciLow: number;
  ciHigh: number;
  trendDirection: string;
  seasonalityFactor: number;
  holidayAdjustment: number;
  recommendedFleetSize: number;
  repositioningActions: string[];
  narrative: string;
}

// ── UAE Holiday Adjustment ─────────────────────────────────────────────────────
function holidayAdjustment(weekNumber: number): number {
  if (weekNumber >= 33 && weekNumber <= 36) return 1.15; // Aug/Sep school start
  if (weekNumber >= 1 && weekNumber <= 2) return 0.85;   // New Year slowdown
  if (weekNumber >= 25 && weekNumber <= 28) return 0.80;  // Eid Al Adha
  if (weekNumber >= 13 && weekNumber <= 16) return 0.80;  // Eid Al Fitr
  if (weekNumber >= 47 && weekNumber <= 50) return 0.90;  // National Day / Commemoration
  return 1.0;
}

function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function nextWeekLabel(weeksFromNow = 1): string {
  const d = new Date();
  d.setDate(d.getDate() + weeksFromNow * 7);
  const year = d.getFullYear();
  const week = isoWeekNumber(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function buildDeterministicDemandNarrative(
  vehicleType: string,
  branchId: string | null,
  forecastValue: number,
  trendDirection: string,
  recommendedFleetSize: number,
  hwAdj: number,
): string {
  const branchLabel = branchId && branchId !== 'ALL' ? `for branch ${branchId}` : 'across all operational hubs';
  const holidayNote = hwAdj > 1.05
    ? ' Seasonal holiday surge expected.'
    : hwAdj < 0.95
    ? ' Seasonal holiday slowdown factored in.'
    : '';

  return `${vehicleType} demand is trending ${trendDirection.toLowerCase()} ${branchLabel} with ${forecastValue} bookings forecast next week.${holidayNote} ` +
         `Recommended target fleet readiness is ${recommendedFleetSize} available units.`;
}

async function runDemandForecasting(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const forecastPeriod = nextWeekLabel(1);

  // 1. Pull 12 weeks of booking demand by vehicle type + branch
  const weeklyData = await prisma.$queryRaw<WeeklyDemand[]>`
    SELECT
      TO_CHAR(DATE_TRUNC('week', t.created_at), 'IYYY-"W"IW') AS week,
      v.vehicle_type,
      v.branch_id::text,
      COUNT(*)::int AS count
    FROM trips t
    JOIN vehicles v ON v.id = t.vehicle_id::uuid
    WHERE t.created_at >= NOW() - INTERVAL '12 weeks'
      AND t.status IN ('COMPLETED', 'IN_PROGRESS')
    GROUP BY 1, 2, 3
    ORDER BY 1
  `.catch(() => [] as WeeklyDemand[]);

  if (weeklyData.length === 0) {
    const bookingData = await prisma.$queryRaw<WeeklyDemand[]>`
      SELECT
        TO_CHAR(DATE_TRUNC('week', b.created_at), 'IYYY-"W"IW') AS week,
        b.service_type AS vehicle_type,
        NULL AS branch_id,
        COUNT(*)::int AS count
      FROM dispatch_jobs b
      WHERE b.created_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY 1, 2, 3
      ORDER BY 1
    `.catch(() => [] as WeeklyDemand[]);

    weeklyData.push(...bookingData);
  }

  if (weeklyData.length === 0) {
    return {
      agentId: 'demand-forecasting', tenantId: event.tenant_id, eventType: event.event_type,
      status: 'COMPLETED', durationMs: Date.now() - t0,
      itemsProcessed: 0, actionsCreated: 0,
      output: { summary: 'Insufficient booking history for forecasting (need >= 4 weeks).', forecasts: [] },
    };
  }

  // 2. Group by segment (vehicle_type + branch_id)
  const segmentMap = new Map<string, number[]>();
  for (const row of weeklyData) {
    const key = `${row.vehicleType ?? 'ALL'}::${row.branchId ?? 'ALL'}`;
    if (!segmentMap.has(key)) segmentMap.set(key, []);
    segmentMap.get(key)!.push(row.count);
  }

  const forecasts: ForecastOutput[] = [];
  let forecastsCreated = 0;
  const avoidedTokens = segmentMap.size * 200; // ~200 tokens avoided per segment

  for (const [segKey, counts] of segmentMap) {
    if (counts.length < 4) continue;

    const [vehicleType, branchId] = segKey.split('::');

    const window = counts.slice(-8);
    const historicalAvg = window.reduce((a, b) => a + b, 0) / window.length;

    const recent4   = counts.slice(-4).reduce((a, b) => a + b, 0) / 4;
    const previous4 = counts.length >= 8
      ? counts.slice(-8, -4).reduce((a, b) => a + b, 0) / 4
      : historicalAvg;
    const trendFactor = previous4 > 0 ? recent4 / previous4 : 1.0;
    const trendDirection = trendFactor > 1.05 ? 'UP' : trendFactor < 0.95 ? 'DOWN' : 'STABLE';

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const hwAdj = holidayAdjustment(isoWeekNumber(nextWeek));
    const seasonalFactor = 1.0;

    const forecastValue = Math.max(0, Math.round(historicalAvg * trendFactor * hwAdj));
    const stdDev = Math.sqrt(window.reduce((s, v) => s + (v - historicalAvg) ** 2, 0) / window.length);
    const ciLow  = Math.max(0, Math.round(forecastValue - stdDev));
    const ciHigh = Math.round(forecastValue + stdDev);

    const recommendedFleetSize = Math.ceil(forecastValue * 1.10);

    const repositioningActions: string[] = [];
    if (trendDirection === 'UP')   repositioningActions.push(`Increase ${vehicleType} fleet availability by ${Math.ceil((trendFactor - 1) * 100)}%`);
    if (trendDirection === 'DOWN') repositioningActions.push(`Consider redeploying ${vehicleType} units to higher-demand segments`);
    if (hwAdj < 0.9)               repositioningActions.push('Holiday period: pre-position vehicles for post-holiday surge');
    if (hwAdj > 1.1)               repositioningActions.push('High-demand period: maximise vehicle availability, reduce scheduled maintenance');

    // Deterministic narrative generation (0 tokens, 0ms latency)
    const narrative = buildDeterministicDemandNarrative(
      vehicleType,
      branchId,
      forecastValue,
      trendDirection,
      recommendedFleetSize,
      hwAdj,
    );

    // Upsert to demand_forecasts
    await prisma.$executeRawUnsafe(`
      INSERT INTO demand_forecasts (
        forecast_period, vehicle_type, branch_id, segment,
        historical_avg, forecast_value, confidence_interval_low, confidence_interval_high,
        trend_direction, seasonality_factor, holiday_adjustment,
        recommended_fleet_size, repositioning_actions, narrative, model_used
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,'MOVING_AVG_TREND')
      ON CONFLICT (forecast_period, segment, vehicle_type, branch_id) DO UPDATE SET
        historical_avg           = EXCLUDED.historical_avg,
        forecast_value           = EXCLUDED.forecast_value,
        confidence_interval_low  = EXCLUDED.confidence_interval_low,
        confidence_interval_high = EXCLUDED.confidence_interval_high,
        trend_direction          = EXCLUDED.trend_direction,
        seasonality_factor       = EXCLUDED.seasonality_factor,
        holiday_adjustment       = EXCLUDED.holiday_adjustment,
        recommended_fleet_size   = EXCLUDED.recommended_fleet_size,
        repositioning_actions    = EXCLUDED.repositioning_actions,
        narrative                = EXCLUDED.narrative
    `,
      forecastPeriod,
      vehicleType === 'ALL' ? null : vehicleType,
      branchId === 'ALL' ? null : branchId,
      segKey,
      historicalAvg, forecastValue, ciLow, ciHigh,
      trendDirection, seasonalFactor, hwAdj,
      recommendedFleetSize,
      JSON.stringify(repositioningActions),
      narrative,
    );

    forecasts.push({
      forecastPeriod,
      vehicleType: vehicleType === 'ALL' ? null : vehicleType,
      branchId: branchId === 'ALL' ? null : branchId,
      segment: segKey,
      historicalAvg,
      forecastValue,
      ciLow,
      ciHigh,
      trendDirection,
      seasonalityFactor: seasonalFactor,
      holidayAdjustment: hwAdj,
      recommendedFleetSize,
      repositioningActions,
      narrative,
    });

    forecastsCreated++;
  }

  // 3. Generate Single Consolidated Fleet Executive Summary (1 API call instead of 500)
  let executiveSummary = `Generated ${forecastsCreated} demand forecasts for period ${forecastPeriod}.`;
  let aiTokensUsed = 0;
  let aiCostAed = 0;

  if (forecastsCreated > 0) {
    try {
      const topSegments = forecasts.slice(0, 5).map(f =>
        `- ${f.segment}: ${f.forecastValue} bookings (${f.trendDirection} trend, target fleet: ${f.recommendedFleetSize})`
      ).join('\n');

      const macroResp = await aiGateway.chat({
        capability: 'ECONOMY_TEXT',
        tenantId: event.tenant_id,
        agentId: 'demand-forecasting',
        messages: [
          {
            role: 'system',
            content: 'You are an executive fleet demand analyst for a UAE transport operator. Write a 2-sentence macro demand forecast summary.',
          },
          {
            role: 'user',
            content: `Forecast Period: ${forecastPeriod}\nTotal Segments: ${forecastsCreated}\nTop Segments:\n${topSegments}`,
          },
        ],
        maxTokens: 150,
      });

      executiveSummary = macroResp.content;
      aiTokensUsed = macroResp.telemetry.inputTokens + macroResp.telemetry.outputTokens;
      aiCostAed = macroResp.telemetry.costAed;
    } catch {
      // Graceful fallback to deterministic summary
      executiveSummary = `Demand forecast for ${forecastPeriod} complete across ${forecastsCreated} fleet segments with moving average and holiday trend models.`;
    }
  }

  const telemetry: AgentRunTelemetry = {
    modelAlias: 'ECONOMY_TEXT',
    modelProvider: 'openai',
    inputTokens: aiTokensUsed,
    outputTokens: 0,
    cachedTokens: avoidedTokens,
    costAed: aiCostAed,
    estimatedSavingsAed: (avoidedTokens / 1000) * 0.005 * 3.6725,
    businessOutcome: 'NO_ACTION_REQUIRED',
  };

  return {
    agentId: 'demand-forecasting', tenantId: event.tenant_id, eventType: event.event_type,
    status: 'COMPLETED', durationMs: Date.now() - t0,
    itemsProcessed: weeklyData.length, actionsCreated: forecastsCreated,
    telemetry,
    output: {
      summary: executiveSummary,
      forecastPeriod,
      totalForecasts: forecastsCreated,
      avoidedLoopCalls: forecastsCreated > 0 ? forecastsCreated - 1 : 0,
      forecasts,
    },
  };
}

export const DEMAND_FORECASTING_AGENT: AgentDefinition = {
  id:          'demand-forecasting',
  name:        'Demand Forecasting Agent',
  description: '12-week moving average + trend + UAE holiday model that forecasts fleet demand with deterministic segment narratives and consolidated macro summary.',
  version:     '2.0.0',
  agentType:   'BATCH',
  subscribedEvents: ['booking.completed', 'manual.trigger', 'schedule.nightly'],
  supportsEntityScan: false,
  run: runDemandForecasting,
};
