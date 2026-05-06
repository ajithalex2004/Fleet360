/**
 * POST /api/school-bus/attendance/sweep-no-show
 *
 * Run during the morning trip window (e.g. every 5 min between 06:00 and
 * 09:00). For each IN_PROGRESS morning trip, find every active student
 * on its route who:
 *   - is NOT marked EXCUSED for today
 *   - has NOT been BOARDED yet (no school_bus_attendance row with status PRESENT)
 *   - the bus has already departed >= minAfterDepartureMins ago
 *
 * Notifies guardians (with escalation to guardian2) and writes an
 * attendance row marking ABSENT with reason "AUTO_NO_SHOW".
 *
 * Idempotent: refuses to re-fire on a student who already has an
 * attendance row for the day.
 *
 * Auth: optional CRON_SECRET Bearer.
 * Query: ?dryRun=1 to preview, ?minAfterDepartureMins=N (default 15).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadStudentForNotify, notifyGuardians, ensureGuardianNotificationsTable } from '@/lib/school-bus-notify';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface TripRow {
  id: string;
  route_id: string;
  scheduled_departure: string;
  actual_departure: string | null;
  session_type: string | null;
  status: string;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !req.headers.get('x-tenant-id')) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    const sp = req.nextUrl.searchParams;
    const dryRun = sp.get('dryRun') === '1';
    const minAfterDepartureMins = Math.max(5, Number(sp.get('minAfterDepartureMins') ?? 15));

    await ensureGuardianNotificationsTable();
    const todayDate = new Date().toISOString().slice(0, 10);

    // 1. Find IN_PROGRESS morning trips where we're past the threshold.
    const trips = await prisma.$queryRawUnsafe<TripRow[]>(
      `SELECT id::text, route_id::text, scheduled_departure::text,
              actual_departure::text, session_type, status
       FROM school_bus_trips
       WHERE status IN ('IN_PROGRESS', 'COMPLETED')
         AND DATE(scheduled_departure) = $1::date
         AND session_type = 'MORNING'
         AND actual_departure IS NOT NULL
         AND actual_departure <= NOW() - ($2 || ' minutes')::interval`,
      todayDate, String(minAfterDepartureMins),
    ).catch(() => [] as TripRow[]);

    if (trips.length === 0) {
      return NextResponse.json({
        dryRun, runAt: new Date().toISOString(),
        tripsScanned: 0, students: 0, notified: 0, errors: 0,
        message: 'No qualifying trips this run.',
      });
    }

    interface Assessment {
      tripId: string;
      studentId: string;
      studentName: string | null;
      stopName: string | null;
      reason: 'no_attendance_row' | 'recorded_absent';
    }
    const assessments: Assessment[] = [];

    for (const trip of trips) {
      // Active students on the route.
      const routeStudents = await prisma.$queryRawUnsafe<Array<{
        id: string; first_name: string | null; last_name: string | null;
        pickup_stop: string | null;
      }>>(
        `SELECT id::text, first_name, last_name, pickup_stop
         FROM school_bus_students
         WHERE route_id = $1::uuid AND deleted_at IS NULL AND is_active = true`,
        trip.route_id,
      ).catch(() => [] as Array<{ id: string; first_name: string | null; last_name: string | null; pickup_stop: string | null }>);

      if (routeStudents.length === 0) continue;

      // Today's attendance for this trip's session.
      const att = await prisma.$queryRawUnsafe<Array<{ student_id: string; status: string }>>(
        `SELECT student_id::text, status FROM school_bus_attendance
         WHERE date = $1::date AND session_type = $2
           AND student_id = ANY($3::uuid[])`,
        todayDate, trip.session_type ?? 'MORNING',
        routeStudents.map(s => s.id),
      ).catch(() => [] as Array<{ student_id: string; status: string }>);
      const attByStudent = new Map(att.map(a => [a.student_id, a.status]));

      for (const s of routeStudents) {
        const status = attByStudent.get(s.id);
        if (status === 'EXCUSED' || status === 'PRESENT' || status === 'LATE') continue;

        assessments.push({
          tripId: trip.id,
          studentId: s.id,
          studentName: [s.first_name, s.last_name].filter(Boolean).join(' ') || null,
          stopName: s.pickup_stop,
          reason: status === 'ABSENT' ? 'recorded_absent' : 'no_attendance_row',
        });
      }
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true, runAt: new Date().toISOString(),
        tripsScanned: trips.length, candidates: assessments.length, assessments,
      });
    }

    let notified = 0;
    let errors = 0;
    for (const a of assessments) {
      try {
        // Mark ABSENT (auto) if no row yet.
        if (a.reason === 'no_attendance_row') {
          await prisma.$executeRawUnsafe(
            `INSERT INTO school_bus_attendance (student_id, date, session_type, status, reason)
             VALUES ($1::uuid, $2::date, 'MORNING', 'ABSENT', 'AUTO_NO_SHOW')
             ON CONFLICT (student_id, date, session_type) DO NOTHING`,
            a.studentId, todayDate,
          );
        }

        // Skip if we've already notified for this student+kind today.
        const alreadyNotified = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM school_bus_guardian_notifications
           WHERE student_id = $1::uuid AND kind = 'NO_SHOW'
             AND sent_at::date = CURRENT_DATE
           LIMIT 1`,
          a.studentId,
        ).catch(() => [] as Array<{ id: string }>);
        if (alreadyNotified.length > 0) continue;

        const student = await loadStudentForNotify(a.studentId);
        if (!student) continue;

        const result = await notifyGuardians('NO_SHOW', student, {
          stopName: a.stopName,
          whenLabel: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        });
        if (result.ok) notified += 1;
      } catch (err) {
        errors += 1;
        captureException(err, { context: 'school-bus.sweep-no-show.apply', tags: { studentId: a.studentId } });
      }
    }

    if (notified > 0) {
      void logAudit({
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'SchoolBusAttendance',
        action: 'UPDATE',
        details: `No-show sweep: ${trips.length} trips scanned, ${assessments.length} candidates, ${notified} guardians notified, ${errors} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false, runAt: new Date().toISOString(),
      tripsScanned: trips.length,
      candidates: assessments.length,
      notified, errors,
      assessments,
    });
  } catch (err) {
    captureException(err, { context: 'school-bus.sweep-no-show' });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
