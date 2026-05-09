/**
 * PATCH  /api/admin/service-config/categories/[id]   — edit a category
 * DELETE /api/admin/service-config/categories/[id]   — soft delete (blocks
 *        deletion of system rows OR rows with non-deleted child types).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { ensureServiceConfigTables } from '@/lib/service-config/schema';
import { SERVICE_TONES } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

interface CategoryRow {
  id: string; tenant_id: string; key: string; name: string; description: string | null;
  icon: string | null; tone: string; sort_order: number; is_system: boolean;
  created_at: string; updated_at: string;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const adminCheck = requireAdmin(auth);
  if (!adminCheck.ok) return adminCheck.res;

  const { id } = await params;
  await ensureServiceConfigTables();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, value: unknown) => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}`); args.push(value); p++;
  };

  if (typeof body.name === 'string')         setIf('name',        body.name.trim());
  if (typeof body.description === 'string')  setIf('description', body.description);
  if (typeof body.icon === 'string')         setIf('icon',        body.icon);
  if (typeof body.tone === 'string' && (SERVICE_TONES as readonly string[]).includes(body.tone)) {
    setIf('tone', body.tone);
  }
  if (typeof body.sortOrder === 'number')    setIf('sort_order',  body.sortOrder);

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: 'No updatable fields in body' }, { status: 400 });
  }
  sets.push(`updated_at = NOW()`);
  args.push(id, auth.tenantId);

  try {
    const updated = await prisma.$queryRawUnsafe<CategoryRow[]>(
      `UPDATE service_categories
         SET ${sets.join(', ')}
       WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
       RETURNING id::text, tenant_id, key, name, description, icon, tone,
                 sort_order, is_system, created_at::text, updated_at::text`,
      ...args,
    );
    const cat = updated[0];
    if (!cat) return NextResponse.json({ ok: false, error: 'Category not found' }, { status: 404 });

    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
      entityType: 'ServiceCategory', entityId: cat.id, entityName: cat.name,
      action: 'UPDATE', details: `Updated service category ${cat.name}`,
    });

    return NextResponse.json({ ok: true, category: cat });
  } catch (err) {
    captureException(err, { context: 'service-config.categories.update' });
    return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const adminCheck = requireAdmin(auth);
  if (!adminCheck.ok) return adminCheck.res;

  const { id } = await params;
  await ensureServiceConfigTables();

  // Block delete of system rows or rows with non-deleted child types.
  const rows = await prisma.$queryRawUnsafe<Array<{ is_system: boolean; type_count: bigint }>>(
    `SELECT c.is_system,
            (SELECT COUNT(*) FROM service_types t
              WHERE t.category_id = c.id AND t.deleted_at IS NULL)::bigint AS type_count
     FROM service_categories c
     WHERE c.id = $1::uuid AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
    id, auth.tenantId,
  ).catch(() => []);
  const found = rows[0];
  if (!found) return NextResponse.json({ ok: false, error: 'Category not found' }, { status: 404 });
  if (found.is_system) return NextResponse.json({ ok: false, error: 'Cannot delete a system category.' }, { status: 400 });
  if (Number(found.type_count) > 0) {
    return NextResponse.json({ ok: false, error: 'Cannot delete — category still has service types.' }, { status: 400 });
  }

  await prisma.$executeRawUnsafe(
    `UPDATE service_categories SET deleted_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
    id, auth.tenantId,
  );

  void logAudit({
    tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
    entityType: 'ServiceCategory', entityId: id,
    action: 'DELETE', details: 'Soft-deleted service category',
  });

  return NextResponse.json({ ok: true });
}
