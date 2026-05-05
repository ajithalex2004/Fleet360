/**
 * Agent Orchestration Bus
 * -----------------------
 * The event router. Receives an AgentEvent, resolves the correct agent,
 * runs it, persists the result to agent_runs, and returns AgentRunResult.
 *
 * This is the single entry point for all agent invocations — whether from
 * the internal API, a cron job, or an external platform webhook.
 */
import { prisma } from '@/lib/prisma';
import { AgentEvent, AgentRunResult } from './types';
import { getAgent } from './registry';
import { ensureAgentSchema } from './schema';

export async function dispatch(event: AgentEvent): Promise<AgentRunResult> {
  await ensureAgentSchema();

  const started = Date.now();
  let result: AgentRunResult;

  try {
    const agent = await getAgent(event.agent_id);
    result = await agent.run(event);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      agentId:         event.agent_id,
      tenantId:        event.tenant_id,
      eventType:       event.event_type,
      entityId:        event.entity_id,
      status:          'FAILED',
      durationMs:      Date.now() - started,
      itemsProcessed:  0,
      actionsCreated:  0,
      output:          null,
      error:           message,
    };
  }

  // Persist run to audit log — fire and forget (don't let log failure crash the agent)
  persistRun(event, result).catch((e) =>
    console.error('[orchestrator] Failed to persist agent run:', e),
  );

  return result;
}

async function persistRun(event: AgentEvent, result: AgentRunResult): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_runs (
       agent_id, tenant_id, event_type, entity_id,
       input, output, items_processed, actions_created,
       duration_ms, status, error_text
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    result.agentId,
    result.tenantId,
    result.eventType,
    result.entityId ?? null,
    JSON.stringify(event.payload ?? {}),
    JSON.stringify(result.output ?? {}),
    result.itemsProcessed,
    result.actionsCreated,
    result.durationMs,
    result.status,
    result.error ?? null,
  );
}

/**
 * Convenience: dispatch a manual full-scan for an agent.
 * Used by the "Run Analysis" buttons in the UI.
 */
export async function triggerFullScan(
  agentId: AgentEvent['agent_id'],
  tenantId = 'default',
): Promise<AgentRunResult> {
  return dispatch({
    tenant_id:  tenantId,
    agent_id:   agentId,
    event_type: 'manual.trigger',
  });
}
