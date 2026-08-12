/**
 * Maintenance invoice management (AP) is owned by the Finance module.
 * Canonical location: /finance/invoices
 */
import { redirect } from 'next/navigation';

export default function MaintenanceInvoicesRedirect() {
  redirect('/finance/invoices');
}
