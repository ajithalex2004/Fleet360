export const dynamic = 'force-dynamic';

/**
 * /api/admin/service-config/departments
 *
 * GET — every department for the tenant, including hidden ones, with the
 *       built-ins merged in (see src/lib/service-tickets/departments.ts).
 * PUT — create or update one department.
 *       Body: { key, label, shortLabel?, description?, tone?, sortOrder?, isActive? }
 *       Using a built-in key renames / hides that built-in. Triage can't be hidden.
 *       TENANT_ADMIN / SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import {
  listDepartments, upsertDepartment, validateDepartmentInput, type DepartmentInput,
} from '@/lib/service-tickets/departments';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;

  const departments = await listDepartments(auth.tenantId, { includeInactive: true });
  return NextResponse.json({ ok: true, departments });
}

async function handlePUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;

  let body: Partial<DepartmentInput>;
  try { body = stripTenantOwnershipFields(await req.json()); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const input: DepartmentInput = {
    key: String(body.key ?? '').trim().toUpperCase(),
    label: String(body.label ?? '').trim(),
    shortLabel: body.shortLabel ? String(body.shortLabel).trim().slice(0, 24) : undefined,
    description: body.description ? String(body.description).trim().slice(0, 240) : '',
    tone: body.tone ? String(body.tone) : undefined,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined,
    isActive: body.isActive !== false,
  };
  const invalid = validateDepartmentInput(input);
  if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 });

  try {
    await upsertDepartment(auth.tenantId, input);
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined,
      entityType: 'ServiceDepartment', entityId: input.key, entityName: input.label,
      action: 'UPDATE', details: `Saved department ${input.label} (${input.key})${input.isActive ? '' : ' — hidden'}`,
    });
    const departments = await listDepartments(auth.tenantId, { includeInactive: true });
    return NextResponse.json({ ok: true, departments });
  } catch (err) {
    captureException(err, { context: 'service-config.departments.put' });
    return NextResponse.json({ ok: false, error: 'Failed to save department' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
