export const dynamic = 'force-dynamic';

/**
 * Customer onboarding — the customer's portal users.
 *
 * GET   /api/customers/portal-users?customerId=…          the customer's portal users
 * POST  /api/customers/portal-users                        invite (or re-invite) a user
 *   Body: { customerId, email, fullName?, mobile?, role: 'ADMIN' | 'REQUESTER' | 'VIEWER' }
 *   Returns a single-use setup link (valid 7 days) for the user to set a password.
 * PATCH /api/customers/portal-users                        Body: { id, isActive?, role? }
 *   Deactivate / reactivate or change role; ends the user's open sessions.
 * Writes: TENANT_ADMIN / SUPER_ADMIN only; audited. The setup link is never logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import {
  PortalUserError, invitePortalUser, listPortalUsers, updatePortalUser,
} from '@/lib/customer-portal/users';

export const runtime = 'nodejs';

function appOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (configured || req.nextUrl.origin).replace(/\/+$/, '');
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const customerId = req.nextUrl.searchParams.get('customerId') ?? '';
  if (!customerId) return NextResponse.json({ ok: false, error: 'customerId is required' }, { status: 400 });
  try {
    const users = await listPortalUsers(auth.tenantId, customerId);
    return NextResponse.json({ ok: true, users, canEdit: requireAdmin(auth).ok });
  } catch (err) {
    captureException(err, { context: 'customers.portal-users.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load portal users' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;

  const body = stripTenantOwnershipFields((await req.json().catch(() => ({}))) as Record<string, unknown>);
  const customerId = String(body.customerId ?? '');
  if (!customerId) return NextResponse.json({ ok: false, error: 'customerId is required' }, { status: 400 });
  try {
    const { user, rawToken, expiresAt } = await invitePortalUser(auth.tenantId, customerId, body, auth.userId);
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'CustomerPortalUser',
      entityId: user.id, entityName: user.email, action: 'CREATE',
      details: `Invited ${user.email} (${user.role}) to the Customer Portal for customer ${customerId}`,
    });
    const setupUrl = `${appOrigin(req)}/customer-portal/setup?token=${encodeURIComponent(rawToken)}`;
    return NextResponse.json({ ok: true, user, setupUrl, expiresAt }, { status: 201 });
  } catch (err) {
    if (err instanceof PortalUserError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customers.portal-users.invite' });
    return NextResponse.json({ ok: false, error: 'Failed to invite the user' }, { status: 500 });
  }
}

async function handlePATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;

  const body = stripTenantOwnershipFields((await req.json().catch(() => ({}))) as Record<string, unknown>);
  const id = String(body.id ?? '');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
  try {
    const user = await updatePortalUser(auth.tenantId, id, { isActive: body.isActive, role: body.role });
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'CustomerPortalUser',
      entityId: user.id, entityName: user.email, action: 'UPDATE',
      details: `Customer Portal user ${user.email}: ${user.isActive ? 'active' : 'deactivated'}, role ${user.role}`,
    });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    if (err instanceof PortalUserError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customers.portal-users.update' });
    return NextResponse.json({ ok: false, error: 'Failed to update the user' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
export const PATCH = withAuditedAction(handlePATCH);
