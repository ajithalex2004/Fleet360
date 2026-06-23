import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MODULES } from '@/lib/permissions';
import { requireAdminRole } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';
import { normalizeModuleKey } from '@/lib/admin-policy';
import { listTenantReadiness } from '@/lib/tenant-readiness';

export async function GET(req: NextRequest) {
  try {
    const auth = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const limit  = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);

    const where = auth.isSuperAdmin && search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { code: { contains: search, mode: 'insensitive' as const } },
            { id:   { contains: search, mode: 'insensitive' as const } },
            { contactEmail: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : auth.isSuperAdmin ? {} : { id: auth.tenantId };

    const tenants = await prisma.tenant.findMany({
      where,
      include: {
        modules: true,
        _count: { select: { userTenants: true, roles: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const readinessRows = await listTenantReadiness(tenants.map(t => t.id));
    const readinessByTenant = new Map(readinessRows.map(row => [row.tenantId, row]));

    return NextResponse.json(tenants.map(t => ({
      ...t,
      readiness: readinessByTenant.get(t.id) ?? null,
      health: (() => {
        const readiness = readinessByTenant.get(t.id);
        if (!readiness) return null;
        return {
          score: readiness.score,
          status: readiness.status === 'READY' ? 'HEALTHY' : readiness.status,
          enabledModules: readiness.metrics.enabledModules,
          pendingApprovals: readiness.metrics.pendingApprovals,
          issues: readiness.checks
            .filter(issue => issue.severity !== 'pass')
            .map(issue => ({
              severity: issue.severity === 'blocker' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info',
              message: issue.message,
            })),
        };
      })(),
    })));
  } catch (e) {
    console.error('[GET /api/admin/tenants] error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Failed', detail: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdminRole(req, ['SUPER_ADMIN']);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json();
    const {
      enabledModules = MODULES,
      // pull out fields that need special handling
      localizedName, localizedDesc, bookingTypes,
      supportedLanguages, defaultLanguage,
      domain, address, contactName, contactEmail, contactPhone,
      plan, industry, code, name,
    } = body;
    const modules = Array.from(new Set((enabledModules as string[]).map(normalizeModuleKey)));
    const invalidModules = modules.filter(m => !(MODULES as readonly string[]).includes(m));
    if (invalidModules.length) {
      return NextResponse.json(
        { error: `Invalid module keys: ${invalidModules.join(', ')}. Valid modules: ${MODULES.join(', ')}` },
        { status: 400 },
      );
    }

    const tenant = await prisma.tenant.create({
      data: {
        name:              name,
        code:              code   || undefined,
        plan:              plan   || 'STANDARD',
        industry:          industry || undefined,
        domain:            domain   || undefined,
        address:           address  || undefined,
        contactName:       contactName  || undefined,
        contactEmail:      contactEmail || undefined,
        contactPhone:      contactPhone || undefined,
        defaultLanguage:   defaultLanguage  || 'en',
        supportedLanguages: supportedLanguages || 'en',
        localizedName:     localizedName  || undefined,
        localizedDesc:     localizedDesc  || undefined,
        bookingTypes:      bookingTypes   || undefined,
        modules: {
          create: modules.map((m: string) => ({ module: m, isEnabled: true })),
        },
      },
      include: { modules: true },
    });
    await recordAdminChange({
      req,
      ctx: auth,
      tenantId: tenant.id,
      entityType: 'Tenant',
      entityId: tenant.id,
      entityName: tenant.name,
      action: 'CREATE',
      after: tenant,
      summary: `Created tenant ${tenant.name}.`,
    });
    return NextResponse.json(tenant, { status: 201 });
  } catch (e) {
    console.error('[CREATE TENANT]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
