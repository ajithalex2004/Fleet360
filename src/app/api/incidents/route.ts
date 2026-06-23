import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { maybeCreateIncidentWorkOrder } from '@/lib/incident-work-orders';

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

// ── POST — create a new incident ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      incidentType, severity = 'MEDIUM', description, location,
      vehicleId, driverId, incidentDate,
    } = body;

    if (!incidentType) {
      return NextResponse.json({ error: 'incidentType is required' }, { status: 400 });
    }

    // Generate incident number: INC-YYYYMMDD-XXXX
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 9000) + 1000;
    const incidentNo = `INC-${dateStr}-${rand}`;

    const [incident] = await prisma.$queryRawUnsafe<Array<{ id: string; incident_no: string | null }>>(
      `INSERT INTO trip_incidents
         (id, incident_no, incident_type, severity, status, description, location,
          vehicle_id, driver_id, incident_date, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, 'OPEN', $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id, incident_no`,
      incidentNo,
      incidentType,
      severity,
      description ?? null,
      location ?? null,
      vehicleId ?? null,
      driverId ?? null,
      incidentDate ? new Date(incidentDate) : today,
    ).catch(async () => {
      // Fallback: try without optional foreign key columns (in case they don't exist)
      const [row] = await prisma.$queryRawUnsafe<Array<{ id: string; incident_no: string | null }>>(
        `INSERT INTO trip_incidents
           (id, incident_no, incident_type, severity, status, description, location, incident_date, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'OPEN', $4, $5, $6, NOW(), NOW())
         RETURNING id, incident_no`,
        incidentNo, incidentType, severity,
        description ?? null, location ?? null,
        incidentDate ? new Date(incidentDate) : today,
      );
      return [row];
    });

    const workOrder = incident
      ? await maybeCreateIncidentWorkOrder({
          req,
          incident: {
            id: incident.id,
            incidentNo,
            incidentType,
            severity,
            description,
            location,
            vehicleId,
            driverId,
          },
          createWorkOrder: typeof body.createWorkOrder === 'boolean' ? body.createWorkOrder : undefined,
          sourceModule: 'INCIDENT',
        })
      : { created: false, skipped: true, reason: 'incident_insert_not_returned' };

    return NextResponse.json({ success: true, incidentId: incident?.id ?? null, incidentNo, workOrder }, { status: 201 });
  } catch (err) {
    console.error('[incidents POST]', err);
    return NextResponse.json({ error: 'Failed to create incident' }, { status: 500 });
  }
}

// ── GET — dashboard stats ─────────────────────────────────────────────────────

export async function GET() {
  try {
    const [
      totalIncidents,
      openIncidents,
      resolvedToday,
      ambulanceVehicles,
      ambulanceAvailable,
      criticalAlerts,
    ] = await Promise.all([
      // Use trip_incidents table if it exists; fall back gracefully
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM trip_incidents`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM trip_incidents WHERE status = 'OPEN'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM trip_incidents WHERE status = 'RESOLVED' AND DATE(updated_at) = CURRENT_DATE`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'AMBULANCE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND vehicle_usage = 'AMBULANCE' AND status = 'AVAILABLE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM alerts WHERE severity = 'CRITICAL' AND status != 'RESOLVED'`,
      ).catch(zero),
    ]);

    // Recent incidents
    const incidents = await prisma.$queryRawUnsafe<Array<{
      id: string; incident_no: string | null; incident_type: string;
      severity: string | null; status: string | null; description: string | null;
      incident_date: Date; location: string | null; created_at: Date;
    }>>(
      `SELECT id, incident_no, incident_type, severity, status, description,
              incident_date, location, created_at
       FROM trip_incidents
       ORDER BY incident_date DESC
       LIMIT 20`,
    ).catch(() => [] as Array<{
      id: string; incident_no: string | null; incident_type: string;
      severity: string | null; status: string | null; description: string | null;
      incident_date: Date; location: string | null; created_at: Date;
    }>);

    return NextResponse.json({
      totalIncidents:     Number(totalIncidents[0]?.count    ?? 0),
      openIncidents:      Number(openIncidents[0]?.count     ?? 0),
      resolvedToday:      Number(resolvedToday[0]?.count     ?? 0),
      ambulanceVehicles:  Number(ambulanceVehicles[0]?.count  ?? 0),
      ambulanceAvailable: Number(ambulanceAvailable[0]?.count ?? 0),
      criticalAlerts:     Number(criticalAlerts[0]?.count     ?? 0),
      incidents: incidents.map(i => ({
        ...i,
        incident_date: i.incident_date?.toISOString?.() ?? null,
        created_at:    i.created_at?.toISOString?.()    ?? null,
      })),
    });
  } catch (err) {
    console.error('[incidents]', err);
    return NextResponse.json({
      totalIncidents: 0, openIncidents: 0, resolvedToday: 0,
      ambulanceVehicles: 0, ambulanceAvailable: 0, criticalAlerts: 0, incidents: [],
    });
  }
}
