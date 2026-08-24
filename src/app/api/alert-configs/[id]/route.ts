import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { PrismaClient } from '@prisma/client';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const prisma = new PrismaClient();

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();
            const { id, ...updateData } = body; // Exclude ID from update data

            const updatedConfig = await tx.alertConfig.update({
                where: { id: params.id },
                data: updateData,
            });
            return NextResponse.json(updatedConfig);
        } catch (e) {
            console.error('Failed to update alert config:', e);
            return NextResponse.json({
                error: 'Failed to update alert config',
                details: e instanceof Error ? e.message : String(e)
            }, { status: 500 });
        }
  });
}


export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            await tx.alertConfig.delete({
                where: { id: params.id },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete alert config:', e);
            return NextResponse.json({ error: 'Failed to delete alert config' }, { status: 500 });
        }
  });
}

