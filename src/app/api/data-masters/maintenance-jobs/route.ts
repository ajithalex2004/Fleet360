/**
 * /api/data-masters/maintenance-jobs
 *
 * Tenant-scoped Maintenance Jobs Master. Lists jobs that can be selected
 * when creating a maintenance ticket / request, optionally filtered to
 * one parent Maintenance Type.
 *
 *   GET ?activeOnly=true&maintenanceTypeId=<uuid>
 *     → list, joined with maintenance_types for type code + name
 *   POST  → create
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataMasterContext, requireDataMasterAdmin } from '@/lib/data-masters/auth';
import {
  listMaintenanceJobs,
  createMaintenanceJob,
} from '@/lib/data-masters/maintenance-jobs';

export async function GET(req: NextRequest) {
  try {
    const auth = getDataMasterContext(req);
    if (auth instanceof NextResponse) return auth;
    const activeOnly         = req.nextUrl.searchParams.get('activeOnly') === 'true';
    const maintenanceTypeId  = req.nextUrl.searchParams.get('maintenanceTypeId') ?? undefined;
    const jobs = await listMaintenanceJobs(auth.tenantId, { activeOnly, maintenanceTypeId });
    return NextResponse.json(
      { jobs },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (e) {
    console.error('[maintenance-jobs] GET error:', e);
    return NextResponse.json({ error: 'Failed to load maintenance jobs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireDataMasterAdmin(req);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    if (!body?.code || !body?.name || !body?.maintenanceTypeId) {
      return NextResponse.json({ error: 'maintenanceTypeId, code and name are required' }, { status: 400 });
    }
    const created = await createMaintenanceJob(auth.tenantId, body);
    return NextResponse.json(created, { status: 201 });
  } catch (e: unknown) {
    console.error('[maintenance-jobs] POST error:', e);
    const err = e as { code?: string; message?: string };
    if (err?.code === '23505') {
      return NextResponse.json({ error: 'A job with that code already exists under this maintenance type.' }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to create' }, { status: 500 });
  }
}
