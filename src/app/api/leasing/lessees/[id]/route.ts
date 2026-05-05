import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const lessee = await prisma.lessee.findUnique({
      where: { id: params.id },
      include: {
        leaseContracts:    { take: 5, orderBy: { createdAt: 'desc' } },
        creditAssessments: { orderBy: { assessmentDate: 'desc' }, take: 1 },
        invoices:          { where: { status: { in: ['SENT','OVERDUE'] } }, take: 5 },
        directDebits:      { where: { status: 'ACTIVE' } },
      },
    });
    if (!lessee) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(lessee);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { leaseContracts, creditAssessments, invoices, directDebits, ...data } = await req.json();
    const lessee = await prisma.lessee.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(lessee);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.lessee.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ success: true });
}
