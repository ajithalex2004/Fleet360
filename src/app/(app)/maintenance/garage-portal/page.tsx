/**
 * The Garage Portal (vendor quotation submission) is owned by the Vendors module.
 * Canonical location: /vendors/garage-portal
 */
import { redirect } from 'next/navigation';

export default function GaragePortalRedirect() {
  redirect('/vendors/garage-portal');
}
