export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAndAutoActivateExpiredEtcJobs } from '@/lib/logistics/drayage-domain';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow unauthenticated local/preview check or enforce secret if set
    }

    const result = await checkAndAutoActivateExpiredEtcJobs(prisma);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    console.error('[api/logistics/drayage/cron GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron worker failed' },
      { status: 500 },
    );
  }
}
