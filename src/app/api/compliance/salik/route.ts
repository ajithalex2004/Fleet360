import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const salikAccounts = await prisma.salikAccount.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(salikAccounts);
  } catch (error) {
    console.error('Error fetching Salik accounts:', error);
    return NextResponse.json({ error: 'Failed to fetch Salik accounts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json();
    const salikAccount = await prisma.salikAccount.create({ data: body });
    return NextResponse.json(salikAccount, { status: 201 });
  } catch (error) {
    console.error('Error creating Salik account:', error);
    return NextResponse.json({ error: 'Failed to create Salik account' }, { status: 500 });
  }
}
