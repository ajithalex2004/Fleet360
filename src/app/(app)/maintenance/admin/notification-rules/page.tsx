/**
 * Notification rules are a platform-wide concern, not owned by Maintenance.
 * The canonical editor lives under /admin/settings/notifications.
 * Outbox events from the maintenance workflow are dispatched by
 * NotificationDispatchConsumer in src/events/consumers/notification-dispatch.consumer.ts
 */
import { redirect } from 'next/navigation';

export default function MaintenanceNotificationRulesRedirect() {
    redirect('/admin/settings/notifications');
}
