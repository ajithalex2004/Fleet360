export const dynamic = 'force-dynamic';

/**
 * PUT /api/service-tickets/technicians/[id]/skills — replace technician skills & certifications
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
  getUserFsmScopes,
  replaceTechnicianSkills,
} from '@/lib/service-tickets/workforce-db';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function handlePUT(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';
  const { id } = await params;

  let body: { skills?: unknown };
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!Array.isArray(body.skills)) {
    return NextResponse.json({ ok: false, error: 'skills array is required.' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const skills = await replaceTechnicianSkills(
        tx,
        tenantId,
        id,
        body.skills as Array<Record<string, unknown>>,
      );
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmTechnician',
        entityId: id,
        action: 'UPDATE',
        details: `Updated ${skills.length} skill(s)/certification(s) for technician ${id}`,
      });
      return NextResponse.json({ ok: true, skills });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.skills.update', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to update skills.' }, { status: 500 });
    }
  });
}

export const PUT = withAuditedAction(handlePUT);
