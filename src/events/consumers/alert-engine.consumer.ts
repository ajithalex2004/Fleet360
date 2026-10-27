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
 * After raising the alert it delivers it on the rule's channels
 * (enqueueNotifications → src/lib/notification-delivery.ts). There are no
 * downstream channel workers: notifications are sent here or not at all.
 */

import { randomUUID }               from 'crypto';
import { BaseEventConsumer }        from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { deliverNotification } from '@/lib/notification-delivery';
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
      const alertId = randomUUID();
      await prisma.alert.create({
        data: {
          id:            alertId,
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

      // Deliver on each channel × recipient. Best-effort: a delivery
      // failure is recorded in NotificationLog and doesn't undo the alert
      // (the alert is the source of truth; notifications are its delivery).
      await enqueueNotifications({
        tenantId:   envelope.tenantId,
        alertId,
        code:       data.code,
        title:      data.title,
        body:       data.description ?? data.title,
        channels:   routing.channels,
        recipients: routing.recipients,
        subjectId:  data.subjectId,
      }).catch(err => console.warn('[alert-engine] notification fan-out failed:', err));

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

/**
 * Deliver an alert on its rule's channels to its recipients, in the alert's
 * tenant (src/lib/notification-delivery.ts records each outcome). This used
 * to write 'Pending' NotificationLog rows for channel workers that do not
 * exist, so no alert notification was ever sent.
 */
async function enqueueNotifications(args: {
  tenantId: string;
  alertId: string;
  code: string;
  title: string;
  body: string;
  channels: string[];
  recipients: string[];
  subjectId: string;
}): Promise<void> {
  if (args.channels.length === 0 || args.recipients.length === 0) return;
  for (const channel of args.channels) {
    for (const recipient of args.recipients) {
      await deliverNotification({
        tenantId:      args.tenantId,
        channel, recipient,
        subject:       args.title,
        body:          args.body,
        triggerReason: `${args.code} — alert:${args.alertId}`,
      });
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
