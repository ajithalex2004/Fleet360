import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function parseOptionalDate(value: unknown) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const data = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'lessee'));
    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.assessmentDate !== undefined) {
      const assessmentDate = parseOptionalDate(data.assessmentDate);
      if (assessmentDate) updateData.assessmentDate = assessmentDate;
      else delete updateData.assessmentDate;
    }
    if (data.validUntil !== undefined) {
      updateData.validUntil = parseOptionalDate(data.validUntil);
    }
    const item = await prisma.leaseCreditAssessment.update({
      where: { id: params.id },
      data: updateData,
    });
    return NextResponse.json(item);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
