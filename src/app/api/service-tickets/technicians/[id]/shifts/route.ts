export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/technicians/[id]/shifts             — list shifts / leave blocks
 * POST   /api/service-tickets/technicians/[id]/shifts             — add shift / leave / on-call entry
 * DELETE /api/service-tickets/technicians/[id]/shifts?shiftId=... — remove shift entry
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
  addTechnicianShift,
  deleteTechnicianShift,
  getUserFsmScopes,
  listTechnicianShifts,
} from '@/lib/service-tickets/workforce-db';

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
      const shifts = await listTechnicianShifts(tx, tenantId, id);
      return NextResponse.json({ ok: true, shifts });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.shifts.list', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to load shifts.' }, { status: 500 });
    }
  });
}

async function handlePOST(req: NextRequest, { params }: RouteParams) {
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

      const shift = await addTechnicianShift(tx, tenantId, id, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTechnicianShift',
        entityId: shift.id,
        action: 'CREATE',
        details: `Added ${shift.entryType} shift for technician ${id}`,
      });
      return NextResponse.json({ ok: true, shift }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.shifts.create', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to add shift.' }, { status: 500 });
    }
  });
}

async function handleDELETE(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';
  const { id } = await params;
  const shiftId = req.nextUrl.searchParams.get('shiftId') || '';

  if (!shiftId) {
    return NextResponse.json({ ok: false, error: 'shiftId query parameter is required.' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'dispatch:assign' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      await deleteTechnicianShift(tx, tenantId, id, shiftId);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTechnicianShift',
        entityId: shiftId,
        action: 'DELETE',
        details: `Deleted shift ${shiftId} for technician ${id}`,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.shifts.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to delete shift.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
export const DELETE = withAuditedAction(handleDELETE);
