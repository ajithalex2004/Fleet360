export const dynamic = 'force-dynamic';

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
    const staleAfterDays = Math.max(7, Number(sp.get('staleAfterDays') ?? 35));

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const staleCutoff = new Date(now.getTime() - staleAfterDays * 86400000);

    interface Assessment {
      tenantId: string;
      contractId: string;
      contractNumber: string | null;
      lastReadingAt: Date | null;
      daysSince: number;
      title: string;
      message: string;
    }
    interface PerTenantResult {
      scanned: number;
      assessments: Assessment[];
      alertsCreated: number;
      alertsSkipped: number;
      errors: number;
    }

    const perTenant = await runSweep<PerTenantResult>(
      async ({ tx, tenantId }) => {
        const contracts = await tx.leaseContract2.findMany({
          where: { tenantId, deletedAt: null, status: 'ACTIVE' },
          select: { id: true, contractNumber: true, mileageCap: true, startDate: true },
        });

        const assessments: Assessment[] = [];
        for (const c of contracts) {
          const latest = await tx.leaseMileageReading.findFirst({
            where: { tenantId, contractId: c.id },
            orderBy: { readingDate: 'desc' },
            select: { readingDate: true },
          });
          const reference = latest?.readingDate ?? c.startDate;
          if (reference > staleCutoff) continue;

          const daysSince = Math.floor((now.getTime() - reference.getTime()) / 86400000);
          assessments.push({
            tenantId,
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
          return { scanned: contracts.length, assessments, alertsCreated: 0, alertsSkipped: 0, errors: 0 };
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
                alertType: 'CUSTOM',
                severity: 'WARNING',
                title: a.title,
                message: a.message,
                contractId: a.contractId,
                status: 'OPEN',
                tenantId: a.tenantId,
              },
            });
            alertsCreated += 1;
          } catch (err) {
            errors += 1;
            captureException(err, {
              context: 'leasing.mileage.sweep-stale.apply',
              tags: { contractId: a.contractId, tenantId: a.tenantId },
            });
          }
        }
        return { scanned: contracts.length, assessments, alertsCreated, alertsSkipped, errors };
      },
      { tenantHeader },
    );

    let totalScanned = 0;
    const allAssessments: Assessment[] = [];
    const counts = { alertsCreated: 0, alertsSkipped: 0, errors: 0 };
    for (const r of perTenant) {
      totalScanned += r.result.scanned;
      allAssessments.push(...r.result.assessments);
      counts.alertsCreated += r.result.alertsCreated;
      counts.alertsSkipped += r.result.alertsSkipped;
      counts.errors += r.result.errors;
    }

    if (!dryRun && counts.alertsCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseContract2',
        action: 'UPDATE',
        details: `Mileage stale-reading sweep (≥${staleAfterDays}d): scanned ${totalScanned} across ${perTenant.length} tenant(s), ${counts.alertsCreated} alerts emitted, ${counts.alertsSkipped} skipped, ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun,
      runAt: now.toISOString(),
      staleAfterDays,
      tenantsScanned: perTenant.length,
      scanned: totalScanned,
      counts,
      assessments: allAssessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.mileage.sweep-stale' });
    console.error('[mileage stale sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
