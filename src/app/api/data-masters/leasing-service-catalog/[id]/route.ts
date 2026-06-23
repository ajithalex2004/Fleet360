/**
 * /api/data-masters/leasing-service-catalog/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataMasterContext, requireDataMasterAdmin } from '@/lib/data-masters/auth';
import {
  deleteLeasingServiceCatalogItem,
  getLeasingServiceCatalogItem,
  updateLeasingServiceCatalogItem,
} from '@/lib/data-masters/leasing-service-catalog';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getDataMasterContext(req);
    if (auth instanceof NextResponse) return auth;
    const item = await getLeasingServiceCatalogItem(auth.tenantId, params.id);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(item);
  } catch (error) {
    console.error('[leasing-service-catalog] GET item error:', error);
    return NextResponse.json({ error: 'Failed to load catalog item' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    const updated = await updateLeasingServiceCatalogItem(auth.tenantId, params.id, body);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error: unknown) {
    console.error('[leasing-service-catalog] PATCH error:', error);
    const err = error as { code?: string; message?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'A catalog item with that code already exists for this service type.' }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to update catalog item' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const deleted = await deleteLeasingServiceCatalogItem(auth.tenantId, params.id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[leasing-service-catalog] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete catalog item' }, { status: 500 });
  }
}
