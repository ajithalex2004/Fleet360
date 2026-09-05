/**
 * Agent Orchestration Bus
 * -----------------------
 * The event router. Receives an AgentEvent, resolves the correct agent,
 * runs it, persists the result to agent_runs, updates ROI metrics, and returns AgentRunResult.
 *
 * This is the single entry point for all agent invocations — whether from
 * the internal API, a cron job, or an external platform webhook.
 */
import { prisma } from '@/lib/prisma';
import { AgentEvent, AgentRunResult, ModelCapabilityAlias, ModelProviderType } from './types';
import { getAgent } from './registry';
import { ensureAgentSchema } from './schema';
import { calculateTokenCost, updateDailyRoiMetrics, USD_TO_AED_RATE } from './telemetry';

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

  // Persist run and update ROI metrics — fire and forget
  persistRun(event, result).catch((e) =>
    console.error('[orchestrator] Failed to persist agent run:', e),
  );

  return result;
}

async function persistRun(event: AgentEvent, result: AgentRunResult): Promise<void> {
  // Infer / extract telemetry
  const t = result.telemetry ?? {};
  let modelAlias: ModelCapabilityAlias = t.modelAlias ?? 'DETERMINISTIC_RULES';
  let modelProvider: ModelProviderType = t.modelProvider ?? 'deterministic';

  if (!t.modelAlias) {
    if (result.agentId === 'route-optimiser' || result.agentId === 'staff-transport-planner' || result.agentId === 'dispatch-optimiser') {
      modelAlias = 'LOCAL_STATISTICAL';
      modelProvider = 'local_solver';
    } else if (result.agentId === 'incident-triage' || result.agentId === 'driver-coach' || result.agentId === 'demand-forecasting') {
      modelAlias = 'ECONOMY_TEXT';
      modelProvider = 'openai';
    }
  }

  const inputTokens = t.inputTokens ?? 0;
  const outputTokens = t.outputTokens ?? 0;
  const cachedTokens = t.cachedTokens ?? 0;
  const tokenCost = calculateTokenCost(modelAlias, inputTokens, outputTokens, cachedTokens);

  const costUsd = t.costUsd ?? tokenCost.costUsd;
  const costAed = t.costAed ?? (costUsd > 0 ? costUsd * USD_TO_AED_RATE : tokenCost.costAed);

  // Auto-extract savings from output if present
  let estimatedSavingsAed = t.estimatedSavingsAed ?? 0;
  let businessOutcome = t.businessOutcome ?? null;

  if (result.output && typeof result.output === 'object') {
    const out = result.output as Record<string, unknown>;
    if (typeof out.monthlyCostSavingsAed === 'number' && out.monthlyCostSavingsAed > 0) {
      estimatedSavingsAed = out.monthlyCostSavingsAed;
      businessOutcome = businessOutcome ?? 'VEHICLE_SAVED';
    } else if (typeof out.monthlyCostSavedAed === 'number' && out.monthlyCostSavedAed > 0) {
      estimatedSavingsAed = out.monthlyCostSavedAed;
      businessOutcome = businessOutcome ?? 'VEHICLE_SAVED';
    } else if (typeof out.financialExposureAed === 'number' && out.financialExposureAed > 0) {
      estimatedSavingsAed = out.financialExposureAed;
      businessOutcome = businessOutcome ?? 'INVOICE_ANOMALY_STOPPED';
    }
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_runs (
       agent_id, tenant_id, event_type, entity_id,
       input, output, items_processed, actions_created,
       duration_ms, status, error_text,
       model_alias, model_provider, input_tokens, output_tokens, cached_tokens,
       tool_calls_count, agent_hops_count, matrix_elements_queried, solver_duration_ms,
       cost_usd, cost_aed, estimated_savings_aed, actual_savings_aed,
       business_outcome, decision_quality_score, human_feedback
     ) VALUES (
       $1,$2,$3,$4,
       $5,$6,$7,$8,
       $9,$10,$11,
       $12,$13,$14,$15,$16,
       $17,$18,$19,$20,
       $21,$22,$23,$24,
       $25,$26,$27
     )`,
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
    modelAlias,
    modelProvider,
    inputTokens,
    outputTokens,
    cachedTokens,
    t.toolCallsCount ?? 0,
    t.agentHopsCount ?? 0,
    t.matrixElementsQueried ?? 0,
    t.solverDurationMs ?? 0,
    costUsd,
    costAed,
    estimatedSavingsAed,
    t.actualSavingsAed ?? 0,
    businessOutcome,
    t.decisionQualityScore ?? null,
    t.humanFeedback ?? null,
  );

  // Update aggregated daily ROI
  await updateDailyRoiMetrics({
    tenantId: result.tenantId,
    agentId: result.agentId,
    costUsd,
    costAed,
    savingsAed: estimatedSavingsAed,
    wasAccepted: t.humanFeedback === 'ACCEPTED' || t.humanFeedback === 'AUTO_EXECUTED' || result.status === 'COMPLETED',
  });
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
