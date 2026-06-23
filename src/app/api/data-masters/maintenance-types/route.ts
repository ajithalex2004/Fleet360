/**
 * /api/data-masters/maintenance-types
 *
 * Tenant-scoped catalogue of maintenance sub-categories used as a dropdown
 * source on the maintenance ticket creation form. List is readable by any
 * authenticated tenant user; create requires admin (caller checked via
 * x-user-role header set by middleware).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataMasterContext, requireDataMasterAdmin } from '@/lib/data-masters/auth';
import {
  listMaintenanceTypes,
  createMaintenanceType,
} from '@/lib/data-masters/maintenance-types';

export async function GET(req: NextRequest) {
  try {
    const auth = getDataMasterContext(req);
    if (auth instanceof NextResponse) return auth;
    const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true';
    const types = await listMaintenanceTypes(auth.tenantId, { activeOnly });
    return NextResponse.json(
      { types },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (e) {
    console.error('[maintenance-types] GET error:', e);
    return NextResponse.json({ error: 'Failed to load maintenance types' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    if (!body?.code || !body?.name) {
      return NextResponse.json({ error: 'code and name are required' }, { status: 400 });
    }
    const created = await createMaintenanceType(auth.tenantId, body);
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    console.error('[maintenance-types] POST error:', e);
    const err = e as { code?: string; message?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'A maintenance type with that code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to create' }, { status: 500 });
  }
}
