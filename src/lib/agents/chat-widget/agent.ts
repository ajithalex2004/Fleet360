/**
 * Platform Chat Widget — Ecosystem Wrapper
 * -----------------------------------------
 * The actual Chat Widget runs at POST /api/chat via SSE streaming.
 * Uses TheSys (GPT-5) with 1 tool: createBooking.
 *
 * This wrapper:
 *   1. Returns 7-day session + message stats when run() is called.
 *   2. logInteraction() is called by /api/chat after each stream completes.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';

// ── Called by /api/chat/route.ts after each streaming completion ───────────────
export async function logInteraction(opts: {
  threadId:       string;
  messageCount:   number;
  toolsUsed:      string[];
  durationMs:     number;
  tenantId?:      string;
}): Promise<void> {
  prisma.$executeRawUnsafe(`
    INSERT INTO agent_runs
      (agent_id, tenant_id, event_type, entity_id, input, output,
       items_processed, actions_created, duration_ms, status)
    VALUES ('chat-widget', $1, 'chat.message_sent', $2,
            $3::jsonb, $4::jsonb, $5, $6, $7, 'COMPLETED')
  `,
    opts.tenantId ?? 'default',
    opts.threadId,
    JSON.stringify({ threadId: opts.threadId }),
    JSON.stringify({ toolsUsed: opts.toolsUsed }),
    opts.messageCount,
    opts.toolsUsed.length,
    opts.durationMs,
  ).catch(() => {});
}

// ── Stats runner ──────────────────────────────────────────────────────────────
async function runChatWidgetStats(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();

  // Pull from agent_runs (populated by logInteraction)
  const runs = await prisma.$queryRaw<{
    sessions: number;
    total_messages: number;
    bookings_created: number;
    avg_duration_ms: number;
  }[]>`
    SELECT
      COUNT(*)::int               AS sessions,
      SUM(items_processed)::int   AS total_messages,
      SUM(actions_created)::int   AS bookings_created,
      AVG(duration_ms)::int       AS avg_duration_ms
    FROM agent_runs
    WHERE agent_id = 'chat-widget'
      AND created_at >= NOW() - INTERVAL '7 days'
  `.catch(() => [{ sessions: 0, total_messages: 0, bookings_created: 0, avg_duration_ms: 0 }]);

  const r = runs[0] ?? { sessions: 0, total_messages: 0, bookings_created: 0, avg_duration_ms: 0 };

  return {
    agentId:        'chat-widget',
    tenantId:       event.tenant_id,
    eventType:      event.event_type,
    status:         'COMPLETED',
    durationMs:     Date.now() - t0,
    itemsProcessed: r.sessions,
    actionsCreated: r.bookings_created,
    output: {
      summary:          `Chat Widget handled ${r.sessions} sessions with ${r.total_messages} messages in the last 7 days.`,
      period:           'last_7_days',
      totalSessions:    r.sessions,
      totalMessages:    r.total_messages,
      bookingsCreated:  r.bookings_created,
      avgResponseMs:    r.avg_duration_ms,
      agentStatus:      'ALWAYS_ON',
      endpoint:         'POST /api/chat',
      llm:              'TheSys GPT-5 (c1/openai/gpt-5)',
      tools:            ['createBooking'],
    },
  };
}

export const CHAT_WIDGET_AGENT: AgentDefinition = {
  id:          'chat-widget',
  name:        'Platform Chat Widget',
  description: 'Global chat widget available on every page. Powered by TheSys GPT-5 with SSE streaming. Supports createBooking tool for quick logistics bookings.',
  version:     '1.0.0',
  agentType:   'CONVERSATIONAL',
  subscribedEvents: ['chat.message_sent', 'chat.stats_requested', 'manual.trigger'],
  supportsEntityScan: false,
  run: runChatWidgetStats,
};
