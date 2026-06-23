/**
 * GET /api/bus-ops/schedules/[id]/manifest/pdf
 *
 * Bilingual passenger-manifest PDF for a staff bus trip.
 *
 * Query:
 *   ?lang=en|ar      (default en)
 *   ?download=1      (force attachment)
 *
 * Use cases:
 *   - Driver carries the printed manifest in the bus during the trip.
 *   - Dispatcher emails it to RTA in incident response.
 *   - Operations archive it for audit.
 */

import { createElement } from 'react';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import { BusManifestPdf, type BusManifestPdfData, type ManifestPassenger } from '@/lib/pdf/templates/bus-manifest';
import type { Lang } from '@/lib/pdf/theme';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { requireBusEntity, requireBusOpsContext } from '@/lib/bus-ops-route-guards';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360 — Staff Transport',
  tagline: 'UAE Smart Transport Management',
  phone: '+971 4 000 0000',
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const ctx = await requireBusOpsContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const boundary = await requireBusEntity(ctx, 'trip_schedules', id, 'Trip');
    if (boundary) return boundary;
    const schedule = await prisma.tripSchedule.findUnique({
      where: { id },
      include: {
        route: true,
        passengers: { orderBy: { boardingStopName: 'asc' } },
      },
    });
    if (!schedule) return jsonErr('Trip not found', 404);

    // Lazy-fetch driver + vehicle (Driver/Vehicle live in their hub modules).
    const driver = schedule.driverId
      ? await prisma.driver.findUnique({
          where: { id: schedule.driverId },
          select: { name: true, firstName: true, lastName: true, contactNumber: true, licenseNumber: true },
        }).catch(() => null)
      : null;
    const vehicle = schedule.vehicleId
      ? await prisma.vehicle.findUnique({
          where: { id: schedule.vehicleId },
          select: { make: true, model: true, licensePlate: true },
        }).catch(() => null)
      : null;

    const passengers: ManifestPassenger[] = schedule.passengers.map(p => ({
      employeeName: p.employeeName,
      employeeId: p.employeeId,
      department: p.department,
      boardingStop: p.boardingStopName,
      alightingStop: p.alightingStopName,
      status: p.status ?? 'CONFIRMED',
      boardedAt: p.boardedAt,
    }));

    const driverName = driver?.name ?? ([driver?.firstName, driver?.lastName].filter(Boolean).join(' ') || null);

    const data: BusManifestPdfData = {
      manifestNo: `MAN-${schedule.tripNumber ?? id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`,
      generatedAt: new Date(),
      vendor: VENDOR,
      trip: {
        tripNumber: schedule.tripNumber ?? id.slice(0, 8),
        departureAt: schedule.departureTime,
        arrivalAt: schedule.arrivalTime,
        routeName: schedule.route?.name ?? '—',
        routeOrigin: schedule.route?.origin ?? '—',
        routeDestination: schedule.route?.destination ?? '—',
        shiftType: schedule.shiftType,
        capacity: schedule.capacity,
      },
      driver: {
        name: driverName,
        contactNumber: driver?.contactNumber ?? null,
        licenseNumber: driver?.licenseNumber ?? null,
      },
      vehicle: {
        licensePlate: vehicle?.licensePlate ?? null,
        make: vehicle?.make ?? null,
        model: vehicle?.model ?? null,
      },
      passengers,
    };

    const buffer = await renderPdf(createElement(BusManifestPdf, { data, lang }));

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userRole: ctx.role,
      entityType: 'TripSchedule',
      entityId: id,
      action: 'EXPORT',
      details: `Manifest PDF (${lang.toUpperCase()}) exported for trip ${schedule.tripNumber ?? id.slice(0, 8)} — ${passengers.length} passengers.`,
    });

    const filename = `manifest-${data.manifestNo}.pdf`;
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    captureException(err, { context: 'bus-ops.manifest.pdf', tags: { scheduleId: id } });
    console.error('[manifest pdf] error:', err);
    return jsonErr('Failed to generate manifest', 500);
  }
}

function jsonErr(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
