import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { runContractRenewalSweep } from '@/lib/leasing/contract-renewal-sweep';

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
    const result = await runContractRenewalSweep({ dryRun });

    if (!dryRun && (result.alertsCreated > 0 || result.alertsSkipped > 0)) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseContract',
        action: 'UPDATE',
        details: `Contract renewal sweep: scanned ${result.scanned}, hits ${result.hits.length}, alerts created ${result.alertsCreated}, skipped ${result.alertsSkipped}, errors ${result.errors.length}.`,
      });
    }

    return NextResponse.json({
      dryRun,
      runAt: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.contract-renewal-sweep.route' });
    console.error('[contract renewal sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
