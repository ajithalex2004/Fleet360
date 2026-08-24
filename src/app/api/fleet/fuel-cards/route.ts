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
    const fuelCards = await prisma.fuelCard.findMany({
      orderBy: { cardNumber: 'asc' },
    });
    return NextResponse.json(fuelCards);
  } catch (error) {
    console.error('Error fetching fuel cards:', error);
    return NextResponse.json({ error: 'Failed to fetch fuel cards' }, { status: 500 });
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
    const fuelCard = await prisma.fuelCard.create({ data: body });
    return NextResponse.json(fuelCard, { status: 201 });
  } catch (error) {
    console.error('Error creating fuel card:', error);
    return NextResponse.json({ error: 'Failed to create fuel card' }, { status: 500 });
  }
}
