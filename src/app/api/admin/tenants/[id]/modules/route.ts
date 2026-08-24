import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, params.id, async (tx) => {
    const modules = await tx.tenantModule.findMany({ where: { tenantId: params.id } });
    return NextResponse.json(modules);
  });
}

// PUT: replace all module assignments
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const { enabledModules }: { enabledModules: string[] } = await req.json();
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
