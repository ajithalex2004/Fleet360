/**
 * Fleet360 Agent Telemetry & Cost / ROI Valuation Engine
 * --------------------------------------------------------
 * Central accounting engine for AI model tokens, routing matrix elements,
 * solver compute time, and business savings attribution across all agents.
 */

import { prisma } from '@/lib/prisma';
import {
  AgentEvaluationEvent,
  AgentId,
  ModelCapabilityAlias,
} from './types';
import { ensureAgentSchema } from './schema';

export const USD_TO_AED_RATE = 3.6725;

/**
 * Capability-based pricing table per 1,000,000 tokens (USD)
 */
export const CAPABILITY_PRICING: Record<
  ModelCapabilityAlias,
  { inputPerMillion: number; outputPerMillion: number; cachedPerMillion: number }
> = {
  DETERMINISTIC_RULES: { inputPerMillion: 0.0, outputPerMillion: 0.0, cachedPerMillion: 0.0 },
  LOCAL_STATISTICAL:   { inputPerMillion: 0.0, outputPerMillion: 0.0, cachedPerMillion: 0.0 },
  ECONOMY_TEXT:        { inputPerMillion: 0.15, outputPerMillion: 0.60, cachedPerMillion: 0.075 },
  STANDARD_REASONING:  { inputPerMillion: 2.50, outputPerMillion: 10.00, cachedPerMillion: 1.25 },
  ADVANCED_REASONING:  { inputPerMillion: 5.00, outputPerMillion: 15.00, cachedPerMillion: 2.50 },
  VISION_FAST:         { inputPerMillion: 0.15, outputPerMillion: 0.60, cachedPerMillion: 0.075 },
  VISION_HIGH_ACCURACY:{ inputPerMillion: 2.50, outputPerMillion: 10.00, cachedPerMillion: 1.25 },
  STRUCTURED_EXTRACTION:{ inputPerMillion: 0.15, outputPerMillion: 0.60, cachedPerMillion: 0.075 },
};

/**
 * Routing matrix cost per element (USD)
 */
export const ROUTING_PROVIDER_PRICING: Record<string, number> = {
  google: 0.005,    // $5.00 per 1,000 elements
  mapbox: 0.001,    // $1.00 per 1,000 elements
  haversine: 0.000, // Zero provider cost
  osrm: 0.000,      // Self-hosted / local
};

/**
 * Calculate token cost in USD and AED given a capability alias and token counts
 */
export function calculateTokenCost(
  modelAlias: ModelCapabilityAlias,
  inputTokens = 0,
  outputTokens = 0,
  cachedTokens = 0,
): { costUsd: number; costAed: number } {
  const pricing = CAPABILITY_PRICING[modelAlias] ?? CAPABILITY_PRICING.ECONOMY_TEXT;
  // inputTokens is the provider's prompt total, which already includes the
  // cached tokens (OpenAI: usage.prompt_tokens includes
  // prompt_tokens_details.cached_tokens). Charge the uncached part at the
  // input rate and the cached part at the cached rate; charging the full
  // input plus the cached tokens again billed cached tokens at 150%.
  const cached = Math.min(Math.max(cachedTokens, 0), Math.max(inputTokens, 0));
  const uncached = Math.max(inputTokens, 0) - cached;
  const inCost = (uncached / 1_000_000) * pricing.inputPerMillion;
  const outCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cachedCost = (cached / 1_000_000) * pricing.cachedPerMillion;

  const costUsd = Number((inCost + outCost + cachedCost).toFixed(6));
  const costAed = Number((costUsd * USD_TO_AED_RATE).toFixed(4));

  return { costUsd, costAed };
}

/**
 * Calculate routing matrix expenditure and avoided cost
 */
export function calculateRoutingCost(
  provider: 'google' | 'mapbox' | 'haversine' | 'osrm',
  elementsQueried = 0,
  isCacheHit = false,
): { costUsd: number; costAed: number; costAvoidedUsd: number; costAvoidedAed: number } {
  const unitCost = ROUTING_PROVIDER_PRICING[provider] ?? 0;
  if (isCacheHit) {
    const avoidedUsd = Number((elementsQueried * unitCost).toFixed(5));
    const avoidedAed = Number((avoidedUsd * USD_TO_AED_RATE).toFixed(4));
    return { costUsd: 0, costAed: 0, costAvoidedUsd: avoidedUsd, costAvoidedAed: avoidedAed };
  }

  const costUsd = Number((elementsQueried * unitCost).toFixed(5));
  const costAed = Number((costUsd * USD_TO_AED_RATE).toFixed(4));
  return { costUsd, costAed, costAvoidedUsd: 0, costAvoidedAed: 0 };
}

/**
 * Compute Net Financial Value & ROI Multiplier
 */
export function computeRoi(
  totalCostAed: number,
  totalSavingsAed: number,
): { netValueAed: number; roiMultiplier: number } {
  const netValueAed = Number((totalSavingsAed - totalCostAed).toFixed(2));
  const roiMultiplier =
    totalCostAed <= 0
      ? totalSavingsAed > 0
        ? 999.99
        : 1.0
      : Number((totalSavingsAed / totalCostAed).toFixed(2));

  return { netValueAed, roiMultiplier };
}

/**
 * Record a decision quality metric event (e.g. dispatch acceptance, false positive, driver reassignment)
 */
export async function recordEvaluationMetric(event: AgentEvaluationEvent): Promise<void> {
  await ensureAgentSchema();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_evaluation_metrics (
         agent_id, tenant_id, run_id, entity_id,
         metric_category, metric_name, metric_value,
         is_positive_outcome, notes, recorded_at
       ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,NOW())`,
      event.agentId,
      event.tenantId ?? 'default',
      event.runId ?? null,
      event.entityId ?? null,
      event.metricCategory,
      event.metricName,
      event.metricValue,
      event.isPositiveOutcome,
      event.notes ?? null,
    );
  } catch (err) {
    console.error('[telemetry] Failed to record evaluation metric:', err);
  }
}

/**
 * Upsert daily ROI metrics per tenant & agent
 */
export async function updateDailyRoiMetrics(opts: {
  tenantId: string;
  agentId: AgentId;
  costUsd?: number;
  costAed?: number;
  savingsAed?: number;
  wasAccepted?: boolean;
}): Promise<void> {
  await ensureAgentSchema();
  try {
    const costUsd = opts.costUsd ?? 0;
    const costAed = opts.costAed ?? costUsd * USD_TO_AED_RATE;
    const savingsAed = opts.savingsAed ?? 0;
    const acceptedInc = opts.wasAccepted === true ? 1 : 0;

    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_roi_metrics (
         tenant_id, agent_id, period_date,
         total_executions, total_cost_usd, total_cost_aed,
         total_savings_aed, net_value_aed, roi_multiplier,
         accepted_executions, acceptance_rate_pct, updated_at
       ) VALUES (
         $1, $2, CURRENT_DATE,
         1, $3, $4,
         $5, $5 - $4,
         CASE WHEN $4 > 0 THEN ROUND($5 / $4, 2) ELSE 1.0 END,
         $6, $6 * 100.0,
         NOW()
       )
       ON CONFLICT (tenant_id, agent_id, period_date) DO UPDATE SET
         total_executions = agent_roi_metrics.total_executions + 1,
         total_cost_usd = agent_roi_metrics.total_cost_usd + EXCLUDED.total_cost_usd,
         total_cost_aed = agent_roi_metrics.total_cost_aed + EXCLUDED.total_cost_aed,
         total_savings_aed = agent_roi_metrics.total_savings_aed + EXCLUDED.total_savings_aed,
         net_value_aed = (agent_roi_metrics.total_savings_aed + EXCLUDED.total_savings_aed) - (agent_roi_metrics.total_cost_aed + EXCLUDED.total_cost_aed),
         roi_multiplier = CASE
           WHEN (agent_roi_metrics.total_cost_aed + EXCLUDED.total_cost_aed) > 0
           THEN ROUND((agent_roi_metrics.total_savings_aed + EXCLUDED.total_savings_aed) / (agent_roi_metrics.total_cost_aed + EXCLUDED.total_cost_aed), 2)
           ELSE 1.0
         END,
         accepted_executions = agent_roi_metrics.accepted_executions + EXCLUDED.accepted_executions,
         acceptance_rate_pct = ROUND(
           100.0 * (agent_roi_metrics.accepted_executions + EXCLUDED.accepted_executions)
                 / (agent_roi_metrics.total_executions + 1),
           2),
         updated_at = NOW()`,
      opts.tenantId ?? 'default',
      opts.agentId,
      costUsd,
      costAed,
      savingsAed,
      acceptedInc,
    );
  } catch (err) {
    console.error('[telemetry] Failed to update daily ROI metrics:', err);
  }
}


export interface RecordAiInvocationOptions {
  runId?: string;
  tenantId?: string;
  agentId?: string;
  eventType?: string;
  entityId?: string;
  modelAlias?: ModelCapabilityAlias | string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  durationMs?: number;
  status?: 'COMPLETED' | 'FAILED' | 'RUNNING';
  errorText?: string;
  costUsd?: number;
  costAed?: number;
  savingsAed?: number;
  businessOutcome?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record a live AI runtime invocation directly into agent_runs and update daily ROI.
 * Safe and non-blocking: never throws, preserving caller execution flow.
 */
export async function recordAiInvocation(opts: RecordAiInvocationOptions): Promise<string> {
  const runId = opts.runId || crypto.randomUUID();
  const tenantId = opts.tenantId || 'default';
  const agentId = opts.agentId || 'ai-runtime-service';
  const eventType = opts.eventType || 'AI_INVOCATION';
  const status = opts.status || 'COMPLETED';
  const alias = (opts.modelAlias || 'ECONOMY_TEXT') as ModelCapabilityAlias;
  const inTokens = opts.inputTokens || 0;
  const outTokens = opts.outputTokens || 0;
  const cachedTokens = opts.cachedTokens || 0;

  // Calculate pricing if not provided
  let costUsd = opts.costUsd;
  let costAed = opts.costAed;
  if (costUsd === undefined || costAed === undefined) {
    const calculated = calculateTokenCost(alias, inTokens, outTokens, cachedTokens);
    costUsd = costUsd ?? calculated.costUsd;
    costAed = costAed ?? calculated.costAed;
  }

  const savingsAed = opts.savingsAed || 0;
  const durationMs = opts.durationMs || 0;

  try {
    await ensureAgentSchema();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_runs (
         id, agent_id, tenant_id, event_type, entity_id,
         duration_ms, status, error_text,
         model_alias, model_provider, input_tokens, output_tokens, cached_tokens,
         cost_usd, cost_aed, actual_savings_aed, estimated_savings_aed,
         business_outcome, input, created_at
       ) VALUES (
         $1::uuid, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $16,
         $17, $18::jsonb, NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         error_text = EXCLUDED.error_text,
         duration_ms = EXCLUDED.duration_ms,
         model_alias = EXCLUDED.model_alias,
         model_provider = EXCLUDED.model_provider,
         input_tokens = EXCLUDED.input_tokens,
         output_tokens = EXCLUDED.output_tokens,
         cached_tokens = EXCLUDED.cached_tokens,
         cost_usd = EXCLUDED.cost_usd,
         cost_aed = EXCLUDED.cost_aed,
         actual_savings_aed = EXCLUDED.actual_savings_aed,
         business_outcome = EXCLUDED.business_outcome`,
      runId,
      agentId,
      tenantId,
      eventType,
      opts.entityId || null,
      durationMs,
      status,
      opts.errorText || null,
      alias,
      opts.modelProvider || 'openai',
      inTokens,
      outTokens,
      cachedTokens,
      costUsd,
      costAed,
      savingsAed,
      opts.businessOutcome || null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    );

    // Also update daily ROI
    void updateDailyRoiMetrics({
      tenantId,
      agentId: agentId as AgentId,
      costUsd,
      costAed,
      savingsAed,
      wasAccepted: status === 'COMPLETED',
    });
  } catch (err) {
    console.warn('[telemetry] Non-fatal error recording AI invocation:', err);
  }

  return runId;
}
