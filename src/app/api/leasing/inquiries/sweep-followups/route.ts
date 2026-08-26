/**
 * POST /api/leasing/inquiries/sweep-followups
 *
 * Daily cron: scans LeaseInquiryActivity rows with followUpAt ≤ now and
 * followUpDone = false. Emits one LeaseAlert per inquiry summarising overdue
 * follow-ups so sales reps see them in the alerts page.
 *
 * Idempotent — same-day, same-title dedup.
 *
 * Tenant scoping: cron-triggered sweeps iterate every active tenant; a
 * logged-in user only triggers for their own tenant.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?dryRun=1 to preview.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withSystemJob } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { sendEmail } from '@/lib/email';
import { sendWhatsApp } from '@/lib/whatsapp';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
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
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    type DueActivity = Awaited<ReturnType<typeof prisma.leaseInquiryActivity.findMany>>[number];

    interface Assessment {
      tenantId: string;
      inquiryId: string;
      inquiryNumber: string | null;
      label: string;
      count: number;
      oldestDue: Date;
      title: string;
      message: string;
    }
    interface PerTenantResult {
      activities: number;
      inquiries: number;
      assessments: Assessment[];
      alertsCreated: number;
      alertsSkipped: number;
      errors: number;
    }

    const perTenant = await withSystemJob<PerTenantResult>(
      prisma,
      async ({ tx, tenantId }) => {
        const due = (await tx.leaseInquiryActivity.findMany({
          where: {
            tenantId,
            followUpDone: false,
            followUpAt: { lte: now },
          },
          select: {
            id: true, inquiryId: true, activityType: true, subject: true,
            followUpAt: true, performedByName: true,
          },
        })) as DueActivity[];

        const byInquiry = new Map<string, DueActivity[]>();
        for (const d of due) {
          const arr = byInquiry.get(d.inquiryId) ?? [];
          arr.push(d);
          byInquiry.set(d.inquiryId, arr);
        }

        const inquiries = await tx.leaseInquiry.findMany({
          where: {
            tenantId,
            id: { in: [...byInquiry.keys()] },
            deletedAt: null,
            status: { notIn: ['CONVERTED', 'LOST'] },
          },
          select: { id: true, inquiryNumber: true, customerName: true, companyName: true },
        });
        const inquiryById = new Map(inquiries.map(i => [i.id, i]));

        const assessments: Assessment[] = [];
        for (const [iid, items] of byInquiry) {
          const inq = inquiryById.get(iid);
          if (!inq) continue;
          items.sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime());
          const oldestDue = items[0].followUpAt!;
          const daysOverdue = Math.floor((now.getTime() - oldestDue.getTime()) / 86400000);
          const label = inq.companyName ?? inq.customerName;
          assessments.push({
            tenantId,
            inquiryId: iid,
            inquiryNumber: inq.inquiryNumber,
            label,
            count: items.length,
            oldestDue,
            title: `Sales follow-up overdue: ${inq.inquiryNumber ?? iid.slice(0, 8)} — ${label}`,
            message: `${items.length} pending follow-up${items.length === 1 ? '' : 's'} for ${label}. Oldest due ${oldestDue.toISOString().slice(0, 10)} (${daysOverdue}d ago).`,
          });
        }

        if (dryRun) {
          return {
            activities: due.length, inquiries: byInquiry.size, assessments,
            alertsCreated: 0, alertsSkipped: 0, errors: 0,
          };
        }

        let alertsCreated = 0;
        let alertsSkipped = 0;
        let errors = 0;
        for (const a of assessments) {
          try {
            // tenantId is not just isolation here — this is an idempotency
            // probe. Unscoped, an OPEN alert with the same title in ANY tenant
            // suppressed this one, so a tenant could silently never receive an
            // alert because another organisation already had a matching one.
            const existing = await tx.leaseAlert.findFirst({
              where: { tenantId, title: a.title, status: 'OPEN', createdAt: { gte: today } },
              select: { id: true },
            });
            if (existing) { alertsSkipped += 1; continue; }
            await tx.leaseAlert.create({
              data: {
                alertType: 'CUSTOM', severity: 'WARNING',
                title: a.title, message: a.message,
                status: 'OPEN', tenantId,
              },
            });
            alertsCreated += 1;
          } catch (err) {
            errors += 1;
            captureException(err, {
              context: 'leasing.inquiries.sweep-followups.apply',
              tags: { inquiryId: a.inquiryId, tenantId },
            });
          }
        }
        return {
          activities: due.length, inquiries: byInquiry.size, assessments,
          alertsCreated, alertsSkipped, errors,
        };
      },
      { tenantHeader },
    );

    let totalActivities = 0;
    let totalInquiries = 0;
    const allAssessments: Assessment[] = [];
    const counts = { alertsCreated: 0, alertsSkipped: 0, errors: 0 };
    for (const r of perTenant) {
      totalActivities += r.result.activities;
      totalInquiries += r.result.inquiries;
      allAssessments.push(...r.result.assessments);
      counts.alertsCreated += r.result.alertsCreated;
      counts.alertsSkipped += r.result.alertsSkipped;
      counts.errors += r.result.errors;
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, runAt: now.toISOString(),
        tenantsScanned: perTenant.length,
        scannedActivities: totalActivities,
        scannedInquiries: totalInquiries,
        assessments: allAssessments,
      });
    }

    // Digest notifications to the sales team (best-effort, non-blocking).
    let digestEmailSent = false;
    let digestWhatsAppSent = false;
    if (allAssessments.length > 0) {
      const teamEmail = process.env.LEASING_SALES_NOTIFY_EMAIL;
      const teamPhone = process.env.LEASING_SALES_NOTIFY_WHATSAPP ?? process.env.OPERATIONS_PHONE;
      const lines = allAssessments.map(a =>
        `• ${a.inquiryNumber ?? a.inquiryId.slice(0, 8)} — ${a.label}: ${a.count} follow-up${a.count === 1 ? '' : 's'} (oldest ${a.oldestDue.toISOString().slice(0, 10)})`,
      );
      const summary = `Sales follow-up digest — ${allAssessments.length} inquiries with overdue follow-ups across ${perTenant.length} tenant(s)`;

      if (teamEmail) {
        const html = `<p>${summary}</p><ul>${allAssessments.map(a =>
          `<li><strong>${a.inquiryNumber ?? a.inquiryId.slice(0, 8)}</strong> — ${escapeHtml(a.label)}: ${a.count} pending (oldest ${a.oldestDue.toISOString().slice(0, 10)})</li>`,
        ).join('')}</ul><p style="color:#666;font-size:12px">Triggered by daily sweep at ${now.toISOString()}.</p>`;
        const r = await sendEmail({
          to: teamEmail,
          subject: `[Leasing CRM] ${summary}`,
          text: [summary, '', ...lines, '', `Generated ${now.toISOString()}`].join('\n'),
          html,
        });
        digestEmailSent = r.sent;
      }
      if (teamPhone) {
        const whatsappBody = `📋 ${summary}\n\n${lines.slice(0, 10).join('\n')}${lines.length > 10 ? `\n... and ${lines.length - 10} more` : ''}`;
        const r = await sendWhatsApp({ to: teamPhone, body: whatsappBody });
        digestWhatsAppSent = r.sent;
      }
    }

    if (counts.alertsCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseInquiry',
        action: 'UPDATE',
        details: `Inquiry follow-up sweep: ${allAssessments.length} inquiries with overdue follow-ups across ${perTenant.length} tenant(s), ${counts.alertsCreated} alerts emitted, ${counts.alertsSkipped} skipped, ${counts.errors} errors. Digest email: ${digestEmailSent}, WhatsApp: ${digestWhatsAppSent}.`,
      });
    }

    return NextResponse.json({
      dryRun: false, runAt: now.toISOString(),
      tenantsScanned: perTenant.length,
      scannedActivities: totalActivities,
      scannedInquiries: totalInquiries,
      counts, assessments: allAssessments,
      digestEmailSent, digestWhatsAppSent,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.inquiries.sweep-followups' });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
