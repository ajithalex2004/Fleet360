/**
 * Job adapter: dunning-sweep
 * Thin wrapper — delegates to the existing dunning route logic.
 */
import type { JobContext, JobResult } from '@/lib/jobs/registry';
import { prisma } from '@/lib/prisma';

import { classifyMany, activityTypeFor, type InvoiceForDunning } from '@/lib/finance/dunning-engine';
import { renderDunningEmail, type DunningStage } from '@/lib/finance/dunning-templates';
import { sendEmail } from '@/services/email/emailService';
import { captureException, captureMessage } from '@/lib/sentry';
import { runSweep } from '@/lib/prisma-sweep';

export async function runDunningSweep(ctx: JobContext): Promise<JobResult> {
  const dryRun      = ctx.searchParams.get('dryRun') === '1';
  const lesseeFilter = ctx.searchParams.get('lesseeId') ?? undefined;
  const tenantHeader = ctx.tenantId ?? undefined;

  type InvoiceWithLessee = Awaited<ReturnType<typeof prisma.leaseInvoice.findMany>>[number] & {
    lessee: { name: string | null; email: string | null; type: string | null } | null;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const perTenant = await runSweep<{
    scanned: number;
    sent: { reminder_30: number; notice_60: number; final_90: number };
    markedOverdue: number;
    skipped: number;
    errors: { invoiceId: string; message: string }[];
  }>(async ({ tx, tenantId }) => {
    const invoices = (await tx.leaseInvoice.findMany({
      where: { tenantId, ...(lesseeFilter ? { lesseeId: lesseeFilter } : {}), status: { notIn: ['PAID', 'CANCELLED'] } },
      include: { lessee: { select: { name: true, email: true, type: true } } },
    })) as InvoiceWithLessee[];

    const sent = { reminder_30: 0, notice_60: 0, final_90: 0 };
    let markedOverdue = 0, skipped = 0;
    const errors: { invoiceId: string; message: string }[] = [];

    const inputs: InvoiceForDunning[] = invoices.map(i => ({
      id: i.id, invoiceNo: i.invoiceNo, lesseeId: i.lesseeId,
      contractId: null, totalAmount: Number(i.totalAmount ?? 0), paidAmount: null,
      currency: i.currency ?? 'AED', dueDate: i.dueDate, paidAt: i.paidAt, status: i.status ?? 'SENT',
    }));

    const { classifications } = classifyMany(inputs);

    for (const c of classifications) {
      const invoice = invoices.find(i => i.id === c.invoiceId)!;
      if (c.action === 'mark_overdue') {
        if (!dryRun) {
          try { await tx.leaseInvoice.update({ where: { id: c.invoiceId }, data: { status: 'OVERDUE' } }); markedOverdue++; }
          catch (err) { errors.push({ invoiceId: c.invoiceId, message: String(err) }); }
        }
        continue;
      }
      if (c.action === 'none') { skipped++; continue; }

      const stage: DunningStage = c.action === 'send_reminder_30' ? 'reminder_30' : c.action === 'send_notice_60' ? 'notice_60' : 'final_90';
      const fingerprint = `dunning:${invoice.id}:${stage}`;
      const existing = !invoice.lesseeId ? null : await tx.leaseDunningActivity.findFirst({
        where: { lesseeId: invoice.lesseeId, notes: { contains: fingerprint }, createdAt: { gte: today } },
      });
      if (existing) { skipped++; continue; }

      const recipient = invoice.lessee?.email;
      if (!recipient) {
        skipped++;
        if (!dryRun) captureMessage('Dunning skipped — no email', { level: 'warning', context: 'jobs.dunning-sweep', extra: { invoiceId: invoice.id, tenantId } });
        continue;
      }

      const email = renderDunningEmail({
        stage, productName: 'Vehicle Lease', lesseeName: invoice.lessee?.name ?? 'Customer',
        invoiceNo: invoice.invoiceNo ?? invoice.id.slice(0, 8),
        outstandingAmount: c.outstandingAmount, currency: invoice.currency ?? 'AED',
        daysOverdue: c.daysOverdue, dueDate: invoice.dueDate, contractRef: null,
      });

      if (dryRun) { sent[stage]++; continue; }
      try {
        await sendEmail({ to: [{ email: recipient, name: invoice.lessee?.name ?? 'Customer' }], subject: email.subject, htmlBody: email.htmlBody, textBody: email.textBody });
        await tx.leaseDunningActivity.create({ data: {
          contractId: '', lesseeId: invoice.lesseeId, activityType: activityTypeFor(c.bucket),
          daysOverdue: c.daysOverdue, outstandingAmount: c.outstandingAmount,
          currency: invoice.currency ?? 'AED', performedBy: ctx.userId,
          response: 'AUTO_SENT', tenantId, notes: `${fingerprint}\nInvoice ${invoice.invoiceNo ?? invoice.id} · stage=${stage}`,
        }});
        sent[stage]++;
      } catch (err) {
        captureException(err, { context: 'jobs.dunning-sweep.send', tags: { invoiceId: invoice.id, stage, tenantId } });
        errors.push({ invoiceId: invoice.id, message: String(err) });
      }
    }
    return { scanned: invoices.length, sent, markedOverdue, skipped, errors };
  }, { tenantHeader });

  const total = perTenant.reduce((acc, r) => {
    acc.scanned += r.result.scanned;
    acc.sent.reminder_30 += r.result.sent.reminder_30;
    acc.sent.notice_60   += r.result.sent.notice_60;
    acc.sent.final_90    += r.result.sent.final_90;
    acc.markedOverdue    += r.result.markedOverdue;
    acc.skipped          += r.result.skipped;
    return acc;
  }, { scanned: 0, sent: { reminder_30: 0, notice_60: 0, final_90: 0 }, markedOverdue: 0, skipped: 0 });

  return {
    status: 'ok',
    summary: `Scanned ${total.scanned} invoices across ${perTenant.length} tenant(s); sent ${total.sent.reminder_30}r/${total.sent.notice_60}n/${total.sent.final_90}f; marked ${total.markedOverdue} OVERDUE`,
    data: { dryRun, tenantsScanned: perTenant.length, ...total },
  };
}
