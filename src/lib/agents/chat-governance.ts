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
 * Token usage: TheSys streams don't report it unless asked, and whether
 * they accept OpenAI's stream_options.include_usage is unconfirmed (sending
 * an option the API rejects would break chat). So a turn uses the provider's
 * usage when a chunk carries one, and otherwise an estimate of ~4 characters
 * per token over the prompt sent and the reply, marked
 * output.tokenUsage = 'estimated'. Either way chat spend now counts toward
 * the tenant's AI budget; it used to be recorded as zero.
 */
import { recordRun } from './orchestrator';
import type { AgentEventType, AgentId } from './types';

export { checkRunAllowed } from './orchestrator';

export type ChatUsage = { inputTokens: number; outputTokens: number; estimated: boolean };

/** Usage the provider reported on a stream chunk (OpenAI shape), if any. */
export type ReportedUsage = { prompt_tokens?: number; completion_tokens?: number } | null | undefined;

const CHARS_PER_TOKEN = 4;

/** Reported usage when the stream carried it, else an estimate from text length. */
export function chatUsage(reported: ReportedUsage, promptSent: unknown, replyText: string): ChatUsage {
  if (reported && typeof reported.prompt_tokens === 'number') {
    return {
      inputTokens: reported.prompt_tokens,
      outputTokens: reported.completion_tokens ?? 0,
      estimated: false,
    };
  }
  const promptChars = typeof promptSent === 'string' ? promptSent.length : JSON.stringify(promptSent ?? '').length;
  return {
    inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN),
    outputTokens: Math.ceil(replyText.length / CHARS_PER_TOKEN),
    estimated: true,
  };
}

export function recordChatTurn(opts: {
  tenantId: string;
  agentId: Extract<AgentId, 'chat-widget' | 'ops-assistant'>;
  eventType: AgentEventType;
  threadId: string;
  messageCount: number;
  toolsUsed: string[];
  durationMs: number;
  usage?: ChatUsage;
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
      output: {
        toolsUsed: opts.toolsUsed,
        ...(opts.usage ? { tokenUsage: opts.usage.estimated ? 'estimated' : 'reported' } : {}),
      },
      error: opts.failed,
      telemetry: {
        modelAlias: 'ADVANCED_REASONING',
        modelProvider: 'thesys',
        inputTokens: opts.usage?.inputTokens ?? 0,
        outputTokens: opts.usage?.outputTokens ?? 0,
      },
    },
  ).catch((err) => console.error(`[${opts.agentId}] Failed to record chat turn:`, err));
}
