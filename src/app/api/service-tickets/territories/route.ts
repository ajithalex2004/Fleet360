export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/territories         — list geographic service territories
 * POST   /api/service-tickets/territories         — create territory
 * PATCH  /api/service-tickets/territories         — update territory (id in body)
 * DELETE /api/service-tickets/territories?id=...  — soft-delete territory
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
  createTerritory,
  getUserFsmScopes,
  listTerritories,
  softDeleteTerritory,
  updateTerritory,
} from '@/lib/service-tickets/workforce-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const territories = await listTerritories(tx, tenantId);
      return NextResponse.json({ ok: true, territories });
    } catch (err) {
      captureException(err, { context: 'fsm.territories.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load territories.' }, { status: 500 });
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
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const territory = await createTerritory(tx, tenantId, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTerritory',
        entityId: territory.id,
        entityName: territory.name,
        action: 'CREATE',
        details: `Created territory ${territory.name} (${territory.code})`,
      });
      return NextResponse.json({ ok: true, territory }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.territories.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to create territory.' }, { status: 500 });
    }
  });
}

async function handlePATCH(req: NextRequest) {
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
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ ok: false, error: 'Territory id is required.' }, { status: 400 });

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const territory = await updateTerritory(tx, tenantId, id, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTerritory',
        entityId: territory.id,
        entityName: territory.name,
        action: 'UPDATE',
        details: `Updated territory ${territory.name} (${territory.code})`,
      });
      return NextResponse.json({ ok: true, territory });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.territories.update', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to update territory.' }, { status: 500 });
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
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      await softDeleteTerritory(tx, tenantId, id);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTerritory',
        entityId: id,
        action: 'DELETE',
        details: `Soft-deleted territory ${id}`,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.territories.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to delete territory.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
