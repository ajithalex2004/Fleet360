import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const department = searchParams.get('department');
    const routeId    = searchParams.get('routeId');
    const active     = searchParams.get('active');

    const staff = await prisma.staffMember.findMany({
      where: {
        deletedAt: null,
        ...(department ? { department } : {}),
        ...(routeId    ? { defaultRouteId: routeId } : {}),
        ...(active === 'true' ? { isActive: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(staff);
  } catch (error) {
    console.error('Error fetching staff:', error);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const staffMember = await prisma.staffMember.create({ data: body });
    return NextResponse.json(staffMember, { status: 201 });
  } catch (error) {
    console.error('Error creating staff member:', error);
    return NextResponse.json({ error: 'Failed to create staff member' }, { status: 500 });
  }
}
