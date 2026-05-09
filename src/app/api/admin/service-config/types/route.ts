/**
 * POST /api/admin/service-config/types
 *   Body: { categoryId, key, name, description?, icon?, tone?,
 *           defaultPriority?, sortOrder? }
 *   Adds a new L2 service type under an existing category. Mapping row is
 *   inserted with safe defaults (linked to ADMIN, notification engine on).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { ensureServiceConfigTables } from '@/lib/service-config/schema';
import { SERVICE_TONES } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface TypeRow {
  id: string; tenant_id: string; category_id: string; key: string; name: string;
  description: string | null; icon: string | null; tone: string;
  default_priority: string; sort_order: number; is_system: boolean;
  created_at: string; updated_at: string;
}

export async function POST(req: NextRequest) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const adminCheck = requireAdmin(auth);
  if (!adminCheck.ok) return adminCheck.res;

  let body: {
    categoryId?: string; key?: string; name?: string; description?: string;
    icon?: string; tone?: string; defaultPriority?: string; sortOrder?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const categoryId = String(body.categoryId ?? '').trim();
  const key  = String(body.key  ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const name = String(body.name ?? '').trim();
  if (!categoryId) return NextResponse.json({ ok: false, error: 'categoryId is required.' }, { status: 400 });
  if (!key)        return NextResponse.json({ ok: false, error: 'Key is required.' }, { status: 400 });
  if (!name)       return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 });

  const tone = (SERVICE_TONES as readonly string[]).includes(body.tone ?? '') ? body.tone! : 'violet';
  const priority = ['Low', 'Medium', 'High'].includes(body.defaultPriority ?? '') ? body.defaultPriority! : 'Medium';
  const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 100;

  await ensureServiceConfigTables();

  // Verify the category belongs to this tenant.
  const cat = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM service_categories
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    categoryId, auth.tenantId,
  ).catch(() => []);
  if (!cat[0]) return NextResponse.json({ ok: false, error: 'Category not found' }, { status: 404 });

  try {
    const inserted = await prisma.$queryRawUnsafe<TypeRow[]>(
      `INSERT INTO service_types
        (tenant_id, category_id, key, name, description, icon, tone,
         default_priority, sort_order, is_system)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, FALSE)
       RETURNING id::text, tenant_id, category_id::text, key, name, description, icon, tone,
                 default_priority, sort_order, is_system, created_at::text, updated_at::text`,
      auth.tenantId, categoryId, key, name, body.description ?? null,
      body.icon ?? null, tone, priority, sortOrder,
    );
    const t = inserted[0];
    if (!t) return NextResponse.json({ ok: false, error: 'Insert returned no row' }, { status: 500 });

    // Default mapping — owned by ADMIN, notifications on, everything else off.
    await prisma.$executeRawUnsafe(
      `INSERT INTO service_module_mapping
         (service_type_id, linked_module, sub_module,
          workflow_engine_enabled, notification_engine_enabled, approval_engine_enabled,
          finance_engine_enabled, dispatch_engine_enabled)
       VALUES ($1::uuid, 'ADMIN', NULL, FALSE, TRUE, FALSE, FALSE, FALSE)
       ON CONFLICT (service_type_id) DO NOTHING`,
      t.id,
    );

    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
      entityType: 'ServiceType', entityId: t.id, entityName: name,
      action: 'CREATE', details: `Created service type ${name} (${key})`,
    });

    return NextResponse.json({ ok: true, type: t }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return NextResponse.json({ ok: false, error: `Key "${key}" already exists.` }, { status: 409 });
    }
    captureException(err, { context: 'service-config.types.create' });
    return NextResponse.json({ ok: false, error: 'Failed to create service type' }, { status: 500 });
  }
}
