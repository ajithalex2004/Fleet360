import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * PATCH /api/ambulance/calls/[id]  — advance status or update fields
 */

const NEXT_STATUS: Record<string, string> = {
  CALL_RECEIVED: 'DISPATCHED',
  DISPATCHED:    'ON_SCENE',
  ON_SCENE:      'TRANSPORTING',
  TRANSPORTING:  'AT_HOSPITAL',
  AT_HOSPITAL:   'CLEARED',
};

const STATUS_TIMESTAMP: Record<string, string> = {
  DISPATCHED:   'dispatched_at',
  ON_SCENE:     'on_scene_at',
  TRANSPORTING: 'transport_start_at',
  AT_HOSPITAL:  'at_hospital_at',
  CLEARED:      'cleared_at',
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'advance') {
      // Look up current status
      type StatusRow = { status: string; call_received_at: string; dispatched_at: string | null };
      const [call] = await prisma.$queryRawUnsafe<StatusRow[]>(
        `SELECT status, call_received_at, dispatched_at FROM ambulance_calls WHERE id = $1`,
        params.id
      );
      if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 });

      const nextStatus = NEXT_STATUS[call.status];
      if (!nextStatus) return NextResponse.json({ error: 'No next status available' }, { status: 400 });

      const tsField = STATUS_TIMESTAMP[nextStatus];
      const extras: string[] = [];
      const vals: unknown[]  = [nextStatus, params.id];

      // Auto-compute response time when reaching ON_SCENE
      if (nextStatus === 'ON_SCENE' && call.dispatched_at) {
        const respMin = Math.round((Date.now() - new Date(call.dispatched_at).getTime()) / 60000);
        extras.push(`response_time_min = ${respMin}`);
      }
      // Auto-compute scene time when starting TRANSPORTING
      if (nextStatus === 'TRANSPORTING' && call.call_received_at) {
        const sceneMin = Math.round((Date.now() - new Date(call.call_received_at).getTime()) / 60000);
        extras.push(`scene_time_min = ${sceneMin}`);
      }

      const setClause = [
        `status = $1`,
        tsField ? `${tsField} = NOW()` : null,
        `updated_at = NOW()`,
        ...extras,
      ].filter(Boolean).join(', ');

      await prisma.$executeRawUnsafe(
        `UPDATE ambulance_calls SET ${setClause} WHERE id = $2`,
        ...vals
      );

      // When cleared: mark vehicle as AVAILABLE again
      if (nextStatus === 'CLEARED') {
        const [v] = await prisma.$queryRawUnsafe<[{ vehicle_id: string | null }]>(
          `SELECT vehicle_id FROM ambulance_calls WHERE id = $1`, params.id
        );
        if (v?.vehicle_id) {
          await prisma.$executeRawUnsafe(
            `UPDATE vehicles SET status = 'AVAILABLE', updated_at = NOW() WHERE id = $1`, v.vehicle_id
          ).catch(() => {});
        }
      }

      return NextResponse.json({ ok: true, newStatus: nextStatus });
    }

    if (action === 'assign') {
      const { vehicleId, driverId, paramedicName } = body;
      await prisma.$executeRawUnsafe(
        `UPDATE ambulance_calls
            SET vehicle_id = $1, driver_id = $2, paramedic_name = $3,
                status = 'DISPATCHED', dispatched_at = NOW(), updated_at = NOW()
          WHERE id = $4`,
        vehicleId || null, driverId || null, paramedicName || null, params.id
      );
      // Mark vehicle as DISPATCHED
      if (vehicleId) {
        await prisma.$executeRawUnsafe(
          `UPDATE vehicles SET status = 'DISPATCHED', updated_at = NOW() WHERE id = $1`, vehicleId
        ).catch(() => {});
      }
      return NextResponse.json({ ok: true, newStatus: 'DISPATCHED' });
    }

    if (action === 'update') {
      const { notes, destination, patientName, patientAge, patientGender, chiefComplaint } = body;
      await prisma.$executeRawUnsafe(
        `UPDATE ambulance_calls
            SET notes = COALESCE($1, notes),
                destination = COALESCE($2, destination),
                patient_name = COALESCE($3, patient_name),
                patient_age = COALESCE($4, patient_age),
                patient_gender = COALESCE($5, patient_gender),
                chief_complaint = COALESCE($6, chief_complaint),
                updated_at = NOW()
          WHERE id = $7`,
        notes, destination, patientName, patientAge, patientGender, chiefComplaint, params.id
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[ambulance/calls/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update call' }, { status: 500 });
  }
}
