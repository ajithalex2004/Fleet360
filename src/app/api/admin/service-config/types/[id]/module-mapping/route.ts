/**
 * GET /api/admin/service-config/types/[id]/module-mapping
 *   Returns the mapping row for a service type. Lazily creates a default one
 *   linked to ADMIN if none exists (e.g. types that pre-date this table).
 *
 * PUT /api/admin/service-config/types/[id]/module-mapping
 *   Body: { linkedModule, subModule?, workflowEngineEnabled,
 *           notificationEngineEnabled, approvalEngineEnabled,
 *           financeEngineEnabled, dispatchEngineEnabled }
 *   Replaces the mapping row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { ensureServiceConfigTables } from '@/lib/service-config/schema';
import { LINKED_MODULES, type LinkedModule } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

interface MappingRow {
  service_type_id: string; linked_module: string; sub_module: string | null;
  workflow_engine_enabled: boolean; notification_engine_enabled: boolean;
  approval_engine_enabled: boolean; finance_engine_enabled: boolean;
  dispatch_engine_enabled: boolean; updated_at: string;
}

async function ownsType(tenantId: string, typeId: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM service_types
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    typeId, tenantId,
  ).catch(() => []);
  return rows.length > 0;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const { id } = await params;
  await ensureServiceConfigTables();
  if (!await ownsType(auth.tenantId, id)) {
    return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });
  }

  let rows = await prisma.$queryRawUnsafe<MappingRow[]>(
    `SELECT service_type_id::text, linked_module, sub_module,
            workflow_engine_enabled, notification_engine_enabled,
            approval_engine_enabled, finance_engine_enabled,
            dispatch_engine_enabled, updated_at::text
     FROM service_module_mapping
     WHERE service_type_id = $1::uuid`,
    id,
  ).catch(() => []);

  if (rows.length === 0) {
    // Lazy-create a sensible default so the UI always has something to edit.
    await prisma.$executeRawUnsafe(
      `INSERT INTO service_module_mapping
         (service_type_id, linked_module, notification_engine_enabled)
       VALUES ($1::uuid, 'ADMIN', TRUE)
       ON CONFLICT (service_type_id) DO NOTHING`,
      id,
    );
    rows = await prisma.$queryRawUnsafe<MappingRow[]>(
      `SELECT service_type_id::text, linked_module, sub_module,
              workflow_engine_enabled, notification_engine_enabled,
              approval_engine_enabled, finance_engine_enabled,
              dispatch_engine_enabled, updated_at::text
       FROM service_module_mapping WHERE service_type_id = $1::uuid`,
      id,
    );
  }

  return NextResponse.json({ ok: true, mapping: rows[0] });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const adminCheck = requireAdmin(auth);
  if (!adminCheck.ok) return adminCheck.res;

  const { id } = await params;
  await ensureServiceConfigTables();
  if (!await ownsType(auth.tenantId, id)) {
    return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });
  }

  let body: {
    linkedModule?: string; subModule?: string | null;
    workflowEngineEnabled?: boolean; notificationEngineEnabled?: boolean;
    approvalEngineEnabled?: boolean; financeEngineEnabled?: boolean;
    dispatchEngineEnabled?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.linkedModule || !(LINKED_MODULES as readonly string[]).includes(body.linkedModule)) {
    return NextResponse.json({ ok: false, error: `linkedModule must be one of ${LINKED_MODULES.join(', ')}` }, { status: 400 });
  }
  const linkedModule = body.linkedModule as LinkedModule;
  const subModule    = (typeof body.subModule === 'string' && body.subModule.trim().length > 0) ? body.subModule.trim() : null;

  try {
    const updated = await prisma.$queryRawUnsafe<MappingRow[]>(
      `INSERT INTO service_module_mapping
         (service_type_id, linked_module, sub_module,
          workflow_engine_enabled, notification_engine_enabled, approval_engine_enabled,
          finance_engine_enabled, dispatch_engine_enabled, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (service_type_id) DO UPDATE SET
         linked_module               = EXCLUDED.linked_module,
         sub_module                  = EXCLUDED.sub_module,
         workflow_engine_enabled     = EXCLUDED.workflow_engine_enabled,
         notification_engine_enabled = EXCLUDED.notification_engine_enabled,
         approval_engine_enabled     = EXCLUDED.approval_engine_enabled,
         finance_engine_enabled      = EXCLUDED.finance_engine_enabled,
         dispatch_engine_enabled     = EXCLUDED.dispatch_engine_enabled,
         updated_at                  = NOW()
       RETURNING service_type_id::text, linked_module, sub_module,
                 workflow_engine_enabled, notification_engine_enabled,
                 approval_engine_enabled, finance_engine_enabled,
                 dispatch_engine_enabled, updated_at::text`,
      id, linkedModule, subModule,
      !!body.workflowEngineEnabled, body.notificationEngineEnabled !== false,
      !!body.approvalEngineEnabled, !!body.financeEngineEnabled, !!body.dispatchEngineEnabled,
    );

    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
      entityType: 'ServiceModuleMapping', entityId: id,
      action: 'UPDATE',
      details: `Module mapping → ${linkedModule}${subModule ? ` / ${subModule}` : ''}`,
    });

    return NextResponse.json({ ok: true, mapping: updated[0] });
  } catch (err) {
    captureException(err, { context: 'service-config.mapping.put' });
    return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 });
  }
}
