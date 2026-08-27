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
 * Tenant scoping: cron-triggered sweeps iterate every active tenant; a
 * logged-in user only triggers for their own tenant.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?dryRun=1 to preview, ?olderThanDays=N to bill only fines older
 *        than N days (default 0 = bill everything pending).
 *
 * RLS: withSystemJob iterates each tenant in its own transaction (app.tenant_id
 * = tenantId). Per-lessee $transaction calls use savepoints (tx.$transaction
 * cast as any) for atomic invoice+status-flip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { runSweep } from '@/lib/prisma-sweep';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const tenantHeader = req.headers.get('x-tenant-id');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !tenantHeader) {
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

    type FineWithContract = Awaited<ReturnType<typeof prisma.leaseTrafficFine.findMany>>[number] & {
      contract: { id: string; lesseeId: string; contractNumber: string | null; currency: string | null } | null;
    };

    interface Assessment {
      tenantId: string;
      lesseeId: string;
      contractCount: number;
      fineCount: number;
      totalAmount: number;
      currency: string;
    }
    interface PerTenantResult {
      scanned: number;
      lesseeBuckets: number;
      assessments: Assessment[];
      invoicesCreated: number;
      finesBilled: number;
      errors: number;
    }

    const perTenant = await runSweep<PerTenantResult>(
      async ({ tx, tenantId }) => {
        const fines = (await tx.leaseTrafficFine.findMany({
          where: {
            tenantId,
            billingStatus: 'PENDING',
            billedToLessee: true,
            ...(cutoff ? { violationDate: { lte: cutoff } } : {}),
          },
          include: { contract: { select: { id: true, lesseeId: true, contractNumber: true, currency: true } } },
        })) as FineWithContract[];

        const byLessee = new Map<string, FineWithContract[]>();
        for (const f of fines) {
          if (!f.contract?.lesseeId) continue;
          const arr = byLessee.get(f.contract.lesseeId) ?? [];
          arr.push(f);
          byLessee.set(f.contract.lesseeId, arr);
        }

        const assessments: Assessment[] = [];
        for (const [lesseeId, items] of byLessee) {
          const totalAmount = items.reduce((s, f) => s + Number(f.finalAmount ?? f.fineAmount), 0);
          const contractIds = new Set(items.map(f => f.contract!.id));
          assessments.push({
            tenantId,
            lesseeId,
            contractCount: contractIds.size,
            fineCount: items.length,
            totalAmount,
            currency: items[0].currency ?? 'AED',
          });
        }

        if (dryRun) {
          return { scanned: fines.length, lesseeBuckets: byLessee.size, assessments, invoicesCreated: 0, finesBilled: 0, errors: 0 };
        }

        let invoicesCreated = 0;
        let finesBilled = 0;
        let errors = 0;
        for (const [lesseeId, items] of byLessee) {
          try {
            // tx.$transaction is a savepoint; the withSystemJob
            // GUC persists through it. Cast through `any` because
            // Prisma's TxClient type does not expose $transaction.
            await (tx as any).$transaction(async (lesseeTx: typeof tx) => {
              const count = await lesseeTx.leaseInvoice.count({ where: { tenantId } });
              const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
              const currency = items[0].currency ?? 'AED';
              const subTotal = items.reduce((s, f) => s + Number(f.finalAmount ?? f.fineAmount), 0);
              const vatPct = 5;
              const vatAmount = subTotal * (vatPct / 100);
              const totalAmount = subTotal + vatAmount;
              const issueDate = new Date();
              const dueDate = new Date(issueDate.getTime() + 30 * 86400000);

              const invoice = await lesseeTx.leaseInvoice.create({
                data: {
                  invoiceNo,
                  lesseeId,
                  billingPeriod: `Traffic fines — ${issueDate.toISOString().slice(0, 10)}`,
                  issueDate, dueDate,
                  subTotal, vatPct, vatAmount, totalAmount, currency,
                  status: 'DRAFT',
                  notes: `Auto-generated consolidated invoice for ${items.length} traffic fine${items.length === 1 ? '' : 's'}.`,
                  tenantId,
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

              await lesseeTx.leaseTrafficFine.updateMany({
                where: { id: { in: items.map(f => f.id) } },
                data: { billingStatus: 'INVOICED', paymentRef: invoice.invoiceNo },
              });
            });
            invoicesCreated += 1;
            finesBilled += items.length;
          } catch (err) {
            errors += 1;
            captureException(err, {
              context: 'leasing.traffic-fines.sweep-bill.apply',
              tags: { lesseeId, tenantId },
            });
          }
        }
        return { scanned: fines.length, lesseeBuckets: byLessee.size, assessments, invoicesCreated, finesBilled, errors };
      },
      { tenantHeader },
    );

    let totalScanned = 0;
    let totalLesseeBuckets = 0;
    const allAssessments: Assessment[] = [];
    const counts = { invoicesCreated: 0, finesBilled: 0, errors: 0 };
    for (const r of perTenant) {
      totalScanned += r.result.scanned;
      totalLesseeBuckets += r.result.lesseeBuckets;
      allAssessments.push(...r.result.assessments);
      counts.invoicesCreated += r.result.invoicesCreated;
      counts.finesBilled += r.result.finesBilled;
      counts.errors += r.result.errors;
    }

    if (!dryRun && counts.invoicesCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseTrafficFine',
        action: 'CREATE',
        details: `Traffic fine sweep-bill: ${counts.invoicesCreated} invoices, ${counts.finesBilled} fines billed across ${perTenant.length} tenant(s), ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun,
      runAt: new Date().toISOString(),
      tenantsScanned: perTenant.length,
      scanned: totalScanned,
      lesseeBuckets: totalLesseeBuckets,
      counts,
      assessments: allAssessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.traffic-fines.sweep-bill' });
    console.error('[traffic-fines sweep-bill] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
