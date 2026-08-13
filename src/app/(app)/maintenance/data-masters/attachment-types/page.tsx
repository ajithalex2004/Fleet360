/**
 * Attachment-type master is a Documents Platform concern, not owned by Maintenance.
 * Canonical location: /documents/attachment-types (Documents Platform — pending).
 * Redirecting to Admin Settings in the interim.
 */
import { redirect } from 'next/navigation';

export default function AttachmentTypesRedirect() {
  redirect('/admin/settings');
}
