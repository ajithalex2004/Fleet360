/**
 * POST /api/leasing/inquiries/sweep-followups
 *
 * Daily cron: scans LeaseInquiryActivity rows with followUpAt ≤ now and
 * followUpDone = false. Emits one LeaseAlert per inquiry summarising overdue
 * follow-ups so sales reps see them in the alerts page.
 *
 * Idempotent — same-day, same-title dedup.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?dryRun=1 to preview.
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
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const due = await prisma.leaseInquiryActivity.findMany({
      where: {
        followUpDone: false,
        followUpAt: { lte: now },
      },
      select: {
        id: true, inquiryId: true, activityType: true, subject: true,
        followUpAt: true, performedByName: true,
      },
    });

    // Aggregate by inquiry — one alert summarising N overdue follow-ups.
    const byInquiry = new Map<string, typeof due>();
    for (const d of due) {
      const arr = byInquiry.get(d.inquiryId) ?? [];
      arr.push(d);
      byInquiry.set(d.inquiryId, arr);
    }

    const inquiries = await prisma.leaseInquiry.findMany({
      where: { id: { in: [...byInquiry.keys()] }, deletedAt: null, status: { notIn: ['CONVERTED', 'LOST'] } },
      select: { id: true, inquiryNumber: true, customerName: true, companyName: true },
    });
    const inquiryById = new Map(inquiries.map(i => [i.id, i]));

    interface Assessment {
      inquiryId: string;
      inquiryNumber: string | null;
      label: string;
      count: number;
      oldestDue: Date;
      title: string;
      message: string;
    }

    const assessments: Assessment[] = [];
    for (const [iid, items] of byInquiry) {
      const inq = inquiryById.get(iid);
      if (!inq) continue; // skip converted/lost
      items.sort((a, b) => a.followUpAt!.getTime() - b.followUpAt!.getTime());
      const oldestDue = items[0].followUpAt!;
      const daysOverdue = Math.floor((now.getTime() - oldestDue.getTime()) / 86400000);
      const label = inq.companyName ?? inq.customerName;
      assessments.push({
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
      return NextResponse.json({
        dryRun: true, runAt: now.toISOString(),
        scannedActivities: due.length,
        scannedInquiries: byInquiry.size,
        assessments,
      });
    }

    const counts = { alertsCreated: 0, alertsSkipped: 0, errors: 0 };
    for (const a of assessments) {
      try {
        const existing = await prisma.leaseAlert.findFirst({
          where: { title: a.title, status: 'OPEN', createdAt: { gte: today } },
          select: { id: true },
        });
        if (existing) { counts.alertsSkipped += 1; continue; }
        await prisma.leaseAlert.create({
          data: {
            alertType: 'CUSTOM',
            severity: 'WARNING',
            title: a.title,
            message: a.message,
            status: 'OPEN',
          },
        });
        counts.alertsCreated += 1;
      } catch (err) {
        counts.errors += 1;
        captureException(err, { context: 'leasing.inquiries.sweep-followups.apply', tags: { inquiryId: a.inquiryId } });
      }
    }

    if (counts.alertsCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseInquiry',
        action: 'UPDATE',
        details: `Inquiry follow-up sweep: ${assessments.length} inquiries with overdue follow-ups, ${counts.alertsCreated} alerts emitted, ${counts.alertsSkipped} skipped, ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false, runAt: now.toISOString(),
      scannedActivities: due.length,
      scannedInquiries: byInquiry.size,
      counts, assessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.inquiries.sweep-followups' });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
