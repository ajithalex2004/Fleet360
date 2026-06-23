/**
 * /api/data-masters/maintenance-types/[id] — single-row CRUD.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataMasterContext, requireDataMasterAdmin } from '@/lib/data-masters/auth';
import {
  getMaintenanceType,
  updateMaintenanceType,
  deleteMaintenanceType,
} from '@/lib/data-masters/maintenance-types';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getDataMasterContext(req);
    if (auth instanceof NextResponse) return auth;
    const row = await getMaintenanceType(auth.tenantId, params.id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[maintenance-types] GET error:', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    const updated = await updateMaintenanceType(auth.tenantId, params.id, body);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e: unknown) {
    console.error('[maintenance-types] PATCH error:', e);
    const err = e as { code?: string; message?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'A maintenance type with that code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const ok = await deleteMaintenanceType(auth.tenantId, params.id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[maintenance-types] DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
