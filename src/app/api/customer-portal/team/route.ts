export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal — the company's own team, managed by its Admin.
 *
 * GET                                   the company's users with their portal roles
 * POST  { email, fullName?, mobile?, roles }   invite a colleague, or give one more portals
 * PATCH { id, roles?, isActive? }            change a colleague's roles or deactivate them
 *
 * An account may grant or change roles only in portals it is an Admin in
 * (and the company has). It cannot change itself, and can deactivate only a
 * colleague whose every portal role it administers. Staff keep full control
 * in Customer Management → Customer Portal access. Every change is audited.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyAdmin, type CompanyAdminContext } from '@/lib/customer-portal/session';
import {
  PortalUserError, inviteCustomerUser, listCustomerAccounts, updateCustomerUser, type PortalAccount,
} from '@/lib/customer-portal/users';
import { CUSTOMER_PORTALS, parsePortalRoleMap, type PortalRoleMap } from '@/lib/customer-portal/catalog';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

function appOrigin(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin).replace(/\/+$/, '');
}

/** Roles may only touch portals this admin administers. */
function rolesWithinAdminPortals(raw: unknown, ctx: CompanyAdminContext): PortalRoleMap | NextResponse {
  const roles = parsePortalRoleMap(raw);
  if (!roles) return NextResponse.json({ ok: false, error: 'Unknown portal or role.' }, { status: 400 });
  const outside = CUSTOMER_PORTALS.filter((p) => p in roles && !ctx.adminPortals.includes(p));
  if (outside.length) {
    return NextResponse.json({ ok: false, error: 'You can only set roles in portals you are an admin of.' }, { status: 403 });
  }
  return roles;
}

const rolesText = (a: PortalAccount) => Object.entries(a.roles).map(([p, r]) => `${p} ${r}`).join(', ') || 'no portal';

function audit(ctx: CompanyAdminContext, account: PortalAccount, action: 'CREATE' | 'UPDATE', what: string) {
  void logAudit({
    tenantId: ctx.tenantId, entityType: 'CustomerPortalUser', entityId: account.id, entityName: account.email,
    userId: `customer-portal:${ctx.user.id}`, userEmail: ctx.user.email, userRole: 'CUSTOMER_ADMIN', action,
    details: `Customer admin ${ctx.user.email} ${what} ${account.email} (${rolesText(account)}) for customer ${ctx.customerId}`,
  });
}

export async function GET(req: NextRequest) {
  const ctx = await requireCompanyAdmin(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const users = await listCustomerAccounts(ctx.tenantId, ctx.customerId);
    return NextResponse.json({ ok: true, users, me: ctx.user.id, companyPortals: ctx.companyPortals, adminPortals: ctx.adminPortals });
  } catch (err) {
    captureException(err, { context: 'customer-portal.team.list' });
    return NextResponse.json({ ok: false, error: 'Could not load your team' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireCompanyAdmin(req);
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const roles = rolesWithinAdminPortals(body.roles, ctx);
  if (roles instanceof NextResponse) return roles;
  try {
    // Inviting reactivates an existing colleague: same rule as reactivating directly.
    const email = String(body.email ?? '').trim().toLowerCase();
    const existing = (await listCustomerAccounts(ctx.tenantId, ctx.customerId)).find((a) => a.email.toLowerCase() === email);
    if (existing && !existing.isActive && CUSTOMER_PORTALS.some((p) => existing.roles[p] && !ctx.adminPortals.includes(p))) {
      return NextResponse.json({ ok: false, error: 'This user also works in a portal you do not administer. Ask your service provider.' }, { status: 403 });
    }
    const { account, rawToken, expiresAt } = await inviteCustomerUser(
      ctx.tenantId, ctx.customerId,
      { email: body.email, fullName: body.fullName, mobile: body.mobile, roles },
      `customer-portal:${ctx.user.id}`,
    );
    audit(ctx, account, 'CREATE', 'invited');
    const setupUrl = rawToken ? `${appOrigin(req)}/customer-portal/setup?token=${encodeURIComponent(rawToken)}` : null;
    return NextResponse.json({ ok: true, user: account, setupUrl, expiresAt }, { status: 201 });
  } catch (err) {
    if (err instanceof PortalUserError) {
      // Never tell one company that an email belongs to another.
      const error = err.status === 409 ? 'This email cannot be invited. Contact your service provider.' : err.message;
      return NextResponse.json({ ok: false, error }, { status: err.status });
    }
    captureException(err, { context: 'customer-portal.team.invite' });
    return NextResponse.json({ ok: false, error: 'Could not invite the user' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireCompanyAdmin(req);
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? '');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
  if (id === ctx.user.id) {
    return NextResponse.json({ ok: false, error: 'You cannot change your own access. Ask another admin or your service provider.' }, { status: 403 });
  }
  const roles = body.roles === undefined ? undefined : rolesWithinAdminPortals(body.roles, ctx);
  if (roles instanceof NextResponse) return roles;
  try {
    if (typeof body.isActive === 'boolean') {
      const target = (await listCustomerAccounts(ctx.tenantId, ctx.customerId)).find((a) => a.id === id);
      if (!target) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
      const theirs = CUSTOMER_PORTALS.filter((p) => target.roles[p]);
      if (theirs.some((p) => !ctx.adminPortals.includes(p))) {
        return NextResponse.json({ ok: false, error: 'This user also works in a portal you do not administer. Ask your service provider.' }, { status: 403 });
      }
    }
    const user = await updateCustomerUser(
      ctx.tenantId, id, { isActive: body.isActive, roles }, `customer-portal:${ctx.user.id}`, ctx.customerId,
    );
    audit(ctx, user, 'UPDATE', typeof body.isActive === 'boolean' ? (body.isActive ? 'reactivated' : 'deactivated') : 'changed roles of');
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    if (err instanceof PortalUserError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customer-portal.team.update' });
    return NextResponse.json({ ok: false, error: 'Could not update the user' }, { status: 500 });
  }
}
