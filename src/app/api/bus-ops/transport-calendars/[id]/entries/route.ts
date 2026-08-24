/**
 * POST /api/bus-ops/transport-calendars/[id]/entries
 *
 * Add one entry (date + kind) to a calendar. Idempotent via the
 * (calendar_id, entry_date) unique index — re-posting the same date
 * for the same calendar returns the existing row (400 semantics from
 * Prisma P2002 caught and translated to 200 + existing row).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const VALID_KINDS = new Set(['HOLIDAY', 'WORKING_OVERRIDE', 'HALF_DAY', 'REDUCED_SERVICE']);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const { id: calendarId } = await ctx.params;

  // Tenant-scope check: caller must own the calendar
  const cal = await prisma.transportCalendar.findFirst({
    where: { id: calendarId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!cal) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

  try {
    const body = await req.json();
    if (!body?.entryDate) return NextResponse.json({ error: 'entryDate is required' }, { status: 400 });
    if (!body?.kind || !VALID_KINDS.has(body.kind)) {
      return NextResponse.json({ error: `kind must be one of ${[...VALID_KINDS].join('|')}` }, { status: 400 });
    }
    const row = await prisma.transportCalendarEntry.create({
      data: {
        calendarId,
        entryDate: new Date(body.entryDate),
        kind:      body.kind,
        note:      body.note?.trim() || null,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    // P2002 = unique constraint (calendar_id, entry_date). Return existing.
    const code = (e as { code?: string } | null)?.code;
    if (code === 'P2002') {
      const existing = await prisma.transportCalendarEntry.findFirst({
        where: { calendarId, entryDate: new Date((await req.json())?.entryDate ?? new Date()) },
      });
      return NextResponse.json(existing, { status: 200 });
    }
    console.error('[transport-calendar-entries.POST]', e);
    return NextResponse.json({ error: 'Failed to add entry' }, { status: 500 });
  }
}
