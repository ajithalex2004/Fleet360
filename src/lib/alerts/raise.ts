/**
 * raiseAlert(...) — the ONE way modules should raise an alert.
 *
 * Publishes an `alert.condition_detected` event via the transactional
 * outbox. The AlertEngineConsumer picks it up, looks up the tenant's
 * AlertRule for the condition, and writes an enriched Alert row with
 * severity / channels / recipients / SLA due dates.
 *
 * The publisher never touches `prisma.alert` directly. That way:
 *   - a new module can raise alerts without duplicating severity /
 *     channel / dedup / SLA logic
 *   - operators change routing by editing AlertRule, not code
 *   - the outbox gives us at-least-once + idempotent dispatch
 *
 * Best-effort by default — a publish failure never blocks the primary
 * business action (mirrors the pattern on trip.completed / cancelled
 * publishers). Callers can opt into strict mode with `{ throwOnError }`
 * for cases where dropping an alert is worse than dropping the action.
 */

import { getEventBus }                            from '@/events/event-bus';
import { ALERT_CONDITION_DETECTED }                from '@/events/contracts/alert.events';
import type { AlertConditionDetectedPayload, AlertSubjectType, AlertSeverityOverride } from '@/events/contracts/alert.events';

export interface RaiseAlertArgs {
  tenantId:     string;
  code:         string;    // AlertCondition or ad-hoc string
  sourceModule: string;
  subjectType:  AlertSubjectType;
  subjectId:    string;
  title:        string;
  description?: string;
  context?:     Record<string, unknown>;
  severity?:    AlertSeverityOverride;
  dedupeKey?:   string;
  /** Correlation id for tracing this alert back to the user action. */
  correlationId?: string;
  /** userId or 'system' — recorded on the event for audit. */
  actor?:       string;
  /** When true, publish errors propagate instead of being swallowed. */
  throwOnError?: boolean;
}

export async function raiseAlert(args: RaiseAlertArgs): Promise<{ eventId?: string }> {
  const payload: AlertConditionDetectedPayload = {
    code:        args.code,
    sourceModule: args.sourceModule,
    subjectType: args.subjectType,
    subjectId:   args.subjectId,
    title:       args.title,
    description: args.description,
    context:     args.context,
    severity:    args.severity,
    dedupeKey:   args.dedupeKey,
  };
  try {
    const { eventId } = await getEventBus().publish({
      eventType:     ALERT_CONDITION_DETECTED,
      aggregateType: args.subjectType,
      aggregateId:   args.subjectId,
      sourceModule:  args.sourceModule,
      tenantId:      args.tenantId,
      correlationId: args.correlationId,
      actor:         args.actor,
      payload,
    });
    return { eventId };
  } catch (err) {
    if (args.throwOnError) throw err;
    console.warn(`[raiseAlert] publish failed for ${args.code}:${args.subjectId} —`, err);
    return {};
  }
}
