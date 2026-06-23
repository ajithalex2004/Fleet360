import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { buildLeasingOperationalDashboard } from '@/lib/leasing-operational-dashboard';

export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await buildLeasingOperationalDashboard(ctx), {
      headers: {
        'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
      },
    });
  } catch (err) {
    console.error('[leasing/operational-dashboard]', err);
    return NextResponse.json({ error: 'Failed to load Leasing operational dashboard' }, { status: 500 });
  }
}
