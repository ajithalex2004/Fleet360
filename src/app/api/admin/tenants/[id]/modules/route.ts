export const dynamic = 'force-dynamic';

import { resolveModuleKey } from '@/lib/modules';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant, requireSuperAdminForTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  return withTenantRls(prisma, params.id, async (tx) => {
    const modules = await tx.tenantModule.findMany({ where: { tenantId: params.id } });
    return NextResponse.json(modules);
  });
}

// PUT: replace all module assignments
async function handlePUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw) as { enabledModules: string[] };
    const { enabledModules } = body;
      if (!Array.isArray(enabledModules) || enabledModules.some(m => typeof m !== 'string' || !resolveModuleKey(m))) {
        return NextResponse.json({ error: 'Invalid enabledModules' }, { status: 400 });
      }
      const canonical = [...new Set(enabledModules.map(m => resolveModuleKey(m)!))];
      await tx.tenantModule.deleteMany({ where: { tenantId: params.id } });
      await tx.tenantModule.createMany({ data: canonical.map(module => ({ tenantId: params.id, module, isEnabled: true })) });
      const modules = await tx.tenantModule.findMany({ where: { tenantId: params.id } });
      return NextResponse.json(modules);
    });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
