import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET    /api/school-bus/students/[id]  — single student detail
 * PATCH  /api/school-bus/students/[id]  — update student
 * DELETE /api/school-bus/students/[id]  — soft-delete (archive)
 */

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    type StudentDetail = {
      id: string; student_code: string; first_name: string; last_name: string;
      date_of_birth: string | null; grade: string | null; section: string | null;
      school_name: string | null; route_id: string | null; route_name: string | null;
      pickup_stop: string | null; dropoff_stop: string | null; rfid_card: string | null;
      guardian1_name: string | null; guardian1_phone: string | null; guardian1_email: string | null;
      guardian2_name: string | null; guardian2_phone: string | null; guardian2_email: string | null;
      medical_notes: string | null; photo_url: string | null;
      is_active: boolean; enrollment_date: string; created_at: string; updated_at: string;
    };

    const [s] = await prisma.$queryRawUnsafe<StudentDetail[]>(
      `SELECT s.*, r.name AS route_name
         FROM school_bus_students s
         LEFT JOIN bus_routes r ON r.id = s.route_id
        WHERE s.id = $1 AND s.deleted_at IS NULL`,
      params.id
    );
    if (!s) return NextResponse.json({ error: 'Student not found' }, { status: 404 });

    return NextResponse.json({
      id: s.id, studentCode: s.student_code,
      firstName: s.first_name, lastName: s.last_name,
      fullName: `${s.first_name} ${s.last_name}`,
      dateOfBirth: s.date_of_birth, grade: s.grade, section: s.section,
      schoolName: s.school_name, routeId: s.route_id, routeName: s.route_name,
      pickupStop: s.pickup_stop, dropoffStop: s.dropoff_stop, rfidCard: s.rfid_card,
      guardian1: { name: s.guardian1_name, phone: s.guardian1_phone, email: s.guardian1_email },
      guardian2: { name: s.guardian2_name, phone: s.guardian2_phone, email: s.guardian2_email },
      medicalNotes: s.medical_notes, photoUrl: s.photo_url,
      isActive: s.is_active, enrollmentDate: s.enrollment_date,
      createdAt: s.created_at, updatedAt: s.updated_at,
    });
  } catch (err) {
    console.error('[school-bus/students/:id GET]', err);
    return NextResponse.json({ error: 'Failed to load student' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const fields: string[] = [];
    const vals: unknown[] = [];
    let pi = 1;

    const allowed: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', dateOfBirth: 'date_of_birth',
      grade: 'grade', section: 'section', schoolName: 'school_name',
      routeId: 'route_id', pickupStop: 'pickup_stop', dropoffStop: 'dropoff_stop',
      rfidCard: 'rfid_card',
      guardian1Name: 'guardian1_name', guardian1Phone: 'guardian1_phone', guardian1Email: 'guardian1_email',
      guardian2Name: 'guardian2_name', guardian2Phone: 'guardian2_phone', guardian2Email: 'guardian2_email',
      medicalNotes: 'medical_notes', photoUrl: 'photo_url', isActive: 'is_active',
      enrollmentDate: 'enrollment_date',
    };

    for (const [key, col] of Object.entries(allowed)) {
      if (key in body) { fields.push(`${col} = $${pi++}`); vals.push(body[key] ?? null); }
    }
    if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    fields.push(`updated_at = NOW()`);
    vals.push(params.id);

    await prisma.$executeRawUnsafe(
      `UPDATE school_bus_students SET ${fields.join(', ')} WHERE id = $${pi} AND deleted_at IS NULL`,
      ...vals
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[school-bus/students/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE school_bus_students SET deleted_at = NOW(), is_active = false WHERE id = $1 AND deleted_at IS NULL`,
      params.id
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[school-bus/students/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to archive student' }, { status: 500 });
  }
}
