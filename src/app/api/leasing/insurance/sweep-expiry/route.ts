/**
 * POST /api/leasing/insurance/sweep-expiry
 *
 * Daily cron: scans active LeaseInsurancePolicy rows and emits LeaseAlert rows
 * for any policy whose expiryDate falls inside the policy's own
 * renewalReminderDays window (default 30).
 *
 * Idempotent — checks for an existing OPEN alert with the same title for
 * today before inserting, so repeat runs never duplicate.
 *
 * Auth: optional CRON_SECRET Bearer for external cron.
 *
 * Query: ?dryRun=1 to preview without writing.
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

    const policies = await prisma.leaseInsurancePolicy.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
      },
      select: {
        id: true,
        policyNo: true,
        contractId: true,
        insurer: true,
        expiryDate: true,
        renewalReminderDays: true,
        status: true,
      },
    });

    interface Assessment {
      policyId: string;
      policyNo: string | null;
      contractId: string | null;
      insurer: string;
      daysToExpiry: number;
      newStatus: 'EXPIRING_SOON' | 'EXPIRED';
      title: string;
      message: string;
      severity: 'WARNING' | 'ERROR';
    }

    const assessments: Assessment[] = [];
    for (const p of policies) {
      const daysToExpiry = Math.ceil((p.expiryDate.getTime() - now.getTime()) / 86400000);
      const reminderWindow = p.renewalReminderDays ?? 30;
      if (daysToExpiry < 0) {
        assessments.push({
          policyId: p.id, policyNo: p.policyNo, contractId: p.contractId, insurer: p.insurer,
          daysToExpiry, newStatus: 'EXPIRED',
          title: `Insurance EXPIRED: ${p.policyNo ?? p.id.slice(0, 8)} (${p.insurer})`,
          message: `Policy expired ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry) === 1 ? '' : 's'} ago — vehicle is uninsured. Renew immediately.`,
          severity: 'ERROR',
        });
      } else if (daysToExpiry <= reminderWindow) {
        assessments.push({
          policyId: p.id, policyNo: p.policyNo, contractId: p.contractId, insurer: p.insurer,
          daysToExpiry, newStatus: 'EXPIRING_SOON',
          title: `Insurance expiring soon: ${p.policyNo ?? p.id.slice(0, 8)} (${p.insurer})`,
          message: `Policy expires in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'} on ${p.expiryDate.toISOString().slice(0, 10)}. Initiate renewal.`,
          severity: 'WARNING',
        });
      }
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, runAt: now.toISOString(),
        scanned: policies.length, assessments,
      });
    }

    const counts = { alertsCreated: 0, alertsSkipped: 0, statusUpdated: 0, errors: 0 };
    for (const a of assessments) {
      try {
        // Idempotency: same title + OPEN status today already?
        const existing = await prisma.leaseAlert.findFirst({
          where: {
            title: a.title,
            status: 'OPEN',
            createdAt: { gte: today },
          },
          select: { id: true },
        });
        if (existing) {
          counts.alertsSkipped += 1;
        } else {
          await prisma.leaseAlert.create({
            data: {
              alertType: 'EXPIRY',
              severity: a.severity,
              title: a.title,
              message: a.message,
              contractId: a.contractId,
              status: 'OPEN',
            },
          });
          counts.alertsCreated += 1;
        }

        // Update policy status if it changed.
        if (
          (a.newStatus === 'EXPIRED' && policies.find(p => p.id === a.policyId)?.status !== 'EXPIRED') ||
          (a.newStatus === 'EXPIRING_SOON' && policies.find(p => p.id === a.policyId)?.status === 'ACTIVE')
        ) {
          await prisma.leaseInsurancePolicy.update({
            where: { id: a.policyId },
            data: { status: a.newStatus },
          });
          counts.statusUpdated += 1;
        }
      } catch (err) {
        counts.errors += 1;
        captureException(err, {
          context: 'leasing.insurance.sweep-expiry.apply',
          tags: { policyId: a.policyId },
        });
      }
    }

    if (counts.alertsCreated + counts.statusUpdated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseInsurancePolicy',
        action: 'UPDATE',
        details: `Insurance expiry sweep: scanned ${policies.length}, ${counts.alertsCreated} alerts emitted, ${counts.statusUpdated} status flips, ${counts.alertsSkipped} skipped (already today), ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false, runAt: now.toISOString(),
      scanned: policies.length, counts, assessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.insurance.sweep-expiry' });
    console.error('[insurance expiry sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
