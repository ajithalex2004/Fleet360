import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Auto-creates `school_bus_attendance` table.
 * GET  /api/school-bus/attendance?date=YYYY-MM-DD&routeId=&sessionType=
 * POST /api/school-bus/attendance  — mark single student or bulk
 *
 * sessionType: MORNING | AFTERNOON
 * status:      PRESENT | ABSENT | LATE | EXCUSED
 */

async function ensureTable() {
  // Ensure students table exists first
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS school_bus_students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_code TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      date_of_birth DATE, grade TEXT, section TEXT, school_name TEXT,
      route_id UUID, pickup_stop TEXT, dropoff_stop TEXT, rfid_card TEXT,
      guardian1_name TEXT, guardian1_phone TEXT, guardian1_email TEXT,
      guardian2_name TEXT, guardian2_phone TEXT, guardian2_email TEXT,
      medical_notes TEXT, photo_url TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
      enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS school_bus_attendance (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id   UUID        NOT NULL REFERENCES school_bus_students(id) ON DELETE CASCADE,
      date         DATE        NOT NULL DEFAULT CURRENT_DATE,
      session_type TEXT        NOT NULL DEFAULT 'MORNING',  -- MORNING | AFTERNOON
      status       TEXT        NOT NULL DEFAULT 'ABSENT',   -- PRESENT | ABSENT | LATE | EXCUSED
      scanned_at   TIMESTAMPTZ,
      boarded_at   TIMESTAMPTZ,
      dropped_at   TIMESTAMPTZ,
      trip_id      UUID,
      marked_by    TEXT,
      notes        TEXT,
      notified_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (student_id, date, session_type)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_sba_date_route ON school_bus_attendance(date)
  `);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const date        = searchParams.get('date')        ?? new Date().toISOString().slice(0, 10);
    const routeId     = searchParams.get('routeId')     ?? '';
    const sessionType = searchParams.get('sessionType') ?? 'MORNING';
    const q           = searchParams.get('q')?.trim()   ?? '';

    type AttendanceRow = {
      id: string | null; student_id: string; student_code: string;
      first_name: string; last_name: string; grade: string | null; section: string | null;
      route_id: string | null; route_name: string | null; pickup_stop: string | null;
      guardian1_name: string | null; guardian1_phone: string | null;
      rfid_card: string | null; medical_notes: string | null;
      att_status: string | null; scanned_at: string | null; boarded_at: string | null;
      dropped_at: string | null; notified_at: string | null; notes: string | null;
      att_id: string | null;
    };

    const conditions: string[] = ['s.deleted_at IS NULL', 's.is_active = true'];
    const params: unknown[] = [date, sessionType];
    let pi = 3;

    if (routeId) { conditions.push(`s.route_id = $${pi++}`); params.push(routeId); }
    if (q)       { conditions.push(`(s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi} OR s.student_code ILIKE $${pi})`); params.push(`%${q}%`); pi++; }

    const rows = await prisma.$queryRawUnsafe<AttendanceRow[]>(
      `SELECT
          a.id AS att_id,
          s.id AS student_id, s.student_code, s.first_name, s.last_name,
          s.grade, s.section, s.route_id, r.name AS route_name, s.pickup_stop,
          s.guardian1_name, s.guardian1_phone, s.rfid_card, s.medical_notes,
          COALESCE(a.status, 'ABSENT') AS att_status,
          a.scanned_at, a.boarded_at, a.dropped_at, a.notified_at, a.notes
       FROM school_bus_students s
       LEFT JOIN bus_routes r ON r.id = s.route_id
       LEFT JOIN school_bus_attendance a
         ON a.student_id = s.id AND a.date = $1 AND a.session_type = $2
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.last_name, s.first_name`,
      ...params
    ).catch(() => [] as AttendanceRow[]);

    const present  = rows.filter(r => r.att_status === 'PRESENT').length;
    const absent   = rows.filter(r => r.att_status === 'ABSENT').length;
    const late     = rows.filter(r => r.att_status === 'LATE').length;
    const excused  = rows.filter(r => r.att_status === 'EXCUSED').length;
    const notified = rows.filter(r => r.notified_at).length;

    return NextResponse.json({
      date, sessionType,
      summary: { total: rows.length, present, absent, late, excused, notified },
      records: rows.map(r => ({
        attendanceId:   r.att_id,
        studentId:      r.student_id,
        studentCode:    r.student_code,
        firstName:      r.first_name,
        lastName:       r.last_name,
        fullName:       `${r.first_name} ${r.last_name}`,
        grade:          r.grade,
        section:        r.section,
        routeId:        r.route_id,
        routeName:      r.route_name,
        pickupStop:     r.pickup_stop,
        guardian1Name:  r.guardian1_name,
        guardian1Phone: r.guardian1_phone,
        rfidCard:       r.rfid_card,
        medicalNotes:   r.medical_notes,
        status:         r.att_status ?? 'ABSENT',
        scannedAt:      r.scanned_at,
        boardedAt:      r.boarded_at,
        droppedAt:      r.dropped_at,
        notifiedAt:     r.notified_at,
        notes:          r.notes,
      })),
    });
  } catch (err) {
    console.error('[school-bus/attendance GET]', err);
    return NextResponse.json({ error: 'Failed to load attendance' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { action } = body;

    // action: 'mark' | 'bulk_mark' | 'notify_absent'

    if (action === 'mark') {
      const { studentId, date, sessionType, status, notes, boardedAt, droppedAt } = body;
      if (!studentId || !date || !sessionType || !status) {
        return NextResponse.json({ error: 'studentId, date, sessionType, status required' }, { status: 400 });
      }

      type AttRow = { id: string };
      const [att] = await prisma.$queryRawUnsafe<AttRow[]>(
        `INSERT INTO school_bus_attendance (student_id, date, session_type, status, notes, boarded_at, dropped_at, scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (student_id, date, session_type)
         DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes,
           boarded_at = COALESCE(EXCLUDED.boarded_at, school_bus_attendance.boarded_at),
           dropped_at = COALESCE(EXCLUDED.dropped_at, school_bus_attendance.dropped_at),
           scanned_at = NOW(), updated_at = NOW()
         RETURNING id`,
        studentId, date, sessionType, status, notes || null, boardedAt || null, droppedAt || null
      );
      return NextResponse.json({ id: att.id, ok: true });
    }

    if (action === 'bulk_mark') {
      // marks all students with same status (e.g., mark all present at start of route)
      const { studentIds, date, sessionType, status } = body;
      if (!studentIds?.length || !date || !sessionType || !status) {
        return NextResponse.json({ error: 'studentIds, date, sessionType, status required' }, { status: 400 });
      }
      let count = 0;
      for (const sid of studentIds) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO school_bus_attendance (student_id, date, session_type, status, scanned_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (student_id, date, session_type)
           DO UPDATE SET status = EXCLUDED.status, scanned_at = NOW(), updated_at = NOW()`,
          sid, date, sessionType, status
        ).catch(() => {});
        count++;
      }
      return NextResponse.json({ count, ok: true });
    }

    if (action === 'notify_absent') {
      // Simulate notifying guardians of absent students
      const { date, sessionType, routeId } = body;
      const conditions = ['a.status = \'ABSENT\'', 'a.notified_at IS NULL', `a.date = $1`, `a.session_type = $2`];
      const params: unknown[] = [date, sessionType];
      if (routeId) { conditions.push(`s.route_id = $3`); params.push(routeId); }

      type AbsentRow = { att_id: string; student_id: string; first_name: string; last_name: string; guardian1_phone: string | null };
      const absentStudents = await prisma.$queryRawUnsafe<AbsentRow[]>(
        `SELECT a.id AS att_id, s.id AS student_id, s.first_name, s.last_name, s.guardian1_phone
           FROM school_bus_attendance a
           JOIN school_bus_students s ON s.id = a.student_id
          WHERE ${conditions.join(' AND ')}`,
        ...params
      ).catch(() => [] as AbsentRow[]);

      // Mark as notified (in a real system, this would trigger WhatsApp/SMS)
      for (const s of absentStudents) {
        await prisma.$executeRawUnsafe(
          `UPDATE school_bus_attendance SET notified_at = NOW(), updated_at = NOW() WHERE id = $1`,
          s.att_id
        ).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        notified: absentStudents.length,
        students: absentStudents.map(s => ({
          name: `${s.first_name} ${s.last_name}`,
          phone: s.guardian1_phone,
        })),
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[school-bus/attendance POST]', err);
    return NextResponse.json({ error: 'Failed to save attendance' }, { status: 500 });
  }
}
