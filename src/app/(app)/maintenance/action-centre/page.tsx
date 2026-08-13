/**
 * The Action Centre (active fleet alerts) is owned by the platform Alert Engine.
 * Maintenance-specific alerts are surfaced there alongside alerts from every
 * other module; Maintenance does not own the triage or escalation workflow.
 * Canonical location: /admin/alerts
 */
import { redirect } from 'next/navigation';

export default function ActionCentreRedirect() {
  redirect('/admin/alerts');
}
