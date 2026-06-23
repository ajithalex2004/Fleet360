/**
 * GET /api/school-bus/parent/today?guardianPhone=+971...
 *
 * Identity-by-phone-number lookup. Returns all students linked to this
 * guardian (either as guardian1 or guardian2), with their current trip
 * (if any), today's attendance status, and recent guardian notifications.
 *
 * No DB-level auth — guarded only by phone-as-identifier (matches the
 * STS Passenger PWA pattern; full magic-link auth deferred to v1.1).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGuardianNotificationsTable } from '@/lib/school-bus-notify';

export const runtime = 'nodejs';

interface StudentRow {
  id: string;
  student_code: string | null;
  first_name: string | null;
  last_name: string | null;
  grade: string | null;
  section: string | null;
  school_name: string | null;
  route_id: string | null;
  pickup_stop: string | null;
  dropoff_stop: string | null;
  rfid_card: string | null;
  photo_url: string | null;
  medical_notes: string | null;
}

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('guardianPhone')?.trim();
  if (!phone) {
    return NextResponse.json({ error: 'guardianPhone is required' }, { status: 400 });
  }

  // Normalise phone — strip non-digits except leading +
  const normalised = phone.startsWith('+')
    ? '+' + phone.slice(1).replace(/\D/g, '')
    : phone.replace(/\D/g, '');

  await ensureGuardianNotificationsTable();

  const students = await prisma.$queryRawUnsafe<StudentRow[]>(
    `SELECT id, student_code, first_name, last_name, grade, section,
            school_name, route_id, pickup_stop, dropoff_stop, rfid_card,
            photo_url, medical_notes
     FROM school_bus_students
     WHERE deleted_at IS NULL AND is_active = true
       AND (guardian1_phone = $1 OR guardian2_phone = $1
         OR guardian1_phone = $2 OR guardian2_phone = $2)
     ORDER BY first_name ASC`,
    phone, normalised,
  ).catch(() => [] as StudentRow[]);

  if (students.length === 0) {
    return NextResponse.json({ guardianPhone: phone, students: [] });
  }

  const studentIds = students.map(s => s.id);
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

  // Pull today's attendance per student
  const attendance = await prisma.$queryRawUnsafe<Array<{
    student_id: string; session_type: string; status: string; boarded_at: string | null; reason: string | null;
  }>>(
    `SELECT student_id, session_type, status, boarded_at::text, reason
     FROM school_bus_attendance
     WHERE student_id = ANY($1::uuid[])
       AND date = CURRENT_DATE`,
    studentIds,
  ).catch(() => []);
  const attendanceByStudent = new Map<string, typeof attendance>();
  for (const a of attendance) {
    const arr = attendanceByStudent.get(a.student_id) ?? [];
    arr.push(a);
    attendanceByStudent.set(a.student_id, arr);
  }

  // Pull today's trips on each student's route (if they have one)
  const routeIds = [...new Set(students.map(s => s.route_id).filter(Boolean) as string[])];
  const trips = routeIds.length > 0
    ? await prisma.$queryRawUnsafe<Array<{
        id: string; route_id: string; status: string; session_type: string;
        scheduled_departure: string; actual_departure: string | null;
        actual_arrival: string | null;
      }>>(
        `SELECT id, route_id, status, session_type,
                scheduled_departure::text, actual_departure::text, actual_arrival::text
         FROM school_bus_trips
         WHERE route_id = ANY($1::uuid[])
           AND scheduled_departure >= $2::timestamptz
           AND scheduled_departure < $3::timestamptz`,
        routeIds, startOfDay, endOfDay,
      ).catch(() => [])
    : [];
  const tripsByRoute = new Map<string, typeof trips>();
  for (const t of trips) {
    const arr = tripsByRoute.get(t.route_id) ?? [];
    arr.push(t);
    tripsByRoute.set(t.route_id, arr);
  }

  // Recent guardian notifications (last 7 days) per student
  const notifications = await prisma.$queryRawUnsafe<Array<{
    student_id: string; kind: string; subject: string | null; sent_at: string;
    reached_guardian1: boolean; reached_guardian2: boolean;
  }>>(
    `SELECT student_id::text, kind, subject, sent_at::text, reached_guardian1, reached_guardian2
     FROM school_bus_guardian_notifications
     WHERE student_id = ANY($1::uuid[])
       AND sent_at >= NOW() - INTERVAL '7 days'
     ORDER BY sent_at DESC
     LIMIT 50`,
    studentIds,
  ).catch(() => []);
  const notifByStudent = new Map<string, typeof notifications>();
  for (const n of notifications) {
    const arr = notifByStudent.get(n.student_id) ?? [];
    arr.push(n);
    notifByStudent.set(n.student_id, arr);
  }

  return NextResponse.json({
    guardianPhone: phone,
    students: students.map(s => ({
      studentId: s.id,
      studentCode: s.student_code,
      firstName: s.first_name,
      lastName: s.last_name,
      grade: s.grade,
      section: s.section,
      schoolName: s.school_name,
      photoUrl: s.photo_url,
      pickupStop: s.pickup_stop,
      dropoffStop: s.dropoff_stop,
      rfidCard: s.rfid_card ? '••••' + s.rfid_card.slice(-4) : null,
      medicalNotes: s.medical_notes,
      hasMedicalAlert: Boolean(s.medical_notes && s.medical_notes.trim().length > 0),
      attendance: attendanceByStudent.get(s.id) ?? [],
      trips: s.route_id ? (tripsByRoute.get(s.route_id) ?? []) : [],
      notifications: notifByStudent.get(s.id) ?? [],
    })),
  });
}
