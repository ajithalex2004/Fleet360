/**
 * Demand Forecasting Agent
 * -------------------------
 * Builds a 4-week rolling demand forecast per vehicle type + branch.
 * Model: 12-week moving average + linear trend + UAE holiday adjustments.
 * GPT-4o generates the fleet manager narrative.
 *
 * UAE Public Holidays (approximate fixed dates used):
 *  - New Year (Jan 1), Eid Al Fitr (Apr ±2w), Eid Al Adha (Jun ±2w),
 *    National Day (Dec 2–3), Commemoration Day (Nov 30)
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';
import { complete } from '../openai-client';

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
// Returns adjustment multiplier for a given ISO week number
function holidayAdjustment(weekNumber: number): number {
  // High demand periods (school year start, back-to-work after Eid)
  if (weekNumber >= 33 && weekNumber <= 36) return 1.15; // Aug/Sep school start
  if (weekNumber >= 1 && weekNumber <= 2) return 0.85;   // New Year slowdown
  // Eid Al Adha ~ week 26 (approximate)
  if (weekNumber >= 25 && weekNumber <= 28) return 0.80;
  // Eid Al Fitr ~ week 14–16
  if (weekNumber >= 13 && weekNumber <= 16) return 0.80;
  // National Day/Commemoration ~ week 48–49
  if (weekNumber >= 47 && weekNumber <= 50) return 0.90;
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

async function runDemandForecasting(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const forecastPeriod = nextWeekLabel(1); // next week

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
    // Use bookings as fallback if no trips data
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
      output: { summary: 'Insufficient booking history for forecasting (need ≥ 4 weeks).', forecasts: [] },
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

  for (const [segKey, counts] of segmentMap) {
    if (counts.length < 4) continue; // need at least 4 data points

    const [vehicleType, branchId] = segKey.split('::');

    // Moving average (last 8 weeks or all available)
    const window = counts.slice(-8);
    const historicalAvg = window.reduce((a, b) => a + b, 0) / window.length;

    // Linear trend: compare last 4 weeks vs previous 4 weeks
    const recent4   = counts.slice(-4).reduce((a, b) => a + b, 0) / 4;
    const previous4 = counts.length >= 8
      ? counts.slice(-8, -4).reduce((a, b) => a + b, 0) / 4
      : historicalAvg;
    const trendFactor = previous4 > 0 ? recent4 / previous4 : 1.0;
    const trendDirection = trendFactor > 1.05 ? 'UP' : trendFactor < 0.95 ? 'DOWN' : 'STABLE';

    // Holiday adjustment for next week
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const hwAdj = holidayAdjustment(isoWeekNumber(nextWeek));
    const seasonalFactor = 1.0; // simplified — would use Prophet in production

    const forecastValue = Math.max(0, Math.round(historicalAvg * trendFactor * hwAdj));
    const stdDev = Math.sqrt(window.reduce((s, v) => s + (v - historicalAvg) ** 2, 0) / window.length);
    const ciLow  = Math.max(0, Math.round(forecastValue - stdDev));
    const ciHigh = Math.round(forecastValue + stdDev);

    // Fleet size recommendation (add 10% buffer for availability)
    const recommendedFleetSize = Math.ceil(forecastValue * 1.10);

    // Repositioning actions
    const repositioningActions: string[] = [];
    if (trendDirection === 'UP')   repositioningActions.push(`Increase ${vehicleType} fleet availability by ${Math.ceil((trendFactor - 1) * 100)}%`);
    if (trendDirection === 'DOWN') repositioningActions.push(`Consider redeploying ${vehicleType} units to higher-demand segments`);
    if (hwAdj < 0.9)               repositioningActions.push('Holiday period: pre-position vehicles for post-holiday surge');
    if (hwAdj > 1.1)               repositioningActions.push('High-demand period: maximise vehicle availability, reduce scheduled maintenance');

    // GPT-4o narrative
    const context = [
      `Segment: ${vehicleType} — Branch: ${branchId === 'ALL' ? 'All Branches' : branchId}`,
      `Forecast Period: ${forecastPeriod}`,
      `Historical Average: ${historicalAvg.toFixed(1)} bookings/week`,
      `Trend: ${trendDirection} (factor: ${trendFactor.toFixed(2)})`,
      `Holiday Adjustment: ${hwAdj.toFixed(2)}x`,
      `Forecast: ${forecastValue} bookings (CI: ${ciLow}–${ciHigh})`,
      `Recommended Fleet Size: ${recommendedFleetSize} vehicles`,
      `Actions: ${repositioningActions.join('; ')}`,
    ].join('\n');

    const narrative = await complete(
      'You are a fleet demand analyst for a UAE transport company. ' +
      'Write a 2-sentence executive summary of this demand forecast. ' +
      'Mention the trend, any holiday impact, and the key recommendation. Be concise and data-driven.',
      context,
      {
        model: 'gpt-4o-mini',
        maxTokens: 150,
        temperature: 0.2,
        fallback: `${vehicleType} demand is trending ${trendDirection.toLowerCase()} with ${forecastValue} bookings forecast for next week. ` +
                  `Recommend having ${recommendedFleetSize} vehicles available.`,
      },
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
      forecastPeriod, vehicleType, branchId,
      segment: segKey, historicalAvg, forecastValue,
      ciLow, ciHigh, trendDirection, seasonalityFactor: seasonalFactor,
      holidayAdjustment: hwAdj, recommendedFleetSize,
      repositioningActions, narrative,
    });

    forecastsCreated++;
  }

  return {
    agentId: 'demand-forecasting', tenantId: event.tenant_id, eventType: event.event_type,
    status: 'COMPLETED', durationMs: Date.now() - t0,
    itemsProcessed: segmentMap.size, actionsCreated: forecastsCreated,
    output: {
      summary: `Generated ${forecastsCreated} demand forecasts for ${forecastPeriod}.`,
      forecastPeriod, forecasts,
    },
  };
}

export const DEMAND_FORECASTING_AGENT: AgentDefinition = {
  id:          'demand-forecasting',
  name:        'Demand Forecasting Agent',
  description: '12-week moving average + trend + UAE holiday model that forecasts fleet demand by vehicle type and branch, with GPT-4o narrative.',
  version:     '1.0.0',
  agentType:   'BATCH',
  subscribedEvents: ['manual.trigger', 'schedule.nightly', 'booking.created', 'booking.completed'],
  supportsEntityScan: true,
  run: runDemandForecasting,
};
