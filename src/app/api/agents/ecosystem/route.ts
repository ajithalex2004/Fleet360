/**
 * GET /api/agents/ecosystem
 * --------------------------
 * Aggregated stats for the AI Ecosystem Hub.
 * Returns command-strip KPIs, per-batch-agent stats + pending items,
 * and per-conversational-agent 7-day stats.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';

const AGENT_CONFIGS_DDL = `
  CREATE TABLE IF NOT EXISTS agent_configs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    TEXT        NOT NULL UNIQUE,
    thresholds  JSONB       NOT NULL DEFAULT '{}',
    schedule_cron TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );
`;

async function ensureAgentConfigsTable() {
  await prisma.$executeRawUnsafe(AGENT_CONFIGS_DDL).catch(() => {});
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function agentLastRun(agentId: string) {
  const rows = await prisma.$queryRawUnsafe<{
    status: string; created_at: string; duration_ms: number;
    items_processed: number; actions_created: number;
  }[]>(
    `SELECT status, created_at::text, duration_ms, items_processed, actions_created
     FROM agent_runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`,
    agentId,
  ).catch(() => []);
  return rows[0] ?? null;
}

async function agent7dStats(agentId: string) {
  const rows = await prisma.$queryRawUnsafe<{
    runs: number; items_processed: number; actions_created: number;
  }[]>(
    `SELECT COUNT(*)::int AS runs,
            COALESCE(SUM(items_processed),0)::int AS items_processed,
            COALESCE(SUM(actions_created),0)::int AS actions_created
     FROM agent_runs
     WHERE agent_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
    agentId,
  ).catch(() => [{ runs: 0, items_processed: 0, actions_created: 0 }]);
  return rows[0] ?? { runs: 0, items_processed: 0, actions_created: 0 };
}

// ── Pending items per agent ────────────────────────────────────────────────────
async function routePendingItems() {
  return prisma.$queryRawUnsafe<{
    id: string; route_name: string; route_number: string;
    distance_saved_km: number; distance_saved_pct: number;
    matched_stop_count: number; created_at: string;
  }[]>(
    `SELECT id::text, route_name, route_number,
            distance_saved_km::float8, distance_saved_pct::float8,
            matched_stop_count, created_at::text
     FROM route_optimisation_results
     WHERE status = 'SUGGESTED'
     ORDER BY distance_saved_km DESC LIMIT 10`,
  ).catch(() => []);
}

async function coachingPendingCount() {
  const rows = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt FROM driver_coaching_plans WHERE status = 'PENDING'`,
  ).catch(() => [{ cnt: 0 }]);
  return rows[0]?.cnt ?? 0;
}

async function forecastPendingCount() {
  const rows = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt FROM demand_forecasts WHERE status = 'PENDING'`,
  ).catch(() => [{ cnt: 0 }]);
  return rows[0]?.cnt ?? 0;
}

// ── Conversational stats ───────────────────────────────────────────────────────
async function whatsAppStats() {
  // agent_runs schema: actions_created = resolved ? 1 : 0, items_processed = 1 per message
  // There is NO `direction` or `resolved` column — derive from what logInteraction() writes.
  const rows = await prisma.$queryRawUnsafe<{
    total: number; resolved: number; avg_ms: number;
  }[]>(
    `SELECT
       COUNT(*)::int                             AS total,
       COALESCE(SUM(actions_created),0)::int     AS resolved,
       COALESCE(AVG(duration_ms),0)::int         AS avg_ms
     FROM agent_runs
     WHERE agent_id = 'whatsapp-agent'
       AND created_at >= NOW() - INTERVAL '7 days'`,
  ).catch(() => [{ total: 0, resolved: 0, avg_ms: 0 }]);
  const s = rows[0] ?? { total: 0, resolved: 0, avg_ms: 0 };
  // Every logged row is an inbound interaction (logInteraction is called per inbound message)
  return {
    sessions: s.total,
    resolved: s.resolved,
    resolvedRate: s.total > 0 ? Math.round((s.resolved / s.total) * 100) : 0,
    avgResponseMs: s.avg_ms,
  };
}

async function chatWidgetStats() {
  const rows = await prisma.$queryRawUnsafe<{
    sessions: number; total_messages: number; bookings_created: number; avg_ms: number;
  }[]>(
    `SELECT
       COUNT(*)::int AS sessions,
       COALESCE(SUM(items_processed),0)::int AS total_messages,
       COALESCE(SUM(actions_created),0)::int AS bookings_created,
       COALESCE(AVG(duration_ms),0)::int AS avg_ms
     FROM agent_runs
     WHERE agent_id = 'chat-widget'
       AND created_at >= NOW() - INTERVAL '7 days'`,
  ).catch(() => [{ sessions: 0, total_messages: 0, bookings_created: 0, avg_ms: 0 }]);
  return rows[0] ?? { sessions: 0, total_messages: 0, bookings_created: 0, avg_ms: 0 };
}

async function opsAssistantStats() {
  const rows = await prisma.$queryRawUnsafe<{
    sessions: number; total_queries: number; tools_invoked: number; avg_ms: number;
  }[]>(
    `SELECT
       COUNT(*)::int AS sessions,
       COALESCE(SUM(items_processed),0)::int AS total_queries,
       COALESCE(SUM(actions_created),0)::int AS tools_invoked,
       COALESCE(AVG(duration_ms),0)::int AS avg_ms
     FROM agent_runs
     WHERE agent_id = 'ops-assistant'
       AND created_at >= NOW() - INTERVAL '7 days'`,
  ).catch(() => [{ sessions: 0, total_queries: 0, tools_invoked: 0, avg_ms: 0 }]);
  return rows[0] ?? { sessions: 0, total_queries: 0, tools_invoked: 0, avg_ms: 0 };
}

// ── Command strip KPIs — single query to reduce pool pressure ─────────────────
async function commandStripKPIs(
  routePendingCount: number,
  coachPending: number,
  forecastPending: number,
) {
  const [actionsToday, routeKm, anomalies] = await Promise.all([
    prisma.$queryRawUnsafe<{ cnt: number }[]>(
      `SELECT COALESCE(SUM(actions_created),0)::int AS cnt FROM agent_runs
       WHERE created_at >= CURRENT_DATE`,
    ).catch(() => [{ cnt: 0 }]),
    prisma.$queryRawUnsafe<{ km: number }[]>(
      `SELECT COALESCE(SUM(distance_saved_km),0)::float8 AS km
       FROM route_optimisation_results
       WHERE created_at >= NOW() - INTERVAL '7 days'`,
    ).catch(() => [{ km: 0 }]),
    prisma.$queryRawUnsafe<{ cnt: number }[]>(
      `SELECT COUNT(*)::int AS cnt FROM finance_anomaly_flags
       WHERE created_at >= NOW() - INTERVAL '7 days'`,
    ).catch(() => [{ cnt: 0 }]),
  ]);

  return {
    actionsToday: actionsToday[0]?.cnt ?? 0,
    routeKmSaved7d: parseFloat((routeKm[0]?.km ?? 0).toFixed(1)),
    anomaliesFlagged7d: anomalies[0]?.cnt ?? 0,
    pendingApprovals: routePendingCount + coachPending + forecastPending,
  };
}

// ── Activity feed ──────────────────────────────────────────────────────────────
async function activityFeed() {
  return prisma.$queryRawUnsafe<{
    agent_id: string; event_type: string; status: string;
    items_processed: number; actions_created: number;
    created_at: string; duration_ms: number;
  }[]>(
    `SELECT agent_id, event_type, status, items_processed, actions_created,
            created_at::text, duration_ms
     FROM agent_runs
     ORDER BY created_at DESC LIMIT 20`,
  ).catch(() => []);
}

// ── Main handler ───────────────────────────────────────────────────────────────
export async function GET() {
  // Run DDL sequentially first to avoid pool pressure during init
  await ensureAgentSchema();
  await ensureAgentConfigsTable();

  const BATCH_IDS = [
    'predictive-maintenance',
    'finance-anomaly',
    'route-optimiser',
    'incident-triage',
    'dispatch-optimiser',
    'driver-coach',
    'demand-forecasting',
  ];

  // Batch 1: shared data needed by multiple sections (≤4 concurrent)
  const [pendingRoutes, coachPending, forecastPending, feed] = await Promise.all([
    routePendingItems(),
    coachingPendingCount(),
    forecastPendingCount(),
    activityFeed(),
  ]);

  // Batch 2: KPIs + conversational stats (≤4 concurrent, reuses pendingRoutes)
  const [kpis, waStats, chatStats, opsStats] = await Promise.all([
    commandStripKPIs(pendingRoutes.length, coachPending, forecastPending),
    whatsAppStats(),
    chatWidgetStats(),
    opsAssistantStats(),
  ]);

  // Batch 3: per-batch-agent last-run + 7d stats — run 2 at a time to stay within pool
  const batchStats: [Awaited<ReturnType<typeof agentLastRun>>, Awaited<ReturnType<typeof agent7dStats>>][] = [];
  for (let i = 0; i < BATCH_IDS.length; i += 2) {
    const chunk = BATCH_IDS.slice(i, i + 2);
    const results = await Promise.all(
      chunk.map(id => Promise.all([agentLastRun(id), agent7dStats(id)])),
    );
    batchStats.push(...results);
  }

  const BATCH_META: Record<string, { name: string; module: string; model: string; resultsHref: string }> = {
    'predictive-maintenance': { name: 'Predictive Maintenance',  module: 'Fleet',           model: 'Statistical',       resultsHref: '/fleet/intelligence' },
    'finance-anomaly':        { name: 'Finance Anomaly',         module: 'Finance',         model: 'Z-Score / Heuristic', resultsHref: '/finance/anomalies' },
    'route-optimiser':        { name: 'Route Optimisation',      module: 'School Bus',      model: 'TSP + 2-opt',       resultsHref: '/school-bus/intelligence' },
    'incident-triage':        { name: 'Incident Auto-Triage',    module: 'Incidents',       model: 'Rules + GPT-4o',    resultsHref: '/incidents' },
    'dispatch-optimiser':     { name: 'Smart Dispatch Optimiser',module: 'Dispatch',        model: 'Statistical (15-factor)', resultsHref: '/dispatch/jobs' },
    'driver-coach':           { name: 'Driver Coaching',         module: 'Fleet / Driver',  model: 'GPT-4o',            resultsHref: '/fleet/intelligence' },
    'demand-forecasting':     { name: 'Demand Forecasting',      module: 'Fleet / RAC',     model: 'Moving Avg + GPT-4o', resultsHref: '/fleet/intelligence' },
  };

  const batchAgents = BATCH_IDS.map((id, i) => {
    const [lastRun, stats7d] = batchStats[i] as [Awaited<ReturnType<typeof agentLastRun>>, Awaited<ReturnType<typeof agent7dStats>>];
    const pendingItems = id === 'route-optimiser' ? pendingRoutes : [];
    return {
      id,
      ...BATCH_META[id],
      lastRun,
      stats7d,
      pendingCount: pendingItems.length,
      pendingItems,
    };
  });

  return NextResponse.json({
    commandStrip: {
      activeAgents: 7,
      ...kpis,
    },
    batchAgents,
    convAgents: [
      {
        id: 'whatsapp-agent',
        name: 'WhatsApp AI Agent',
        model: 'Rule-based',
        endpoint: 'POST /api/webhooks/whatsapp',
        stats7d: waStats,
      },
      {
        id: 'chat-widget',
        name: 'Platform Chat Widget',
        model: 'TheSys GPT-5',
        endpoint: 'POST /api/chat',
        stats7d: chatStats,
      },
      {
        id: 'ops-assistant',
        name: 'XL AI Ops Assistant',
        model: 'TheSys GPT-5',
        endpoint: 'POST /api/operations/simple-chat',
        stats7d: opsStats,
      },
    ],
    activityFeed: feed,
    generatedAt: new Date().toISOString(),
  });
}
