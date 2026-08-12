/**
 * Garage management is owned by the Vendors / Procurement module.
 * Canonical location: /vendors/garages
 * Maintenance retains a read-only consumer view at /maintenance/garage-assignments.
 */
import { redirect } from 'next/navigation';

export default function GarageManagementRedirect() {
  redirect('/vendors/garages');
}
