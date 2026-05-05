import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const status   = searchParams.get('status');
    const invoices = await prisma.leaseInvoice.findMany({
      where: { ...(lesseeId ? { lesseeId } : {}), ...(status ? { status } : {}) },
      include: { lessee: { select: { name: true } }, lines: true },
      orderBy: { issueDate: 'desc' },
    });
    return NextResponse.json(invoices);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lines = [], ...invoiceData } = body;
    const count = await prisma.leaseInvoice.count();
    const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
    const subTotal = lines.reduce((s: number, l: any) => s + parseFloat(l.totalAmount || '0'), 0);
    const vatPct   = parseFloat(invoiceData.vatPct ?? '5');
    const vatAmount = subTotal * (vatPct / 100);
    const totalAmount = subTotal + vatAmount;
    const invoice = await prisma.leaseInvoice.create({
      data: {
        ...invoiceData, invoiceNo, subTotal, vatAmount, totalAmount,
        lines: { create: lines },
      },
      include: { lines: true, lessee: { select: { name: true } } },
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
