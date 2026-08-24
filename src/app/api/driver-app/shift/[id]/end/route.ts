/**
 * src/app/api/driver-app/shift/[id]/end/route.ts
 *
 * POST /api/driver-app/shift/[id]/end — close the active shift.
 *
 * Called when the driver signs out (or explicitly ends their shift).
 * Sets status='CLOSED' and ended_at=NOW(). The shift then becomes
 * read-only — fuel and expense entries that arrived after this point
 * will auto-attach to a NEW shift when one is started.
 *
 * Idempotent: ending a CLOSED shift is a no-op.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest, ctx2: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id: shiftId } = await ctx2.params;
      const ctx = await requireDriverSession(req);
      if (ctx instanceof NextResponse) return ctx;

      // Ownership + status check
      const existing = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM shifts
        WHERE id = ${shiftId}::uuid
          AND tenant_id = ${ctx.tenantId}::uuid
          AND driver_id = ${ctx.userId}::uuid
        LIMIT 1
      `;
      if (existing.length === 0) {
        return NextResponse.json({ error: 'shift not found' }, { status: 404 });
      }
      if (existing[0].status === 'CLOSED') {
        return NextResponse.json({
          ok: true,
          shiftId,
          alreadyClosed: true,
        });
      }

      await tx.$executeRaw`
        UPDATE shifts
        SET status = 'CLOSED', ended_at = NOW(), updated_at = NOW()
        WHERE id = ${shiftId}::uuid
      `;

      return NextResponse.json({ ok: true, shiftId, status: 'CLOSED' });
  });
}

