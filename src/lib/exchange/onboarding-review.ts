/**
 * Who reviews and activates a transport partner: the administrators of the
 * tenant that onboarded it (transport_partners.onboarded_by_tenant_id), and
 * platform administrators for any partner. Used by /api/admin/exchange/
 * onboarding/*, whose ADMIN_ROUTE_POLICY level ('admin') already requires
 * TENANT_ADMIN or SUPER_ADMIN; checked again here so each handler is safe
 * on its own.
 */
import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { isSuperAdmin, TENANT_ADMIN } from '@/lib/admin-access';
import { sendEmail } from '@/lib/email';

type Tx = Prisma.TransactionClient;

/** The onboarding tenant a reviewer may act for; null means every tenant (platform administrator). */
export type ReviewerScope = { tenantId: string | null };

export function reviewerScope(
  headers: Headers,
  tenantId: string,
): { ok: true; scope: ReviewerScope } | { ok: false; response: NextResponse } {
  if (isSuperAdmin(headers)) return { ok: true, scope: { tenantId: null } };
  if (headers.get('x-user-role') === TENANT_ADMIN) return { ok: true, scope: { tenantId } };
  return {
    ok: false,
    response: NextResponse.json({ error: 'Only your company\'s administrators review transport partners' }, { status: 403 }),
  };
}

/** Prisma filter for the partners a reviewer may see. */
export function scopeWhere(scope: ReviewerScope): Prisma.TransportPartnerWhereInput {
  return scope.tenantId ? { deletedAt: null, onboardedByTenantId: scope.tenantId } : { deletedAt: null };
}

/** The partner's id when the reviewer may act on it, else null (reported as not found). */
export async function findReviewablePartner(tx: Tx, scope: ReviewerScope, partnerId: string) {
  return tx.transportPartner.findFirst({
    where: { id: partnerId, ...scopeWhere(scope) },
    select: { id: true, legalName: true, onboardingStatus: true, onboardedByTenantId: true },
  });
}

/** Email addresses of a partner's members with `roles`. */
export async function partnerMemberEmails(tx: Tx, partnerId: string, roles: readonly string[]): Promise<string[]> {
  const rows = await tx.partnerUser.findMany({
    where: { partnerId, role: { in: [...roles] } },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(rows.map((r) => r.user.email).filter((e): e is string => !!e))];
}

/** Email addresses of a tenant's active administrators. */
export async function tenantAdminEmails(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx.userTenant.findMany({
    where: { tenantId, isActive: true, role: { code: TENANT_ADMIN } },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(rows.map((r) => r.user.email).filter((e): e is string => !!e))];
}

/** Best effort: a failed notification never fails the review action. */
export async function notify(to: string[], subject: string, lines: string[]): Promise<void> {
  if (to.length === 0) return;
  try {
    await sendEmail({
      to,
      subject,
      text: lines.join('\n'),
      html: lines.map((l) => (l ? `<p>${escapeHtml(l)}</p>` : '')).join(''),
    });
  } catch (err) {
    console.error('[exchange/onboarding] notification failed:', err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
