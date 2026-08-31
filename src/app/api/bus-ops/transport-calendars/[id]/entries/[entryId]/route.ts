export const dynamic = 'force-dynamic';

/**
 * DELETE /api/bus-ops/transport-calendars/[id]/entries/[entryId]
 *
 * Hard-delete an entry (no soft-delete on the child table). Tenant
 * scope enforced via the parent calendar.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; entryId: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const { id: calendarId, entryId } = await ctx.params;

      // Tenant scope: caller must own the parent calendar.
      const cal = await tx.transportCalendar.findFirst({
        where: { id: calendarId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!cal) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

      try {
        await tx.transportCalendarEntry.delete({ where: { id: entryId } });
        return NextResponse.json({ ok: true });
        } catch (e) {
        console.error('[transport-calendar-entries.DELETE]', e);
        return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
      }
  });
}

