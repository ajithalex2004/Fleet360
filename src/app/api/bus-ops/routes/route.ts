import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const active = searchParams.get('active');
    const routes = await prisma.busRoute.findMany({
      where: {
        deletedAt: null,
        ...(active === 'true' ? { isActive: true } : {}),
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(routes);
  } catch (error) {
    console.error('Error fetching routes:', error);
    return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { stops, ...routeData } = body;
    const route = await prisma.busRoute.create({
      data: {
        ...routeData,
        stops: stops?.length
          ? { create: stops.map((s: any, i: number) => ({ ...s, sequence: s.sequence ?? i + 1 })) }
          : undefined,
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    return NextResponse.json(route, { status: 201 });
  } catch (error) {
    console.error('Error creating route:', error);
    return NextResponse.json({ error: 'Failed to create route' }, { status: 500 });
  }
}
