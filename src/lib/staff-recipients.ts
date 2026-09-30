/**
 * Who inside a tenant gets a staff email: the members holding a role (e.g.
 * LEASING_MANAGER, TRANSPORT_MANAGER), else the tenant's contact email
 * (Admin > Company profile). Tenant ids come from the session or a record,
 * never from input.
 */
import 'server-only';
import { tenantContact } from '@/lib/tenant-contact';
import { getRoleHolders } from '@/lib/workflow-db';

/** Addresses of the role's holders in the tenant, else the tenant contact. */
export async function staffRecipients(tenantId: string, roleCode: string): Promise<string[]> {
  const holders = await getRoleHolders(tenantId, roleCode).catch(() => []);
  if (holders.length) return holders.map((h) => h.email);
  const contact = await tenantContact(tenantId);
  return contact ? [contact.email] : [];
}
