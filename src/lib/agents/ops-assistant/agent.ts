/**
 * XL AI Ops Assistant — Ecosystem Wrapper
 * -----------------------------------------
 * The actual Ops Assistant runs at POST /api/operations/simple-chat
 * via SSE streaming. Uses TheSys GPT-5 with 7 fleet management tools.
 *
 * This wrapper:
 *   1. Returns 7-day query volume + tool usage stats when run() is called.
 *   2. logInteraction() is called by /api/operations/simple-chat after each stream.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';

// ── Called by /api/operations/simple-chat after each stream completes ──────────
export async function logInteraction(opts: {
  threadId:     string;
  toolsInvoked: string[];
  messageCount: number;
  durationMs:   number;
  tenantId?:    string;
}): Promise<void> {
  prisma.$executeRawUnsafe(`
    INSERT INTO agent_runs
      (agent_id, tenant_id, event_type, entity_id, input, output,
       items_processed, actions_created, duration_ms, status)
    VALUES ('ops-assistant', $1, 'ops.query_received', $2,
            $3::jsonb, $4::jsonb, $5, $6, $7, 'COMPLETED')
  `,
    opts.tenantId ?? 'default',
    opts.threadId,
    JSON.stringify({ threadId: opts.threadId, messageCount: opts.messageCount }),
    JSON.stringify({ toolsInvoked: opts.toolsInvoked }),
    opts.messageCount,
    opts.toolsInvoked.length,
    opts.durationMs,
  ).catch(() => {});
}

// ── Stats runner ──────────────────────────────────────────────────────────────
async function runOpsAssistantStats(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();

  const runs = await prisma.$queryRaw<{
    sessions: number;
    total_queries: number;
    tools_invoked: number;
    avg_duration_ms: number;
  }[]>`
    SELECT
      COUNT(*)::int               AS sessions,
      SUM(items_processed)::int   AS total_queries,
      SUM(actions_created)::int   AS tools_invoked,
      AVG(duration_ms)::int       AS avg_duration_ms
    FROM agent_runs
    WHERE agent_id = 'ops-assistant'
      AND created_at >= NOW() - INTERVAL '7 days'
  `.catch(() => [{ sessions: 0, total_queries: 0, tools_invoked: 0, avg_duration_ms: 0 }]);

  // Which tools were used most — parse from output JSONB
  const toolBreakdown = await prisma.$queryRaw<{ tool: string; count: number }[]>`
    SELECT
      tool_name AS tool,
      COUNT(*)::int AS count
    FROM (
      SELECT jsonb_array_elements_text(output->'toolsInvoked') AS tool_name
      FROM agent_runs
      WHERE agent_id = 'ops-assistant'
        AND created_at >= NOW() - INTERVAL '7 days'
        AND output ? 'toolsInvoked'
    ) t
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10
  `.catch(() => []);

  const r = runs[0] ?? { sessions: 0, total_queries: 0, tools_invoked: 0, avg_duration_ms: 0 };

  return {
    agentId:        'ops-assistant',
    tenantId:       event.tenant_id,
    eventType:      event.event_type,
    status:         'COMPLETED',
    durationMs:     Date.now() - t0,
    itemsProcessed: r.sessions,
    actionsCreated: r.tools_invoked,
    output: {
      summary:         `XL Ops Assistant handled ${r.sessions} sessions with ${r.total_queries} queries in the last 7 days.`,
      period:          'last_7_days',
      totalSessions:   r.sessions,
      totalQueries:    r.total_queries,
      totalToolCalls:  r.tools_invoked,
      avgResponseMs:   r.avg_duration_ms,
      toolBreakdown:   toolBreakdown.reduce((acc, t) => ({ ...acc, [t.tool]: t.count }), {} as Record<string, number>),
      availableTools:  ['showFleetStatus', 'showVehicles', 'showMaintenanceRequests', 'showAlerts', 'showBookings', 'showKPIDashboard'],
      agentStatus:     'ALWAYS_ON',
      endpoint:        'POST /api/operations/simple-chat',
      llm:             'TheSys GPT-5 (c1/openai/gpt-5)',
    },
  };
}

export const OPS_ASSISTANT_AGENT: AgentDefinition = {
  id:          'ops-assistant',
  name:        'XL AI Ops Assistant',
  description: 'Conversational operations assistant with 6 fleet management tools. Powered by TheSys GPT-5 with SSE streaming. Always calls tools to show live data visually.',
  version:     '1.0.0',
  agentType:   'CONVERSATIONAL',
  subscribedEvents: ['ops.query_received', 'ops.stats_requested', 'manual.trigger'],
  supportsEntityScan: false,
  run: runOpsAssistantStats,
};
