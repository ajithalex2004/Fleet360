/**
 * NotificationDispatchConsumer
 *
 * Subscribes to maintenance QC workflow domain events and dispatches
 * notifications by reading the platform NotificationRule table.
 *
 * For each matching enabled rule it renders the template, resolves
 * recipients, and delivers each message in the event's tenant
 * (src/lib/notification-delivery.ts), which records the outcome in
 * NotificationLog.
 *
 * One consumer instance per event type — all share the same class.
 */

import { type NotificationEvent }   from '@prisma/client';
import { BaseEventConsumer }        from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import type { MaintenanceQCEventPayload } from '@/events/contracts/maintenance.events';
import { deliverNotification } from '@/lib/notification-delivery';
import { prisma }                   from '@/lib/prisma';

/**
 * Maps domain event type string → the NotificationEvent enum value that
 * operators configure in the NotificationRule table.
 */
const DOMAIN_TO_NOTIF_EVENT: Record<string, string> = {
    'maintenance.repair_completed':           'REPAIR_COMPLETED',
    'maintenance.quality_inspection_started': 'QUALITY_INSPECTION_STARTED',
    'maintenance.inspection_failed':          'INSPECTION_FAILED',
    'maintenance.vehicle_ready_for_service':  'VEHICLE_READY_FOR_SERVICE',
};

function renderTemplate(template: string, vars: Record<string, string>): string {
    return Object.entries(vars).reduce(
        (s, [k, v]) => s.replaceAll(`{{${k}}}`, v),
        template,
    );
}

export class NotificationDispatchConsumer extends BaseEventConsumer<MaintenanceQCEventPayload> {
    readonly consumerName: string;
    readonly eventType:    string;

    constructor(domainEventType: string, consumerName: string) {
        super();
        this.eventType    = domainEventType;
        this.consumerName = consumerName;
    }

    protected async handle(
        envelope: DomainEventEnvelope<MaintenanceQCEventPayload>,
    ): Promise<void> {
        const notifEvent = DOMAIN_TO_NOTIF_EVENT[envelope.eventType];
        if (!notifEvent) {
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

        const { data } = envelope;
        const vars: Record<string, string> = {
            requestId:  data.requestId,
            vehicleId:  data.vehicleId,
            garageName: data.garageName ?? '',
            status:     envelope.eventType,
            assignee:   '',
        };

        for (const rule of rules) {
            const subject = rule.template
                ? renderTemplate(rule.template.subject ?? envelope.eventType, vars)
                : envelope.eventType;
            const body = rule.template
                ? renderTemplate(rule.template.body, vars)
                : `Event: ${envelope.eventType} — request ${data.requestId}`;

            // CUSTOM rules carry explicit recipient strings; others carry role names
            // (FLEET_MANAGER, ADMIN, etc.) — resolved to actual addresses by the send pipeline.
            const recipients = rule.recipientTypes.includes('CUSTOM')
                ? rule.specificRecipientIds
                : rule.recipientTypes;

            // Delivered now, in the event's tenant (src/lib/notification-delivery.ts).
            // These used to be written as 'Pending' NotificationLog rows for a
            // channel worker that does not exist: nothing was ever sent.
            for (const channel of rule.channels) {
                for (const recipient of recipients) {
                    const outcomes = await deliverNotification({
                        tenantId: envelope.tenantId,
                        channel, recipient, subject, body,
                        triggerReason: `${notifEvent} — ${data.requestId}`,
                    });
                    console.log(
                        `[${this.consumerName}] ${channel} → ${recipient} for request ${data.requestId}: ${outcomes.join(', ')}`,
                    );
                }
            }
        }
    }
}
