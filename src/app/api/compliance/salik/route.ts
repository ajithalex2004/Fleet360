export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const salikAccounts = await tx.salikAccount.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(salikAccounts);
      } catch (e) {
        console.error('Error fetching Salik accounts:', e);
        return NextResponse.json({ error: 'Failed to fetch Salik accounts' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const salikAccount = await tx.salikAccount.create({ data: body });
        return NextResponse.json(salikAccount, { status: 201 });
        } catch (e) {
        console.error('Error creating Salik account:', e);
        return NextResponse.json({ error: 'Failed to create Salik account' }, { status: 500 });
      }
  });
}

