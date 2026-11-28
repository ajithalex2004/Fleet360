export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/technicians/[id] — fetch single technician
 * PATCH  /api/service-tickets/technicians/[id] — update profile, skills, territories
 * DELETE /api/service-tickets/technicians/[id] — soft-delete technician
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
  getTechnician,
  getUserFsmScopes,
  softDeleteTechnician,
  updateTechnician,
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
      const technician = await getTechnician(tx, tenantId, id);
      return NextResponse.json({ ok: true, technician });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.get', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to load technician.' }, { status: 500 });
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
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const technician = await updateTechnician(tx, tenantId, id, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTechnician',
        entityId: technician.id,
        entityName: technician.fullName,
        action: 'UPDATE',
        details: `Updated technician ${technician.fullName} (${technician.employeeCode})`,
      });
      return NextResponse.json({ ok: true, technician });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.update', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to update technician.' }, { status: 500 });
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
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      await softDeleteTechnician(tx, tenantId, id);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTechnician',
        entityId: id,
        action: 'DELETE',
        details: `Soft-deleted technician ${id}`,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to delete technician.' }, { status: 500 });
    }
  });
}

export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
