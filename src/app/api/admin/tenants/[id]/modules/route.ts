export const dynamic = 'force-dynamic';

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
      // TxClient's public type doesn't expose $transaction; use the
      // savepoint cast pattern (runtime supports it; same GUC on the
      // inner connection).
      await (tx as any).$transaction([
        tx.tenantModule.deleteMany({ where: { tenantId: params.id } }),
        tx.tenantModule.createMany({
          data: enabledModules.map(m => ({ tenantId: params.id, module: m, isEnabled: true })),
        }),
      ]);
      const modules = await tx.tenantModule.findMany({ where: { tenantId: params.id } });
      return NextResponse.json(modules);
    });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
