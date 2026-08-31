export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const sets: string[] = [];
      if (body.name)        sets.push(`name = '${body.name.replace(/'/g,"''")}'`);
      if (body.code)        sets.push(`code = '${body.code.replace(/'/g,"''")}'`);
      if (body.description) sets.push(`description = '${body.description.replace(/'/g,"''")}'`);
      if (sets.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
      await tx.$executeRawUnsafe(`UPDATE customer_hierarchy SET ${sets.join(', ')} WHERE id = '${params.id}'`);
      const rows = await tx.$queryRawUnsafe(`SELECT * FROM customer_hierarchy WHERE id = '${params.id}'`);
      return NextResponse.json((rows as any[])[0]);
  });
}


export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE customer_hierarchy SET is_active = false WHERE id = '${params.id}'`);
      return NextResponse.json({ success: true });
  });
}

