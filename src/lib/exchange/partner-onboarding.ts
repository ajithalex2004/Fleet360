/**
 * The tenant that onboards a transport partner, and invitations that create
 * the partner's users.
 *
 * Partner companies are onboarded by a tenant (transport_partners
 * .onboarded_by_tenant_id). Their staff are users of that tenant, so they
 * appear in its User Master, and each is also a partner member
 * (partner_users), which is what opens the partner portal and marketplace.
 *
 * A platform administrator invites a partner user by email from
 * /admin/exchange-partners. The invitation is an ordinary tenant invitation
 * (tenant_invitations) for the onboarding tenant, with the Partner tenant
 * role (src/lib/exchange/partner-role.ts), that also names the partner and
 * partner role; accepting it (/api/auth/invitation/accept) creates the
 * user, the tenant membership and the partner membership in one transaction.
 *
 * Callers run these inside withPlatformAdmin: partners are platform records,
 * while tenant_invitations, tenant_partner_relationships and roles are
 * tenant-isolated by RLS.
 */
import type { Prisma } from '@prisma/client';
import { PARTNER_ROLES, type PartnerRole } from '@/lib/exchange/partner-auth';

type Tx = Prisma.TransactionClient;

export function isPartnerRole(v: unknown): v is PartnerRole {
  return typeof v === 'string' && (PARTNER_ROLES as readonly string[]).includes(v);
}

/** An active tenant by id, or null. */
export async function findActiveTenant(tx: Tx, tenantId: string) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, plan: true, isActive: true },
  });
  return tenant?.isActive ? tenant : null;
}

/**
 * Records `tenantId` as the tenant that onboarded the partner, and puts the
 * partner in that tenant's network (tenant_partner_relationships, APPROVED)
 * unless a relationship already exists, so a BLOCKED one stays blocked.
 */
export async function setOnboardingTenant(tx: Tx, partnerId: string, tenantId: string): Promise<void> {
  await tx.transportPartner.update({ where: { id: partnerId }, data: { onboardedByTenantId: tenantId } });
  await tx.tenantPartnerRelationship.upsert({
    where: { tenantId_partnerId: { tenantId, partnerId } },
    create: { tenantId, partnerId, status: 'APPROVED' },
    update: {},
  });
}

/**
 * Called when an invitation is accepted: links the user to the invitation's
 * partner with its partner role. Returns false, linking nothing, when the
 * partner is gone or the role is unknown.
 */
export async function linkInvitedPartnerUser(
  tx: Tx,
  invitation: { partner_id: string | null; partner_role: string | null },
  userId: string,
): Promise<boolean> {
  if (!invitation.partner_id || !isPartnerRole(invitation.partner_role)) return false;
  const partner = await tx.transportPartner.findFirst({
    where: { id: invitation.partner_id, deletedAt: null },
    select: { id: true },
  });
  if (!partner) return false;
  await tx.partnerUser.upsert({
    where: { partnerId_userId: { partnerId: partner.id, userId } },
    create: { partnerId: partner.id, userId, role: invitation.partner_role },
    update: { role: invitation.partner_role },
  });
  return true;
}
