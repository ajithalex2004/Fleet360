/**
 * GET  /api/admin/service-config/categories
 *   Returns the tenant's categories with their child types and module mapping
 *   so the admin tree can render in one round-trip. Lazy-seeds platform
 *   defaults on first read.
 *
 * POST /api/admin/service-config/categories
 *   Body: { key, name, description?, icon?, tone?, sortOrder? }
 *   Adds a new category. Reserved if `key` collides with an existing one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig, recordServiceConfigChange, requireServiceConfigApproval, requireServiceConfigPermission } from '@/lib/service-config/auth';
import { ensureSeededForTenant } from '@/lib/service-config/schema';
import { SERVICE_TONES, type ServiceTone, type ServiceCategoryWithTypes, type ServiceCategory, type ServiceType, type ServiceModuleMapping } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface CategoryRow {
  id: string; tenant_id: string; key: string; name: string; description: string | null;
  icon: string | null; tone: string; sort_order: number; is_system: boolean;
  created_at: string; updated_at: string;
}
interface TypeRow {
  id: string; tenant_id: string; category_id: string; key: string; name: string;
  description: string | null; icon: string | null; tone: string;
  default_priority: string; sort_order: number; is_system: boolean;
  created_at: string; updated_at: string;
}
interface MappingRow {
  service_type_id: string; linked_module: string; sub_module: string | null;
  workflow_engine_enabled: boolean; notification_engine_enabled: boolean;
  approval_engine_enabled: boolean; finance_engine_enabled: boolean;
  dispatch_engine_enabled: boolean; updated_at: string;
}

function catRowToApi(r: CategoryRow): ServiceCategory {
  return {
    id: r.id, tenantId: r.tenant_id, key: r.key, name: r.name,
    description: r.description, icon: r.icon, tone: r.tone as ServiceTone,
    sortOrder: r.sort_order, isSystem: r.is_system,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function typeRowToApi(r: TypeRow): ServiceType {
  return {
    id: r.id, tenantId: r.tenant_id, categoryId: r.category_id,
    key: r.key, name: r.name, description: r.description, icon: r.icon,
    tone: r.tone as ServiceTone,
    defaultPriority: r.default_priority as 'Low' | 'Medium' | 'High',
    sortOrder: r.sort_order, isSystem: r.is_system,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mappingRowToApi(r: MappingRow): ServiceModuleMapping {
  return {
    serviceTypeId: r.service_type_id,
    linkedModule: r.linked_module as ServiceModuleMapping['linkedModule'],
    subModule: r.sub_module,
    workflowEngineEnabled: r.workflow_engine_enabled,
    notificationEngineEnabled: r.notification_engine_enabled,
    approvalEngineEnabled: r.approval_engine_enabled,
    financeEngineEnabled: r.finance_engine_enabled,
    dispatchEngineEnabled: r.dispatch_engine_enabled,
    updatedAt: r.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;

  await ensureSeededForTenant(auth.tenantId);

  try {
    const [cats, types, mappings] = await Promise.all([
      prisma.$queryRawUnsafe<CategoryRow[]>(
        `SELECT id::text, tenant_id, key, name, description, icon, tone,
                sort_order, is_system, created_at::text, updated_at::text
         FROM service_categories
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY sort_order, name`,
        auth.tenantId,
      ),
      prisma.$queryRawUnsafe<TypeRow[]>(
        `SELECT id::text, tenant_id, category_id::text, key, name, description, icon, tone,
                default_priority, sort_order, is_system, created_at::text, updated_at::text
         FROM service_types
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY sort_order, name`,
        auth.tenantId,
      ),
      prisma.$queryRawUnsafe<MappingRow[]>(
        `SELECT m.service_type_id::text, m.linked_module, m.sub_module,
                m.workflow_engine_enabled, m.notification_engine_enabled,
                m.approval_engine_enabled, m.finance_engine_enabled,
                m.dispatch_engine_enabled, m.updated_at::text
         FROM service_module_mapping m
         JOIN service_types t ON t.id = m.service_type_id
         WHERE t.tenant_id = $1 AND t.deleted_at IS NULL`,
        auth.tenantId,
      ),
    ]);

    const mappingByType = new Map(mappings.map(m => [m.service_type_id, mappingRowToApi(m)]));
    const typesByCat: Record<string, ServiceType[]> = {};
    for (const t of types) {
      const k = t.category_id;
      (typesByCat[k] = typesByCat[k] ?? []).push(typeRowToApi(t));
    }

    const categories: ServiceCategoryWithTypes[] = cats.map(c => ({
      ...catRowToApi(c),
      types: typesByCat[c.id] ?? [],
    }));

    return NextResponse.json({ ok: true, categories, mappings: Array.from(mappingByType.values()) });
  } catch (err) {
    captureException(err, { context: 'service-config.categories.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load service config' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireServiceConfigPermission(req, 'create');
  if (!auth.ok) return auth.res;

  let body: { key?: string; name?: string; description?: string; icon?: string; tone?: string; sortOrder?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const key  = String(body.key  ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const name = String(body.name ?? '').trim();
  if (!key)  return NextResponse.json({ ok: false, error: 'Key is required.' }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 });
  const tone = (SERVICE_TONES as readonly string[]).includes(body.tone ?? '') ? body.tone! : 'violet';
  const sortOrder = Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 100;

  const approval = await requireServiceConfigApproval(req, auth, 'service_config.category.create', {
    targetType: 'ServiceCategory',
    targetId: key,
    summary: `Create service category ${name} (${key}).`,
    payload: { key, name, tone, sortOrder },
  });
  if (approval) return approval;

  await ensureSeededForTenant(auth.tenantId);

  try {
    const inserted = await prisma.$queryRawUnsafe<CategoryRow[]>(
      `INSERT INTO service_categories
        (tenant_id, key, name, description, icon, tone, sort_order, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       RETURNING id::text, tenant_id, key, name, description, icon, tone,
                 sort_order, is_system, created_at::text, updated_at::text`,
      auth.tenantId, key, name, body.description ?? null, body.icon ?? null, tone, sortOrder,
    );
    const cat = inserted[0];
    if (!cat) return NextResponse.json({ ok: false, error: 'Insert returned no row' }, { status: 500 });

    await recordServiceConfigChange({
      req,
      auth,
      entityType: 'ServiceCategory',
      entityId: cat.id,
      entityName: name,
      action: 'CREATE',
      after: catRowToApi(cat),
      summary: `Created service category ${name} (${key}).`,
    });

    return NextResponse.json({ ok: true, category: catRowToApi(cat) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return NextResponse.json({ ok: false, error: `Key "${key}" already exists.` }, { status: 409 });
    }
    captureException(err, { context: 'service-config.categories.create' });
    return NextResponse.json({ ok: false, error: 'Failed to create category' }, { status: 500 });
  }
}
