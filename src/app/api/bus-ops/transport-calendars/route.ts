/**
 * /api/bus-ops/transport-calendars — MVP CRUD for tenant exception-day
 * calendars. GET lists active calendars (with entries); POST creates a
 * calendar; POST /[id]/entries adds an entry.
 *
 * Consumed by the schedule-template generator to skip HOLIDAY dates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const rows = await prisma.transportCalendar.findMany({
      where: { tenantId, deletedAt: null },
      include: { entries: { orderBy: { entryDate: 'asc' } } },
      orderBy: [{ isActive: 'desc' }, { effectiveFrom: 'desc' }],
    });
    return NextResponse.json(rows);
  } catch (e) {
    console.error('[transport-calendars.GET]', e);
    return NextResponse.json({ error: 'Failed to fetch calendars' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const createdBy = req.headers.get('x-user-id') ?? null;
  try {
    const body = await req.json();
    if (!body?.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const row = await prisma.transportCalendar.create({
      data: {
        tenantId,                       // stamped from session
        name: body.name.trim(),
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
        effectiveTo:   body.effectiveTo   ? new Date(body.effectiveTo)   : null,
        isActive:      body.isActive ?? true,
        notes:         body.notes?.trim() || null,
        createdBy,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    console.error('[transport-calendars.POST]', e);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
