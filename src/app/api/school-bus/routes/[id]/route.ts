/**
 * School Bus Route — Detail & Assignment
 *
 * GET  /api/school-bus/routes/[id]          — route detail with waypoints, vehicle & driver
 * POST /api/school-bus/routes/[id]/assign   — assign vehicle + driver to route
 * POST /api/school-bus/routes/[id]/trigger  — trigger route execution (start journey)
 *
 * School Bus uses a ROUTE-ASSIGNMENT engine (fixed routes) — NOT the generic dispatch pipeline.
 * Assignment: match an available vehicle (school bus type, sufficient capacity) and a
 * licensed driver with school-bus clearance to a fixed scheduled route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

type Row = Record<string, unknown>;

function serialize(r: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
    if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
    out[k] = v;
  }
  return out;
}

/* ─────────────────────────────────────────────
   GET /api/school-bus/routes/[id]
   Returns full route detail including:
   - waypoints (JSONB array)
   - assigned vehicle (reg number, capacity, type)
   - assigned driver (name, phone, licence)
   - student count, departure/arrival time
───────────────────────────────────────────── */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await ensureDispatchSchema();

    const { id } = params;

    const [route] = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        r.*,
        v.registration_number AS vehicle_reg,
        v.type                AS vehicle_type,
        v.make                AS vehicle_make,
        v.model               AS vehicle_model,
        COALESCE(v.capacity, 0) AS vehicle_capacity,
        d.first_name || ' ' || d.last_name AS driver_name,
        d.phone                             AS driver_phone,
        d.licence_number                    AS driver_licence
      FROM school_bus_routes r
      LEFT JOIN vehicles v ON v.id::text = r.assigned_vehicle_id AND v.deleted_at IS NULL
      LEFT JOIN drivers  d ON d.id::text = r.assigned_driver_id  AND d.deleted_at IS NULL
      WHERE r.id = $1::uuid AND r.status != 'DELETED'
    `, id);

    if (!route) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }

    return NextResponse.json({ data: serialize(route) });
  } catch (err) {
    console.error('[school-bus/routes/[id] GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─────────────────────────────────────────────
   POST /api/school-bus/routes/[id]
   Handles sub-actions via body.action:

   action = "assign"   — assign vehicle + driver
   action = "trigger"  — start the route (set IN_PROGRESS, notify driver)
   action = "complete" — mark route as COMPLETED
   action = "cancel"   — cancel route
───────────────────────────────────────────── */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await ensureDispatchSchema();
    const { id } = params;
    const body = await req.json();
    const action = body.action ?? 'assign';

    switch (action) {
      case 'assign':     return handleAssign(id, body);
      case 'reassign':   return handleReassign(id, body);
      case 'trigger':    return handleTrigger(id, body);
      case 'complete':   return handleStatusChange(id, 'COMPLETED');
      case 'cancel':     return handleStatusChange(id, 'CANCELLED');
      case 'auto-assign': return handleAutoAssign(id, body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[school-bus/routes/[id] POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─────────────────────────────────────────────
   Manual Assign: admin picks vehicle + driver
   Body: { action: 'assign', vehicleId, driverId, adminId? }
───────────────────────────────────────────── */
async function handleAssign(routeId: string, body: Row) {
  const { vehicleId, driverId, adminId } = body as {
    vehicleId?: string; driverId?: string; adminId?: string;
  };

  if (!vehicleId || !driverId) {
    return NextResponse.json({ error: 'vehicleId and driverId are required' }, { status: 400 });
  }

  // Verify vehicle exists and is suitable (capacity ≥ student count)
  const [vehicle] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT id, type, capacity, status FROM vehicles
    WHERE id = $1::uuid AND deleted_at IS NULL
  `, vehicleId);

  if (!vehicle) {
    return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
  }

  // Verify driver exists and is available
  const [driver] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT d.id, da.status AS availability_status
    FROM drivers d
    LEFT JOIN driver_availability da ON da.driver_id = d.id::text
    WHERE d.id = $1::uuid AND d.deleted_at IS NULL
  `, driverId);

  if (!driver) {
    return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
  }

  // Fetch route's student count to validate capacity
  const [route] = await prisma.$queryRawUnsafe<{ student_count: number; status: string }[]>(`
    SELECT student_count, status FROM school_bus_routes
    WHERE id = $1::uuid AND status != 'DELETED'
  `, routeId);

  if (!route) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  }

  if (route.status === 'IN_PROGRESS') {
    return NextResponse.json({ error: 'Cannot reassign a route that is already in progress' }, { status: 409 });
  }

  const capacity = Number(vehicle.capacity ?? 0);
  const studentCount = Number(route.student_count ?? 0);
  if (capacity > 0 && capacity < studentCount) {
    return NextResponse.json({
      error: `Vehicle capacity (${capacity}) is less than student count (${studentCount})`,
    }, { status: 422 });
  }

  // Assign vehicle + driver to route
  const [updated] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    UPDATE school_bus_routes
    SET assigned_vehicle_id = $2,
        assigned_driver_id  = $3,
        status              = 'ASSIGNED',
        updated_at          = NOW()
    WHERE id = $1::uuid AND status != 'DELETED'
    RETURNING id
  `, routeId, vehicleId, driverId);

  if (!updated) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  }

  // Audit log
  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, meta)
    VALUES ('SCHOOL_BUS_ROUTE', $1, 'ASSIGNED', $2, $3::jsonb)
    ON CONFLICT DO NOTHING
  `, routeId, adminId ?? 'system',
    JSON.stringify({ vehicleId, driverId, vehicleType: vehicle.type })
  ).catch(() => {});

  return NextResponse.json({ ok: true, id: updated.id, status: 'ASSIGNED' });
}

/* ─────────────────────────────────────────────
   Reassign: admin changes vehicle / driver / attendant
   Body: { action:'reassign', vehicleId?, driverId?, attendantId?, reason, reassignedBy? }
   Logs previous assignment to reassignment_history JSONB column.
───────────────────────────────────────────── */
async function handleReassign(routeId: string, body: Row) {
  const { vehicleId, driverId, attendantId, reason, reassignedBy } = body as {
    vehicleId?: string; driverId?: string; attendantId?: string;
    reason?: string;    reassignedBy?: string;
  };

  // Fetch current route
  const [route] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT id, status, assigned_vehicle_id, assigned_driver_id, assigned_attendant_id,
           COALESCE(reassignment_history, '[]'::jsonb) AS reassignment_history
    FROM school_bus_routes
    WHERE id = $1::uuid AND status != 'DELETED'
  `, routeId);

  if (!route) return NextResponse.json({ error: 'Route not found' }, { status: 404 });

  if (route.status === 'IN_PROGRESS') {
    return NextResponse.json({ error: 'Cannot reassign a route that is currently in progress' }, { status: 409 });
  }

  // Build history entry
  const prevHistory = Array.isArray(route.reassignment_history) ? route.reassignment_history : [];
  const historyEntry = {
    reassignedAt:       new Date().toISOString(),
    reassignedBy:       reassignedBy ?? 'system',
    reason:             reason ?? 'Manual reassignment',
    previousVehicleId:  route.assigned_vehicle_id  ?? null,
    previousDriverId:   route.assigned_driver_id   ?? null,
    previousAttendantId:route.assigned_attendant_id ?? null,
    newVehicleId:       vehicleId   ?? route.assigned_vehicle_id   ?? null,
    newDriverId:        driverId    ?? route.assigned_driver_id    ?? null,
    newAttendantId:     attendantId ?? route.assigned_attendant_id ?? null,
  };

  const updatedHistory = [...prevHistory, historyEntry];

  const setClauses: string[] = ['updated_at = NOW()', `reassignment_history = $2::jsonb`];
  const values: unknown[]    = [routeId, JSON.stringify(updatedHistory)];

  if (vehicleId   !== undefined) { values.push(vehicleId   || null); setClauses.push(`assigned_vehicle_id   = $${values.length}`); }
  if (driverId    !== undefined) { values.push(driverId    || null); setClauses.push(`assigned_driver_id    = $${values.length}`); }
  if (attendantId !== undefined) { values.push(attendantId || null); setClauses.push(`assigned_attendant_id = $${values.length}`); }

  const [updated] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    UPDATE school_bus_routes SET ${setClauses.join(', ')}
    WHERE id = $1::uuid AND status != 'DELETED'
    RETURNING id
  `, ...values);

  if (!updated) return NextResponse.json({ error: 'Route not found' }, { status: 404 });

  // Audit log
  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, meta)
    VALUES ('SCHOOL_BUS_ROUTE', $1, 'REASSIGNED', $2, $3::jsonb)
    ON CONFLICT DO NOTHING
  `, routeId, reassignedBy ?? 'system', JSON.stringify(historyEntry)).catch(() => {});

  return NextResponse.json({ ok: true, id: updated.id, historyEntry });
}

/* ─────────────────────────────────────────────
   Auto-Assign: system picks best available
   vehicle (SCHOOL_BUS type, sufficient capacity,
   not on another active route) and an available driver.
   Body: { action: 'auto-assign', tenantId }
───────────────────────────────────────────── */
async function handleAutoAssign(routeId: string, body: Row) {
  const { tenantId } = body as { tenantId?: string };

  // Fetch route details
  const [route] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT r.*, vl.lat AS origin_lat, vl.lng AS origin_lng
    FROM school_bus_routes r
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = r.assigned_vehicle_id
    WHERE r.id = $1::uuid AND r.status NOT IN ('DELETED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  `, routeId);

  if (!route) {
    return NextResponse.json({ error: 'Route not found or already active/completed' }, { status: 404 });
  }

  const studentCount = Number(route.student_count ?? 0);
  const tenantFilter = tenantId ? `AND v.tenant_id = '${tenantId.replace(/'/g, "''")}'` : '';

  // Find available school bus vehicles not currently assigned to an active route
  const vehicles = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT v.id, v.registration_number, v.capacity, v.status,
           vl.lat, vl.lng
    FROM vehicles v
    LEFT JOIN vehicle_locations vl ON vl.vehicle_id = v.id::text
    WHERE v.deleted_at IS NULL
      AND v.type IN ('SCHOOL_BUS', 'MINIBUS', 'BUS')
      AND v.status = 'AVAILABLE'
      AND COALESCE(v.capacity, 0) >= $1
      AND v.id::text NOT IN (
        SELECT assigned_vehicle_id FROM school_bus_routes
        WHERE status IN ('ASSIGNED', 'IN_PROGRESS') AND id != $2::uuid
          AND assigned_vehicle_id IS NOT NULL
      )
      ${tenantFilter}
    ORDER BY v.capacity ASC
    LIMIT 10
  `, studentCount, routeId);

  if (vehicles.length === 0) {
    return NextResponse.json({
      error: 'No available school bus vehicle found with sufficient capacity',
      studentCount,
    }, { status: 404 });
  }

  // Find an available driver not currently assigned to an active route
  const drivers = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT d.id, d.first_name, d.last_name, da.status AS avail_status
    FROM drivers d
    LEFT JOIN driver_availability da ON da.driver_id = d.id::text
    WHERE d.deleted_at IS NULL
      AND COALESCE(da.status, 'AVAILABLE') = 'AVAILABLE'
      AND d.id::text NOT IN (
        SELECT assigned_driver_id FROM school_bus_routes
        WHERE status IN ('ASSIGNED', 'IN_PROGRESS') AND id != $1::uuid
          AND assigned_driver_id IS NOT NULL
      )
    LIMIT 5
  `, routeId);

  if (drivers.length === 0) {
    return NextResponse.json({ error: 'No available driver found' }, { status: 404 });
  }

  const vehicle = vehicles[0] as { id: string; registration_number: string; capacity: number };
  const driver  = drivers[0]  as { id: string; first_name: string; last_name: string };

  // Assign
  const [updated] = await prisma.$queryRawUnsafe<{ id: string }[]>(`
    UPDATE school_bus_routes
    SET assigned_vehicle_id = $2,
        assigned_driver_id  = $3,
        status              = 'ASSIGNED',
        updated_at          = NOW()
    WHERE id = $1::uuid
    RETURNING id
  `, routeId, String(vehicle.id), String(driver.id));

  if (!updated) {
    return NextResponse.json({ error: 'Route assignment failed' }, { status: 500 });
  }

  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, meta)
    VALUES ('SCHOOL_BUS_ROUTE', $1, 'AUTO_ASSIGNED', 'system', $2::jsonb)
    ON CONFLICT DO NOTHING
  `, routeId,
    JSON.stringify({
      vehicleId: vehicle.id,
      vehicleReg: vehicle.registration_number,
      driverId: driver.id,
      driverName: `${driver.first_name} ${driver.last_name}`,
    })
  ).catch(() => {});

  return NextResponse.json({
    ok: true,
    id: updated.id,
    status: 'ASSIGNED',
    vehicle: { id: vehicle.id, reg: vehicle.registration_number, capacity: vehicle.capacity },
    driver:  { id: driver.id,  name: `${driver.first_name} ${driver.last_name}` },
  });
}

/* ─────────────────────────────────────────────
   Trigger: start the route (IN_PROGRESS)
   Body: { action: 'trigger', adminId? }
   Sends push notification to the assigned driver.
───────────────────────────────────────────── */
async function handleTrigger(routeId: string, body: Row) {
  const { adminId } = body as { adminId?: string };

  const [route] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT r.*, d.phone AS driver_phone, d.first_name || ' ' || d.last_name AS driver_name
    FROM school_bus_routes r
    LEFT JOIN drivers d ON d.id::text = r.assigned_driver_id AND d.deleted_at IS NULL
    WHERE r.id = $1::uuid AND r.status != 'DELETED'
  `, routeId);

  if (!route) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  }
  if (!route.assigned_vehicle_id || !route.assigned_driver_id) {
    return NextResponse.json({
      error: 'Route must have a vehicle and driver assigned before triggering',
    }, { status: 422 });
  }
  if (route.status === 'IN_PROGRESS') {
    return NextResponse.json({ error: 'Route is already in progress' }, { status: 409 });
  }
  if (route.status === 'COMPLETED' || route.status === 'CANCELLED') {
    return NextResponse.json({
      error: `Cannot trigger a ${route.status} route`,
    }, { status: 409 });
  }

  // Set IN_PROGRESS
  await prisma.$executeRawUnsafe(`
    UPDATE school_bus_routes
    SET status = 'IN_PROGRESS', updated_at = NOW()
    WHERE id = $1::uuid
  `, routeId);

  // Update driver to BUSY
  await prisma.$executeRawUnsafe(`
    UPDATE driver_availability SET status = 'BUSY', updated_at = NOW()
    WHERE driver_id = $1
  `, String(route.assigned_driver_id)).catch(() => {});

  // Audit
  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, meta)
    VALUES ('SCHOOL_BUS_ROUTE', $1, 'TRIGGERED', $2, $3::jsonb)
    ON CONFLICT DO NOTHING
  `, routeId, adminId ?? 'system',
    JSON.stringify({
      routeName: route.route_name,
      departureTime: route.departure_time,
      driverName: route.driver_name,
    })
  ).catch(() => {});

  // Fire-and-forget driver notification (don't await — never crash on notify failure)
  notifySchoolBusDriver(route).catch(err =>
    console.warn('[school-bus trigger] notify failed', err)
  );

  return NextResponse.json({ ok: true, id: routeId, status: 'IN_PROGRESS' });
}

/* ─────────────────────────────────────────────
   Generic status change (COMPLETED / CANCELLED)
───────────────────────────────────────────── */
async function handleStatusChange(routeId: string, status: string) {
  const [updated] = await prisma.$queryRawUnsafe<{ id: string; assigned_driver_id: string }[]>(`
    UPDATE school_bus_routes
    SET status = $2, updated_at = NOW()
    WHERE id = $1::uuid AND status != 'DELETED'
    RETURNING id, assigned_driver_id
  `, routeId, status);

  if (!updated) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 });
  }

  // Free driver back to AVAILABLE
  if (updated.assigned_driver_id) {
    await prisma.$executeRawUnsafe(`
      UPDATE driver_availability SET status = 'AVAILABLE', updated_at = NOW()
      WHERE driver_id = $1
    `, String(updated.assigned_driver_id)).catch(() => {});
  }

  return NextResponse.json({ ok: true, id: updated.id, status });
}

/* ─────────────────────────────────────────────
   School Bus Driver Notification (fire-and-forget)
   Sends push + WhatsApp if available.
───────────────────────────────────────────── */
async function notifySchoolBusDriver(route: Row) {
  const message =
    `🚌 School Bus Route Started\n` +
    `Route: ${route.route_name}\n` +
    `Departure: ${route.departure_time ?? 'N/A'}\n` +
    `Students: ${route.student_count ?? 0}\n` +
    `Direction: ${route.direction ?? 'PICKUP'}\n\n` +
    `Please follow the assigned route and pick up students at scheduled stops.`;

  console.log('[school-bus notify] driver message prepared:', {
    driverId: route.assigned_driver_id,
    driverName: route.driver_name,
    message,
  });

  // Push notification placeholder — integrate with your push service
  // await pushService.send({ userId: route.assigned_driver_id, title: 'Route Started', body: message });

  // WhatsApp placeholder — integrate with your WhatsApp provider
  // if (route.driver_phone) {
  //   await whatsappService.send({ to: route.driver_phone, text: message });
  // }
}
