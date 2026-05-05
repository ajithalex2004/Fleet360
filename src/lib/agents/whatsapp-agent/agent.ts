/**
 * WhatsApp Agent — Ecosystem Wrapper
 * ------------------------------------
 * The actual WhatsApp agent runs 24/7 at POST /api/webhooks/whatsapp,
 * processing Twilio events with regex-based intent detection (no LLM).
 *
 * This wrapper does two things:
 *   1. When run() is called, returns 7-day activity stats from whatsapp_messages.
 *   2. The existing webhook route calls logInteraction() after each message
 *      to write a row to agent_runs — giving unified ecosystem visibility.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult } from '../types';

// ── Called by the WhatsApp webhook route after every interaction ───────────────
export async function logInteraction(opts: {
  messageId:   string;
  intent:      string;
  from:        string;
  resolved:    boolean;
  durationMs:  number;
  tenantId?:   string;
}): Promise<void> {
  // Fire-and-forget — never block the Twilio webhook response
  prisma.$executeRawUnsafe(`
    INSERT INTO agent_runs
      (agent_id, tenant_id, event_type, entity_id, input, output,
       items_processed, actions_created, duration_ms, status)
    VALUES ('whatsapp-agent', $1, 'whatsapp.message_received', $2,
            $3::jsonb, $4::jsonb, 1, $5, $6, 'COMPLETED')
  `,
    opts.tenantId ?? 'default',
    opts.messageId,
    JSON.stringify({ from: opts.from, intent: opts.intent }),
    JSON.stringify({ resolved: opts.resolved }),
    opts.resolved ? 1 : 0,
    opts.durationMs,
  ).catch(() => {}); // swallow any DB errors
}

// ── Stats runner — called when operator triggers "Run" in the ecosystem ────────
async function runWhatsAppStats(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();

  // Pull 7-day stats from agent_runs — the authoritative source.
  // logInteraction() writes: input={from, intent}, actions_created = resolved ? 1 : 0
  // Every row represents one inbound WhatsApp message.
  const runs = await prisma.$queryRawUnsafe<{
    total: number;
    resolved: number;
    avg_duration_ms: number;
  }[]>(
    `SELECT
       COUNT(*)::int                         AS total,
       COALESCE(SUM(actions_created),0)::int AS resolved,
       COALESCE(AVG(duration_ms),0)::int     AS avg_duration_ms
     FROM agent_runs
     WHERE agent_id = 'whatsapp-agent'
       AND created_at >= NOW() - INTERVAL '7 days'`,
  ).catch(() => [{ total: 0, resolved: 0, avg_duration_ms: 0 }]);

  // Intent breakdown — parsed from the input JSONB that logInteraction() writes
  const intentBreakdown = await prisma.$queryRawUnsafe<{ intent: string; count: number }[]>(
    `SELECT
       COALESCE(input->>'intent', 'GENERAL') AS intent,
       COUNT(*)::int AS count
     FROM agent_runs
     WHERE agent_id = 'whatsapp-agent'
       AND created_at >= NOW() - INTERVAL '7 days'
     GROUP BY 1
     ORDER BY 2 DESC`,
  ).catch(() => [] as { intent: string; count: number }[]);

  const r = runs[0] ?? { total: 0, resolved: 0, avg_duration_ms: 0 };
  const resolvedRate = r.total > 0 ? parseFloat(((r.resolved / r.total) * 100).toFixed(1)) : 0;

  return {
    agentId:        'whatsapp-agent',
    tenantId:       event.tenant_id,
    eventType:      event.event_type,
    status:         'COMPLETED',
    durationMs:     Date.now() - t0,
    itemsProcessed: r.total,
    actionsCreated: r.resolved,
    output: {
      summary:          `WhatsApp agent handled ${r.total} messages in the last 7 days. Resolution rate: ${resolvedRate}%.`,
      period:           'last_7_days',
      totalMessages:    r.total,
      inboundMessages:  r.total,   // every agent_runs row = one inbound message
      resolvedCount:    r.resolved,
      resolvedRatePct:  resolvedRate,
      avgResponseMs:    r.avg_duration_ms,
      intentBreakdown:  intentBreakdown.reduce((acc, row) => ({ ...acc, [row.intent]: row.count }), {} as Record<string, number>),
      agentStatus:      'ALWAYS_ON',
      endpoint:         'POST /api/webhooks/whatsapp',
      llm:              'Rule-based (no LLM)',
    },
  };
}

export const WHATSAPP_AGENT: AgentDefinition = {
  id:          'whatsapp-agent',
  name:        'WhatsApp AI Agent',
  description: 'Handles inbound WhatsApp messages via Twilio. Classifies intent (INQUIRY, PAYMENT, RENEWAL, GENERAL) and auto-replies without LLM latency.',
  version:     '1.0.0',
  agentType:   'CONVERSATIONAL',
  subscribedEvents: ['whatsapp.message_received', 'whatsapp.stats_requested', 'manual.trigger'],
  supportsEntityScan: false,
  run: runWhatsAppStats,
};
