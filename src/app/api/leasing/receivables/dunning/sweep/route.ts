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
 *     scanned, sent: { reminder_30, notice_60, final_90 },
 *     markedOverdue, skipped, errors[]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  classifyMany,
  activityTypeFor,
  type InvoiceForDunning,
} from '@/lib/finance/dunning-engine';
import { renderDunningEmail, type DunningStage } from '@/lib/finance/dunning-templates';
import { sendEmail } from '@/services/email/emailService';
import { logAudit } from '@/lib/audit';
import { captureException, captureMessage } from '@/lib/sentry';
import { requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/receivables/dunning/sweep');
  if (moved) return moved;
  // Optional shared-secret auth for external cron triggers.
  const cronSecret = process.env.CRON_SECRET;
  const hasTenantHeaders = Boolean(req.headers.get('x-tenant-id'));
  if (cronSecret && !hasTenantHeaders) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    if (hasTenantHeaders) {
      const ctx = requireOperationalContext(req, 'leasing', { write: true, requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
      if (ctx instanceof NextResponse) return ctx;
      const permission = await requireOperationalPermission(ctx, [
        { module: 'finance', action: 'approve', resource: 'leasing_billing' },
        { module: 'finance', action: 'edit', resource: 'leasing_billing' },
        { module: 'leasing', action: 'create', resource: 'dunning' },
        { module: 'leasing', action: 'approve', resource: 'invoices' },
      ], { message: 'You do not have access to run the Leasing dunning sweep' });
      if (permission) return permission;
    }

    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const lesseeFilter = req.nextUrl.searchParams.get('lesseeId') ?? undefined;

    const invoices = await prisma.leaseInvoice.findMany({
      where: {
        ...(lesseeFilter ? { lesseeId: lesseeFilter } : {}),
        status: { notIn: ['PAID', 'CANCELLED'] },
      },
      include: {
        lessee: { select: { name: true, email: true, type: true } },
      },
    });

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

    const sent = { reminder_30: 0, notice_60: 0, final_90: 0 };
    let markedOverdue = 0;
    let skipped = 0;
    const errors: { invoiceId: string; message: string }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const c of classifications) {
      const invoice = invoices.find((i) => i.id === c.invoiceId)!;

      // ── Action: mark_overdue ────────────────────────────────────────────
      if (c.action === 'mark_overdue') {
        if (!dryRun) {
          try {
            await prisma.leaseInvoice.update({
              where: { id: c.invoiceId },
              data: { status: 'OVERDUE' },
            });
            markedOverdue += 1;
          } catch (err) {
            errors.push({
              invoiceId: c.invoiceId,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
        continue;
      }

      // ── Action: send_reminder_30 / send_notice_60 / send_final_90 ──────
      if (c.action === 'none') {
        skipped += 1;
        continue;
      }

      const stage: DunningStage =
        c.action === 'send_reminder_30'
          ? 'reminder_30'
          : c.action === 'send_notice_60'
            ? 'notice_60'
            : 'final_90';

      // Idempotency: don't re-fire the same stage for the same invoice today.
      // We log per-invoice activity with notes containing a fingerprint.
      const fingerprint = `dunning:${invoice.id}:${stage}`;
      const existing = !invoice.lesseeId
        ? null
        : await prisma.leaseDunningActivity.findFirst({
            where: {
              lesseeId: invoice.lesseeId,
              notes: { contains: fingerprint },
              createdAt: { gte: today },
            },
          });

      if (existing) {
        skipped += 1;
        continue;
      }

      // Skip if no email on file — can't dunn.
      const recipient = invoice.lessee?.email;
      if (!recipient) {
        skipped += 1;
        if (!dryRun) {
          captureMessage('Dunning skipped — no email on file', {
            level: 'warning',
            context: 'leasing.dunning.sweep',
            extra: { invoiceId: invoice.id, lesseeId: invoice.lesseeId },
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

      if (dryRun) {
        sent[stage] += 1;
        continue;
      }

      try {
        await sendEmail({
          to: [{ email: recipient, name: invoice.lessee?.name ?? 'Customer' }],
          subject: email.subject,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
        });

        // Log the activity (per-contract requirement — we use lesseeId here;
        // contractId is set when the invoice is linked to a contract).
        await prisma.leaseDunningActivity.create({
          data: {
            // No invoice → contract link in current schema; bind to invoice's
            // lessee and use contractId placeholder if absent.
            contractId: '',
            lesseeId: invoice.lesseeId,
            activityType: activityTypeFor(c.bucket),
            daysOverdue: c.daysOverdue,
            outstandingAmount: c.outstandingAmount,
            currency: invoice.currency ?? 'AED',
            performedBy: req.headers.get('x-user-id') ?? 'system:cron',
            response: 'AUTO_SENT',
            notes: `${fingerprint}\nInvoice ${invoice.invoiceNo ?? invoice.id} · stage=${stage}`,
          },
        });

        sent[stage] += 1;
      } catch (err) {
        captureException(err, {
          context: 'leasing.dunning.sweep.send',
          tags: { invoiceId: invoice.id, stage },
        });
        errors.push({
          invoiceId: invoice.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!dryRun && (sent.reminder_30 + sent.notice_60 + sent.final_90 > 0 || markedOverdue > 0)) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: req.headers.get('x-user-role') ?? 'SYSTEM',
        entityType: 'LeaseDunningActivity',
        action: 'CREATE',
        details: `Dunning sweep: scanned ${classifications.length}, sent ${sent.reminder_30} reminder/${sent.notice_60} notice/${sent.final_90} final, marked ${markedOverdue} OVERDUE, skipped ${skipped}, errors ${errors.length}.`,
      });
    }

    return NextResponse.json({
      dryRun,
      runAt: new Date().toISOString(),
      scanned: classifications.length,
      sent,
      markedOverdue,
      skipped,
      errors,
      aging,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.dunning.sweep' });
    console.error('[dunning sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
