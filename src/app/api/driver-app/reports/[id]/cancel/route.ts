/**
 * src/app/api/driver-app/reports/[id]/cancel/route.ts
 *
 * POST /api/driver-app/reports/[id]/cancel
 *   Driver withdraws their own report. Only valid from OPEN status
 *   (a report the dispatcher has already acknowledged or started
 *   working on should not be silently cancelled by the driver — the
 *   dispatcher would lose context). For those, the driver should
 *   reach out via the in-app chat (future).
 *
 *   Idempotent: cancelling an already-CANCELLED report is a 200
 *   no-op.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { evaluateReportTransition } from '@/lib/driver-reports';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      // 1) Load the report (no body needed)
      const rows = await tx.$queryRaw<Array<{
        id: string;
        tenant_id: string;
        driver_id: string;
        status: string;
      }>>`
        SELECT id, tenant_id, driver_id, status
        FROM driver_reports
        WHERE id = ${params.id}::uuid
        LIMIT 1
      `;
      if (rows.length === 0) {
        return NextResponse.json({ error: 'report not found' }, { status: 404 });
      }
      const r = rows[0];

      if (r.tenant_id !== ctx.tenantId) {
        return NextResponse.json({ error: 'forbidden: report is in a different tenant' }, { status: 403 });
      }
      if (r.driver_id !== ctx.userId) {
        return NextResponse.json({ error: 'forbidden: this report was filed by another driver' }, { status: 403 });
      }

      // 2) State machine
      const decision = evaluateReportTransition({
        currentStatus: r.status as Parameters<typeof evaluateReportTransition>[0]['currentStatus'],
        action: 'CANCEL',
      });
      if (!decision.allowed) {
        return NextResponse.json(
          { error: 'cannot cancel', reason: decision.reason, currentStatus: r.status },
          { status: 409 },
        );
      }

      // 3) Idempotent re-cancel
      if (r.status === 'CANCELLED') {
        return NextResponse.json({
          ok: true,
          id: r.id,
          status: 'CANCELLED',
          idempotent: true,
        });
      }

      // 4) Persist
      await tx.$executeRaw`
        UPDATE driver_reports
        SET status = 'CANCELLED',
            cancelled_by = ${ctx.userId}::uuid,
            cancelled_at = NOW(),
            updated_at = NOW()
        WHERE id = ${r.id}::uuid
      `;

      return NextResponse.json({
        ok: true,
        id: r.id,
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
      });
  });
}

