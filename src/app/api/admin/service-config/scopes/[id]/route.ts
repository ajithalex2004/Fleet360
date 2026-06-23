/**
 * PATCH  /api/admin/service-config/scopes/[id]   — edit name / description /
 *        level / parent / sort order. Cannot re-parent the tenant root.
 *
 * DELETE /api/admin/service-config/scopes/[id]   — soft delete. Refuses to
 *        delete the tenant root or scopes with non-deleted children.
 */

import { NextRequest, NextResponse } from 'next/server';
import { recordServiceConfigChange, requireServiceConfigApproval, requireServiceConfigPermission } from '@/lib/service-config/auth';
import { ensureScopesTable, getScope, updateScope, deleteScope } from '@/lib/service-config/scopes-schema';
import { SCOPE_LEVELS, type ScopeLevel } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireServiceConfigPermission(req, 'edit');
  if (!auth.ok) return auth.res;
  const { id } = await params;

  await ensureScopesTable();
  const target = await getScope(auth.tenantId, id);
  if (!target) return NextResponse.json({ ok: false, error: 'Scope not found' }, { status: 404 });
  if (target.isRoot) {
    return NextResponse.json({ ok: false, error: 'The tenant root scope cannot be edited.' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  try {
    const patch: Parameters<typeof updateScope>[2] = {};
    if (typeof body.name === 'string')        patch.name = body.name.trim();
    if (typeof body.description === 'string') patch.description = body.description;
    if (body.description === null)            patch.description = null;
    if (typeof body.sortOrder === 'number')   patch.sortOrder = body.sortOrder;
    if (typeof body.level === 'string' && (SCOPE_LEVELS as readonly string[]).includes(body.level)) {
      patch.level = body.level as ScopeLevel;
    }
    if (typeof body.parentScopeId === 'string') patch.parentScopeId = body.parentScopeId;

    const approval = await requireServiceConfigApproval(req, auth, 'service_config.scope.update', {
      targetType: 'ServiceScope',
      targetId: id,
      summary: `Update service scope ${target.name}.`,
      payload: patch,
    });
    if (approval) return approval;

    const updated = await updateScope(auth.tenantId, id, patch);
    if (!updated) return NextResponse.json({ ok: false, error: 'Scope not found' }, { status: 404 });

    await recordServiceConfigChange({
      req,
      auth,
      entityType: 'ServiceScope',
      entityId: id,
      entityName: updated.name,
      action: 'UPDATE',
      before: target,
      after: updated,
      summary: `Updated scope ${updated.name}.`,
    });

    return NextResponse.json({ ok: true, scope: updated });
  } catch (err) {
    captureException(err, { context: 'service-config.scopes.update' });
    return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireServiceConfigPermission(req, 'delete');
  if (!auth.ok) return auth.res;
  const { id } = await params;

  const target = await getScope(auth.tenantId, id);
  if (!target) return NextResponse.json({ ok: false, error: 'Scope not found' }, { status: 404 });

  const approval = await requireServiceConfigApproval(req, auth, 'service_config.scope.delete', {
    targetType: 'ServiceScope',
    targetId: id,
    summary: `Delete service scope ${target.name}.`,
  });
  if (approval) return approval;

  const result = await deleteScope(auth.tenantId, id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  await recordServiceConfigChange({
    req,
    auth,
    entityType: 'ServiceScope',
    entityId: id,
    entityName: target.name,
    action: 'DELETE',
    before: target,
    after: { ...target, deleted: true },
    summary: `Soft-deleted scope ${target.name}.`,
  });

  return NextResponse.json({ ok: true });
}
