export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/checklists/templates         — list reusable SOP/Safety/QA templates
 * POST   /api/service-tickets/checklists/templates         — create template (or seedDefaults: true)
 * DELETE /api/service-tickets/checklists/templates?id=...  — soft-delete template
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
  createChecklistTemplate,
  deleteChecklistTemplate,
  listChecklistTemplates,
  seedStarterChecklistTemplates,
} from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  const serviceTypeKey = req.nextUrl.searchParams.get('serviceTypeKey') || undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const templates = await listChecklistTemplates(tx, tenantId, serviceTypeKey);
      return NextResponse.json({ ok: true, templates });
    } catch (err) {
      captureException(err, { context: 'fsm.checklists.templates.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load checklist templates.' }, { status: 500 });
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
      if (body.seedDefaults === true) {
        const templates = await seedStarterChecklistTemplates(tx, tenantId);
        return NextResponse.json({ ok: true, templates }, { status: 201 });
      }

      const scopes = await getUserFsmScopes(tx, tenantId, userId ?? '');
      const perm = checkFsmPermission({ platformRole, fsmScopes: scopes, action: 'workforce:write' });
      if (!perm.allowed) {
        return NextResponse.json({ ok: false, error: perm.reason ?? 'Forbidden' }, { status: 403 });
      }

      const template = await createChecklistTemplate(tx, tenantId, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmChecklistTemplate',
        entityId: template.id,
        entityName: template.name,
        action: 'CREATE',
        details: `Created checklist template "${template.name}" (${template.items.length} items)`,
      });
      return NextResponse.json({ ok: true, template }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.checklists.templates.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to create checklist template.' }, { status: 500 });
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

      await deleteChecklistTemplate(tx, tenantId, id);
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.checklists.templates.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to delete checklist template.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
export const DELETE = withAuditedAction(handleDELETE);
