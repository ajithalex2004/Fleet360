/**
 * Who inside a tenant gets a staff email: the members holding a role (e.g.
 * LEASING_MANAGER), else the tenant's contact email (Admin > Company
 * profile). Tenant ids come from the session or a record, never from input.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { runAsTenant } from '@/lib/rls-scope';
import { getRoleHolders, parseEmailList } from '@/lib/workflow-db';

/** The tenant's contact email and name, if it has one. */
export async function tenantContact(tenantId: string): Promise<{ email: string; name: string } | null> {
  const tenant = await runAsTenant(tenantId, () => prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { contactEmail: true, contactName: true, name: true },
  })).catch(() => null);
  const email = parseEmailList(tenant?.contactEmail)[0];
  return email ? { email, name: tenant?.contactName ?? tenant?.name ?? '' } : null;
}

/** Addresses of the role's holders in the tenant, else the tenant contact. */
export async function staffRecipients(tenantId: string, roleCode: string): Promise<string[]> {
  const holders = await getRoleHolders(tenantId, roleCode).catch(() => []);
  if (holders.length) return holders.map((h) => h.email);
  const contact = await tenantContact(tenantId);
  return contact ? [contact.email] : [];
}
