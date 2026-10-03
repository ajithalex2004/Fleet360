import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireBusOpsRequest, ownsBusOpsEmployee } from '@/lib/bus-ops/access';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { verifyQrToken, normaliseNfcUid, normaliseBleUuid } from '@/lib/bus-checkin';
import { recordBoarding, recordAlighting } from '@/lib/bus-ops/passenger-attendance';
import { writeRequiredAudit } from '@/lib/audit';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const input = z.object({
  method: z.enum(['QR','NFC','BLE','MANUAL']), direction: z.enum(['BOARD','ALIGHT']).default('BOARD'),
  token: z.string().max(4096).optional(), scheduleId: z.string().min(1).optional(),
  staffMemberId: z.string().min(1).optional(), staffEmployeeId: z.string().min(1).optional(), passengerId: z.string().min(1).optional(),
  tagUid: z.string().max(200).optional(), beaconUuid: z.string().max(200).optional(), rssi: z.number().finite().optional(),
  stopId: z.string().min(1).optional(), performedAt: z.iso.datetime({ offset: true }).optional(),
}).strict();
export async function POST(req: NextRequest) {
  const refusal = await requireBusOpsRequest(req);
  if (refusal) return refusal;
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid check-in request' }, { status: 400 });
  const b = parsed.data;
  const performedAt = b.performedAt ? new Date(b.performedAt) : new Date();
  if (Math.abs(performedAt.getTime() - Date.now()) > 5 * 60_000) return NextResponse.json({ error: 'Check-in timestamp is outside the allowed window' }, { status: 400 });
  try {
    return await withTenantRls(prisma, auth.tenantId, async tx => {
      let scheduleId = b.scheduleId, staffMemberId = b.staffMemberId;
      let identifier: string | null = null;
      if (b.method === 'QR') {
        const verified = verifyQrToken(b.token ?? '');
        if (!verified.ok) return NextResponse.json({ error: 'Invalid QR token' }, { status: 400 });
        if (scheduleId && scheduleId !== verified.scheduleId) return NextResponse.json({ error: 'QR trip mismatch' }, { status: 400 });
        scheduleId = verified.scheduleId!;
        identifier = b.token ?? null;
      }
      if (!scheduleId) return NextResponse.json({ error: 'Trip is required' }, { status: 400 });
      await tx.$queryRawUnsafe('SELECT id FROM trip_schedules WHERE id::text = $1 AND tenant_id = $2 FOR UPDATE', scheduleId, auth.tenantId);
      const trip = await tx.tripSchedule.findFirst({ where: { id: scheduleId, tenantId: auth.tenantId, deletedAt: null, status: { in: ['SCHEDULED','STARTED','EN_ROUTE','DEPARTED','IN_TRANSIT'] } } });
      if (!trip) return NextResponse.json({ error: 'Eligible trip not found' }, { status: 404 });
      if (b.method === 'NFC') {
        identifier = normaliseNfcUid(b.tagUid ?? '');
        const tag = await tx.staffRfidTag.findFirst({ where: { tagUid: identifier, tenantId: auth.tenantId, isActive: true } });
        if (!tag || (staffMemberId && staffMemberId !== tag.staffMemberId)) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
        staffMemberId = tag.staffMemberId;
      }
      if (b.staffEmployeeId) {
        const employee = await tx.staffMember.findFirst({ where: { tenantId: auth.tenantId, employeeId: b.staffEmployeeId, deletedAt: null, isActive: true } });
        if (!employee || (staffMemberId && staffMemberId !== employee.id)) return NextResponse.json({ error: 'Employee mismatch' }, { status: 404 });
        staffMemberId = employee.id;
      }
      if (!b.passengerId && !staffMemberId) return NextResponse.json({ error: 'Passenger identity is required' }, { status: 400 });
      const passenger = await tx.tripPassenger.findFirst({ where: { tenantId: auth.tenantId, tripId: scheduleId, deletedAt: null,
        ...(b.passengerId ? { id: b.passengerId } : {}), ...(staffMemberId ? { staffMemberId } : {}) } });
      if (!passenger?.staffMemberId) return NextResponse.json({ error: 'Passenger not found on this trip' }, { status: 404 });
      const employee = await tx.staffMember.findFirst({ where: { id: passenger.staffMemberId, tenantId: auth.tenantId, deletedAt: null, isActive: true } });
      if (!employee || !await ownsBusOpsEmployee(req, employee.employeeId)) return NextResponse.json({ error: 'Passenger identity is not authorized' }, { status: 403 });
      if (b.method === 'BLE') {
        identifier = normaliseBleUuid(b.beaconUuid ?? '');
        const beacon = trip.vehicleId ? await tx.vehicleBeacon.findFirst({ where: { vehicleId: trip.vehicleId, tenantId: auth.tenantId, isActive: true, bleUuid: identifier } }) : null;
        if (!beacon) return NextResponse.json({ error: 'Beacon does not match trip' }, { status: 403 });
      }
      if (b.stopId && !await tx.routeStop.findFirst({ where: { id: b.stopId, routeId: trip.routeId, tenantId: auth.tenantId } })) return NextResponse.json({ error: 'Stop does not belong to trip route' }, { status: 400 });
      await tx.$queryRawUnsafe(`SELECT id FROM trip_passengers WHERE id::text = $1 AND tenant_id = $2 FOR UPDATE`, passenger.id, auth.tenantId);
      const context = { tenantId: auth.tenantId, scheduleId, passengerId: passenger.id, staffMemberId: employee.id, source: b.method,
        occurredAt: performedAt, performedBy: auth.userId, identifier, stopId: b.stopId, rawPayload: b as Prisma.InputJsonValue };
      const result = await (b.direction === 'BOARD' ? recordBoarding : recordAlighting)(tx, context);
      if (!result.applied && result.reason !== 'already in target state') return NextResponse.json({ error: result.reason }, { status: 409 });
      if (result.applied) await writeRequiredAudit({ tenantId: auth.tenantId, userId: auth.userId ?? undefined, entityType: 'TripPassenger', entityId: passenger.id, action: b.direction, details: `${b.method}; trip ${scheduleId}` }, tx);
      const updated = await tx.tripPassenger.findFirst({ where: { id: passenger.id, tenantId: auth.tenantId } });
      return NextResponse.json({ ok: true, applied: result.applied, passenger: updated });
    });
  } catch (error) {
    console.error('[bus-ops check-in] transaction failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'Check-in failed' }, { status: 500 });
  }
}
