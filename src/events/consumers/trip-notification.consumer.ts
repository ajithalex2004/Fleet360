import { BaseEventConsumer } from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { enqueueRiderNotifications, RIDER_EVENTS } from '@/lib/bus-ops/rider-notifications';
export const TRIP_NOTIFICATION_EVENT_TYPES = [...RIDER_EVENTS];
/** Tenant rules and actual rider contacts; delivery is handled by bus-rider-notifications. */
export class TripNotificationDispatchConsumer extends BaseEventConsumer<unknown> {
 constructor(readonly eventType: string, readonly consumerName: string) { super(); }
 protected async handle(event: DomainEventEnvelope<unknown>): Promise<void> {
  await withTenantRls(prisma,event.tenantId,tx => enqueueRiderNotifications(tx,event));
 }
}
