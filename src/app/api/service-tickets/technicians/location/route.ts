export const dynamic = 'force-dynamic';

/**
 * POST /api/service-tickets/technicians/location
 * Live GPS heartbeat for field technicians powering the Dispatch Live Field Map.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { captureException } from '@/lib/sentry';
import { AVAILABILITY_STATUSES } from '@/lib/service-tickets/workforce';
import { WorkforceError } from '@/lib/service-tickets/workforce-db';
import { upsertTechnicianGpsLocation } from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const technicianId = typeof body.technicianId === 'string' ? body.technicianId : '';
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracyM = body.accuracyM !== undefined && body.accuracyM !== null ? Number(body.accuracyM) : null;
  const batteryPct = body.batteryPct !== undefined && body.batteryPct !== null ? Math.round(Number(body.batteryPct)) : null;
  const availRaw = typeof body.availabilityStatus === 'string' ? body.availabilityStatus.toUpperCase() : null;
  const availabilityStatus =
    availRaw && (AVAILABILITY_STATUSES as readonly string[]).includes(availRaw) ? availRaw : null;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await upsertTechnicianGpsLocation(tx, tenantId, technicianId, {
        latitude,
        longitude,
        accuracyM: Number.isFinite(accuracyM) ? accuracyM : null,
        batteryPct: Number.isFinite(batteryPct) ? batteryPct : null,
        availabilityStatus,
      });
      return NextResponse.json({ ok: true, recordedAt: new Date().toISOString() });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.technicians.location', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to update technician location.' }, { status: 500 });
    }
  });
}
