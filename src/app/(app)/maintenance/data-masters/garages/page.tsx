/**
 * Garage master data is owned by the Vendors / Procurement module.
 * Canonical location: /vendors/garages
 */
import { redirect } from 'next/navigation';

export default function GaragesMasterRedirect() {
  redirect('/vendors/garages');
}
