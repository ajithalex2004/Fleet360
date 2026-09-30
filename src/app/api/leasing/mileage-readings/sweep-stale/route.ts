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

import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { runSweep } from '@/lib/prisma-sweep';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { listBlock } from '@/lib/email-templates/render';
import { tenantContact } from '@/lib/leasing/staff-recipients';
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
      alertCreated?: boolean;
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
            a.alertCreated = true;
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
    const counts = { alertsCreated: 0, alertsSkipped: 0, errors: 0, emailsSent: 0 };
    for (const r of perTenant) {
      totalScanned += r.result.scanned;
      allAssessments.push(...r.result.assessments);
      counts.alertsCreated += r.result.alertsCreated;
      counts.alertsSkipped += r.result.alertsSkipped;
      counts.errors += r.result.errors;
    }

    // Staff-facing digest — capturing a mileage reading is an operations/
    // finance task, not something the lessee can do, so this goes to the
    // tenant's own contact address, one email per tenant per run.
    if (!dryRun) {
      for (const r of perTenant) {
        const newHits = r.result.assessments.filter(a => a.alertCreated);
        if (newHits.length === 0) continue;
        try {
          const contact = await tenantContact(r.tenantId);
          if (!contact) continue;
          const result = await sendTemplatedEmail({
            tenantId: r.tenantId, key: 'leasing.mileage_overdue_digest', to: contact.email,
            values: { recipientName: contact.name, count: String(newHits.length), contractsUrl: appUrl('/leasing/contracts') },
            blocks: { contracts: listBlock(newHits.map(h => `${h.contractNumber ?? h.contractId.slice(0, 8)}: ${h.message}`)) },
          });
          if (result.sent) counts.emailsSent += 1;
        } catch (emailErr) {
          captureException(emailErr, { context: 'leasing.mileage.sweep-stale.email', tags: { tenantId: r.tenantId } });
        }
      }
    }

    if (!dryRun && counts.alertsCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseContract2',
        action: 'UPDATE',
        details: `Mileage stale-reading sweep (≥${staleAfterDays}d): scanned ${totalScanned} across ${perTenant.length} tenant(s), ${counts.alertsCreated} alerts emitted, ${counts.alertsSkipped} skipped, ${counts.emailsSent} digest emails sent, ${counts.errors} errors.`,
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
