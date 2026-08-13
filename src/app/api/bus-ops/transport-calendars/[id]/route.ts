/**
 * /api/bus-ops/transport-calendars/[id] — single-calendar ops.
 * GET returns the calendar with entries; PATCH updates header
 * (name / effective window / isActive); DELETE is soft.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function loadOwned(id: string, tenantId: string) {
  return prisma.transportCalendar.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { entries: { orderBy: { entryDate: 'asc' } } },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const row = await loadOwned(id, tenantId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if ('effectiveFrom' in body && body.effectiveFrom) patch.effectiveFrom = new Date(body.effectiveFrom);
    if ('effectiveTo'   in body) patch.effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : null;
    if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;
    if ('notes' in body) patch.notes = body.notes?.trim() || null;
    const row = await prisma.transportCalendar.update({ where: { id }, data: patch });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[transport-calendars.PATCH]', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { id } = await ctx.params;
  const existing = await loadOwned(id, tenantId);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    await prisma.transportCalendar.update({ where: { id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[transport-calendars.DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
