export const dynamic = 'force-dynamic';

/**
 * GET  /api/service-tickets/visits — list scheduled field visits
 * POST /api/service-tickets/visits — schedule & dispatch a new visit (multi-visit + crew)
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
import { createWorkVisit, listWorkVisits } from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const ticketId = req.nextUrl.searchParams.get('ticketId') || undefined;
  const technicianId = req.nextUrl.searchParams.get('technicianId') || undefined;
  const startIso = req.nextUrl.searchParams.get('start') || undefined;
  const endIso = req.nextUrl.searchParams.get('end') || undefined;
  const status = req.nextUrl.searchParams.get('status') || undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const visits = await listWorkVisits(tx, tenantId, { ticketId, technicianId, startIso, endIso, status });
      return NextResponse.json({ ok: true, visits });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.visits.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load visits.' }, { status: 500 });
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
      const perm = checkFsmPermission({
        platformRole,
        fsmScopes: scopes,
        action: 'dispatch:assign',
        targetTeamId: typeof body.teamId === 'string' ? body.teamId : null,
      });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const { visit, warnings } = await createWorkVisit(tx, tenantId, userId ?? 'dispatcher', body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmWorkVisit',
        entityId: visit.id,
        entityName: `${visit.ticketReadableId ?? visit.ticketId} Visit #${visit.visitNumber}`,
        action: 'CREATE',
        details: `Scheduled Visit #${visit.visitNumber} for ${visit.ticketReadableId ?? visit.ticketId} with ${visit.crew.length} crew member(s)`,
      });
      return NextResponse.json({ ok: true, visit, warnings }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.visits.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to schedule visit.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
