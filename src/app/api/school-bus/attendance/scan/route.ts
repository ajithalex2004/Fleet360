/**
 * POST /api/school-bus/attendance/scan
 *
 * Driver/attendant scans a student's RFID card OR enters their student
 * code. Resolves the student, writes attendance + a BOARDING|ALIGHTING
 * trip event (which auto-fires guardian notify via the existing hook
 * in /api/school-bus/trips/[id]/events).
 *
 * Body:
 *   {
 *     tripId: UUID,
 *     scanType: 'BOARDING' | 'ALIGHTING',
 *     rfidCard?: string,        // either rfidCard...
 *     studentCode?: string,     // ...or studentCode required
 *     stopName?: string,
 *     lat?: number, lng?: number,
 *     scannedBy?: string,       // driver/attendant identifier
 *   }
 *
 * Idempotent for same student + same trip + same scanType (last 60s
 * dedup window so accidental double-taps don't fire two notifications).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface StudentRow {
  id: string;
  student_code: string;
  first_name: string;
  last_name: string;
  route_id: string | null;
  pickup_stop: string | null;
  dropoff_stop: string | null;
  medical_notes: string | null;
}

interface TripRow {
  id: string;
  route_id: string;
  session_type: string;
  status: string;
  tenant_id: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tripId = String(body?.tripId ?? '').trim();
    const scanType = String(body?.scanType ?? '').toUpperCase();
    const rfidCard = body?.rfidCard ? String(body.rfidCard).trim() : null;
    const studentCode = body?.studentCode ? String(body.studentCode).trim() : null;
    const stopName = body?.stopName ? String(body.stopName).trim() : null;
    const scannedBy = body?.scannedBy ? String(body.scannedBy) : null;

    if (!tripId) return NextResponse.json({ error: 'tripId is required' }, { status: 400 });
    if (!['BOARDING', 'ALIGHTING'].includes(scanType)) {
      return NextResponse.json({ error: 'scanType must be BOARDING or ALIGHTING' }, { status: 400 });
    }
    if (!rfidCard && !studentCode) {
      return NextResponse.json({ error: 'rfidCard or studentCode is required' }, { status: 400 });
    }

    // Lookup student
    const studentRows = await prisma.$queryRawUnsafe<StudentRow[]>(
      rfidCard
        ? `SELECT id::text, student_code, first_name, last_name, route_id::text, pickup_stop, dropoff_stop, medical_notes
           FROM school_bus_students
           WHERE rfid_card = $1 AND deleted_at IS NULL AND is_active = true LIMIT 1`
        : `SELECT id::text, student_code, first_name, last_name, route_id::text, pickup_stop, dropoff_stop, medical_notes
           FROM school_bus_students
           WHERE student_code = $1 AND deleted_at IS NULL AND is_active = true LIMIT 1`,
      rfidCard ?? studentCode,
    ).catch(() => []);

    if (studentRows.length === 0) {
      return NextResponse.json({
        error: rfidCard ? `Unknown RFID card: ${rfidCard}` : `Unknown student code: ${studentCode}`,
      }, { status: 404 });
    }
    const student = studentRows[0];

    // Lookup trip + verify it's on the right route
    const tripRows = await prisma.$queryRawUnsafe<TripRow[]>(
      `SELECT id::text, route_id::text, session_type, status, tenant_id FROM school_bus_trips WHERE id = $1::uuid`,
      tripId,
    ).catch(() => []);
    if (tripRows.length === 0) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    const trip = tripRows[0];
    if (['CANCELLED', 'COMPLETED'].includes(trip.status) && scanType === 'BOARDING') {
      return NextResponse.json({ error: `Trip is ${trip.status} — cannot board` }, { status: 409 });
    }
    if (student.route_id && student.route_id !== trip.route_id) {
      return NextResponse.json({
        error: 'Student is not on this trip\'s route',
        studentRouteId: student.route_id,
        tripRouteId: trip.route_id,
      }, { status: 409 });
    }

    // Idempotency: refuse same-direction scan within 60s
    const dedup = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM school_bus_trip_events
       WHERE trip_id = $1::uuid AND student_id = $2::uuid AND event_type = $3
         AND event_time > NOW() - INTERVAL '60 seconds'
       LIMIT 1`,
      tripId, student.id, scanType,
    ).catch(() => [] as Array<{ id: string }>);
    if (dedup.length > 0) {
      return NextResponse.json({
        ok: true, deduplicated: true,
        message: 'Same scan recorded within last 60s — skipped',
        student: { id: student.id, name: `${student.first_name} ${student.last_name}` },
      });
    }

    // Insert attendance row (PRESENT for BOARDING). For ALIGHTING we don't
    // change attendance — student already had it from BOARDING.
    if (scanType === 'BOARDING') {
      const today = new Date().toISOString().slice(0, 10);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS school_bus_attendance (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL,
          date DATE NOT NULL,
          session_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ABSENT',
          boarded_at TIMESTAMPTZ,
          scanned_at TIMESTAMPTZ,
          reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (student_id, date, session_type)
        )
      `);
      await prisma.$executeRawUnsafe(
        `INSERT INTO school_bus_attendance
           (student_id, date, session_type, status, boarded_at, scanned_at, reason)
         VALUES ($1::uuid, $2::date, $3, 'PRESENT', NOW(), NOW(), $4)
         ON CONFLICT (student_id, date, session_type)
         DO UPDATE SET status='PRESENT', boarded_at=NOW(), scanned_at=NOW(),
                       reason=EXCLUDED.reason`,
        student.id, today, trip.session_type ?? 'MORNING',
        rfidCard ? 'RFID' : 'CODE',
      );
    }

    // Create the trip event — this triggers the guardian-notify hook in
    // the events route. We post via fetch to that handler so the hook
    // fires, OR insert directly to avoid an extra round-trip. Direct
    // insert + manual notify call is more reliable here.
    await prisma.$executeRawUnsafe(`
      INSERT INTO school_bus_trip_events
        (tenant_id, trip_id, event_type, event_time,
         lat, lng, stop_name, student_id, student_name, description, metadata)
      VALUES ($1, $2::uuid, $3, NOW(), $4, $5, $6, $7::uuid, $8, $9, $10::jsonb)
    `,
      trip.tenant_id ?? 'default', tripId, scanType,
      body?.lat ?? null, body?.lng ?? null, stopName,
      student.id, `${student.first_name} ${student.last_name}`,
      `Scan via ${rfidCard ? 'RFID' : 'CODE'} by ${scannedBy ?? 'attendant'}`,
      JSON.stringify({ rfidCard, studentCode, scannedBy }),
    );

    // Bump trip counter (mirrors the events POST handler)
    if (scanType === 'BOARDING') {
      await prisma.$executeRawUnsafe(
        `UPDATE school_bus_trips SET students_boarded = students_boarded + 1, updated_at = NOW() WHERE id = $1::uuid`,
        tripId,
      ).catch(() => {});
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE school_bus_trips SET students_dropped = students_dropped + 1, updated_at = NOW() WHERE id = $1::uuid`,
        tripId,
      ).catch(() => {});
    }

    // Fire guardian notification (re-uses school-bus-notify lib)
    const { loadStudentForNotify, notifyGuardians } = await import('@/lib/school-bus-notify');
    const studentForNotify = await loadStudentForNotify(student.id);
    if (studentForNotify) {
      void notifyGuardians(scanType === 'BOARDING' ? 'BOARDED' : 'ALIGHTED', studentForNotify, {
        stopName,
        whenLabel: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      });
    }

    void logAudit({
      userId: scannedBy ?? req.headers.get('x-user-id') ?? 'driver:unknown',
      userRole: 'DRIVER',
      entityType: 'SchoolBusTripEvent',
      entityId: tripId,
      action: 'CREATE',
      details: `${scanType} scan: ${student.first_name} ${student.last_name} (${student.student_code}) via ${rfidCard ? 'RFID' : 'CODE'}${stopName ? ` at ${stopName}` : ''}`,
    });

    return NextResponse.json({
      ok: true,
      student: {
        id: student.id,
        studentCode: student.student_code,
        name: `${student.first_name} ${student.last_name}`,
        pickupStop: student.pickup_stop,
        dropoffStop: student.dropoff_stop,
        hasMedicalAlert: Boolean(student.medical_notes && student.medical_notes.trim().length > 0),
        medicalNotes: student.medical_notes,
      },
      scanType,
      stopName,
    });
  } catch (err) {
    captureException(err, { context: 'school-bus.attendance.scan' });
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
