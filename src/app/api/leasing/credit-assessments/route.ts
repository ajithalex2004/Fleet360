import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function parseOptionalDate(value: unknown) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const items = await prisma.leaseCreditAssessment.findMany({
      where: lesseeId ? { lesseeId } : {},
      include: { lessee: { select: { name: true, type: true } } },
      orderBy: { assessmentDate: 'desc' },
    });
    const uniqueLesseeIds = Array.from(new Set(items.map(item => item.lesseeId).filter(Boolean)));
    const contracts = uniqueLesseeIds.length > 0
      ? await prisma.leaseContract2.findMany({
          where: {
            lesseeId: { in: uniqueLesseeIds },
            deletedAt: null,
            status: { in: ['ACTIVE', 'APPROVED', 'EXTENDED'] },
          },
          select: { lesseeId: true, totalContractValue: true },
        })
      : [];
    const exposureByLessee = new Map<string, number>();
    for (const contract of contracts) {
      const current = exposureByLessee.get(contract.lesseeId) ?? 0;
      const amount = Number(contract.totalContractValue ?? 0);
      exposureByLessee.set(contract.lesseeId, current + (Number.isFinite(amount) ? amount : 0));
    }

    return NextResponse.json(items.map(item => {
      const activeExposure = exposureByLessee.get(item.lesseeId) ?? 0;
      const recordedExposure = Number(item.currentExposure ?? 0);
      return {
        ...item,
        currentExposure: Math.max(activeExposure, Number.isFinite(recordedExposure) ? recordedExposure : 0),
      };
    }));
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await prisma.leaseCreditAssessment.create({
      data: {
        ...body,
        assessmentDate: parseOptionalDate(body.assessmentDate),
        validUntil: parseOptionalDate(body.validUntil),
        status: body.status ? String(body.status) : 'ACTIVE',
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
