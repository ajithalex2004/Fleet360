/**
 * Notification history is a platform-wide concern, not owned by Maintenance.
 * The canonical view lives under /admin/settings/notifications.
 */
import { redirect } from 'next/navigation';

export default function MaintenanceNotificationHistoryRedirect() {
    redirect('/admin/settings/notifications');
}
