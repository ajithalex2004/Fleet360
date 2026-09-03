export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/fuel/sweep-bill
 *
 * Monthly cron: converts PENDING fuel logs (billedToLessee=true) into a
 * consolidated LeaseInvoice per lessee per run, one line per fuel log.
 * Mirrors the traffic-fines sweep pattern — atomic transaction flips logs
 * to INVOICED with receiptRef=invoice.invoiceNo so repeat runs are safe.
 *
 * Tenant scoping: cron-triggered sweeps iterate every active tenant; a
 * logged-in user only triggers for their own tenant.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?dryRun=1, ?olderThanDays=N (default 0 = bill everything pending),
 *        ?periodMonth=YYYY-MM (only bill logs from this month).
 *
 * RLS: withSystemJob iterates each tenant in its own transaction. Per-lessee
 * $transaction calls use savepoints for atomic invoice+status-flip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { runSweep } from '@/lib/prisma-sweep';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const tenantHeader = req.headers.get('x-tenant-id');
  const cronSecret = process.env.CRON_SECRET;

  // A cron-triggered, all-tenants call has no tenant header at all.
  // requireAuthorizedTenant unconditionally 401s when there's neither a
  // tenant nor a user header, so it must never run for that case — it was
  // called first, unconditionally, which made the CRON_SECRET check below
  // unreachable dead code for every genuine cron invocation.
  if (!tenantHeader) {
    if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  } else {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
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

    type LogWithContract = Awaited<ReturnType<typeof prisma.leaseFuelLog.findMany>>[number] & {
      contract: { id: string; lesseeId: string; contractNumber: string | null; currency: string | null } | null;
    };

    interface Assessment {
      tenantId: string;
      lesseeId: string;
      logCount: number;
      totalLiters: number;
      totalCost: number;
      currency: string;
    }
    interface PerTenantResult {
      scanned: number;
      lesseeBuckets: number;
      assessments: Assessment[];
      invoicesCreated: number;
      logsBilled: number;
      errors: number;
    }

    const perTenant = await runSweep<PerTenantResult>(
      async ({ tx, tenantId }) => {
        const logs = (await tx.leaseFuelLog.findMany({
          where: {
            tenantId,
            billingStatus: 'PENDING',
            billedToLessee: true,
            ...(dateFilter ? { fuelDate: dateFilter } : {}),
          },
          include: { contract: { select: { id: true, lesseeId: true, contractNumber: true, currency: true } } },
        })) as LogWithContract[];

        const byLessee = new Map<string, LogWithContract[]>();
        for (const l of logs) {
          if (!l.contract?.lesseeId) continue;
          const arr = byLessee.get(l.contract.lesseeId) ?? [];
          arr.push(l);
          byLessee.set(l.contract.lesseeId, arr);
        }

        const assessments: Assessment[] = [];
        for (const [lesseeId, items] of byLessee) {
          assessments.push({
            tenantId,
            lesseeId,
            logCount: items.length,
            totalLiters: items.reduce((s, l) => s + Number(l.liters ?? 0), 0),
            totalCost: items.reduce((s, l) => s + Number(l.totalCost ?? 0), 0),
            currency: items[0].currency ?? 'AED',
          });
        }

        if (dryRun) {
          return { scanned: logs.length, lesseeBuckets: byLessee.size, assessments,
            invoicesCreated: 0, logsBilled: 0, errors: 0 };
        }

        let invoicesCreated = 0;
        let logsBilled = 0;
        let errors = 0;
        let spIdx = 0;
        for (const [lesseeId, items] of byLessee) {
          // Real SQL SAVEPOINT for per-lessee atomicity/isolation within the
          // single withSystemJob transaction. `tx.$transaction(...)` looks
          // like the natural nested-transaction API but Prisma removes
          // $transaction from a TransactionClient at runtime (see the
          // denylist note in src/lib/rls.ts) — calling it here always threw
          // "tx.$transaction is not a function", which this try/catch quietly
          // turned into a per-lessee `errors` count. Net effect: this sweep
          // never created a single invoice. SAVEPOINT/RELEASE/ROLLBACK TO is
          // the documented way to get the same per-record recovery directly
          // on `tx`.
          const sp = `sp_fuel_${spIdx++}`;
          try {
            await tx.$executeRawUnsafe(`SAVEPOINT "${sp}"`);
            await lockSerialSeries(tx, tenantId, 'invoice');
            const count = await tx.leaseInvoice.count({ where: { tenantId } });
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
                tenantId,
                lines: {
                  create: items.map(l => ({
                    tenantId,
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
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${sp}"`);
            invoicesCreated += 1;
            logsBilled += items.length;
          } catch (err) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${sp}"`).catch(() => {});
            errors += 1;
            captureException(err, {
              context: 'leasing.fuel.sweep-bill.apply',
              tags: { lesseeId, tenantId },
            });
          }
        }
        return { scanned: logs.length, lesseeBuckets: byLessee.size, assessments,
          invoicesCreated, logsBilled, errors };
      },
      { tenantHeader },
    );

    let totalScanned = 0;
    let totalLesseeBuckets = 0;
    const assessments: Assessment[] = [];
    const counts = { invoicesCreated: 0, logsBilled: 0, errors: 0 };
    for (const r of perTenant) {
      totalScanned += r.result.scanned;
      totalLesseeBuckets += r.result.lesseeBuckets;
      assessments.push(...r.result.assessments);
      counts.invoicesCreated += r.result.invoicesCreated;
      counts.logsBilled += r.result.logsBilled;
      counts.errors += r.result.errors;
    }

    if (!dryRun && counts.invoicesCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseFuelLog',
        action: 'CREATE',
        details: `Fuel sweep-bill${periodMonth ? ` (${periodMonth})` : ''}: ${counts.invoicesCreated} invoices, ${counts.logsBilled} logs billed across ${perTenant.length} tenant(s), ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun,
      runAt: new Date().toISOString(),
      tenantsScanned: perTenant.length,
      scanned: totalScanned,
      lesseeBuckets: totalLesseeBuckets,
      counts,
      assessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.fuel.sweep-bill' });
    console.error('[fuel sweep-bill] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
