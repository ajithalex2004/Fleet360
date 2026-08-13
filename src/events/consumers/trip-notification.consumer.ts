/**
 * TripNotificationDispatchConsumer
 *
 * Subscribes to Staff Transport / bus-ops trip lifecycle events and writes
 * a NotificationLog row per configured channel × recipient per matching
 * enabled NotificationRule. Downstream channel workers (push / SMS /
 * WhatsApp / email / in-app) pick up Pending rows and actually deliver.
 *
 * Ops configures per-event routing in the NotificationRule table:
 *   NotificationRule.event      → which trip event triggers this rule
 *   NotificationRule.channels   → ['PUSH','SMS','WHATSAPP','EMAIL','IN_APP']
 *   NotificationRule.recipientTypes / specificRecipientIds → who
 *   NotificationRule.template   → subject + body with {{var}} placeholders
 *
 * Design notes vs the maintenance sibling
 * ---------------------------------------
 * We can't reuse NotificationDispatchConsumer directly because its var
 * extraction is hardcoded to the maintenance payload shape
 * (requestId/vehicleId/garageName). This consumer is trip-payload-aware
 * and pulls whatever scalar fields exist on the envelope's `data` so any
 * new trip event just needs a payload type + a registration line — the
 * consumer doesn't need to change per event.
 *
 * Each trip event type gets its own instance of this class so
 * event_consumer_inbox idempotency is scoped per (consumerName, eventId)
 * exactly like the maintenance consumers.
 */

import { randomUUID }               from 'crypto';
import { type NotificationEvent }   from '@prisma/client';
import { BaseEventConsumer }        from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { prisma }                   from '@/lib/prisma';

/**
 * Domain event type string → NotificationEvent enum value that operators
 * configure in the NotificationRule table. Keep in lock-step with the
 * enum in prisma/schema.prisma. Typed as string so this file compiles
 * even when @prisma/client hasn't been regenerated after adding new enum
 * values — the cast happens at the query site (same pattern as the
 * sibling maintenance consumer).
 */
const DOMAIN_TO_NOTIF_EVENT: Record<string, string> = {
  'trip.cancelled':  'TRIP_CANCELLED',
  'trip.departed':   'TRIP_DEPARTED',
  'trip.arriving':   'TRIP_ARRIVING',
  'trip.delayed':    'TRIP_DELAYED',
  'trip.completed':  'TRIP_COMPLETED',
  'vehicle.changed': 'VEHICLE_CHANGED',
  'driver.changed':  'DRIVER_CHANGED',
  'boarding.missed': 'BOARDING_MISSED',
} as const;

/**
 * Every trip event type we handle. Exported so the outbox-publisher's
 * initEventConsumers() can iterate and register one instance per type
 * without duplicating the list.
 */
export const TRIP_NOTIFICATION_EVENT_TYPES = Object.keys(DOMAIN_TO_NOTIF_EVENT);

/**
 * Flatten a payload object to a var map for template rendering. Only
 * scalar fields (string / number / boolean) become vars — nested objects
 * and arrays are skipped rather than JSON-stringified into the template.
 * All values are coerced to string because the template renderer works
 * on strings.
 */
function extractVars(payload: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (payload && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (v == null) { out[k] = ''; continue; }
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = String(v);
      }
    }
  }
  return out;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, v),
    template,
  );
}

export class TripNotificationDispatchConsumer extends BaseEventConsumer<unknown> {
  readonly consumerName: string;
  readonly eventType:    string;

  constructor(domainEventType: string, consumerName: string) {
    super();
    this.eventType    = domainEventType;
    this.consumerName = consumerName;
  }

  protected async handle(envelope: DomainEventEnvelope<unknown>): Promise<void> {
    const notifEvent = DOMAIN_TO_NOTIF_EVENT[envelope.eventType];
    if (!notifEvent) {
      // Should never happen — the class is only registered for the mapped
      // types — but a defensive log helps if someone registers by mistake.
      console.warn(`[${this.consumerName}] no NotificationEvent mapping for ${envelope.eventType}`);
      return;
    }

    const rules = await prisma.notificationRule.findMany({
      where:   { event: notifEvent as NotificationEvent, isEnabled: true },
      include: { template: true },
    });

    if (rules.length === 0) {
      console.log(`[${this.consumerName}] no enabled rules for ${notifEvent} — nothing to dispatch`);
      return;
    }

    // Vars available to templates: every scalar payload field, plus a
    // couple of always-present ones for convenience.
    const vars: Record<string, string> = {
      ...extractVars(envelope.data),
      eventType: envelope.eventType,
      occurredAt: envelope.occurredAt,
      tenantId: envelope.tenantId,
    };

    // TripPassenger-scoped triggers (boarding.missed) carry the specific
    // passengerId — surface it as `triggerReason` context so operators can
    // trace a NotificationLog row back to the exact passenger.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triggerScope = (envelope.data as any)?.passengerId
      ? `passenger:${(envelope.data as { passengerId: string }).passengerId}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : `schedule:${(envelope.data as any)?.scheduleId ?? envelope.aggregateId}`;

    for (const rule of rules) {
      const subject = rule.template
        ? renderTemplate(rule.template.subject ?? envelope.eventType, vars)
        : envelope.eventType;
      const body = rule.template
        ? renderTemplate(rule.template.body, vars)
        : `Event: ${envelope.eventType} — ${triggerScope}`;

      // CUSTOM rules carry explicit recipient strings; others carry role
      // names (FLEET_MANAGER, ADMIN, DRIVER, PASSENGER, etc.) — resolved
      // to actual addresses by the send pipeline.
      const recipients = rule.recipientTypes.includes('CUSTOM')
        ? rule.specificRecipientIds
        : rule.recipientTypes;

      for (const channel of rule.channels) {
        for (const recipient of recipients) {
          await prisma.notificationLog.create({
            data: {
              id:            randomUUID(),
              recipient,
              type:          channel,
              subject,
              body,
              triggerReason: `${notifEvent} — ${triggerScope}`,
              status:        'Pending',
            },
          });
          console.log(
            `[${this.consumerName}] queued ${channel} → ${recipient} for ${notifEvent} (${triggerScope})`,
          );
        }
      }
    }
  }
}
