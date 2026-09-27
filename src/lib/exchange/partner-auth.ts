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
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { EXCHANGE_OPEN_MARKET, isActivated, onboardingStatusLabel } from '@/lib/exchange/partner-activation';

export const PARTNER_ROLES = ['PARTNER_ADMIN', 'PARTNER_OPERATIONS', 'PARTNER_FINANCE', 'PARTNER_VIEWER'] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

/** Roles that may submit or revise quotes. */
export const QUOTING_ROLES: readonly PartnerRole[] = ['PARTNER_ADMIN', 'PARTNER_OPERATIONS'];

/** Roles that run the partner's operations: fleet, drivers, compliance documents, job assignment. */
export const OPERATIONS_ROLES: readonly PartnerRole[] = ['PARTNER_ADMIN', 'PARTNER_OPERATIONS'];

/** Roles that may submit invoices for awarded jobs. */
export const FINANCE_ROLES: readonly PartnerRole[] = ['PARTNER_ADMIN', 'PARTNER_FINANCE'];

/** Roles that may change the partner's own company profile. */
export const PROFILE_ROLES: readonly PartnerRole[] = ['PARTNER_ADMIN'];

export interface PartnerMembership {
  partnerId: string;
  role: PartnerRole;
  legalName: string;
  partnerCode: string;
  city: string | null;
  marketplaceStatus: string;
  operationalStatus: string;
  /** DRAFT … APPROVED; anything but APPROVED is Pending Activation (partner-activation.ts). */
  onboardingStatus: string;
  emirate: string | null;
}

export interface PartnerContext extends PartnerMembership {
  userId: string;
}

export type PartnerAuthResult =
  | { ok: true; ctx: PartnerContext; memberships: PartnerMembership[] }
  | { ok: false; status: 400 | 401 | 403 | 503; error: string; code?: string; memberships?: PartnerMembership[] };

/**
 * Prisma P2021: "The table ... does not exist in the current database".
 * The Exchange tables come from
 * 20260926120000_add_remaining_exchange_partner_tables; where that migration
 * has not been applied yet, every Exchange route answers with a clear 503
 * instead of an unhandled 500 with an empty body.
 */
export function isExchangeNotProvisioned(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

export const EXCHANGE_NOT_PROVISIONED = {
  status: 503 as const,
  error: 'The partner exchange is not set up in this environment yet.',
  code: 'EXCHANGE_NOT_PROVISIONED',
};

/** The 503 JSON response for a missing Exchange table. */
export function exchangeNotProvisionedResponse(): NextResponse {
  const { status, error, code } = EXCHANGE_NOT_PROVISIONED;
  return NextResponse.json({ error, code }, { status });
}

/** Runs `fn`; a missing Exchange table becomes the 503 not-provisioned response. */
export async function notProvisionedAware<T>(fn: () => Promise<T>): Promise<{ value: T } | { response: NextResponse }> {
  try {
    return { value: await fn() };
  } catch (err) {
    if (isExchangeNotProvisioned(err)) return { response: exchangeNotProvisionedResponse() };
    throw err;
  }
}

/** Runs `fn`; a missing Exchange table becomes a not-provisioned auth failure. */
async function orNotProvisioned<T>(fn: () => Promise<T>): Promise<T | { ok: false; status: 503; error: string; code: string }> {
  try {
    return await fn();
  } catch (err) {
    if (isExchangeNotProvisioned(err)) return { ok: false, ...EXCHANGE_NOT_PROVISIONED };
    throw err;
  }
}

/** The transport partners the user is a member of (deleted partners excluded). */
export async function partnerMembershipsForUser(userId: string): Promise<PartnerMembership[]> {
  const rows = await prisma.partnerUser.findMany({
    where: { userId, partner: { deletedAt: null } },
    select: {
      role: true,
      partner: {
        select: {
          id: true, legalName: true, partnerCode: true, city: true, emirate: true,
          marketplaceStatus: true, operationalStatus: true, onboardingStatus: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    partnerId: r.partner.id,
    role: (PARTNER_ROLES as readonly string[]).includes(r.role) ? (r.role as PartnerRole) : 'PARTNER_VIEWER',
    legalName: r.partner.legalName,
    partnerCode: r.partner.partnerCode,
    city: r.partner.city,
    marketplaceStatus: r.partner.marketplaceStatus,
    operationalStatus: r.partner.operationalStatus,
    onboardingStatus: r.partner.onboardingStatus,
    emirate: r.partner.emirate,
  }));
}

/**
 * Resolves the partner the signed-in caller acts for.
 *
 * - 401 without a verified user (middleware strips client-sent x-user-id).
 * - 403 when the user is not a member of any partner, is not a member of the
 *   partner it names, or its role is not in `opts.roles`.
 * - 400 when the user belongs to several partners and names none.
 * - 403 PARTNER_PENDING_ACTIVATION when the partner has not been activated
 *   by its onboarding tenant yet, unless `opts.allowPending`: routes a
 *   partner needs to complete onboarding (profile, compliance documents,
 *   fleet, drivers) pass it; the marketplace, quotes, jobs and invoices don't.
 *
 * `opts.requested` names a partner from the request body; otherwise the
 * x-partner-id header or ?partnerId= query does.
 */
export async function requirePartnerContext(
  req: { headers: Headers; nextUrl?: { searchParams: URLSearchParams } },
  opts: PartnerContextOptions = {},
): Promise<PartnerAuthResult> {
  return orNotProvisioned(() => resolvePartnerContext(req, opts));
}

export interface PartnerContextOptions {
  roles?: readonly PartnerRole[];
  requested?: string | null;
  /** Also admit a partner that is not activated yet (onboarding routes). */
  allowPending?: boolean;
}

export const PARTNER_PENDING_ACTIVATION = 'PARTNER_PENDING_ACTIVATION';

async function resolvePartnerContext(
  req: { headers: Headers; nextUrl?: { searchParams: URLSearchParams } },
  opts: PartnerContextOptions,
): Promise<PartnerAuthResult> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return { ok: false, status: 401, error: 'Sign in to use the partner marketplace.' };

  const memberships = await partnerMembershipsForUser(userId);
  if (memberships.length === 0) {
    return { ok: false, status: 403, error: 'Your account is not linked to a transport partner.' };
  }

  const requested = opts.requested || req.headers.get('x-partner-id') || req.nextUrl?.searchParams.get('partnerId') || null;
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

  if (!opts.allowPending && !isActivated(membership)) {
    return {
      ok: false,
      status: 403,
      code: PARTNER_PENDING_ACTIVATION,
      error: `${membership.legalName} is not activated yet (${onboardingStatusLabel(membership.onboardingStatus).toLowerCase()}). `
        + 'Upload your compliance documents and submit them for review; the marketplace opens once your onboarding company activates you.',
      memberships,
    };
  }

  return { ok: true, ctx: { ...membership, userId }, memberships };
}

/** JSON error response for a failed requirePartnerContext(). */
export function partnerAuthFailure(result: Extract<PartnerAuthResult, { ok: false }>): NextResponse {
  return NextResponse.json(
    {
      error: result.error,
      ...(result.code ? { code: result.code } : {}),
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
 * Allowed when the partner is activated (onboarding APPROVED), marketplace-
 * APPROVED and ACTIVE, the buyer has not BLOCKED it, the request is still
 * open (PUBLISHED or QUOTED) and either
 *   - the partner was invited to it, or
 *   - its marketplace opportunity is OPEN, not past closes_at, in a domain the
 *     partner has an approved capability for, and visible to the partner:
 *     TENANT_NETWORK (partners with a relationship to the buyer), or
 *     EXCHANGE_NETWORK: any partner once EXCHANGE_OPEN_MARKET is on, until
 *     then only partners with a relationship to the buyer.
 *     DIRECT opportunities are invitation-only.
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
        onboardingStatus: true,
        capabilities: { where: { isApproved: true }, select: { domain: true } },
        tenantRelationships: { where: { tenantId: request.tenantId }, select: { status: true } },
      },
    });
    if (!partner) return { ok: false, status: 403, error: 'Transport partner not found' };
    if (!isActivated(partner)) {
      return { ok: false, status: 403, error: 'Your partner account is not activated yet.' };
    }
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
      (opp.visibility === 'EXCHANGE_NETWORK' || opp.visibility === 'TENANT_NETWORK') &&
      (!!relationship || (opp.visibility === 'EXCHANGE_NETWORK' && EXCHANGE_OPEN_MARKET));
    if (!visible) {
      return { ok: false, status: 403, error: 'This request is not open to your company.' };
    }
    return { ok: true, tenantId: request.tenantId };
  });
}

export type PartnerViewer =
  | { ok: true; viewer: 'partner'; partnerId: string; ctx: PartnerContext }
  | { ok: true; viewer: 'buyer'; partnerId: string | null; tenantId: string }
  | { ok: false; status: 400 | 401 | 403 | 503; error: string; code?: string; memberships?: PartnerMembership[] };

/**
 * Who may read a partner's profile or scorecard: the partner's own members,
 * or staff of a buying tenant that has a relationship with the partner.
 *
 * A partner member gets its own partner (a named partner chooses among its
 * memberships). Anyone else is treated as buyer staff of `tenantId`: a named
 * partner must have a tenant_partner_relationships row with that tenant, and
 * with none named the first related partner is used (null if there is none).
 */
export async function resolvePartnerViewer(
  req: { headers: Headers; nextUrl?: { searchParams: URLSearchParams } },
  tenantId: string,
  opts: { requested?: string | null } = {},
): Promise<PartnerViewer> {
  return orNotProvisioned(() => resolveViewer(req, tenantId, opts));
}

async function resolveViewer(
  req: { headers: Headers; nextUrl?: { searchParams: URLSearchParams } },
  tenantId: string,
  opts: { requested?: string | null },
): Promise<PartnerViewer> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return { ok: false, status: 401, error: 'Sign in to view transport partners.' };

  const requested = opts.requested || req.headers.get('x-partner-id') || req.nextUrl?.searchParams.get('partnerId') || null;
  const memberships = await partnerMembershipsForUser(userId);
  const ownRequested = requested ? memberships.some((m) => m.partnerId === requested) : false;

  if (memberships.length > 0 && (!requested || ownRequested)) {
    // A partner still being onboarded may read its own profile and scorecard.
    const auth = await requirePartnerContext(req, { requested, allowPending: true });
    if (!auth.ok) return auth;
    return { ok: true, viewer: 'partner', partnerId: auth.ctx.partnerId, ctx: auth.ctx };
  }

  // Buyer staff: only partners related to the caller's own tenant.
  const related = await withTenantRls(prisma, tenantId, (tx) =>
    tx.tenantPartnerRelationship.findMany({
      where: { tenantId, partner: { deletedAt: null } },
      select: { partnerId: true },
      orderBy: { createdAt: 'asc' },
    }),
  );
  if (requested) {
    if (!related.some((r) => r.partnerId === requested)) {
      return { ok: false, status: 403, error: 'This transport partner is not in your partner network.' };
    }
    return { ok: true, viewer: 'buyer', partnerId: requested, tenantId };
  }
  return { ok: true, viewer: 'buyer', partnerId: related[0]?.partnerId ?? null, tenantId };
}

/**
 * The tenant (buyer) of an award that belongs to `partnerId`, or null when the
 * award does not exist or is another partner's. Platform context: the award
 * lives in the buyer's tenant, not the partner user's.
 */
export async function awardTenantForPartner(partnerId: string, awardId: string): Promise<string | null> {
  const award = await withPlatformAdmin(prisma, (tx) =>
    tx.outsourceAward.findFirst({ where: { id: awardId, partnerId }, select: { tenantId: true } }),
  );
  return award?.tenantId ?? null;
}

/**
 * Whether the caller may see a record that belongs to partner `partnerId` and
 * buying tenant `tenantId` (a settlement statement, a proof of delivery): a
 * member of that partner, or staff of that tenant. `caller` comes from
 * requireAuthorizedTenant() (the session's user and tenant).
 */
export async function canSeePartnerRecord(
  caller: { userId: string; tenantId: string },
  record: { partnerId: string; tenantId: string },
): Promise<boolean> {
  if (caller.tenantId === record.tenantId) return true;
  const { userId } = caller;
  const memberships = await partnerMembershipsForUser(userId);
  return memberships.some((m) => m.partnerId === record.partnerId);
}
