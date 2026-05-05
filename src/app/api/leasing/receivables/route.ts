import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const now = new Date();

    // Get all overdue / pending payments with contract + lessee info
    const payments = await prisma.leasePayment2.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
      },
      include: {
        contract: {
          include: {
            // We join to lessees via a sub-select below
          },
          select: { contractNumber: true, lesseeId: true, monthlyRate: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Group by lessee
    const lesseeIds = [...new Set(payments.map(p => p.contract.lesseeId))];
    const filteredIds = lesseeId ? lesseeIds.filter(id => id === lesseeId) : lesseeIds;

    const lessees = await prisma.lessee.findMany({ where: { id: { in: filteredIds } } });
    const lesseeMap = Object.fromEntries(lessees.map(l => [l.id, l]));

    const agingBuckets = filteredIds.map(lid => {
      const lessee = lesseeMap[lid];
      const lesseePmts = payments.filter(p => p.contract.lesseeId === lid);
      const current   = lesseePmts.filter(p => new Date(p.dueDate) >= now);
      const overdue1  = lesseePmts.filter(p => { const d = new Date(p.dueDate); return d < now && (now.getTime()-d.getTime())/(86400000) <= 30; });
      const overdue31 = lesseePmts.filter(p => { const d = new Date(p.dueDate); const days=(now.getTime()-d.getTime())/(86400000); return days>30 && days<=60; });
      const overdue61 = lesseePmts.filter(p => { const d = new Date(p.dueDate); const days=(now.getTime()-d.getTime())/(86400000); return days>60 && days<=90; });
      const overdue90 = lesseePmts.filter(p => { const d = new Date(p.dueDate); return (now.getTime()-d.getTime())/(86400000) > 90; });
      const sum = (arr: typeof lesseePmts) => arr.reduce((s, p) => s + Number(p.totalAmount ?? p.amount), 0);
      return {
        lesseeId: lid,
        lesseeName: lessee?.name ?? lid,
        lesseeType: lessee?.type,
        current: sum(current),
        overdue1_30: sum(overdue1),
        overdue31_60: sum(overdue31),
        overdue61_90: sum(overdue61),
        overdue90plus: sum(overdue90),
        totalOutstanding: sum(lesseePmts),
        payments: lesseePmts.map(p => ({
          id: p.id, contractNumber: p.contract.contractNumber,
          dueDate: p.dueDate, amount: p.totalAmount ?? p.amount,
          status: p.status, periodMonth: p.periodMonth, periodYear: p.periodYear,
        })),
      };
    });

    return NextResponse.json({ agingBuckets, asOfDate: now });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
