import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const severity = searchParams.get('severity');
    const status = searchParams.get('status');
    const contractId = searchParams.get('contractId');

    const alerts = await prisma.leaseAlert.findMany({
      where: {
        ...(severity ? { severity } : {}),
        ...(status ? { status } : {}),
        ...(contractId ? { contractId } : {}),
      },
      include: { contract: { select: { contractNumber: true, lesseeId: true } } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(alerts);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const alert = await prisma.leaseAlert.create({ data: body });
    return NextResponse.json(alert, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
