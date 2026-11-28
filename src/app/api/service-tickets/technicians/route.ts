export const dynamic = 'force-dynamic';

/**
 * GET  /api/service-tickets/technicians — list technician roster (skills, territories, GPS)
 * POST /api/service-tickets/technicians — create a new technician
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
  createTechnician,
  getUserFsmScopes,
  listTechnicians,
} from '@/lib/service-tickets/workforce-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const department = req.nextUrl.searchParams.get('department') || undefined;
  const territoryId = req.nextUrl.searchParams.get('territoryId') || undefined;
  const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const technicians = await listTechnicians(tx, tenantId, { department, territoryId, activeOnly });
      return NextResponse.json({ ok: true, technicians });
    } catch (err) {
      captureException(err, { context: 'fsm.technicians.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load technicians.' }, { status: 500 });
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

      const technician = await createTechnician(tx, tenantId, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTechnician',
        entityId: technician.id,
        entityName: technician.fullName,
        action: 'CREATE',
        details: `Created technician ${technician.fullName} (${technician.employeeCode})`,
      });
      return NextResponse.json({ ok: true, technician }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to create technician.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
