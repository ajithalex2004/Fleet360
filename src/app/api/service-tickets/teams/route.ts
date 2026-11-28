export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/teams         — list persistent teams / squads & members
 * POST   /api/service-tickets/teams         — create team
 * PATCH  /api/service-tickets/teams         — update team & member roster (id in body)
 * DELETE /api/service-tickets/teams?id=...  — soft-delete team
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
  createTeam,
  getUserFsmScopes,
  listTeams,
  softDeleteTeam,
  updateTeam,
} from '@/lib/service-tickets/workforce-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const teams = await listTeams(tx, tenantId);
      return NextResponse.json({ ok: true, teams });
    } catch (err) {
      captureException(err, { context: 'fsm.teams.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load teams.' }, { status: 500 });
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

      const team = await createTeam(tx, tenantId, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTeam',
        entityId: team.id,
        entityName: team.name,
        action: 'CREATE',
        details: `Created team ${team.name} (${team.code}) with ${team.members.length} member(s)`,
      });
      return NextResponse.json({ ok: true, team }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.teams.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to create team.' }, { status: 500 });
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
  if (!id) return NextResponse.json({ ok: false, error: 'Team id is required.' }, { status: 400 });

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const team = await updateTeam(tx, tenantId, id, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTeam',
        entityId: team.id,
        entityName: team.name,
        action: 'UPDATE',
        details: `Updated team ${team.name} (${team.members.length} member(s))`,
      });
      return NextResponse.json({ ok: true, team });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.teams.update', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to update team.' }, { status: 500 });
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

      await softDeleteTeam(tx, tenantId, id);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTeam',
        entityId: id,
        action: 'DELETE',
        details: `Soft-deleted team ${id}`,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.teams.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to delete team.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
