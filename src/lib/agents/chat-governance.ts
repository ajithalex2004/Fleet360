/**
 * Governance for the streaming chat routes (/api/chat, /api/operations/chat,
 * /api/operations/simple-chat).
 *
 * They stream straight from the model, so they can't go through dispatch().
 * Before a turn they pass the same checks (checkRunAllowed: budget caps,
 * circuit breaker, disabledAgents); after it, the turn is recorded as an
 * agent run for the caller's tenant. It used to be logged under the
 * 'default' tenant, because the routes never passed theirs.
 *
 * Token usage is not available from these streams, so a turn is recorded
 * with zero tokens and zero cost: chat spend is not yet counted toward the
 * budget, only gated by it.
 */
import { recordRun } from './orchestrator';
import type { AgentEventType, AgentId } from './types';

export { checkRunAllowed } from './orchestrator';

export function recordChatTurn(opts: {
  tenantId: string;
  agentId: Extract<AgentId, 'chat-widget' | 'ops-assistant'>;
  eventType: AgentEventType;
  threadId: string;
  messageCount: number;
  toolsUsed: string[];
  durationMs: number;
  failed?: string;
}): void {
  recordRun(
    {
      tenant_id: opts.tenantId,
      agent_id: opts.agentId,
      event_type: opts.eventType,
      entity_id: opts.threadId,
      payload: { threadId: opts.threadId, messageCount: opts.messageCount },
    },
    {
      agentId: opts.agentId,
      tenantId: opts.tenantId,
      eventType: opts.eventType,
      entityId: opts.threadId,
      status: opts.failed ? 'FAILED' : 'COMPLETED',
      durationMs: opts.durationMs,
      // Same meaning as before (the ecosystem hub reads these): messages in
      // the thread, and tools the model invoked.
      itemsProcessed: opts.messageCount,
      actionsCreated: opts.toolsUsed.length,
      output: { toolsUsed: opts.toolsUsed },
      error: opts.failed,
      telemetry: { modelAlias: 'ADVANCED_REASONING', modelProvider: 'thesys' },
    },
  ).catch((err) => console.error(`[${opts.agentId}] Failed to record chat turn:`, err));
}
