/**
 * Partner authentication for the Fleet360 Exchange marketplace.
 *
 * A partner user signs in like any other user (xl-session; middleware sets a
 * verified x-user-id). What makes them act for a transport partner is a
 * membership row in partner_users (partner_id, user_id, role), created by a
 * platform admin through /api/admin/exchange/partner-users.
 *
 * Before this, every marketplace route took the partner from a header, query
 * parameter or request body and trusted it, so any signed-in user could act
 * as any partner. requirePartnerContext() resolves the partner from the
 * caller's own memberships instead. A client may still name a partner
 * (x-partner-id header or ?partnerId=) to choose between several
 * memberships, but only one it is a member of.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

export const PARTNER_ROLES = ['PARTNER_ADMIN', 'PARTNER_OPERATIONS', 'PARTNER_FINANCE', 'PARTNER_VIEWER'] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

/** Roles that may submit or revise quotes. */
export const QUOTING_ROLES: readonly PartnerRole[] = ['PARTNER_ADMIN', 'PARTNER_OPERATIONS'];

export interface PartnerMembership {
  partnerId: string;
  role: PartnerRole;
  legalName: string;
  marketplaceStatus: string;
  operationalStatus: string;
}

export interface PartnerContext extends PartnerMembership {
  userId: string;
}

export type PartnerAuthResult =
  | { ok: true; ctx: PartnerContext; memberships: PartnerMembership[] }
  | { ok: false; status: 400 | 401 | 403; error: string; memberships?: PartnerMembership[] };

/** The transport partners the user is a member of (deleted partners excluded). */
export async function partnerMembershipsForUser(userId: string): Promise<PartnerMembership[]> {
  const rows = await prisma.partnerUser.findMany({
    where: { userId, partner: { deletedAt: null } },
    select: {
      role: true,
      partner: { select: { id: true, legalName: true, marketplaceStatus: true, operationalStatus: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    partnerId: r.partner.id,
    role: (PARTNER_ROLES as readonly string[]).includes(r.role) ? (r.role as PartnerRole) : 'PARTNER_VIEWER',
    legalName: r.partner.legalName,
    marketplaceStatus: r.partner.marketplaceStatus,
    operationalStatus: r.partner.operationalStatus,
  }));
}

/**
 * Resolves the partner the signed-in caller acts for.
 *
 * - 401 without a verified user (middleware strips client-sent x-user-id).
 * - 403 when the user is not a member of any partner, is not a member of the
 *   partner it names, or its role is not in `opts.roles`.
 * - 400 when the user belongs to several partners and names none.
 */
export async function requirePartnerContext(
  req: { headers: Headers; nextUrl?: { searchParams: URLSearchParams } },
  opts: { roles?: readonly PartnerRole[] } = {},
): Promise<PartnerAuthResult> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return { ok: false, status: 401, error: 'Sign in to use the partner marketplace.' };

  const memberships = await partnerMembershipsForUser(userId);
  if (memberships.length === 0) {
    return { ok: false, status: 403, error: 'Your account is not linked to a transport partner.' };
  }

  const requested = req.headers.get('x-partner-id') || req.nextUrl?.searchParams.get('partnerId') || null;
  let membership: PartnerMembership | undefined;
  if (requested) {
    membership = memberships.find((m) => m.partnerId === requested);
    if (!membership) {
      return { ok: false, status: 403, error: 'You are not a member of this transport partner.', memberships };
    }
  } else if (memberships.length === 1) {
    membership = memberships[0];
  } else {
    return { ok: false, status: 400, error: 'You belong to several transport partners; choose one with x-partner-id.', memberships };
  }

  if (opts.roles && !opts.roles.includes(membership.role)) {
    return { ok: false, status: 403, error: `Your partner role (${membership.role}) cannot do this.`, memberships };
  }

  return { ok: true, ctx: { ...membership, userId }, memberships };
}

/** JSON error response for a failed requirePartnerContext(). */
export function partnerAuthFailure(result: Extract<PartnerAuthResult, { ok: false }>): NextResponse {
  return NextResponse.json(
    {
      error: result.error,
      ...(result.memberships ? { partners: result.memberships.map(({ partnerId, legalName }) => ({ partnerId, legalName })) } : {}),
    },
    { status: result.status },
  );
}

export type QuoteEligibility =
  | { ok: true; tenantId: string }
  | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * Whether `partnerId` may quote on outsource request `requestId`, and the
 * request's tenant (the buyer) if so. Runs in platform context: the request
 * belongs to another tenant than the partner user's session.
 *
 * Allowed when the partner is marketplace-APPROVED and ACTIVE, the buyer has
 * not BLOCKED it, the request is still open (PUBLISHED or QUOTED) and either
 *   - the partner was invited to it, or
 *   - its marketplace opportunity is OPEN, not past closes_at, in a domain the
 *     partner has an approved capability for, and visible to the partner:
 *     EXCHANGE_NETWORK (any partner) or TENANT_NETWORK (partners with a
 *     relationship to the buyer). DIRECT opportunities are invitation-only.
 * The same rules decide what listOpportunitiesForPartner shows.
 */
export async function checkQuoteEligibility(partnerId: string, requestId: string): Promise<QuoteEligibility> {
  return withPlatformAdmin(prisma, async (tx) => {
    const request = await tx.outsourceRequest.findUnique({
      where: { id: requestId },
      select: {
        tenantId: true,
        status: true,
        opportunity: { select: { status: true, closesAt: true, domain: true, visibility: true } },
        invitedPartners: { where: { partnerId }, select: { status: true } },
      },
    });
    if (!request) return { ok: false, status: 404, error: 'Outsource request not found' };

    const partner = await tx.transportPartner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: {
        marketplaceStatus: true,
        operationalStatus: true,
        capabilities: { where: { isApproved: true }, select: { domain: true } },
        tenantRelationships: { where: { tenantId: request.tenantId }, select: { status: true } },
      },
    });
    if (!partner) return { ok: false, status: 403, error: 'Transport partner not found' };
    if (partner.marketplaceStatus !== 'APPROVED' || partner.operationalStatus !== 'ACTIVE') {
      return { ok: false, status: 403, error: 'Your partner account is not approved and active on the marketplace.' };
    }
    const relationship = partner.tenantRelationships[0];
    if (relationship?.status === 'BLOCKED') {
      return { ok: false, status: 403, error: 'This buyer does not accept quotes from your company.' };
    }
    if (request.status !== 'PUBLISHED' && request.status !== 'QUOTED') {
      return { ok: false, status: 409, error: `This request is no longer open for quotes (${request.status}).` };
    }

    const invited = request.invitedPartners.length > 0;
    if (invited) return { ok: true, tenantId: request.tenantId };

    const opp = request.opportunity;
    const domains = partner.capabilities.map((c) => c.domain);
    const visible =
      !!opp &&
      opp.status === 'OPEN' &&
      opp.closesAt > new Date() &&
      domains.includes(opp.domain) &&
      (opp.visibility === 'EXCHANGE_NETWORK' || (opp.visibility === 'TENANT_NETWORK' && !!relationship));
    if (!visible) {
      return { ok: false, status: 403, error: 'This request is not open to your company.' };
    }
    return { ok: true, tenantId: request.tenantId };
  });
}
