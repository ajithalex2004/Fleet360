/**
 * POST /api/school-bus/parent/absence
 *
 * Body: { studentId, date: YYYY-MM-DD, sessionType: MORNING|AFTERNOON|BOTH, reason }
 *
 * Marks a child absent for the given date so the bus skips their stop.
 * Upserts into school_bus_attendance with status=EXCUSED + reason prefix
 * "PARENT_ABSENCE: <reason>".
 *
 * Idempotent. Best-effort (table auto-created).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const ALLOWED_SESSIONS = ['MORNING', 'AFTERNOON', 'BOTH'] as const;
type Session = typeof ALLOWED_SESSIONS[number];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const studentId = String(body?.studentId ?? '').trim();
    const date = String(body?.date ?? '').trim();
    const sessionType = String(body?.sessionType ?? '').toUpperCase() as Session;
    const reason = String(body?.reason ?? '').trim();

    if (!studentId) return NextResponse.json({ error: 'studentId is required' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    if (!ALLOWED_SESSIONS.includes(sessionType)) {
      return NextResponse.json({ error: `sessionType must be one of: ${ALLOWED_SESSIONS.join(', ')}` }, { status: 400 });
    }

    // Reject past dates (only future / today absences supported).
    const target = new Date(date + 'T00:00:00');
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    if (target < todayStart) {
      return NextResponse.json({ error: 'Cannot mark absence for a past date' }, { status: 400 });
    }

    // Verify student exists.
    const exists = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM school_bus_students WHERE id = $1::uuid AND deleted_at IS NULL AND is_active = true`,
      studentId,
    ).catch(() => []);
    if (exists.length === 0) return NextResponse.json({ error: 'Student not found' }, { status: 404 });

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

    const sessions: Array<'MORNING' | 'AFTERNOON'> = sessionType === 'BOTH'
      ? ['MORNING', 'AFTERNOON']
      : [sessionType as 'MORNING' | 'AFTERNOON'];

    const reasonText = reason
      ? `PARENT_ABSENCE: ${reason}`
      : 'PARENT_ABSENCE';

    for (const s of sessions) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO school_bus_attendance (student_id, date, session_type, status, reason)
         VALUES ($1::uuid, $2::date, $3, 'EXCUSED', $4)
         ON CONFLICT (student_id, date, session_type)
         DO UPDATE SET status = 'EXCUSED', reason = EXCLUDED.reason`,
        studentId, date, s, reasonText,
      );
    }

    void logAudit({
      userId: req.headers.get('x-user-id') ?? `parent:${studentId.slice(0, 8)}`,
      userRole: 'GUARDIAN',
      entityType: 'SchoolBusAttendance',
      entityId: studentId,
      action: 'UPDATE',
      details: `Parent-marked absence: student ${studentId} ${date} ${sessionType}${reason ? ` (${reason})` : ''}`,
    });

    return NextResponse.json({
      ok: true, studentId, date, sessions, status: 'EXCUSED',
    });
  } catch (err) {
    captureException(err, { context: 'school-bus.parent.absence' });
    return NextResponse.json({ error: 'Absence marking failed' }, { status: 500 });
  }
}
