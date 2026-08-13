/**
 * AlertEngineConsumer
 *
 * Subscribes to `alert.condition_detected` events and turns them into
 * enriched Alert rows using the AlertRule table. This is the ONE place
 * every module's alert routing decision lives — severity, channels,
 * recipients, SLA due dates, escalation ladder — so a new condition
 * only needs a publisher + an operator-configured AlertRule.
 *
 * Flow:
 *   1. Look up AlertRule by (tenantId, code). No rule → sensible defaults.
 *   2. Compute dedup key (payload.dedupeKey or `${code}:${subjectId}`).
 *   3. If an OPEN Alert with that dedup key already exists, skip
 *      (idempotency; the partial unique index would raise anyway).
 *   4. Create the Alert with:
 *        - severity: payload override > rule default > 'MEDIUM'
 *        - channels + recipients: from rule
 *        - slaAckDueAt / slaResolveDueAt: createdAt + rule minutes
 *        - status: 'OPEN'
 *        - escalationLevel: 0
 *   5. The escalation cron (docs/FOLLOWUP_ALERT_ENGINE.md) picks it up
 *      from there.
 *
 * Notification delivery is intentionally NOT this consumer's job — the
 * downstream channel workers (push / sms / whatsapp / email / in_app)
 * poll Alert rows with unshipped channel messages. Same separation as
 * NotificationLog. Alternative: this consumer could also write
 * NotificationLog rows so the existing send pipeline delivers — that's
 * the recommended follow-up (see doc) since it reuses infra.
 */

import { randomUUID }               from 'crypto';
import { BaseEventConsumer }        from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { prisma }                   from '@/lib/prisma';
import type { AlertConditionDetectedPayload } from '@/events/contracts/alert.events';

const DEFAULT_SEVERITY = 'MEDIUM' as const;

/** Derive a stable dedup key when the publisher didn't supply one. */
function defaultDedupeKey(code: string, subjectId: string): string {
  return `${code}:${subjectId}`;
}

/**
 * A minimum "one-shot" write when no AlertRule exists for the code.
 * Keeps the Alert row visible so ops know something happened, even if
 * nobody's routed to a channel yet.
 */
interface ResolvedRouting {
  severity:            string;
  channels:            string[];
  recipients:          string[];
  slaAckDueAt:         Date | null;
  slaResolveDueAt:     Date | null;
}

export class AlertEngineConsumer extends BaseEventConsumer<AlertConditionDetectedPayload> {
  readonly consumerName = 'alert-engine';
  readonly eventType    = 'alert.condition_detected';

  protected async handle(envelope: DomainEventEnvelope<AlertConditionDetectedPayload>): Promise<void> {
    const { data } = envelope;
    const tenantId = envelope.tenantId;
    if (!tenantId) {
      console.warn('[alert-engine] no tenantId on envelope — skipping');
      return;
    }
    if (!data?.code || !data?.subjectId) {
      console.warn('[alert-engine] malformed payload (code/subjectId missing) — skipping', envelope.eventId);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rule: any = await prisma.alertRule.findFirst({
      where: { tenantId, code: data.code, isEnabled: true, deletedAt: null },
    });

    const routing = resolveRouting(rule, data);
    const dedupeKey = data.dedupeKey ?? defaultDedupeKey(data.code, data.subjectId);
    const now = new Date();

    // Dedup guard: skip if an OPEN Alert with this key already exists.
    // The partial unique index would raise on the create anyway; this
    // pre-check gives a cleaner log path and avoids a rollback.
    const existing = await prisma.alert.findFirst({
      where: {
        tenantId,
        dedupeKey,
        resolvedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      console.log(`[alert-engine] dedup: ${data.code} for ${data.subjectId} already OPEN as ${existing.id}`);
      return;
    }

    try {
      await prisma.alert.create({
        data: {
          id:            randomUUID(),
          tenantId,
          code:          data.code,
          type:          data.code,             // populate legacy `type` for back-compat
          title:         data.title,
          description:   data.description ?? null,
          severity:      routing.severity,
          status:        'OPEN',
          dateCreated:   now,
          sourceModule:  data.sourceModule,
          sourceEventId: envelope.eventId,
          subjectType:   data.subjectType,
          subjectId:     data.subjectId,
          relatedEntityId: data.subjectId,      // populate legacy field so old readers still work
          dedupeKey,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          context:       (data.context ?? null) as any,
          channels:      routing.channels,
          recipients:    routing.recipients,
          slaAckDueAt:     routing.slaAckDueAt,
          slaResolveDueAt: routing.slaResolveDueAt,
        },
      });
      console.log(`[alert-engine] raised ${data.code} for ${data.subjectId} (${routing.channels.length} channels)`);
    } catch (err) {
      // Unique-index violation → race with another worker for the same
      // dedup key. Safe to treat as "already handled".
      const msg = err instanceof Error ? err.message : String(err);
      if (/uq_alerts_open_dedupe/.test(msg)) {
        console.log(`[alert-engine] race lost on dedup for ${data.code}:${data.subjectId} — other worker won`);
        return;
      }
      throw err;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveRouting(rule: any | null, data: AlertConditionDetectedPayload): ResolvedRouting {
  const severity = data.severity ?? rule?.defaultSeverity ?? DEFAULT_SEVERITY;
  const channels   = rule?.defaultChannels ?? [];
  // Recipients: role tokens from recipientTypes, plus explicit ids from
  // specificRecipientIds — the send pipeline handles the CUSTOM/role split.
  const recipients = [
    ...(rule?.recipientTypes ?? []),
    ...(rule?.specificRecipientIds ?? []),
  ];
  const now = Date.now();
  const slaAckDueAt     = rule?.slaAckMinutes     ? new Date(now + rule.slaAckMinutes     * 60_000) : null;
  const slaResolveDueAt = rule?.slaResolveMinutes ? new Date(now + rule.slaResolveMinutes * 60_000) : null;
  return { severity, channels, recipients, slaAckDueAt, slaResolveDueAt };
}
