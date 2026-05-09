/**
 * POST /api/leasing/fuel/sweep-bill
 *
 * Monthly cron: converts PENDING fuel logs (billedToLessee=true) into a
 * consolidated LeaseInvoice per lessee per run, one line per fuel log.
 * Mirrors the traffic-fines sweep pattern — atomic transaction flips logs
 * to INVOICED with receiptRef=invoice.invoiceNo so repeat runs are safe.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?dryRun=1, ?olderThanDays=N (default 0 = bill everything pending),
 *        ?periodMonth=YYYY-MM (only bill logs from this month).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !req.headers.get('x-tenant-id')) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    const sp = req.nextUrl.searchParams;
    const dryRun = sp.get('dryRun') === '1';
    const olderThanDays = Math.max(0, Number(sp.get('olderThanDays') ?? 0));
    const periodMonth = sp.get('periodMonth'); // "YYYY-MM"

    let dateFilter: { gte?: Date; lte?: Date } | undefined;
    if (periodMonth && /^\d{4}-\d{2}$/.test(periodMonth)) {
      const [y, m] = periodMonth.split('-').map(Number);
      dateFilter = {
        gte: new Date(y, m - 1, 1),
        lte: new Date(y, m, 0, 23, 59, 59),
      };
    } else if (olderThanDays > 0) {
      dateFilter = { lte: new Date(Date.now() - olderThanDays * 86400000) };
    }

    const logs = await prisma.leaseFuelLog.findMany({
      where: {
        billingStatus: 'PENDING',
        billedToLessee: true,
        ...(dateFilter ? { fuelDate: dateFilter } : {}),
      },
      include: { contract: { select: { id: true, lesseeId: true, contractNumber: true, currency: true } } },
    });

    const byLessee = new Map<string, typeof logs>();
    for (const l of logs) {
      if (!l.contract?.lesseeId) continue;
      const arr = byLessee.get(l.contract.lesseeId) ?? [];
      arr.push(l);
      byLessee.set(l.contract.lesseeId, arr);
    }

    interface Assessment {
      lesseeId: string;
      logCount: number;
      totalLiters: number;
      totalCost: number;
      currency: string;
    }
    const assessments: Assessment[] = [];
    for (const [lesseeId, items] of byLessee) {
      assessments.push({
        lesseeId,
        logCount: items.length,
        totalLiters: items.reduce((s, l) => s + Number(l.liters ?? 0), 0),
        totalCost: items.reduce((s, l) => s + Number(l.totalCost ?? 0), 0),
        currency: items[0].currency ?? 'AED',
      });
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, runAt: new Date().toISOString(),
        scanned: logs.length, lesseeBuckets: byLessee.size, assessments,
      });
    }

    const counts = { invoicesCreated: 0, logsBilled: 0, errors: 0 };
    for (const [lesseeId, items] of byLessee) {
      try {
        await prisma.$transaction(async (tx) => {
          const count = await tx.leaseInvoice.count();
          const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
          const currency = items[0].currency ?? 'AED';
          const subTotal = items.reduce((s, l) => s + Number(l.totalCost ?? 0), 0);
          const vatPct = 5;
          const vatAmount = subTotal * (vatPct / 100);
          const totalAmount = subTotal + vatAmount;
          const issueDate = new Date();
          const dueDate = new Date(issueDate.getTime() + 30 * 86400000);
          const billingPeriod = periodMonth
            ? `Fuel — ${periodMonth}`
            : `Fuel — ${issueDate.toISOString().slice(0, 10)}`;

          const invoice = await tx.leaseInvoice.create({
            data: {
              invoiceNo,
              lesseeId,
              billingPeriod,
              issueDate, dueDate,
              subTotal, vatPct, vatAmount, totalAmount, currency,
              status: 'DRAFT',
              notes: `Auto-generated consolidated fuel invoice for ${items.length} log${items.length === 1 ? '' : 's'}.`,
              lines: {
                create: items.map(l => ({
                  contractId: l.contract!.id,
                  vehicleRef: l.vehicleId ?? null,
                  description: `Fuel ${l.fuelDate.toISOString().slice(0, 10)}${l.station ? ` @ ${l.station}` : ''} — ${Number(l.liters).toFixed(2)} L${l.costPerLiter ? ` × ${Number(l.costPerLiter).toFixed(2)}/L` : ''}${l.fuelCardNo ? ` (card ${l.fuelCardNo})` : ''}`,
                  lineType: 'FUEL',
                  quantity: Number(l.liters ?? 0),
                  unitAmount: Number(l.costPerLiter ?? 0),
                  totalAmount: Number(l.totalCost ?? 0),
                  currency,
                })),
              },
            },
          });

          await tx.leaseFuelLog.updateMany({
            where: { id: { in: items.map(l => l.id) } },
            data: { billingStatus: 'INVOICED', receiptRef: invoice.invoiceNo },
          });
        });
        counts.invoicesCreated += 1;
        counts.logsBilled += items.length;
      } catch (err) {
        counts.errors += 1;
        captureException(err, { context: 'leasing.fuel.sweep-bill.apply', tags: { lesseeId } });
      }
    }

    if (counts.invoicesCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseFuelLog',
        action: 'CREATE',
        details: `Fuel sweep-bill${periodMonth ? ` (${periodMonth})` : ''}: ${counts.invoicesCreated} invoices, ${counts.logsBilled} logs billed, ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false, runAt: new Date().toISOString(),
      scanned: logs.length, lesseeBuckets: byLessee.size, counts, assessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.fuel.sweep-bill' });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
