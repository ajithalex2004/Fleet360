/**
 * Driver Coaching Agent
 * ----------------------
 * Generates a personalised weekly coaching plan for every active driver.
 * Data sources: driver performance, fuel logs, speed events, HOS violations.
 * GPT-4o produces the coaching narrative.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';
import { complete } from '../openai-client';

interface DriverRow {
  id: string;
  first_name: string;
  last_name: string;
  employee_id: string | null;
  rag_score: number | null;
  rag_status: string | null;
}

interface PerfRow {
  driver_id: string;
  avg_speed_score: number | null;
  avg_fuel_score: number | null;
  avg_safety_score: number | null;
  violations_last_30d: number | null;
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

async function runDriverCoaching(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();
  const week = weekLabel();

  // 1. Fetch active drivers
  const drivers = await prisma.$queryRaw<DriverRow[]>`
    SELECT id::text, first_name, last_name, employee_id,
           rag_score::float8, rag_status
    FROM drivers
    WHERE status IN ('ACTIVE', 'ON_SHIFT', 'AVAILABLE')
    ORDER BY rag_score ASC NULLS LAST
    LIMIT 200
  `.catch(() => [] as DriverRow[]);

  if (drivers.length === 0) {
    return {
      agentId: 'driver-coach', tenantId: event.tenant_id, eventType: event.event_type,
      status: 'COMPLETED', durationMs: Date.now() - t0,
      itemsProcessed: 0, actionsCreated: 0,
      output: { summary: 'No active drivers found.', plans: [] },
    };
  }

  // 2. Fetch performance summaries (30 days)
  const perfRows = await prisma.$queryRaw<PerfRow[]>`
    SELECT
      d.id::text AS driver_id,
      AVG(CASE WHEN p.metric_type = 'SPEED' THEN p.score END)::float8    AS avg_speed_score,
      AVG(CASE WHEN p.metric_type = 'FUEL'  THEN p.score END)::float8    AS avg_fuel_score,
      AVG(CASE WHEN p.metric_type = 'SAFETY' THEN p.score END)::float8   AS avg_safety_score,
      COUNT(CASE WHEN p.metric_type = 'VIOLATION' THEN 1 END)::int       AS violations_last_30d,
      COUNT(CASE WHEN p.metric_type = 'INCIDENT'  THEN 1 END)::int       AS incidents_last_30d,
      COUNT(DISTINCT t.id)::int                                           AS trips_last_30d
    FROM drivers d
    LEFT JOIN driver_performance_metrics p ON p.driver_id = d.id
      AND p.created_at > NOW() - INTERVAL '30 days'
    LEFT JOIN trips t ON t.driver_id = d.id
      AND t.created_at > NOW() - INTERVAL '30 days'
    GROUP BY d.id
  `.catch(() => [] as PerfRow[]);

  const perfMap = new Map(perfRows.map(p => [p.driver_id, p]));

  let plansGenerated = 0;
  const plans: Record<string, unknown>[] = [];

  for (const driver of drivers) {
    try {
      const perf = perfMap.get(driver.id);

      const speedScore   = perf?.avg_speed_score ?? 70;
      const fuelScore    = perf?.avg_fuel_score ?? 70;
      const safetyScore  = perf?.avg_safety_score ?? 70;
      const violations   = perf?.violations_last_30d ?? 0;
      const incidents    = perf?.incidents_last_30d ?? 0;
      const tripsCount   = perf?.trips_last_30d ?? 0;
      const ragScore     = driver.rag_score;
      const rating       = overallRating(ragScore);
      const trend        = ragTrend(ragScore);

      // Identify focus areas from weak scores
      const focusAreas: string[] = [];
      if (speedScore < 65)  focusAreas.push('Speed Management & Smooth Driving');
      if (fuelScore < 65)   focusAreas.push('Fuel Efficiency & Eco-Driving');
      if (safetyScore < 65) focusAreas.push('Safety Awareness & Hazard Anticipation');
      if (violations > 2)   focusAreas.push('Regulatory Compliance & HOS');
      if (incidents > 0)    focusAreas.push('Incident Prevention & Defensive Driving');
      if (focusAreas.length === 0) focusAreas.push('Performance Maintenance & Excellence');

      // Build prompt context
      const context = [
        `Driver: ${driver.first_name} ${driver.last_name} (${driver.employee_id ?? 'N/A'})`,
        `Week: ${week}`,
        `RAG Score: ${ragScore ?? 'N/A'}/100 (${rating})`,
        `Trend: ${trend}`,
        `30-Day Stats:`,
        `  • Trips completed: ${tripsCount}`,
        `  • Speed score: ${speedScore.toFixed(0)}/100`,
        `  • Fuel efficiency score: ${fuelScore.toFixed(0)}/100`,
        `  • Safety score: ${safetyScore.toFixed(0)}/100`,
        `  • HOS/regulatory violations: ${violations}`,
        `  • Incidents: ${incidents}`,
        `Focus Areas: ${focusAreas.join(', ')}`,
      ].join('\n');

      const coachingPlan = await complete(
        'You are a professional fleet driver coach at a UAE transport company. ' +
        'Write a personalised, motivating weekly coaching plan for this driver. ' +
        'Format it as 3 sections: (1) This Week\'s Focus (2) Daily Practice Tips (3) Goal for Next Week. ' +
        'Be specific, practical, and encouraging. Max 300 words.',
        context,
        {
          model: 'gpt-4o-mini',
          maxTokens: 400,
          temperature: 0.5,
          fallback: `Focus Areas This Week:\n${focusAreas.map(f => `• ${f}`).join('\n')}\n\nDaily Practice:\n• Review your trip data each morning\n• Focus on smooth acceleration and braking\n• Maintain safe following distances\n\nGoal: Improve ${focusAreas[0]} score by 5 points this week.`,
        },
      );

      // Upsert coaching plan
      await prisma.$executeRawUnsafe(`
        INSERT INTO driver_coaching_plans (
          driver_id, driver_name, week_label, rag_score, rag_trend,
          overall_rating, focus_areas, coaching_plan, kpis,
          violations_count, fuel_score, speed_score, safety_score, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,'SENT')
        ON CONFLICT DO NOTHING
      `,
        driver.id,
        `${driver.first_name} ${driver.last_name}`,
        week,
        ragScore, trend, rating,
        JSON.stringify(focusAreas),
        coachingPlan,
        JSON.stringify({ speedTarget: Math.min(100, speedScore + 5), fuelTarget: Math.min(100, fuelScore + 5), safetyTarget: Math.min(100, safetyScore + 5) }),
        violations, fuelScore, speedScore, safetyScore,
      );

      plans.push({
        driverId:    driver.id,
        driverName:  `${driver.first_name} ${driver.last_name}`,
        ragScore,
        rating,
        focusAreas,
        preview:     coachingPlan.slice(0, 120) + '…',
      });

      plansGenerated++;
    } catch { /* skip individual driver failures */ }
  }

  return {
    agentId: 'driver-coach', tenantId: event.tenant_id, eventType: event.event_type,
    status: 'COMPLETED', durationMs: Date.now() - t0,
    itemsProcessed: drivers.length, actionsCreated: plansGenerated,
    output: {
      summary: `Generated ${plansGenerated} personalised coaching plans for week ${week}.`,
      week,
      plans,
    },
  };
}

export const DRIVER_COACHING_AGENT: AgentDefinition = {
  id:          'driver-coach',
  name:        'Driver Coaching Agent',
  description: 'Generates personalised weekly coaching plans using RAG scores, HOS violations, fuel and speed metrics, powered by GPT-4o.',
  version:     '1.0.0',
  agentType:   'BATCH',
  subscribedEvents: ['driver.week_end', 'manual.trigger', 'schedule.nightly'],
  supportsEntityScan: true,
  run: runDriverCoaching,
};
