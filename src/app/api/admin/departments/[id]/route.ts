export const dynamic = 'force-dynamic';

/**
 * /api/admin/departments/[id]
 *
 * PATCH   { name?, code?, isActive? }
 * DELETE  removes the department; members keep their membership with no
 *         department (user_tenants.department_id ON DELETE SET NULL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { departmentInput, isUniqueViolation } from '@/lib/admin/departments';

type Params = { params: Promise<{ id: string }> };

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl }, { allowPlatformSwitch: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const tenantId = authz.tenantId;
  const rawBody = await req.json().catch(() => null);
  const body = rawBody && typeof rawBody === 'object' ? stripTenantOwnershipFields(rawBody as Record<string, unknown>) : null;
  const input = departmentInput(body, { requireName: false });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    const updated = await withTenantRls(prisma, tenantId, async (tx) => {
      const n = await tx.department.updateMany({ where: { id, tenantId }, data: { ...input.value, updatedAt: new Date() } });
      return n.count ? tx.department.findUnique({ where: { id }, select: { id: true, name: true, code: true, isActive: true } }) : null;
    });
    if (!updated) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: 'A department with this name already exists' }, { status: 409 });
    console.error('PATCH /api/admin/departments/[id]:', e);
    return NextResponse.json({ error: 'Failed to update the department' }, { status: 500 });
  }
}

async function handleDELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl }, { allowPlatformSwitch: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const tenantId = authz.tenantId;
  try {
    const n = await withTenantRls(prisma, tenantId, (tx) => tx.department.deleteMany({ where: { id, tenantId } }));
    if (!n.count) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/admin/departments/[id]:', e);
    return NextResponse.json({ error: 'Failed to delete the department' }, { status: 500 });
  }
}

export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
