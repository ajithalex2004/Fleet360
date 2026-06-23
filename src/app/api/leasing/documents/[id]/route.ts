import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const doc = await prisma.leaseDocument.update({ where: { id: params.id }, data: { ...body, updatedAt: new Date() } });
    return NextResponse.json(doc);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await prisma.leaseDocument.findUnique({
    where: { id: params.id },
    select: { fileUrl: true },
  });
  await prisma.leaseDocument.delete({ where: { id: params.id } });
  if (existing?.fileUrl?.startsWith('/uploads/')) {
    await getStorage().delete(existing.fileUrl.replace('/uploads/', ''));
  }
  return NextResponse.json({ success: true });
}
