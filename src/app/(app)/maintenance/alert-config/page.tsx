/**
 * Alert configuration is owned by the platform Alert Engine, not by Maintenance.
 * Cross-module alert rules (registration, insurance, odometer, license) must be
 * configured centrally so every module's thresholds are visible in one place.
 * Canonical location: /admin/alerts
 */
import { redirect } from 'next/navigation';

export default function AlertConfigRedirect() {
  redirect('/admin/alerts');
}
