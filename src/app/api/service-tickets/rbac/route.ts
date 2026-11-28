export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/rbac         — list granular FSM role & territory/team scopes
 * POST   /api/service-tickets/rbac         — grant FSM role scope to a tenant user
 * DELETE /api/service-tickets/rbac?id=...  — revoke FSM role scope
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { checkFsmPermission } from '@/lib/service-tickets/workforce';
import {
  WorkforceError,
  addFsmScope,
  deleteFsmScope,
  getUserFsmScopes,
  listFsmScopes,
} from '@/lib/service-tickets/workforce-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const scopes = await listFsmScopes(tx, tenantId);
      return NextResponse.json({ ok: true, scopes });
    } catch (err) {
      captureException(err, { context: 'fsm.rbac.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load FSM role scopes.' }, { status: 500 });
    }
  });
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const callerScopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: callerScopes, action: 'rbac:manage' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const scope = await addFsmScope(tx, tenantId, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmUserScope',
        entityId: scope.id,
        entityName: scope.userEmail || scope.userId,
        action: 'CREATE',
        details: `Granted ${scope.fsmRole} to ${scope.userEmail || scope.userId}${scope.territoryName ? ` (${scope.territoryName})` : ''}${scope.teamName ? ` [${scope.teamName}]` : ''}`,
      });
      return NextResponse.json({ ok: true, scope }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.rbac.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to grant FSM role scope.' }, { status: 500 });
    }
  });
}

async function handleDELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ ok: false, error: 'id query parameter is required.' }, { status: 400 });

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const callerScopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: callerScopes, action: 'rbac:manage' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      await deleteFsmScope(tx, tenantId, id);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmUserScope',
        entityId: id,
        action: 'DELETE',
        details: `Revoked FSM role scope ${id}`,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.rbac.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to revoke FSM role scope.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
export const DELETE = withAuditedAction(handleDELETE);
