/**
 * GET /api/school-bus/trips/[id]/manifest/pdf?lang=en|ar&download=1
 *
 * Bilingual student manifest PDF. Includes medical alerts as a banner +
 * row highlight so emergency responders can see at a glance.
 */

import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renderPdf } from '@/lib/pdf/render';
import {
  SchoolBusManifestPdf,
  type SchoolBusManifestPdfData,
  type SchoolBusManifestStudent,
} from '@/lib/pdf/templates/school-bus-manifest';
import type { Lang } from '@/lib/pdf/theme';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const VENDOR = {
  name: 'Fleet360 — School Bus',
  tagline: 'UAE Smart Transport Management',
  phone: '+971 4 000 0000',
};

interface TripRow {
  id: string;
  trip_number: string | null;
  session_type: string | null;
  scheduled_departure: string;
  vehicle_id: string | null;
  driver_name: string | null;
  driver_id: string | null;
  route_id: string;
  route_name: string | null;
}

interface StudentRow {
  student_code: string;
  first_name: string | null;
  last_name: string | null;
  grade: string | null;
  section: string | null;
  school_name: string | null;
  pickup_stop: string | null;
  dropoff_stop: string | null;
  medical_notes: string | null;
  guardian1_name: string | null;
  guardian1_phone: string | null;
  guardian2_phone: string | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang: Lang = req.nextUrl.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
  const download = req.nextUrl.searchParams.get('download') === '1';

  try {
    const tripRows = await prisma.$queryRawUnsafe<TripRow[]>(
      `SELECT t.id::text, t.trip_number, t.session_type,
              t.scheduled_departure::text, t.vehicle_id::text,
              t.driver_name, t.driver_id::text,
              t.route_id::text, r.route_name
       FROM school_bus_trips t
       LEFT JOIN school_bus_routes r ON r.id = t.route_id
       WHERE t.id = $1::uuid`,
      id,
    ).catch(() => [] as TripRow[]);
    if (tripRows.length === 0) return jsonErr('Trip not found', 404);
    const trip = tripRows[0];

    const studentRows = await prisma.$queryRawUnsafe<StudentRow[]>(
      `SELECT student_code, first_name, last_name, grade, section, school_name,
              pickup_stop, dropoff_stop, medical_notes,
              guardian1_name, guardian1_phone, guardian2_phone
       FROM school_bus_students
       WHERE route_id = $1::uuid AND deleted_at IS NULL AND is_active = true
       ORDER BY pickup_stop NULLS LAST, last_name, first_name`,
      trip.route_id,
    ).catch(() => [] as StudentRow[]);

    // Today's attendance
    const todayDate = new Date().toISOString().slice(0, 10);
    const attendance = await prisma.$queryRawUnsafe<Array<{ student_code: string; status: string; boarded_at: string | null }>>(
      `SELECT s.student_code, a.status, a.boarded_at::text
       FROM school_bus_attendance a
       JOIN school_bus_students s ON s.id = a.student_id
       WHERE a.date = $1::date AND a.session_type = $2
         AND s.route_id = $3::uuid`,
      todayDate, trip.session_type ?? 'MORNING', trip.route_id,
    ).catch(() => [] as Array<{ student_code: string; status: string; boarded_at: string | null }>);
    const attMap = new Map(attendance.map(a => [a.student_code, a]));

    // Driver phone (if driver_id matches a Driver row)
    let driverPhone: string | null = null;
    if (trip.driver_id) {
      const driver = await prisma.driver.findUnique({
        where: { id: trip.driver_id },
        select: { contactNumber: true },
      }).catch(() => null);
      driverPhone = driver?.contactNumber ?? null;
    }

    // Vehicle details
    let vehicleInfo = { licensePlate: null as string | null, make: null as string | null, model: null as string | null };
    if (trip.vehicle_id) {
      const v = await prisma.vehicle.findUnique({
        where: { id: trip.vehicle_id },
        select: { make: true, model: true, licensePlate: true },
      }).catch(() => null);
      if (v) vehicleInfo = { licensePlate: v.licensePlate, make: v.make, model: v.model };
    }

    const students: SchoolBusManifestStudent[] = studentRows.map(s => {
      const att = attMap.get(s.student_code);
      return {
        studentCode: s.student_code,
        fullName: [s.first_name, s.last_name].filter(Boolean).join(' '),
        grade: s.grade,
        section: s.section,
        pickupStop: s.pickup_stop,
        dropoffStop: s.dropoff_stop,
        guardian1Name: s.guardian1_name,
        guardian1Phone: s.guardian1_phone,
        guardian2Phone: s.guardian2_phone,
        medicalAlert: Boolean(s.medical_notes && s.medical_notes.trim().length > 0),
        medicalNotes: s.medical_notes,
        attendanceStatus: att?.status ?? 'PENDING',
        boardedAt: att?.boarded_at ?? null,
      };
    });

    const data: SchoolBusManifestPdfData = {
      manifestNo: `SBM-${trip.trip_number ?? id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`,
      generatedAt: new Date(),
      vendor: VENDOR,
      trip: {
        tripNumber: trip.trip_number ?? id.slice(0, 8),
        sessionType: trip.session_type,
        scheduledDeparture: trip.scheduled_departure,
        routeName: trip.route_name ?? '—',
        schoolName: studentRows[0]?.school_name ?? null,
      },
      driver: { name: trip.driver_name, contactNumber: driverPhone },
      vehicle: vehicleInfo,
      students,
    };

    const buffer = await renderPdf(createElement(SchoolBusManifestPdf, { data, lang }));

    void logAudit({
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'SchoolBusTrip',
      entityId: id,
      action: 'EXPORT',
      details: `School-bus manifest PDF (${lang.toUpperCase()}) exported for trip ${data.trip.tripNumber} — ${students.length} students, ${students.filter(s => s.medicalAlert).length} medical alerts.`,
    });

    const filename = `school-bus-manifest-${data.manifestNo}.pdf`;
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    captureException(err, { context: 'school-bus.manifest.pdf', tags: { tripId: id } });
    return jsonErr('Failed to generate manifest', 500);
  }
}

function jsonErr(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
