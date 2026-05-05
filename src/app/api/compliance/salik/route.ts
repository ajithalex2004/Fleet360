import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const salikAccounts = await prisma.salikAccount.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(salikAccounts);
  } catch (error) {
    console.error('Error fetching Salik accounts:', error);
    return NextResponse.json({ error: 'Failed to fetch Salik accounts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const salikAccount = await prisma.salikAccount.create({ data: body });
    return NextResponse.json(salikAccount, { status: 201 });
  } catch (error) {
    console.error('Error creating Salik account:', error);
    return NextResponse.json({ error: 'Failed to create Salik account' }, { status: 500 });
  }
}
