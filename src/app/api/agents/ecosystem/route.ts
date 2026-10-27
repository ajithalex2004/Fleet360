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

import { requireAuthorizedTenant } from '@/lib/tenant-context';
// ── Data ───────────────────────────────────────────────────────────────────────
// Everything the hub shows comes from ONE SQL statement. The app and the
// database are far apart (every round trip costs ~265 ms in production), and
// this route used to make 8 queries one after another inside its transaction
// (11 round trips with BEGIN / set_config / COMMIT, ~3 s). It now makes one
// (4 round trips). It also used to .catch() each query separately inside a
// single transaction, so one failing query aborted the transaction and every
// later one silently returned zeros; a failure now fails the statement and
// is logged (see GET).
//
// route_optimisation_results is scoped to the tenant by its RLS policy (the
// transaction's app.tenant_id). driver_coaching_plans has no tenant_id column
// (pre-existing gap: every tenant's pending coaching plans are counted
// together until it gets a proper migration). demand_forecasts has no
// status/approval column — the forecasting agent writes forecasts directly
// with no pending-review workflow — so there is no forecast pending count.
type LastRun = {
  status: string; created_at: string; duration_ms: number;
  items_processed: number; actions_created: number;
};
type Stats7d = {
  runs: number; items_processed: number; actions_created: number; avg_ms: number;
};
type PendingRoute = {
  id: string; route_name: string; route_number: string;
  distance_saved_km: number; distance_saved_pct: number;
  matched_stop_count: number; created_at: string;
};
type FeedEntry = {
  agent_id: string; event_type: string; status: string;
  items_processed: number; actions_created: number;
  created_at: string; duration_ms: number;
};
type EcosystemRow = {
  pending_routes: PendingRoute[];
  coach_pending: number;
  feed: FeedEntry[];
  actions_today: number;
  route_km: number;
  anomalies: number;
  last_runs: (LastRun & { agent_id: string })[];
  stats: (Stats7d & { agent_id: string })[];
};

// $1 = tenant id, $2 = batch agent ids (last runs), $3 = agent ids with 7-day stats.
const ECOSYSTEM_SQL = `
SELECT
  (SELECT COALESCE(json_agg(json_build_object(
            'id', p.id::text, 'route_name', p.route_name, 'route_number', p.route_number,
            'distance_saved_km', p.distance_saved_km::float8, 'distance_saved_pct', p.distance_saved_pct::float8,
            'matched_stop_count', p.matched_stop_count, 'created_at', p.created_at::text)
          ORDER BY p.distance_saved_km DESC), '[]'::json)
     FROM (SELECT * FROM route_optimisation_results
            WHERE status = 'SUGGESTED'
            ORDER BY distance_saved_km DESC LIMIT 10) p)                       AS pending_routes,
  (SELECT COUNT(*)::int FROM driver_coaching_plans WHERE status = 'PENDING') AS coach_pending,
  (SELECT COALESCE(json_agg(json_build_object(
            'agent_id', f.agent_id, 'event_type', f.event_type, 'status', f.status,
            'items_processed', f.items_processed, 'actions_created', f.actions_created,
            'created_at', f.created_at::text, 'duration_ms', f.duration_ms)
          ORDER BY f.created_at DESC), '[]'::json)
     FROM (SELECT * FROM agent_runs WHERE tenant_id = $1
            ORDER BY created_at DESC LIMIT 20) f)                             AS feed,
  (SELECT COALESCE(SUM(actions_created), 0)::int FROM agent_runs
    WHERE tenant_id = $1 AND created_at >= CURRENT_DATE)                     AS actions_today,
  (SELECT COALESCE(SUM(distance_saved_km), 0)::float8 FROM route_optimisation_results
    WHERE created_at >= NOW() - INTERVAL '7 days')                           AS route_km,
  (SELECT COUNT(*)::int FROM ai.agent_anomaly_flags
    WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 days')        AS anomalies,
  (SELECT COALESCE(json_agg(json_build_object(
            'agent_id', a.agent_id, 'status', r.status, 'created_at', r.created_at::text,
            'duration_ms', r.duration_ms, 'items_processed', r.items_processed,
            'actions_created', r.actions_created)), '[]'::json)
     FROM unnest($2::text[]) AS a(agent_id)
     JOIN LATERAL (
       SELECT status, created_at, duration_ms, items_processed, actions_created
         FROM agent_runs
        WHERE agent_id = a.agent_id AND tenant_id = $1
        ORDER BY created_at DESC LIMIT 1
     ) r ON true)                                                            AS last_runs,
  (SELECT COALESCE(json_agg(json_build_object(
            'agent_id', s.agent_id, 'runs', s.runs, 'items_processed', s.items_processed,
            'actions_created', s.actions_created, 'avg_ms', s.avg_ms)), '[]'::json)
     FROM (SELECT agent_id,
                  COUNT(*)::int                            AS runs,
                  COALESCE(SUM(items_processed), 0)::int   AS items_processed,
                  COALESCE(SUM(actions_created), 0)::int   AS actions_created,
                  COALESCE(AVG(duration_ms), 0)::int       AS avg_ms
             FROM agent_runs
            WHERE agent_id = ANY($3::text[]) AND tenant_id = $1
              AND created_at >= NOW() - INTERVAL '7 days'
            GROUP BY agent_id) s)                                            AS stats
`;

const NO_STATS: Stats7d = { runs: 0, items_processed: 0, actions_created: 0, avg_ms: 0 };

// ── Conversational stats ───────────────────────────────────────────────────────
// agent_runs schema for whatsapp-agent: one row per inbound message
// (recordChatTurn, src/lib/agents/chat-governance.ts), actions_created = resolved ? 1 : 0. There is NO
// `direction` or `resolved` column — derive from what recordChatTurn() writes.
function whatsAppStats(s: Stats7d) {
  return {
    sessions: s.runs,
    resolved: s.actions_created,
    resolvedRate: s.runs > 0 ? Math.round((s.actions_created / s.runs) * 100) : 0,
    avgResponseMs: s.avg_ms,
  };
}

function opsAssistantStats(s: Stats7d) {
  return {
    sessions: s.runs,
    total_queries: s.items_processed,
    tools_invoked: s.actions_created,
    avg_ms: s.avg_ms,
  };
}

// ── Main handler ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

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

    // One statement inside one tenant-scoped transaction: BEGIN, set_config,
    // the query, COMMIT. (The route used to run ~20+ queries as separate
    // implicit transactions via Promise.all, which broke Neon's pooled
    // endpoint — see defaultSweepConcurrency() in @/lib/rls — and then 8
    // sequential ones in one transaction.)
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const [row] = await tx.$queryRawUnsafe<EcosystemRow[]>(
        ECOSYSTEM_SQL,
        tenantId,
        BATCH_IDS,
        [...BATCH_IDS, 'whatsapp-agent', 'ops-assistant'],
      );
      const pendingRoutes = row.pending_routes;
      const feed = row.feed;
      const kpis = {
        actionsToday: row.actions_today,
        routeKmSaved7d: parseFloat(Number(row.route_km).toFixed(1)),
        anomaliesFlagged7d: row.anomalies,
        pendingApprovals: pendingRoutes.length + row.coach_pending,
      };
      const lastRuns = new Map(row.last_runs.map(({ agent_id, ...run }) => [agent_id, run]));
      const stats = new Map(row.stats.map(({ agent_id, ...s }) => [agent_id, s]));
      const waStats = whatsAppStats(stats.get('whatsapp-agent') ?? NO_STATS);
      const opsStats = opsAssistantStats(stats.get('ops-assistant') ?? NO_STATS);

      const batchAgents = BATCH_IDS.map((id) => {
        const { runs, items_processed, actions_created } = stats.get(id) ?? NO_STATS;
        const pendingItems = id === 'route-optimiser' ? pendingRoutes : [];
        return {
          id,
          ...BATCH_META[id],
          lastRun: lastRuns.get(id) ?? null,
          stats7d: { runs, items_processed, actions_created },
          pendingCount: pendingItems.length,
          pendingItems,
        };
      });

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
    // If the statement fails, return the static ecosystem structure — but say
    // why in the logs rather than failing silently.
    console.error('[agents/ecosystem] failed to load ecosystem stats:', err);
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
