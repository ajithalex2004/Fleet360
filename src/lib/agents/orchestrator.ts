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
import { policyService } from './governance';

export async function dispatch(event: AgentEvent): Promise<AgentRunResult> {
  const run = await startRun(event);
  return run.result;
}

/**
 * `started`: the run passed the governance checks and is executing.
 * `result` resolves when the agent finishes; `settled` resolves once the
 * agent_runs row also holds the final result (what GET /api/agents/run
 * reads). `rejected`: governance refused the run; nothing was recorded.
 */
export type StartedRun =
  | { kind: 'started'; runId: string; result: Promise<AgentRunResult>; settled: Promise<void> }
  | { kind: 'rejected'; result: AgentRunResult };

/**
 * Runs the governance checks, records the run as RUNNING in agent_runs and
 * starts the agent without waiting for it to finish.
 *
 * The orchestrator owns the run row. Agents that log their own row
 * (finance-anomaly, predictive-maintenance, staff-transport-planner) reuse
 * `event.run_id` and leave the row to the orchestrator; before, every run
 * of those agents was logged twice.
 */
export async function startRun(event: AgentEvent): Promise<StartedRun> {
  await ensureAgentSchema();

  const started = Date.now();
  const rejected = (error: string): StartedRun => ({
    kind: 'rejected',
    result: {
      agentId:         event.agent_id,
      tenantId:        event.tenant_id,
      eventType:       event.event_type,
      entityId:        event.entity_id,
      status:          'FAILED',
      durationMs:      Date.now() - started,
      itemsProcessed:  0,
      actionsCreated:  0,
      output:          null,
      error,
    },
  });

  // Governance: budget caps / circuit breaker, then disabled agents.
  const refusal = await checkRunAllowed(event.tenant_id, event.agent_id);
  if (refusal) {
    return rejected(refusal);
  }

  // Always a fresh id: events can arrive from outside (/api/agents/ingest
  // passes its request body through), and a caller-chosen id would let the
  // final upsert overwrite an existing run.
  const runId = crypto.randomUUID();
  const runEvent: AgentEvent = { ...event, run_id: runId };

  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_runs (id, agent_id, tenant_id, event_type, entity_id, status, created_at)
     VALUES ($1::uuid, $2, $3, $4, $5, 'RUNNING', NOW())
     ON CONFLICT (id) DO NOTHING`,
    runId,
    runEvent.agent_id,
    runEvent.tenant_id,
    runEvent.event_type,
    runEvent.entity_id ?? null,
  ).catch((e) => console.error('[orchestrator] Failed to record agent run start:', e));

  const result = executeAgent(runEvent, started);
  const settled = result.then((r) => persistRun(runEvent, runId, r)).catch((e) =>
    console.error('[orchestrator] Failed to persist agent run:', e),
  );

  return { kind: 'started', runId, result, settled };
}

async function executeAgent(event: AgentEvent, started: number): Promise<AgentRunResult> {
  try {
    const agent = await getAgent(event.agent_id);
    return await agent.run(event);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
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
}

/**
 * agent_runs.input is an audit record, not a blob store: long strings (a
 * base64 upload from /api/documents/intelligence/extract, a whole document's
 * text) are replaced by their length.
 */
const MAX_INPUT_STRING = 2_000;
function summariseInput(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_INPUT_STRING ? `[omitted: ${value.length} chars]` : value;
  }
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => summariseInput(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, summariseInput(v, depth + 1)]),
  );
}

async function persistRun(event: AgentEvent, runId: string, result: AgentRunResult): Promise<void> {
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
       id,
       agent_id, tenant_id, event_type, entity_id,
       input, output, items_processed, actions_created,
       duration_ms, status, error_text,
       model_alias, model_provider, input_tokens, output_tokens, cached_tokens,
       tool_calls_count, agent_hops_count, matrix_elements_queried, solver_duration_ms,
       cost_usd, cost_aed, estimated_savings_aed, actual_savings_aed,
       business_outcome, decision_quality_score, human_feedback
     ) VALUES (
       $28::uuid,
       $1,$2,$3,$4,
       $5::jsonb,$6::jsonb,$7,$8,
       $9,$10,$11,
       $12,$13,$14,$15,$16,
       $17,$18,$19,$20,
       $21,$22,$23,$24,
       $25,$26,$27
     )
     ON CONFLICT (id) DO UPDATE SET
       agent_id = EXCLUDED.agent_id,
       tenant_id = EXCLUDED.tenant_id,
       event_type = EXCLUDED.event_type,
       entity_id = EXCLUDED.entity_id,
       input = EXCLUDED.input,
       output = EXCLUDED.output,
       items_processed = EXCLUDED.items_processed,
       actions_created = EXCLUDED.actions_created,
       duration_ms = EXCLUDED.duration_ms,
       status = EXCLUDED.status,
       error_text = EXCLUDED.error_text,
       model_alias = EXCLUDED.model_alias,
       model_provider = EXCLUDED.model_provider,
       input_tokens = EXCLUDED.input_tokens,
       output_tokens = EXCLUDED.output_tokens,
       cached_tokens = EXCLUDED.cached_tokens,
       tool_calls_count = EXCLUDED.tool_calls_count,
       agent_hops_count = EXCLUDED.agent_hops_count,
       matrix_elements_queried = EXCLUDED.matrix_elements_queried,
       solver_duration_ms = EXCLUDED.solver_duration_ms,
       cost_usd = EXCLUDED.cost_usd,
       cost_aed = EXCLUDED.cost_aed,
       estimated_savings_aed = EXCLUDED.estimated_savings_aed,
       actual_savings_aed = EXCLUDED.actual_savings_aed,
       business_outcome = EXCLUDED.business_outcome,
       decision_quality_score = EXCLUDED.decision_quality_score,
       human_feedback = EXCLUDED.human_feedback`,
    result.agentId,
    result.tenantId,
    result.eventType,
    result.entityId ?? null,
    JSON.stringify(summariseInput(event.payload ?? {})),
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
    runId,
  );

  // Update aggregated daily ROI
  await updateDailyRoiMetrics({
    tenantId: result.tenantId,
    agentId: result.agentId,
    costUsd,
    costAed,
    savingsAed: estimatedSavingsAed,
    // Accepted means a human (or a policy-allowed auto-execution) took the
    // agent's output — not merely that the run completed.
    wasAccepted: t.humanFeedback === 'ACCEPTED' || t.humanFeedback === 'AUTO_EXECUTED',
  });
}

// ── Governance for calls that don't go through dispatch() ─────────────────────
//
// The co-pilot REST routes and the streaming chat routes call the model
// themselves (they need their own response shapes, or stream). They still
// have to pass the same governance as dispatch() — budget caps, manual
// circuit breaker, disabledAgents — and their spend has to land in
// agent_runs / agent_roi_metrics, or the budget never sees it.

/**
 * The governance pre-check shared by dispatch() and direct calls.
 * Returns null when the run may start, else the reason it may not.
 */
export async function checkRunAllowed(tenantId: string, agentId: string): Promise<string | null> {
  const quota = await policyService.checkBudgetQuota(tenantId);
  if (!quota.allowed) {
    return quota.reason ?? 'Tenant AI budget exceeded.';
  }
  const policy = await policyService.getTenantPolicy(tenantId);
  if (policy.disabledAgents.includes(agentId)) {
    return `Agent '${agentId}' is disabled by tenant policy.`;
  }
  return null;
}

/** Record a finished run made outside dispatch(): agent_runs row + daily ROI/spend. */
export async function recordRun(event: AgentEvent, result: AgentRunResult): Promise<void> {
  await persistRun(event, crypto.randomUUID(), result);
}

export type GovernedOutcome<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Run `call` under governance: refuse it if checkRunAllowed says no,
 * otherwise run it and record the run (toResult supplies status, output and
 * token telemetry). A call that throws is recorded as FAILED and rethrown.
 * Recording is best-effort: a logging failure never fails the caller.
 */
export async function runGoverned<T>(
  event: AgentEvent,
  call: () => Promise<T>,
  toResult: (value: T, durationMs: number) => AgentRunResult,
): Promise<GovernedOutcome<T>> {
  await ensureAgentSchema();
  const refusal = await checkRunAllowed(event.tenant_id, event.agent_id);
  if (refusal) return { ok: false, reason: refusal };

  const started = Date.now();
  let value: T;
  try {
    value = await call();
  } catch (err) {
    await recordRun(event, {
      agentId:        event.agent_id,
      tenantId:       event.tenant_id,
      eventType:      event.event_type,
      entityId:       event.entity_id,
      status:         'FAILED',
      durationMs:     Date.now() - started,
      itemsProcessed: 0,
      actionsCreated: 0,
      output:         null,
      error:          err instanceof Error ? err.message : String(err),
    }).catch((e) => console.error('[orchestrator] Failed to record governed run:', e));
    throw err;
  }
  await recordRun(event, toResult(value, Date.now() - started))
    .catch((e) => console.error('[orchestrator] Failed to record governed run:', e));
  return { ok: true, value };
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

/**
 * Same as triggerFullScan, but returns as soon as the run is recorded as
 * RUNNING instead of waiting for the agent to finish.
 */
export async function startFullScan(
  agentId: AgentEvent['agent_id'],
  tenantId = 'default',
): Promise<StartedRun> {
  return startRun({
    tenant_id:  tenantId,
    agent_id:   agentId,
    event_type: 'manual.trigger',
  });
}

// Re-export Multi-Tenant Event Dispatcher
export { eventDispatcher, publishEvent, type PublishEventOptions } from './dispatcher';

// Re-export Governance & Policy Service
export { policyService, PolicyService, type TenantPolicy, type ActionProposal, type AutonomyDecision, type ApprovalItem } from './governance';


