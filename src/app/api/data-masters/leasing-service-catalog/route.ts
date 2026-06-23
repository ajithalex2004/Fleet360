/**
 * /api/data-masters/leasing-service-catalog
 *
 * Tenant-scoped Vehicle Leasing quotation accessories/service catalog.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataMasterContext, requireDataMasterAdmin } from '@/lib/data-masters/auth';
import {
  createLeasingServiceCatalogItem,
  LEASING_QUOTATION_SERVICE_TYPE_KEY,
  listLeasingServiceCatalog,
} from '@/lib/data-masters/leasing-service-catalog';

export async function GET(req: NextRequest) {
  try {
    const auth = getDataMasterContext(req);
    if (auth instanceof NextResponse) return auth;
    const serviceTypeKey = req.nextUrl.searchParams.get('serviceTypeKey') || LEASING_QUOTATION_SERVICE_TYPE_KEY;
    const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true';
    const items = await listLeasingServiceCatalog(auth.tenantId, { serviceTypeKey, activeOnly });
    return NextResponse.json(
      { items },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (error) {
    console.error('[leasing-service-catalog] GET error:', error);
    return NextResponse.json({ error: 'Failed to load leasing service catalog' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    if (!body?.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const created = await createLeasingServiceCatalogItem(auth.tenantId, body);
    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    console.error('[leasing-service-catalog] POST error:', error);
    const err = error as { code?: string; message?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'A catalog item with that code already exists for this service type.' }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to create catalog item' }, { status: 500 });
  }
}
