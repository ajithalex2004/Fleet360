import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const lessees = await prisma.lessee.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(lessees);
  } catch (error) {
    console.error('Error fetching lessees:', error);
    return NextResponse.json({ error: 'Failed to fetch lessees' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const lessee = await prisma.lessee.create({ data: body });
    return NextResponse.json(lessee, { status: 201 });
  } catch (error) {
    console.error('Error creating lessee:', error);
    return NextResponse.json({ error: 'Failed to create lessee' }, { status: 500 });
  }
}
