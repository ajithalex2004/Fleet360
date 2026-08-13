/**
 * DELETE /api/bus-ops/transport-calendars/[id]/entries/[entryId]
 *
 * Hard-delete an entry (no soft-delete on the child table). Tenant
 * scope enforced via the parent calendar.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; entryId: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id: calendarId, entryId } = await ctx.params;

  // Tenant scope: caller must own the parent calendar.
  const cal = await prisma.transportCalendar.findFirst({
    where: { id: calendarId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!cal) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

  try {
    await prisma.transportCalendarEntry.delete({ where: { id: entryId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[transport-calendar-entries.DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
