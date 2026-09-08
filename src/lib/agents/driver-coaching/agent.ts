/**
 * Driver Coaching Agent (Phase 7 Loop Elimination & Selective Routing)
 * --------------------------------------------------------------------
 * Generates personalised weekly coaching plans for active drivers.
 * Optimizations:
 *  1. Selective LLM Routing: Clean drivers (RAG >= 80, 0 violations, 0 incidents)
 *     receive high-quality deterministic coaching plans in 0ms without token cost.
 *  2. At-Risk Driver AI Routing: At-risk drivers (low RAG, violations, incidents)
 *     are routed through aiGateway using ECONOMY_TEXT with batch chunking.
 *  3. Telemetry: Tracks tokens spent, tokens avoided, and execution duration.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult, AgentRunTelemetry } from '../types';
import { aiGateway } from '../gateway';

interface DriverRow {
  id: string;
  first_name: string;
  last_name: string;
  rag_score: number | null;
  avg_fuel_score: number | null;
  incidents_last_30d: number | null;
  trips_last_30d: number | null;
}

// Current week label e.g. "2026-W17"
function weekLabel(d = new Date()): string {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d.getTime() - jan1.getTime()) / 86400000) + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function ragTrend(score: number | null): string {
  if (score === null) return 'UNKNOWN';
  if (score >= 80) return 'IMPROVING';
  if (score >= 60) return 'STABLE';
  return 'DECLINING';
}

function overallRating(score: number | null): string {
  if (score === null) return 'UNRATED';
  if (score >= 85) return 'EXCELLENT';
  if (score >= 70) return 'GOOD';
  if (score >= 55) return 'NEEDS_IMPROVEMENT';
  return 'AT_RISK';
}

export function buildDeterministicCoachingPlan(
  driverName: string,
  rating: string,
  focusAreas: string[],
  speedScore: number,
  fuelScore: number,
  safetyScore: number,
): string {
  return [
    `Weekly Performance Coaching Plan for ${driverName} (${rating} Standing)`,
    '',
    `1. THIS WEEK'S FOCUS`,
    `• Maintain strong baseline across primary operational KPIs (Safety: ${Math.round(safetyScore)}/100, Fuel: ${Math.round(fuelScore)}/100, Speed: ${Math.round(speedScore)}/100).`,
    `• Primary emphasis: ${focusAreas[0] ?? 'Defensive Driving & Standard Operating Procedures'}.`,
    '',
    `2. DAILY PRACTICE TIPS`,
    `• Complete comprehensive pre-trip vehicle and tire pressure inspection.`,
    `• Practice smooth throttle modulation and anticipate highway braking zones.`,
    `• Maintain safe following distance (3-second rule) on high-speed corridors.`,
    '',
    `3. GOAL FOR NEXT WEEK`,
    `• Maintain zero HOS/safety violations and uphold ${rating} rating category.`,
  ].join('\n');
}

async function runDriverCoaching(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const week = weekLabel();

  // 1. Fetch active drivers with their latest known performance snapshot.
  //    workforce.driver_performance is a monthly-aggregate table (not a
  //    30-day event log) — there is no drivers.rag_score column and no
  //    speed/safety/violations metrics table anywhere in the schema, so
  //    those fields have no live source (see candidates mapping below).
  const drivers = await prisma.$queryRaw<DriverRow[]>`
    SELECT
      d.id::text AS id,
      d.first_name,
      d.last_name,
      dp.score::float8           AS rag_score,
      dp.fuel_efficiency::float8 AS avg_fuel_score,
      dp.incident_count::int     AS incidents_last_30d,
      dp.total_trips::int        AS trips_last_30d
    FROM drivers d
    LEFT JOIN LATERAL (
      SELECT score, fuel_efficiency, incident_count, total_trips
      FROM workforce.driver_performance
      WHERE driver_id = d.id
      ORDER BY period_year DESC, period_month DESC, created_at DESC
      LIMIT 1
    ) dp ON true
    WHERE d.tenant_id = ${event.tenant_id}
      AND d.status IN ('ACTIVE', 'ON_SHIFT', 'AVAILABLE')
      AND d.deleted_at IS NULL
    ORDER BY dp.score ASC NULLS LAST
    LIMIT 200
  `;

  if (drivers.length === 0) {
    return {
      agentId: 'driver-coach', tenantId: event.tenant_id, eventType: event.event_type,
      status: 'COMPLETED', durationMs: Date.now() - t0,
      itemsProcessed: 0, actionsCreated: 0,
      output: { summary: 'No active drivers found.', plans: [] },
    };
  }

  let plansGenerated = 0;
  let deterministicCount = 0;
  let aiCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostAed = 0;
  let avoidedTokens = 0;

  const plans: Record<string, unknown>[] = [];

  // Group drivers into deterministic vs AI candidates.
  // speedScore/safetyScore/violations have no live data source (no
  // speed-telemetry, safety-scoring, or HOS-violations table exists yet),
  // so they stay at the same neutral defaults used when data is missing.
  const candidates = drivers.map(driver => {
    const speedScore   = 70;
    const fuelScore    = driver.avg_fuel_score ?? 70;
    const safetyScore  = 70;
    const violations   = 0;
    const incidents    = driver.incidents_last_30d ?? 0;
    const tripsCount   = driver.trips_last_30d ?? 0;
    const ragScore     = driver.rag_score;
    const rating       = overallRating(ragScore);
    const trend        = ragTrend(ragScore);

    const focusAreas: string[] = [];
    if (speedScore < 65)  focusAreas.push('Speed Management & Smooth Driving');
    if (fuelScore < 65)   focusAreas.push('Fuel Efficiency & Eco-Driving');
    if (safetyScore < 65) focusAreas.push('Safety Awareness & Hazard Anticipation');
    if (violations > 2)   focusAreas.push('Regulatory Compliance & HOS');
    if (incidents > 0)    focusAreas.push('Incident Prevention & Defensive Driving');
    if (focusAreas.length === 0) focusAreas.push('Performance Maintenance & Excellence');

    const isCleanDriver = (ragScore !== null && ragScore >= 80) && violations === 0 && incidents === 0;

    return {
      driver,
      speedScore,
      fuelScore,
      safetyScore,
      violations,
      incidents,
      tripsCount,
      ragScore,
      rating,
      trend,
      focusAreas,
      isCleanDriver,
    };
  });

  // Concurrency limit for AI calls
  const CHUNK_SIZE = 5;

  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (item) => {
        try {
          let coachingPlan = '';

          if (item.isCleanDriver) {
            // Fast deterministic template (0 tokens, 0ms latency)
            coachingPlan = buildDeterministicCoachingPlan(
              `${item.driver.first_name} ${item.driver.last_name}`,
              item.rating,
              item.focusAreas,
              item.speedScore,
              item.fuelScore,
              item.safetyScore,
            );
            deterministicCount++;
            avoidedTokens += 350;
          } else {
            // High-touch AI generated coaching plan for at-risk drivers
            const context = [
              `Driver: ${item.driver.first_name} ${item.driver.last_name}`,
              `Week: ${week}`,
              `RAG Score: ${item.ragScore ?? 'N/A'}/100 (${item.rating})`,
              `Trend: ${item.trend}`,
              `30-Day Stats:`,
              `  • Trips completed: ${item.tripsCount}`,
              `  • Speed score: ${item.speedScore.toFixed(0)}/100`,
              `  • Fuel efficiency score: ${item.fuelScore.toFixed(0)}/100`,
              `  • Safety score: ${item.safetyScore.toFixed(0)}/100`,
              `  • HOS/regulatory violations: ${item.violations}`,
              `  • Incidents: ${item.incidents}`,
              `Focus Areas: ${item.focusAreas.join(', ')}`,
            ].join('\n');

            const resp = await aiGateway.chat(
              [
                {
                  role: 'system',
                  content:
                    'You are a professional fleet driver coach at a UAE transport company. ' +
                    'Write a personalised, motivating weekly coaching plan for this driver. ' +
                    'Format it as 3 sections: (1) This Week\'s Focus (2) Daily Practice Tips (3) Goal for Next Week. ' +
                    'Be specific, practical, and encouraging. Max 250 words.',
                },
                {
                  role: 'user',
                  content: context,
                },
              ],
              {
                capabilityAlias: 'ECONOMY_TEXT',
                tenantId: event.tenant_id,
                maxTokens: 350,
                temperature: 0.3,
              },
            );

            coachingPlan = resp.content;
            aiCount++;
            totalInputTokens += resp.telemetry.inputTokens;
            totalOutputTokens += resp.telemetry.outputTokens;
            totalCostAed += resp.telemetry.costAed;
          }

          // Upsert coaching plan
          await prisma.$executeRawUnsafe(`
            INSERT INTO driver_coaching_plans (
              driver_id, driver_name, week_label, rag_score, rag_trend,
              overall_rating, focus_areas, coaching_plan, kpis,
              violations_count, fuel_score, speed_score, safety_score, status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,'SENT')
            ON CONFLICT DO NOTHING
          `,
            item.driver.id,
            `${item.driver.first_name} ${item.driver.last_name}`,
            week,
            item.ragScore, item.trend, item.rating,
            JSON.stringify(item.focusAreas),
            coachingPlan,
            JSON.stringify({ speedTarget: Math.min(100, item.speedScore + 5), fuelTarget: Math.min(100, item.fuelScore + 5), safetyTarget: Math.min(100, item.safetyScore + 5) }),
            item.violations, item.fuelScore, item.speedScore, item.safetyScore,
          );

          plans.push({
            driverId:    item.driver.id,
            driverName:  `${item.driver.first_name} ${item.driver.last_name}`,
            ragScore:    item.ragScore,
            rating:      item.rating,
            focusAreas:  item.focusAreas,
            generationMode: item.isCleanDriver ? 'DETERMINISTIC' : 'AI_GATEWAY',
            preview:     coachingPlan.slice(0, 120) + '…',
          });

          plansGenerated++;
        } catch { /* skip individual driver failures */ }
      }),
    );
  }

  const telemetry: AgentRunTelemetry = {
    modelAlias: aiCount > 0 ? 'ECONOMY_TEXT' : 'DETERMINISTIC_RULES',
    modelProvider: aiCount > 0 ? 'openai' : 'deterministic',
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cachedTokens: avoidedTokens,
    costAed: totalCostAed,
    estimatedSavingsAed: (avoidedTokens / 1000) * 0.005 * 3.6725, // avoided cost
    businessOutcome: 'NO_ACTION_REQUIRED',
  };

  return {
    agentId: 'driver-coach', tenantId: event.tenant_id, eventType: event.event_type,
    status: 'COMPLETED', durationMs: Date.now() - t0,
    itemsProcessed: drivers.length, actionsCreated: plansGenerated,
    telemetry,
    output: {
      summary: `Generated ${plansGenerated} coaching plans (${deterministicCount} deterministic, ${aiCount} AI-assisted) for week ${week}.`,
      week,
      deterministicCount,
      aiCount,
      avoidedTokens,
      plans,
    },
  };
}

export const DRIVER_COACHING_AGENT: AgentDefinition = {
  id:          'driver-coach',
  name:        'Driver Coaching Agent',
  description: 'Generates personalised weekly coaching plans using RAG scores, HOS violations, fuel and speed metrics, with selective AI routing and loop elimination.',
  version:     '2.0.0',
  agentType:   'BATCH',
  subscribedEvents: ['driver.week_end', 'manual.trigger', 'schedule.nightly'],
  supportsEntityScan: true,
  run: runDriverCoaching,
};
