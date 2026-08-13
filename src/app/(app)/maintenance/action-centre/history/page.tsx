/**
 * Alert history is owned by the platform Alert Engine.
 * Canonical location: /admin/alerts
 */
import { redirect } from 'next/navigation';

export default function ActionCentreHistoryRedirect() {
  redirect('/admin/alerts');
}
