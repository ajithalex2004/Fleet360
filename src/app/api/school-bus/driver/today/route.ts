/**
 * GET /api/school-bus/driver/today?driverCode=X
 *
 * Returns today's school-bus trips assigned to this driver, with the full
 * student manifest per trip (including medical alerts) and current
 * attendance state.
 *
 * Driver identity: school_bus_trips.driver_name field is currently a
 * free-text label (no FK). For v1.0 we match driverCode against either
 * `driver_id` (text) or `driver_name`. PWA stores it in localStorage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

interface TripRow {
  id: string;
  route_id: string;
  route_name: string | null;
  status: string;
  session_type: string | null;
  scheduled_departure: string;
  actual_departure: string | null;
  actual_arrival: string | null;
  vehicle_id: string | null;
  driver_name: string | null;
  students_boarded: number;
  students_dropped: number;
}

interface StudentRow {
  id: string;
  student_code: string;
  first_name: string | null;
  last_name: string | null;
  pickup_stop: string | null;
  dropoff_stop: string | null;
  rfid_card: string | null;
  photo_url: string | null;
  medical_notes: string | null;
  guardian1_name: string | null;
  guardian1_phone: string | null;
  guardian2_phone: string | null;
}

export async function GET(req: NextRequest) {
  const driverCode = req.nextUrl.searchParams.get('driverCode')?.trim();
  if (!driverCode) {
    return NextResponse.json({ error: 'driverCode is required' }, { status: 400 });
  }

  // Today range
  const todayDate = new Date().toISOString().slice(0, 10);

  // Trips assigned to this driver today (try driver_id first, fall back to driver_name)
  const trips = await prisma.$queryRawUnsafe<TripRow[]>(
    `SELECT t.id::text, t.route_id::text,
            r.route_name AS route_name,
            t.status, t.session_type,
            t.scheduled_departure::text, t.actual_departure::text, t.actual_arrival::text,
            t.vehicle_id::text, t.driver_name,
            COALESCE(t.students_boarded, 0) AS students_boarded,
            COALESCE(t.students_dropped, 0) AS students_dropped
     FROM school_bus_trips t
     LEFT JOIN school_bus_routes r ON r.id = t.route_id
     WHERE DATE(t.scheduled_departure) = $1::date
       AND (t.driver_id::text = $2 OR t.driver_name = $2)
     ORDER BY t.scheduled_departure ASC`,
    todayDate, driverCode,
  ).catch(() => [] as TripRow[]);

  if (trips.length === 0) {
    return NextResponse.json({ driverCode, trips: [], date: todayDate });
  }

  const routeIds = [...new Set(trips.map(t => t.route_id))];

  // Students per route
  const students = await prisma.$queryRawUnsafe<StudentRow[]>(
    `SELECT id::text, student_code, first_name, last_name,
            pickup_stop, dropoff_stop, rfid_card, photo_url, medical_notes,
            guardian1_name, guardian1_phone, guardian2_phone, route_id::text AS route_id
     FROM school_bus_students
     WHERE route_id = ANY($1::uuid[])
       AND deleted_at IS NULL AND is_active = true
     ORDER BY pickup_stop NULLS LAST, last_name, first_name`,
    routeIds,
  ).catch(() => [] as StudentRow[]) as Array<StudentRow & { route_id: string }>;

  // Today's attendance for these students
  const studentIds = students.map(s => s.id);
  const attendance = studentIds.length > 0
    ? await prisma.$queryRawUnsafe<Array<{ student_id: string; session_type: string; status: string; boarded_at: string | null }>>(
        `SELECT student_id::text, session_type, status, boarded_at::text
         FROM school_bus_attendance
         WHERE student_id = ANY($1::uuid[]) AND date = $2::date`,
        studentIds, todayDate,
      ).catch(() => [] as Array<{ student_id: string; session_type: string; status: string; boarded_at: string | null }>)
    : [];
  const attKey = (sid: string, session: string) => `${sid}|${session}`;
  const attMap = new Map(attendance.map(a => [attKey(a.student_id, a.session_type), a]));

  return NextResponse.json({
    driverCode,
    date: todayDate,
    trips: trips.map(t => {
      const tripStudents = students
        .filter(s => s.route_id === t.route_id)
        .map(s => {
          const att = attMap.get(attKey(s.id, t.session_type ?? 'MORNING'));
          return {
            studentId: s.id,
            studentCode: s.student_code,
            name: [s.first_name, s.last_name].filter(Boolean).join(' '),
            pickupStop: s.pickup_stop,
            dropoffStop: s.dropoff_stop,
            rfidCardLast4: s.rfid_card ? '••••' + s.rfid_card.slice(-4) : null,
            photoUrl: s.photo_url,
            hasMedicalAlert: Boolean(s.medical_notes && s.medical_notes.trim().length > 0),
            medicalNotes: s.medical_notes,
            guardian1Name: s.guardian1_name,
            guardian1Phone: s.guardian1_phone,
            guardian2Phone: s.guardian2_phone,
            attendance: att ? { status: att.status, boardedAt: att.boarded_at } : { status: 'PENDING', boardedAt: null },
          };
        });
      return {
        ...t,
        students: tripStudents,
        totalStudents: tripStudents.length,
        boardedCount: tripStudents.filter(s => s.attendance.status === 'PRESENT').length,
        excusedCount: tripStudents.filter(s => s.attendance.status === 'EXCUSED').length,
        absentCount: tripStudents.filter(s => s.attendance.status === 'ABSENT').length,
        medicalAlertCount: tripStudents.filter(s => s.hasMedicalAlert).length,
      };
    }),
  });
}
