/**
 * POST /api/leasing/receivables/dunning/sweep
 *
 * Daily AR sweep over LeaseInvoice rows. For each invoice:
 *   1. Classify with the finance dunning engine (CURRENT/GRACE/REMINDER_30/NOTICE_60/FINAL_90)
 *   2. If status is OVERDUE-bucket and we haven't already created a
 *      LeaseDunningActivity for that invoice + bucket today, send the
 *      bilingual email and log the activity (idempotent — won't double-fire)
 *   3. If invoice is past due and status != OVERDUE/PAID/CANCELLED, mark OVERDUE
 *
 * Tenant scoping: cron-triggered sweeps iterate every active tenant; a
 * logged-in user only triggers for their own tenant.
 *
 * Auth: middleware-protected (session) OR Authorization: Bearer <CRON_SECRET>
 *       for external cron triggers.
 *
 * Query params:
 *   ?dryRun=1   — preview without sending emails or writing activities
 *   ?lesseeId=  — limit to one lessee (for ad-hoc per-customer chase)
 *
 * Response:
 *   {
 *     dryRun, runAt,
 *     tenantsScanned, scanned, sent: { reminder_30, notice_60, final_90 },
 *     markedOverdue, skipped, errors[]
 *   }
 *
 * RLS: withSystemJob iterates each tenant in its own transaction. The
 * per-tenant callback uses a tenant-scoped tx (app.tenant_id = tenantId),
 * so all reads/writes inside the callback are tenant-isolated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withSystemJob } from '@/lib/rls';
import {
  classifyMany,
  activityTypeFor,
  type InvoiceForDunning,
} from '@/lib/finance/dunning-engine';
import { renderDunningEmail, type DunningStage } from '@/lib/finance/dunning-templates';
import { sendEmail } from '@/services/email/emailService';
import { logAudit } from '@/lib/audit';
import { captureException, captureMessage } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

type InvoiceWithLessee = Awaited<ReturnType<typeof prisma.leaseInvoice.findMany>>[number] & {
  lessee: { name: string | null; email: string | null; type: string | null } | null;
};

export async function POST(req: NextRequest) {
  const tenantHeader = req.headers.get('x-tenant-id');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !tenantHeader) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const lesseeFilter = req.nextUrl.searchParams.get('lesseeId') ?? undefined;

    interface PerTenantResult {
      scanned: number;
      sent: { reminder_30: number; notice_60: number; final_90: number };
      markedOverdue: number;
      skipped: number;
      errors: { invoiceId: string; message: string }[];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const perTenant = await withSystemJob<PerTenantResult>(
      prisma,
      async ({ tx, tenantId }) => {
        const invoices = (await tx.leaseInvoice.findMany({
          where: {
            tenantId,
            ...(lesseeFilter ? { lesseeId: lesseeFilter } : {}),
            status: { notIn: ['PAID', 'CANCELLED'] },
          },
          include: { lessee: { select: { name: true, email: true, type: true } } },
        })) as InvoiceWithLessee[];

        const sent = { reminder_30: 0, notice_60: 0, final_90: 0 };
        let markedOverdue = 0;
        let skipped = 0;
        const errors: { invoiceId: string; message: string }[] = [];

        const inputs: InvoiceForDunning[] = invoices.map((i) => ({
          id: i.id,
          invoiceNo: i.invoiceNo,
          lesseeId: i.lesseeId,
          contractId: null,
          totalAmount: Number(i.totalAmount ?? 0),
          paidAmount: null,
          currency: i.currency ?? 'AED',
          dueDate: i.dueDate,
          paidAt: i.paidAt,
          status: i.status ?? 'SENT',
        }));

        const { classifications, aging } = classifyMany(inputs);

        for (const c of classifications) {
          const invoice = invoices.find((i) => i.id === c.invoiceId)!;

          if (c.action === 'mark_overdue') {
            if (!dryRun) {
              try {
                await tx.leaseInvoice.update({
                  where: { id: c.invoiceId },
                  data: { status: 'OVERDUE' },
                });
                markedOverdue += 1;
              } catch (err) {
                errors.push({ invoiceId: c.invoiceId, message: err instanceof Error ? err.message : String(err) });
              }
            }
            continue;
          }

          if (c.action === 'none') {
            skipped += 1;
            continue;
          }

          const stage: DunningStage =
            c.action === 'send_reminder_30' ? 'reminder_30'
              : c.action === 'send_notice_60' ? 'notice_60'
              : 'final_90';

          const fingerprint = `dunning:${invoice.id}:${stage}`;
          const existing = !invoice.lesseeId
            ? null
            : await tx.leaseDunningActivity.findFirst({
                where: {
                  lesseeId: invoice.lesseeId,
                  notes: { contains: fingerprint },
                  createdAt: { gte: today },
                },
              });

          if (existing) { skipped += 1; continue; }

          const recipient = invoice.lessee?.email;
          if (!recipient) {
            skipped += 1;
            if (!dryRun) {
              captureMessage('Dunning skipped — no email on file', {
                level: 'warning',
                context: 'leasing.dunning.sweep',
                extra: { invoiceId: invoice.id, lesseeId: invoice.lesseeId, tenantId },
              });
            }
            continue;
          }

          const email = renderDunningEmail({
            stage,
            productName: 'Vehicle Lease',
            lesseeName: invoice.lessee?.name ?? 'Customer',
            invoiceNo: invoice.invoiceNo ?? invoice.id.slice(0, 8),
            outstandingAmount: c.outstandingAmount,
            currency: invoice.currency ?? 'AED',
            daysOverdue: c.daysOverdue,
            dueDate: invoice.dueDate,
            contractRef: null,
          });

          if (dryRun) { sent[stage] += 1; continue; }

          try {
            await sendEmail({
              to: [{ email: recipient, name: invoice.lessee?.name ?? 'Customer' }],
              subject: email.subject,
              htmlBody: email.htmlBody,
              textBody: email.textBody,
            });
            await tx.leaseDunningActivity.create({
              data: {
                contractId: '',
                lesseeId: invoice.lesseeId,
                activityType: activityTypeFor(c.bucket),
                daysOverdue: c.daysOverdue,
                outstandingAmount: c.outstandingAmount,
                currency: invoice.currency ?? 'AED',
                performedBy: req.headers.get('x-user-id') ?? 'system:cron',
                response: 'AUTO_SENT',
                tenantId,
                notes: `${fingerprint}\nInvoice ${invoice.invoiceNo ?? invoice.id} · stage=${stage}`,
              },
            });
            sent[stage] += 1;
          } catch (err) {
            captureException(err, {
              context: 'leasing.dunning.sweep.send',
              tags: { invoiceId: invoice.id, stage, tenantId },
            });
            errors.push({ invoiceId: invoice.id, message: err instanceof Error ? err.message : String(err) });
          }
        }
        return { scanned: invoices.length, sent, markedOverdue, skipped, errors };
      },
      { tenantHeader },
    );

    let totalScanned = 0;
    const totalSent = { reminder_30: 0, notice_60: 0, final_90: 0 };
    let totalMarkedOverdue = 0;
    let totalSkipped = 0;
    const allErrors: { tenantId: string; invoiceId: string; message: string }[] = [];
    for (const r of perTenant) {
      totalScanned += r.result.scanned;
      totalSent.reminder_30 += r.result.sent.reminder_30;
      totalSent.notice_60 += r.result.sent.notice_60;
      totalSent.final_90 += r.result.sent.final_90;
      totalMarkedOverdue += r.result.markedOverdue;
      totalSkipped += r.result.skipped;
      for (const e of r.result.errors) {
        allErrors.push({ tenantId: r.tenantId, ...e });
      }
    }

    if (!dryRun && (totalSent.reminder_30 + totalSent.notice_60 + totalSent.final_90 > 0 || totalMarkedOverdue > 0)) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: req.headers.get('x-user-role') ?? 'SYSTEM',
        entityType: 'LeaseDunningActivity',
        action: 'CREATE',
        details: `Dunning sweep: scanned ${totalScanned} across ${perTenant.length} tenant(s), sent ${totalSent.reminder_30} reminder/${totalSent.notice_60} notice/${totalSent.final_90} final, marked ${totalMarkedOverdue} OVERDUE, skipped ${totalSkipped}, errors ${allErrors.length}.`,
      });
    }

    return NextResponse.json({
      dryRun,
      runAt: new Date().toISOString(),
      tenantsScanned: perTenant.length,
      scanned: totalScanned,
      sent: totalSent,
      markedOverdue: totalMarkedOverdue,
      skipped: totalSkipped,
      errors: allErrors,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.dunning.sweep' });
    console.error('[dunning sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
