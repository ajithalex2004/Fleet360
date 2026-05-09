/**
 * POST /api/leasing/traffic-fines/sweep-bill
 *
 * Periodic cron: converts PENDING traffic fines (billedToLessee=true) into
 * a single consolidated LeaseInvoice per lessee per run. One invoice with
 * one line per fine — keeps things readable and auditable for finance.
 *
 * Idempotent — fines flip to INVOICED with `invoice_ref = invoice.invoiceNo`
 * inside the transaction, so a repeat run picks up only fines still PENDING.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?dryRun=1 to preview, ?olderThanDays=N to bill only fines older
 *        than N days (default 0 = bill everything pending).
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
    const cutoff = olderThanDays > 0
      ? new Date(Date.now() - olderThanDays * 86400000)
      : null;

    const fines = await prisma.leaseTrafficFine.findMany({
      where: {
        billingStatus: 'PENDING',
        billedToLessee: true,
        ...(cutoff ? { violationDate: { lte: cutoff } } : {}),
      },
      include: { contract: { select: { id: true, lesseeId: true, contractNumber: true, currency: true } } },
    });

    // Group by lessee. Skip fines without a contract (lessee unknown).
    const byLessee = new Map<string, typeof fines>();
    for (const f of fines) {
      if (!f.contract?.lesseeId) continue;
      const key = f.contract.lesseeId;
      const arr = byLessee.get(key) ?? [];
      arr.push(f);
      byLessee.set(key, arr);
    }

    interface Assessment {
      lesseeId: string;
      contractCount: number;
      fineCount: number;
      totalAmount: number;
      currency: string;
    }
    const assessments: Assessment[] = [];
    for (const [lesseeId, items] of byLessee) {
      const totalAmount = items.reduce((s, f) => s + Number(f.finalAmount ?? f.fineAmount), 0);
      const contractIds = new Set(items.map(f => f.contract!.id));
      assessments.push({
        lesseeId,
        contractCount: contractIds.size,
        fineCount: items.length,
        totalAmount,
        currency: items[0].currency ?? 'AED',
      });
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, runAt: new Date().toISOString(),
        scanned: fines.length, lesseeBuckets: byLessee.size, assessments,
      });
    }

    const counts = { invoicesCreated: 0, finesBilled: 0, errors: 0 };
    for (const [lesseeId, items] of byLessee) {
      try {
        await prisma.$transaction(async (tx) => {
          const count = await tx.leaseInvoice.count();
          const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
          const currency = items[0].currency ?? 'AED';
          const subTotal = items.reduce((s, f) => s + Number(f.finalAmount ?? f.fineAmount), 0);
          const vatPct = 5;
          const vatAmount = subTotal * (vatPct / 100);
          const totalAmount = subTotal + vatAmount;
          const issueDate = new Date();
          const dueDate = new Date(issueDate.getTime() + 30 * 86400000);

          const invoice = await tx.leaseInvoice.create({
            data: {
              invoiceNo,
              lesseeId,
              billingPeriod: `Traffic fines — ${issueDate.toISOString().slice(0, 10)}`,
              issueDate, dueDate,
              subTotal, vatPct, vatAmount, totalAmount, currency,
              status: 'DRAFT',
              notes: `Auto-generated consolidated invoice for ${items.length} traffic fine${items.length === 1 ? '' : 's'}.`,
              lines: {
                create: items.map(f => ({
                  contractId: f.contract!.id,
                  vehicleRef: f.vehicleId ?? null,
                  description: `${f.violationType} fine ${f.fineNo ?? f.id.slice(0, 8)} — ${f.violationDate.toISOString().slice(0, 10)}${f.location ? ` @ ${f.location}` : ''}${f.authority ? ` (${f.authority})` : ''}`,
                  lineType: 'TRAFFIC_FINE',
                  quantity: 1,
                  unitAmount: Number(f.finalAmount ?? f.fineAmount),
                  totalAmount: Number(f.finalAmount ?? f.fineAmount),
                  currency,
                })),
              },
            },
          });

          // Mark all fines invoiced.
          await tx.leaseTrafficFine.updateMany({
            where: { id: { in: items.map(f => f.id) } },
            data: { billingStatus: 'INVOICED', paymentRef: invoice.invoiceNo },
          });
        });
        counts.invoicesCreated += 1;
        counts.finesBilled += items.length;
      } catch (err) {
        counts.errors += 1;
        captureException(err, { context: 'leasing.traffic-fines.sweep-bill.apply', tags: { lesseeId } });
      }
    }

    if (counts.invoicesCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseTrafficFine',
        action: 'CREATE',
        details: `Traffic fine sweep-bill: ${counts.invoicesCreated} invoices, ${counts.finesBilled} fines billed, ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false, runAt: new Date().toISOString(),
      scanned: fines.length, lesseeBuckets: byLessee.size, counts, assessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.traffic-fines.sweep-bill' });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
