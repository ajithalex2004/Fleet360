export const dynamic = 'force-dynamic';

/**
 * /api/admin/departments — the company's Department master (Admin >
 * Departments). A user's department in a company is chosen from it
 * (Admin > Users > Module Access).
 *
 * GET   ?tenantId= (platform admins only; others get their own company)
 *       ?includeInactive=true
 * POST  { name, code? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { departmentInput, isUniqueViolation } from '@/lib/admin/departments';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl }, { allowPlatformSwitch: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const tenantId = authz.tenantId;
  const includeInactive = req.nextUrl.searchParams.get('includeInactive') === 'true';
  try {
    const rows = await withTenantRls(prisma, tenantId, (tx) => tx.department.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      select: { id: true, name: true, code: true, isActive: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    }));
    return NextResponse.json(
      rows.map(({ _count, ...d }) => ({ ...d, memberCount: _count.members })),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    console.error('GET /api/admin/departments:', e);
    return NextResponse.json({ error: 'Failed to load departments' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl }, { allowPlatformSwitch: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const tenantId = authz.tenantId;
  const rawBody = await req.json().catch(() => null);
  const body = rawBody && typeof rawBody === 'object' ? stripTenantOwnershipFields(rawBody as Record<string, unknown>) : null;
  const input = departmentInput(body, { requireName: true });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    const dept = await withTenantRls(prisma, tenantId, (tx) => tx.department.create({
      data: { tenantId, name: input.value.name!, code: input.value.code ?? null },
      select: { id: true, name: true, code: true, isActive: true },
    }));
    return NextResponse.json(dept, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: 'A department with this name already exists' }, { status: 409 });
    console.error('POST /api/admin/departments:', e);
    return NextResponse.json({ error: 'Failed to create the department' }, { status: 500 });
  }
}

export const POST = withAuditedAction(handlePOST);
