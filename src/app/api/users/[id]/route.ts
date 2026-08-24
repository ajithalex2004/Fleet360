import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const user = await tx.user.findUnique({
                where: { id: params.id },
            });
            if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
            return NextResponse.json(user);
        } catch (e) {
            return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
        }
  });
}


export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();
            const updatedUser = await tx.user.update({
                where: { id: params.id },
                data: body,
            });
            return NextResponse.json(updatedUser);
        } catch (e) {
            return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
        }
  });
}


export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            await tx.user.delete({
                where: { id: params.id },
            });
            return NextResponse.json({ message: 'User deleted' });
            } catch (e) {
            return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
        }
  });
}

