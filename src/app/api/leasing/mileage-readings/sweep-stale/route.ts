/**
 * POST /api/leasing/mileage-readings/sweep-stale
 *
 * Daily cron: scans ACTIVE LeaseContract2 rows whose latest mileage reading
 * is older than `staleAfterDays` (default 35 — gives a 5-day grace past the
 * monthly-reading cadence). Emits a LeaseAlert per stale contract so finance
 * can chase the missing reading.
 *
 * Idempotent — same-day, same-title dedup.
 *
 * Query: ?dryRun=1 to preview, ?staleAfterDays=N to override threshold.
 * Auth: optional CRON_SECRET Bearer for external cron.
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
    const staleAfterDays = Math.max(7, Number(sp.get('staleAfterDays') ?? 35));

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const staleCutoff = new Date(now.getTime() - staleAfterDays * 86400000);

    const contracts = await prisma.leaseContract2.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, contractNumber: true, mileageCap: true, startDate: true },
    });

    interface Assessment {
      contractId: string;
      contractNumber: string | null;
      lastReadingAt: Date | null;
      daysSince: number;
      title: string;
      message: string;
    }

    const assessments: Assessment[] = [];
    for (const c of contracts) {
      const latest = await prisma.leaseMileageReading.findFirst({
        where: { contractId: c.id },
        orderBy: { readingDate: 'desc' },
        select: { readingDate: true },
      });
      const reference = latest?.readingDate ?? c.startDate;
      // Skip very-new contracts — give them at least staleAfterDays from start.
      if (reference > staleCutoff) continue;

      const daysSince = Math.floor((now.getTime() - reference.getTime()) / 86400000);
      assessments.push({
        contractId: c.id,
        contractNumber: c.contractNumber,
        lastReadingAt: latest?.readingDate ?? null,
        daysSince,
        title: `Mileage reading overdue: ${c.contractNumber ?? c.id.slice(0, 8)}`,
        message: latest
          ? `No mileage reading captured for ${daysSince} days (last: ${reference.toISOString().slice(0, 10)}). Periodic readings are required for overage billing.`
          : `No mileage reading captured since contract start ${daysSince} days ago. Capture an initial DELIVERY reading.`,
      });
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, runAt: now.toISOString(), staleAfterDays,
        scanned: contracts.length, assessments,
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
            contractId: a.contractId,
            status: 'OPEN',
          },
        });
        counts.alertsCreated += 1;
      } catch (err) {
        counts.errors += 1;
        captureException(err, {
          context: 'leasing.mileage.sweep-stale.apply',
          tags: { contractId: a.contractId },
        });
      }
    }

    if (counts.alertsCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseContract2',
        action: 'UPDATE',
        details: `Mileage stale-reading sweep (≥${staleAfterDays}d): scanned ${contracts.length}, ${counts.alertsCreated} alerts emitted, ${counts.alertsSkipped} skipped, ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false, runAt: now.toISOString(), staleAfterDays,
      scanned: contracts.length, counts, assessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.mileage.sweep-stale' });
    console.error('[mileage stale sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
