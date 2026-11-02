/**
 * Centralized AI Telemetry & Metering API
 * -----------------------------------------
 * Exposes live invocation recording, token metering, and pricing computations.
 */
export {
  recordAiInvocation,
  calculateTokenCost,
  calculateRoutingCost,
  computeRoi,
  updateDailyRoiMetrics,
  recordEvaluationMetric,
  CAPABILITY_PRICING,
  ROUTING_PROVIDER_PRICING,
  USD_TO_AED_RATE,
  type RecordAiInvocationOptions,
} from '@/lib/agents/telemetry';
