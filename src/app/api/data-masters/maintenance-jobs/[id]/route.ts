/**
 * /api/data-masters/maintenance-jobs/[id] — single-row CRUD.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataMasterContext, requireDataMasterAdmin } from '@/lib/data-masters/auth';
import {
  getMaintenanceJob,
  updateMaintenanceJob,
  deleteMaintenanceJob,
} from '@/lib/data-masters/maintenance-jobs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getDataMasterContext(req);
    if (auth instanceof NextResponse) return auth;
    const row = await getMaintenanceJob(auth.tenantId, params.id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[maintenance-jobs] GET error:', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    const updated = await updateMaintenanceJob(auth.tenantId, params.id, body);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e: unknown) {
    console.error('[maintenance-jobs] PATCH error:', e);
    const err = e as { code?: string; message?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'A job with that code already exists under this maintenance type.' }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const ok = await deleteMaintenanceJob(auth.tenantId, params.id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[maintenance-jobs] DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
