/**
 * PATCH  /api/admin/service-config/types/[id]   — edit a service type
 * DELETE /api/admin/service-config/types/[id]   — soft delete (system rows
 *        cannot be deleted; child mapping row is left intact for restore).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordServiceConfigChange, requireServiceConfigApproval, requireServiceConfigPermission } from '@/lib/service-config/auth';
import { ensureServiceConfigTables } from '@/lib/service-config/schema';
import { SERVICE_TONES } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

interface TypeRow {
  id: string; tenant_id: string; category_id: string; key: string; name: string;
  description: string | null; icon: string | null; tone: string;
  default_priority: string; sort_order: number; is_system: boolean;
  created_at: string; updated_at: string;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireServiceConfigPermission(req, 'edit');
  if (!auth.ok) return auth.res;

  const { id } = await params;
  await ensureServiceConfigTables();
  const beforeRows = await prisma.$queryRawUnsafe<TypeRow[]>(
    `SELECT id::text, tenant_id, category_id::text, key, name, description, icon, tone,
            default_priority, sort_order, is_system, created_at::text, updated_at::text
       FROM service_types
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    id, auth.tenantId,
  ).catch(() => []);
  const before = beforeRows[0] ?? null;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, value: unknown, cast = '') => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}${cast}`); args.push(value); p++;
  };

  if (typeof body.name === 'string')         setIf('name',        body.name.trim());
  if (typeof body.description === 'string')  setIf('description', body.description);
  if (typeof body.icon === 'string')         setIf('icon',        body.icon);
  if (typeof body.tone === 'string' && (SERVICE_TONES as readonly string[]).includes(body.tone)) {
    setIf('tone', body.tone);
  }
  if (typeof body.defaultPriority === 'string' && ['Low', 'Medium', 'High'].includes(body.defaultPriority)) {
    setIf('default_priority', body.defaultPriority);
  }
  if (typeof body.sortOrder === 'number')    setIf('sort_order',  body.sortOrder);
  if (typeof body.categoryId === 'string')   setIf('category_id', body.categoryId, '::uuid');

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: 'No updatable fields in body' }, { status: 400 });
  }
  const approval = await requireServiceConfigApproval(req, auth, 'service_config.type.update', {
    targetType: 'ServiceType',
    targetId: id,
    summary: `Update service type ${id}.`,
    payload: body,
  });
  if (approval) return approval;
  sets.push(`updated_at = NOW()`);
  args.push(id, auth.tenantId);

  try {
    const updated = await prisma.$queryRawUnsafe<TypeRow[]>(
      `UPDATE service_types
         SET ${sets.join(', ')}
       WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
       RETURNING id::text, tenant_id, category_id::text, key, name, description, icon, tone,
                 default_priority, sort_order, is_system, created_at::text, updated_at::text`,
      ...args,
    );
    const t = updated[0];
    if (!t) return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });

    await recordServiceConfigChange({
      req,
      auth,
      entityType: 'ServiceType',
      entityId: t.id,
      entityName: t.name,
      action: 'UPDATE',
      before,
      after: t,
      summary: `Updated service type ${t.name}.`,
    });

    return NextResponse.json({ ok: true, type: t });
  } catch (err) {
    captureException(err, { context: 'service-config.types.update' });
    return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireServiceConfigPermission(req, 'delete');
  if (!auth.ok) return auth.res;

  const { id } = await params;
  await ensureServiceConfigTables();

  const rows = await prisma.$queryRawUnsafe<TypeRow[]>(
    `SELECT id::text, tenant_id, category_id::text, key, name, description, icon, tone,
            default_priority, sort_order, is_system, created_at::text, updated_at::text
     FROM service_types
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    id, auth.tenantId,
  ).catch(() => []);
  const found = rows[0];
  if (!found) return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });
  if (found.is_system) return NextResponse.json({ ok: false, error: 'Cannot delete a system service type.' }, { status: 400 });

  const approval = await requireServiceConfigApproval(req, auth, 'service_config.type.delete', {
    targetType: 'ServiceType',
    targetId: id,
    summary: `Delete service type ${found.name}.`,
  });
  if (approval) return approval;

  await prisma.$executeRawUnsafe(
    `UPDATE service_types SET deleted_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
    id, auth.tenantId,
  );

  await recordServiceConfigChange({
    req,
    auth,
    entityType: 'ServiceType',
    entityId: id,
    entityName: found.name,
    action: 'DELETE',
    before: found,
    after: { ...found, deleted: true },
    summary: `Soft-deleted service type ${found.name}.`,
  });

  return NextResponse.json({ ok: true });
}
