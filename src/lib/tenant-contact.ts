/**
 * A tenant's contact email and name (Admin > Company profile), for staff
 * notifications and as the reply-to of customer notices. Tenant ids come
 * from the session or a record, never from request input.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { runAsTenant } from '@/lib/rls-scope';

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export async function tenantContact(tenantId: string): Promise<{ email: string; name: string } | null> {
  const tenant = await runAsTenant(tenantId, () => prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { contactEmail: true, contactName: true, name: true },
  })).catch(() => null);
  const email = tenant?.contactEmail?.trim().toLowerCase();
  return email && EMAIL_RE.test(email) ? { email, name: tenant?.contactName ?? tenant?.name ?? '' } : null;
}
