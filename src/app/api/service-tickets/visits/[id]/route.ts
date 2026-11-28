export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/visits/[id] — fetch visit detail + time logs + tasks + checklists + FSRs
 * PATCH  /api/service-tickets/visits/[id] — reschedule, reassign crew/team, or update dispatch notes
 * DELETE /api/service-tickets/visits/[id] — remove visit
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { checkFsmPermission } from '@/lib/service-tickets/workforce';
import { WorkforceError, getUserFsmScopes } from '@/lib/service-tickets/workforce-db';
import {
  deleteWorkVisit,
  getWorkVisit,
  listChecklistRuns,
  listServiceReports,
  listVisitTimeLogs,
  listWorkTasks,
  updateWorkVisit,
} from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  const { id } = await params;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const visit = await getWorkVisit(tx, tenantId, id);
      const [timeLogs, tasks, checklists, reports] = await Promise.all([
        listVisitTimeLogs(tx, tenantId, visit.id),
        listWorkTasks(tx, tenantId, { ticketId: visit.ticketId }),
        listChecklistRuns(tx, tenantId, { ticketId: visit.ticketId }),
        listServiceReports(tx, tenantId, { ticketId: visit.ticketId }),
      ]);
      return NextResponse.json({ ok: true, visit, timeLogs, tasks, checklists, reports });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.visits.get', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to load visit detail.' }, { status: 500 });
    }
  });
}

async function handlePATCH(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'dispatch:assign' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const visit = await updateWorkVisit(tx, tenantId, id, userId ?? 'dispatcher', body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmWorkVisit',
        entityId: visit.id,
        entityName: `${visit.ticketReadableId ?? visit.ticketId} Visit #${visit.visitNumber}`,
        action: 'UPDATE',
        details: `Updated Visit #${visit.visitNumber} schedule/crew`,
      });
      return NextResponse.json({ ok: true, visit });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.visits.update', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to update visit.' }, { status: 500 });
    }
  });
}

async function handleDELETE(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';
  const { id } = await params;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'dispatch:assign' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      await deleteWorkVisit(tx, tenantId, id);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmWorkVisit',
        entityId: id,
        action: 'DELETE',
        details: `Deleted work visit ${id}`,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.visits.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to delete visit.' }, { status: 500 });
    }
  });
}

export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
