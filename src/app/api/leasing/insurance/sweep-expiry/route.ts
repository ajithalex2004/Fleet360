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
import { withSystemJob } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

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
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    interface Assessment {
      tenantId: string;
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
    interface PerTenantResult {
      scanned: number;
      policies: Array<{
        id: string; policyNo: string | null; contractId: string | null;
        insurer: string; expiryDate: Date; renewalReminderDays: number | null;
        status: string | null;
      }>;
      assessments: Assessment[];
      alertsCreated: number;
      alertsSkipped: number;
      statusUpdated: number;
      errors: number;
    }

    const perTenant = await withSystemJob<PerTenantResult>(
      prisma,
      async ({ tx, tenantId }) => {
        const policies = await tx.leaseInsurancePolicy.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
          },
          select: {
            id: true, policyNo: true, contractId: true, insurer: true,
            expiryDate: true, renewalReminderDays: true, status: true,
          },
        });

        const assessments: Assessment[] = [];
        for (const p of policies) {
          const daysToExpiry = Math.ceil((p.expiryDate.getTime() - now.getTime()) / 86400000);
          const reminderWindow = p.renewalReminderDays ?? 30;
          if (daysToExpiry < 0) {
            assessments.push({
              tenantId,
              policyId: p.id, policyNo: p.policyNo, contractId: p.contractId, insurer: p.insurer,
              daysToExpiry, newStatus: 'EXPIRED',
              title: `Insurance EXPIRED: ${p.policyNo ?? p.id.slice(0, 8)} (${p.insurer})`,
              message: `Policy expired ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry) === 1 ? '' : 's'} ago — vehicle is uninsured. Renew immediately.`,
              severity: 'ERROR',
            });
          } else if (daysToExpiry <= reminderWindow) {
            assessments.push({
              tenantId,
              policyId: p.id, policyNo: p.policyNo, contractId: p.contractId, insurer: p.insurer,
              daysToExpiry, newStatus: 'EXPIRING_SOON',
              title: `Insurance expiring soon: ${p.policyNo ?? p.id.slice(0, 8)} (${p.insurer})`,
              message: `Policy expires in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'} on ${p.expiryDate.toISOString().slice(0, 10)}. Initiate renewal.`,
              severity: 'WARNING',
            });
          }
        }

        if (dryRun) {
          return {
            scanned: policies.length, policies, assessments,
            alertsCreated: 0, alertsSkipped: 0, statusUpdated: 0, errors: 0,
          };
        }

        let alertsCreated = 0;
        let alertsSkipped = 0;
        let statusUpdated = 0;
        let errors = 0;
        for (const a of assessments) {
          try {
            const existing = await tx.leaseAlert.findFirst({
              where: { title: a.title, status: 'OPEN', createdAt: { gte: today } },
              select: { id: true },
            });
            if (existing) {
              alertsSkipped += 1;
            } else {
              await tx.leaseAlert.create({
                data: {
                  alertType: 'EXPIRY', severity: a.severity,
                  title: a.title, message: a.message,
                  contractId: a.contractId, status: 'OPEN', tenantId,
                },
              });
              alertsCreated += 1;
            }
            const currentPolicy = policies.find(p => p.id === a.policyId);
            if (
              (a.newStatus === 'EXPIRED' && currentPolicy?.status !== 'EXPIRED') ||
              (a.newStatus === 'EXPIRING_SOON' && currentPolicy?.status === 'ACTIVE')
            ) {
              await tx.leaseInsurancePolicy.update({
                where: { id: a.policyId },
                data: { status: a.newStatus },
              });
              statusUpdated += 1;
            }
          } catch (err) {
            errors += 1;
            captureException(err, {
              context: 'leasing.insurance.sweep-expiry.apply',
              tags: { policyId: a.policyId, tenantId },
            });
          }
        }
        return {
          scanned: policies.length, policies, assessments,
          alertsCreated, alertsSkipped, statusUpdated, errors,
        };
      },
      { tenantHeader },
    );

    let totalScanned = 0;
    const counts = { alertsCreated: 0, alertsSkipped: 0, statusUpdated: 0, errors: 0 };
    const allAssessments: Assessment[] = [];
    for (const r of perTenant) {
      totalScanned += r.result.scanned;
      counts.alertsCreated += r.result.alertsCreated;
      counts.alertsSkipped += r.result.alertsSkipped;
      counts.statusUpdated += r.result.statusUpdated;
      counts.errors += r.result.errors;
      allAssessments.push(...r.result.assessments);
    }

    if (!dryRun && (counts.alertsCreated + counts.statusUpdated > 0)) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseInsurancePolicy',
        action: 'UPDATE',
        details: `Insurance expiry sweep: scanned ${totalScanned} across ${perTenant.length} tenant(s), ${counts.alertsCreated} alerts emitted, ${counts.statusUpdated} status flips, ${counts.alertsSkipped} skipped (already today), ${counts.errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun,
      runAt: now.toISOString(),
      tenantsScanned: perTenant.length,
      scanned: totalScanned,
      counts,
      assessments: allAssessments,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.insurance.sweep-expiry' });
    console.error('[insurance expiry sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
