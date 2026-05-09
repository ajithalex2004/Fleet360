/**
 * POST /api/leasing/documents/sweep-expiry
 *
 * Scans all leasing documents with an expiryDate in the future, classifies
 * them into expiry buckets (1d / 14d / 30d / past), updates document status,
 * and creates LeaseAlert rows for any new hits.
 *
 * Idempotent — running twice produces the same result (alerts are
 * fingerprinted so they don't double-fire).
 *
 * Query params:
 *   ?dryRun=1 — preview without writing
 *
 * Designed to be cron-triggered (Vercel Cron / GitHub Actions / external):
 *   POST /api/leasing/documents/sweep-expiry
 *   Authorization: Bearer <CRON_SECRET>   (when CRON_SECRET is set)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runExpirySweep } from '@/lib/leasing/expiry-sweep';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Optional shared-secret auth for cron triggers.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      // Fall through if user is authenticated via session — middleware
      // already handled that. We only enforce CRON_SECRET when the request
      // doesn't have a tenant header (i.e. unauthenticated cron pings).
      if (!req.headers.get('x-tenant-id')) {
        return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
      }
    }
  }

  try {
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const result = await runExpirySweep({ dryRun });

    if (!dryRun && result.alertsCreated > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: req.headers.get('x-user-role') ?? 'SYSTEM',
        entityType: 'LeaseDocument',
        action: 'UPDATE',
        details: `Expiry sweep: scanned ${result.scanned}, ${result.hits.length} hits, ${result.alertsCreated} new alerts, ${result.statusUpdates} status updates.`,
      });
    }

    return NextResponse.json({
      ...result,
      dryRun,
      env: env.NODE_ENV,
      runAt: new Date().toISOString(),
    });
  } catch (err) {
    captureException(err, { context: 'leasing.documents.sweep-expiry' });
    console.error('[sweep-expiry] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
