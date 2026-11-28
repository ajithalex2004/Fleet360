export const dynamic = 'force-dynamic';

/**
 * GET /api/service-tickets/dispatch?date=YYYY-MM-DD&endDate=YYYY-MM-DD&territoryId=...&department=...
 * Returns composite Dispatch Board & Live Field Map payload.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { captureException } from '@/lib/sentry';
import { WorkforceError } from '@/lib/service-tickets/workforce-db';
import { getDispatchBoard } from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const today = new Date().toISOString().slice(0, 10);
  const dateParam = req.nextUrl.searchParams.get('date') || today;
  const endDateParam = req.nextUrl.searchParams.get('endDate') || dateParam;
  const date = ISO_DAY_RE.test(dateParam) ? dateParam : today;
  const endDate = ISO_DAY_RE.test(endDateParam) && endDateParam >= date ? endDateParam : date;
  const territoryId = req.nextUrl.searchParams.get('territoryId') || undefined;
  const department = req.nextUrl.searchParams.get('department') || undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const board = await getDispatchBoard(tx, tenantId, { date, endDate, territoryId, department });
      return NextResponse.json({ ok: true, ...board });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.dispatch.board', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load dispatch board.' }, { status: 500 });
    }
  });
}
