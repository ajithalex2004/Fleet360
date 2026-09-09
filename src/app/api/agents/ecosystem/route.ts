export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/ecosystem
 * --------------------------
 * Aggregated stats for the AI Ecosystem Hub.
 * Returns command-strip KPIs, per-batch-agent stats + pending items,
 * and per-conversational-agent 7-day stats.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// ── Helpers ────────────────────────────────────────────────────────────────────
async function agentLastRun(agentId: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<{
    status: string; created_at: string; duration_ms: number;
    items_processed: number; actions_created: number;
  }[]>(
    `SELECT status, created_at::text, duration_ms, items_processed, actions_created
     FROM agent_runs WHERE agent_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
    agentId, tenantId,
  ).catch(() => []);
  return rows[0] ?? null;
}

async function agent7dStats(agentId: string, tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<{
    runs: number; items_processed: number; actions_created: number;
  }[]>(
    `SELECT COUNT(*)::int AS runs,
            COALESCE(SUM(items_processed),0)::int AS items_processed,
            COALESCE(SUM(actions_created),0)::int AS actions_created
     FROM agent_runs
     WHERE agent_id = $1 AND tenant_id = $2 AND created_at >= NOW() - INTERVAL '7 days'`,
    agentId, tenantId,
  ).catch(() => [{ runs: 0, items_processed: 0, actions_created: 0 }]);
  return rows[0] ?? { runs: 0, items_processed: 0, actions_created: 0 };
}

// ── Pending items per agent ────────────────────────────────────────────────────
// route_optimisation_results / driver_coaching_plans / demand_forecasts have no
// tenant_id column at all (pre-existing gap, not introduced here — every tenant's
// pending items are mixed together until those tables get a proper migration).
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

// demand_forecasts (see schema.ts) has no status/approval column — the
// forecasting agent writes forecasts directly with no pending-review
// workflow, unlike driver_coaching_plans. There is nothing to count here.
function forecastPendingCount(): number {
  return 0;
}

// ── Conversational stats ───────────────────────────────────────────────────────
async function whatsAppStats(tenantId: string) {
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
     WHERE agent_id = 'whatsapp-agent' AND tenant_id = $1
       AND created_at >= NOW() - INTERVAL '7 days'`,
    tenantId,
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

async function opsAssistantStats(tenantId: string) {
  const rows = await prisma.$queryRawUnsafe<{
    sessions: number; total_queries: number; tools_invoked: number; avg_ms: number;
  }[]>(
    `SELECT
       COUNT(*)::int AS sessions,
       COALESCE(SUM(items_processed),0)::int AS total_queries,
       COALESCE(SUM(actions_created),0)::int AS tools_invoked,
       COALESCE(AVG(duration_ms),0)::int AS avg_ms
     FROM agent_runs
     WHERE agent_id = 'ops-assistant' AND tenant_id = $1
       AND created_at >= NOW() - INTERVAL '7 days'`,
    tenantId,
  ).catch(() => [{ sessions: 0, total_queries: 0, tools_invoked: 0, avg_ms: 0 }]);
  return rows[0] ?? { sessions: 0, total_queries: 0, tools_invoked: 0, avg_ms: 0 };
}

// ── Command strip KPIs — single query to reduce pool pressure ─────────────────
// Sequential, not Promise.all: these all run inside the request's single
// tenant-scoped interactive transaction (see GET below), which is pinned to
// one pooled connection. Firing raw queries concurrently on it is not
// something Prisma supports (see runSequential in @/lib/rls) — it also
// re-triggers the "2 concurrent interactive transactions breaks the Neon
// pooler" failure this route was rewritten to avoid.
async function commandStripKPIs(
  tenantId: string,
  routePendingCount: number,
  coachPending: number,
  forecastPending: number,
) {
  const actionsToday = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COALESCE(SUM(actions_created),0)::int AS cnt FROM agent_runs
     WHERE tenant_id = $1 AND created_at >= CURRENT_DATE`,
    tenantId,
  ).catch(() => [{ cnt: 0 }]);
  // route_optimisation_results has no tenant_id column — see routePendingItems().
  const routeKm = await prisma.$queryRawUnsafe<{ km: number }[]>(
    `SELECT COALESCE(SUM(distance_saved_km),0)::float8 AS km
     FROM route_optimisation_results
     WHERE created_at >= NOW() - INTERVAL '7 days'`,
  ).catch(() => [{ km: 0 }]);
  const anomalies = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt FROM ai.agent_anomaly_flags
     WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
    tenantId,
  ).catch(() => [{ cnt: 0 }]);

  return {
    actionsToday: actionsToday[0]?.cnt ?? 0,
    routeKmSaved7d: parseFloat((routeKm[0]?.km ?? 0).toFixed(1)),
    anomaliesFlagged7d: anomalies[0]?.cnt ?? 0,
    pendingApprovals: routePendingCount + coachPending + forecastPending,
  };
}

// ── Activity feed ──────────────────────────────────────────────────────────────
async function activityFeed(tenantId: string) {
  return prisma.$queryRawUnsafe<{
    agent_id: string; event_type: string; status: string;
    items_processed: number; actions_created: number;
    created_at: string; duration_ms: number;
  }[]>(
    `SELECT agent_id, event_type, status, items_processed, actions_created,
            created_at::text, duration_ms
     FROM agent_runs
     WHERE tenant_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    tenantId,
  ).catch(() => []);
}

// ── Main handler ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  let tenantId = 'default';
  try {
    const authz = requireAuthorizedTenant(
      { headers: req.headers, nextUrl: req.nextUrl },
      { allowPlatformSwitch: true },
    );
    if (authz.ok) {
      tenantId = authz.tenantId;
    }
  } catch {
    // Graceful fallback to default tenant
  }

  const BATCH_IDS = [
    'predictive-maintenance',
    'finance-anomaly',
    'route-optimiser',
    'incident-triage',
    'dispatch-optimiser',
    'driver-coach',
    'demand-forecasting',
    'staff-transport-planner',
  ];

  const BATCH_META: Record<string, { name: string; module: string; model: string; resultsHref: string }> = {
    'predictive-maintenance': { name: 'Predictive Maintenance',   module: 'Fleet',               model: 'Statistical',          resultsHref: '/fleet/intelligence' },
    'finance-anomaly':        { name: 'Finance Anomaly',          module: 'Finance',             model: 'Z-Score / Heuristic',  resultsHref: '/finance/anomalies' },
    'route-optimiser':        { name: 'Route Optimisation',       module: 'Bus-Ops & Transport', model: 'Consolidation + 2-opt',resultsHref: '/school-bus/intelligence' },
    'incident-triage':        { name: 'Incident Auto-Triage',     module: 'Incidents',           model: 'Rules + GPT-4o',       resultsHref: '/incidents' },
    'dispatch-optimiser':     { name: 'Smart Dispatch Optimiser', module: 'Dispatch',            model: 'Statistical (15-factor)', resultsHref: '/dispatch/jobs' },
    'driver-coach':           { name: 'Driver Coaching',          module: 'Fleet / Driver',      model: 'GPT-4o',               resultsHref: '/fleet/intelligence' },
    'demand-forecasting':     { name: 'Demand Forecasting',       module: 'Fleet / RAC',         model: 'Moving Avg + GPT-4o',  resultsHref: '/fleet/intelligence' },
    'staff-transport-planner':{ name: 'Staff Transport Planning', module: 'Staff Transport',     model: 'Bin-Packing + Clustering', resultsHref: '/bus-ops/planning-engine' },
  };

  try {
    // Run DDL first to avoid pool pressure during init (cached after first run).
    await ensureAgentSchema().catch(() => {});

    // Everything below runs inside ONE tenant-scoped interactive transaction,
    // pinned to a single pooled connection. Every prisma.$queryRawUnsafe call
    // in the helpers above transparently reuses this same tx (see
    // activeRlsScope() in prisma.ts) instead of opening its own transaction.
    //
    // This used to run ~20+ raw queries as separate implicit transactions,
    // batched via Promise.all — which is exactly the load pattern proven (see
    // defaultSweepConcurrency() in @/lib/rls) to break Neon's pooled endpoint
    // at as few as 2 concurrent interactive transactions. That amplification,
    // firing every ~30s from the /agents dashboard poll, was the source of
    // the P2028 "Unable to start a transaction" / connection-reset errors.
    // Fix: one transaction, sequential awaits — same pattern already used by
    // the sibling /api/agents/thresholds route.
    return await withTenantRls(prisma, tenantId, async () => {
      const pendingRoutes = await routePendingItems().catch(() => []);
      const coachPending = await coachingPendingCount().catch(() => 0);
      const forecastPending = forecastPendingCount();
      const feed = await activityFeed(tenantId).catch(() => []);

      const kpis = await commandStripKPIs(tenantId, pendingRoutes.length, coachPending, forecastPending).catch(() => ({
        actionsToday: 0,
        routeKmSaved7d: 0,
        anomaliesFlagged7d: 0,
        pendingApprovals: 0,
      }));
      const waStats = await whatsAppStats(tenantId).catch(() => ({ sessions: 0, resolved: 0, resolvedRate: 0, avgResponseMs: 0 }));
      const opsStats = await opsAssistantStats(tenantId).catch(() => ({ sessions: 0, total_queries: 0, tools_invoked: 0, avg_ms: 0 }));

      const batchAgents = [];
      for (const id of BATCH_IDS) {
        const lastRun = await agentLastRun(id, tenantId).catch(() => null);
        const stats7d = await agent7dStats(id, tenantId).catch(() => ({ runs: 0, items_processed: 0, actions_created: 0 }));
        const pendingItems = id === 'route-optimiser' ? pendingRoutes : [];
        batchAgents.push({
          id,
          ...BATCH_META[id],
          lastRun,
          stats7d,
          pendingCount: pendingItems.length,
          pendingItems,
        });
      }

      return NextResponse.json({
        commandStrip: {
          activeAgents: BATCH_IDS.length,
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
            id: 'ops-assistant',
            name: 'Fleet360 Ops Assistant',
            model: 'TheSys GPT-5',
            endpoint: 'POST /api/operations/simple-chat',
            stats7d: opsStats,
          },
        ],
        activityFeed: feed,
        generatedAt: new Date().toISOString(),
      });
    });
  } catch (err: unknown) {
    // If DB fails completely, return fallback static ecosystem structure
    const fallbackBatch = BATCH_IDS.map(id => ({
      id,
      ...BATCH_META[id],
      lastRun: null,
      stats7d: { runs: 0, items_processed: 0, actions_created: 0 },
      pendingCount: 0,
      pendingItems: [],
    }));

    return NextResponse.json({
      commandStrip: {
        activeAgents: BATCH_IDS.length,
        actionsToday: 0,
        routeKmSaved7d: 0,
        anomaliesFlagged7d: 0,
        pendingApprovals: 0,
      },
      batchAgents: fallbackBatch,
      convAgents: [
        {
          id: 'whatsapp-agent',
          name: 'WhatsApp AI Agent',
          model: 'Rule-based',
          endpoint: 'POST /api/webhooks/whatsapp',
          stats7d: { sessions: 0, resolved: 0, resolvedRate: 0, avgResponseMs: 0 },
        },
        {
          id: 'ops-assistant',
          name: 'Fleet360 Ops Assistant',
          model: 'TheSys GPT-5',
          endpoint: 'POST /api/operations/simple-chat',
          stats7d: { sessions: 0, total_queries: 0, tools_invoked: 0, avg_ms: 0 },
        },
      ],
      activityFeed: [],
      generatedAt: new Date().toISOString(),
    });
  }
}
