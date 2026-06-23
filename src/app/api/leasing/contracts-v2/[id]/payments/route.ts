import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { requireLeaseContractInTenant } from '@/lib/leasing-governance';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(request, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const boundary = await requireLeaseContractInTenant(id, ctx);
    if (boundary) return boundary;
    const body = await request.json();
    const { payments } = body;
    const rows = Array.isArray(payments) ? payments : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: 'payments array is required' }, { status: 400 });
    }

    const existingPending = await prisma.leasePayment2.count({
      where: {
        contractId: id,
        status: 'PENDING',
      },
    });

    const created = await prisma.$transaction(async (tx) => {
      if (existingPending > 0) {
        await tx.leasePayment2.deleteMany({
          where: {
            contractId: id,
            status: 'PENDING',
          },
        });
      }

      return Promise.all(
        rows.map((p: { month?: number; dueDate?: string; amount?: number; vat?: number; total?: number }) => {
          const dueDate = new Date(p.dueDate ?? Date.now());
          return tx.leasePayment2.create({
          data: {
            contractId: id,
            periodMonth: p.month ? Number(p.month) : null,
            periodYear: dueDate.getFullYear(),
            dueDate,
            amount: Number(p.amount ?? 0),
            vatAmount: p.vat === undefined ? null : Number(p.vat),
            totalAmount: p.total === undefined ? Number(p.amount ?? 0) : Number(p.total),
            status: 'PENDING',
          },
          });
        }),
      );
    });
    await recordOperationalChange({
      req: request,
      ctx,
      entityType: 'LeasePaymentSchedule',
      entityId: id,
      action: 'CREATE',
      before: existingPending > 0 ? { replacedPendingRows: existingPending } : undefined,
      after: { count: created.length, paymentIds: created.map(row => row.id), replacedPendingRows: existingPending },
      summary: `${existingPending > 0 ? 'Rebuilt' : 'Generated'} ${created.length} payment schedule row(s) for lease contract ${id}`,
    });
    return NextResponse.json({
      success: true,
      count: created.length,
      replacedPendingRows: existingPending,
      paymentIds: created.map(row => row.id),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
