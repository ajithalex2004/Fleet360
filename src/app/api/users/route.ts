import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET() {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const users = await tx.user.findMany({
                orderBy: { createdAt: 'desc' },
            });
            return NextResponse.json(users);
        } catch (e) {
            console.error('Error fetching users:', e);
            return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
        }
  });
}


export async function POST(request: Request) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();
            const newUser = await tx.user.create({
                data: body,
            });
            return NextResponse.json(newUser);
        } catch (e) {
            console.error('Error creating user:', e);
            return NextResponse.json({ error: `Failed to create user: ${(e as Error).message}` }, { status: 500 });
        }
  });
}

