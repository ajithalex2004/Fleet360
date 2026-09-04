export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * Auto-creates the `school_bus_students` table if it doesn't exist.
 * GET  /api/school-bus/students          — list with optional filters
 * POST /api/school-bus/students          — enroll new student
 */

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const q       = searchParams.get('q')?.trim() ?? '';
        const routeId = searchParams.get('routeId') ?? '';
        const grade   = searchParams.get('grade')   ?? '';
        const active  = searchParams.get('active')  ?? 'true';
        const page    = Math.max(1, Number(searchParams.get('page') ?? 1));
        const limit   = Math.min(100, Number(searchParams.get('limit') ?? 50));
        const offset  = (page - 1) * limit;

        const conditions: string[] = ['s.deleted_at IS NULL'];
        const params: unknown[] = [];
        let pi = 1;

        if (active !== 'all') {
          conditions.push(`s.is_active = $${pi++}`);
          params.push(active !== 'false');
        }
        if (q) {
          conditions.push(`(s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi} OR s.student_code ILIKE $${pi} OR s.rfid_card ILIKE $${pi} OR s.guardian1_phone ILIKE $${pi})`);
          params.push(`%${q}%`); pi++;
        }
        if (routeId) { conditions.push(`s.route_id = $${pi++}`); params.push(routeId); }
        if (grade)   { conditions.push(`s.grade = $${pi++}`);    params.push(grade); }

        const where = conditions.join(' AND ');

        type StudentRow = {
          id: string; student_code: string; first_name: string; last_name: string;
          date_of_birth: string | null; grade: string | null; section: string | null;
          school_name: string | null; route_id: string | null; route_name: string | null;
          pickup_stop: string | null; dropoff_stop: string | null; rfid_card: string | null;
          guardian1_name: string | null; guardian1_phone: string | null; guardian1_email: string | null;
          guardian2_name: string | null; guardian2_phone: string | null; guardian2_email: string | null;
          medical_notes: string | null; photo_url: string | null;
          is_active: boolean; enrollment_date: string; created_at: string;
          total: bigint;
        };

        const rows = await tx.$queryRawUnsafe<StudentRow[]>(
          `SELECT s.*,
                  r.name AS route_name,
                  COUNT(*) OVER() AS total
             FROM school_bus_students s
             LEFT JOIN bus_routes r ON r.id = s.route_id
            WHERE ${where}
            ORDER BY s.last_name, s.first_name
            LIMIT $${pi} OFFSET $${pi + 1}`,
          ...params, limit, offset
        ).catch(() => [] as StudentRow[]);

        const total = rows.length > 0 ? Number(rows[0].total) : 0;
        const students = rows.map(r => ({
          id: r.id, studentCode: r.student_code,
          firstName: r.first_name, lastName: r.last_name,
          fullName: `${r.first_name} ${r.last_name}`,
          dateOfBirth: r.date_of_birth, grade: r.grade, section: r.section,
          schoolName: r.school_name, routeId: r.route_id, routeName: r.route_name,
          pickupStop: r.pickup_stop, dropoffStop: r.dropoff_stop,
          rfidCard: r.rfid_card,
          guardian1: { name: r.guardian1_name, phone: r.guardian1_phone, email: r.guardian1_email },
          guardian2: { name: r.guardian2_name, phone: r.guardian2_phone, email: r.guardian2_email },
          medicalNotes: r.medical_notes, photoUrl: r.photo_url,
          isActive: r.is_active, enrollmentDate: r.enrollment_date, createdAt: r.created_at,
        }));

        return NextResponse.json({ students, total, page, limit, pages: Math.ceil(total / limit) });
        } catch (err) {
        console.error('[school-bus/students GET]', err);
        return NextResponse.json({ error: 'Failed to load students' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const {
          firstName, lastName, dateOfBirth, grade, section, schoolName,
          routeId, pickupStop, dropoffStop, rfidCard,
          guardian1Name, guardian1Phone, guardian1Email,
          guardian2Name, guardian2Phone, guardian2Email,
          medicalNotes, enrollmentDate,
        } = body;

        if (!firstName?.trim() || !lastName?.trim()) {
          return NextResponse.json({ error: 'First and last name are required' }, { status: 400 });
        }

        // Generate student code: SB-YYYYMM-XXXX
        const prefix = `SB-${new Date().toISOString().slice(0, 7).replace('-', '')}-`;
        const [[{ nextval }]] = await tx.$queryRawUnsafe<Array<[{ nextval: bigint }]>>(
          `SELECT COUNT(*) + 1 AS nextval FROM school_bus_students`
        ) as [[{ nextval: bigint }]];
        const studentCode = `${prefix}${String(Number(nextval)).padStart(4, '0')}`;

        type NewStudent = { id: string; student_code: string };
        const [student] = await tx.$queryRawUnsafe<NewStudent[]>(
          `INSERT INTO school_bus_students
             (tenant_id, student_code, first_name, last_name, date_of_birth, grade, section, school_name,
              route_id, pickup_stop, dropoff_stop, rfid_card,
              guardian1_name, guardian1_phone, guardian1_email,
              guardian2_name, guardian2_phone, guardian2_email,
              medical_notes, enrollment_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING id, student_code`,
          tenantId, studentCode, firstName.trim(), lastName.trim(),
          dateOfBirth || null, grade || null, section || null, schoolName || null,
          routeId || null, pickupStop || null, dropoffStop || null, rfidCard || null,
          guardian1Name || null, guardian1Phone || null, guardian1Email || null,
          guardian2Name || null, guardian2Phone || null, guardian2Email || null,
          medicalNotes || null, enrollmentDate || new Date().toISOString().slice(0, 10)
        );

        return NextResponse.json({ id: student.id, studentCode: student.student_code }, { status: 201 });
        } catch (err) {
        console.error('[school-bus/students POST]', err);
        return NextResponse.json({ error: 'Failed to enroll student' }, { status: 500 });
      }
  });
}

