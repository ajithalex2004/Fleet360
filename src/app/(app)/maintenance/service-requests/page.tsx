/**
 * Service-request intake is owned by the Service & Support module.
 * Canonical location: /service-tickets
 */
import { redirect } from 'next/navigation';

export default function ServiceRequestsRedirect() {
  redirect('/service-tickets');
}
