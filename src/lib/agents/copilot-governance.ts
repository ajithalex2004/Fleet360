/**
 * Governance for the co-pilot REST routes.
 *
 * The co-pilots (quotation, rental, damage classifier, doc classifier,
 * contract Q&A) are called straight from their routes, which need the
 * co-pilot's own result shape. governCopilot() puts the same checks as
 * dispatch() in front of them (budget caps, circuit breaker, disabledAgents)
 * and records each call in agent_runs / agent_roi_metrics with its real
 * token usage, so co-pilot spend counts toward the tenant's AI budget.
 */
import { runGoverned, type GovernedOutcome } from './orchestrator';
import type { AgentEventType, AgentId, AgentRunResult, ModelCapabilityAlias } from './types';

/** The fields every co-pilot result shares. */
type CopilotResultLike =
  | { ok: true; modelUsed: string; promptTokens: number; completionTokens: number; durationMs: number }
  | { ok: false; error: string; detail?: unknown };

export async function governCopilot<R extends CopilotResultLike>(
  ctx: {
    tenantId: string;
    agentId: AgentId;
    eventType: AgentEventType;
    entityId?: string;
    modelAlias: ModelCapabilityAlias;
  },
  call: () => Promise<R>,
): Promise<GovernedOutcome<R>> {
  return runGoverned(
    { tenant_id: ctx.tenantId, agent_id: ctx.agentId, event_type: ctx.eventType, entity_id: ctx.entityId },
    call,
    (value, durationMs): AgentRunResult => ({
      agentId:        ctx.agentId,
      tenantId:       ctx.tenantId,
      eventType:      ctx.eventType,
      entityId:       ctx.entityId,
      status:         value.ok ? 'COMPLETED' : 'FAILED',
      durationMs:     value.ok ? value.durationMs : durationMs,
      itemsProcessed: value.ok ? 1 : 0,
      actionsCreated: 0, // advisory only: nothing is persisted or executed
      output:         value.ok ? { modelUsed: value.modelUsed } : null,
      error:          value.ok ? undefined : value.error,
      telemetry: value.ok
        ? {
            modelAlias:    ctx.modelAlias,
            modelProvider: 'openai',
            inputTokens:   value.promptTokens,
            outputTokens:  value.completionTokens,
          }
        : undefined,
    }),
  );
}
