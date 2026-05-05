import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status   = searchParams.get('status');
    const severity = searchParams.get('severity');
    const incidents = await prisma.tripIncident.findMany({
      where: {
        ...(status   ? { status }   : {}),
        ...(severity ? { severity } : {}),
      },
      orderBy: { incidentDate: 'desc' },
    });
    return NextResponse.json(incidents);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.tripIncident.count();
    const incidentNo = body.incidentNo ?? `INC-${String(count + 1).padStart(5, '0')}`;
    const incident = await prisma.tripIncident.create({ data: { ...body, incidentNo } });
    return NextResponse.json(incident, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
