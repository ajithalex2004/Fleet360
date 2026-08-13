/**
 * POST /api/bus-ops/route-passengers/bulk-import
 *
 * Accepts a JSON array of rows and creates RoutePassenger records in
 * bulk. Uses friendly identifiers (employee business ID, route name,
 * stop name) that the server resolves to UUIDs — ops paste from any
 * HR export without needing to know internal IDs.
 *
 * Body: { rows: [ {
 *   employeeId,           // business ID (StaffMember.employeeId)
 *   routeName,            // BusRoute.name (or routeCode via BusRoute.code)
 *   pickupStopName,       // RouteStop.stopName on that route (optional)
 *   dropoffStopName,      // RouteStop.stopName on that route (optional)
 *   pickupTime,           // 'HH:MM' 24h (optional)
 *   dropoffTime,          // 'HH:MM' 24h (optional)
 *   effectiveFrom,        // 'YYYY-MM-DD' (defaults to today)
 *   effectiveTo,          // 'YYYY-MM-DD' (optional)
 * } ] }
 *
 * Response: { total, created, skipped, errors: [{ row, error }] }
 *
 * All-or-nothing per row: a single bad row DOES NOT abort the batch;
 * the caller sees per-row status. Overlap protection (same as single
 * POST) is enforced — a duplicate active enrollment returns skipped
 * rather than an error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface InputRow {
  employeeId?: string;
  routeName?: string;
  routeCode?: string;
  pickupStopName?: string;
  dropoffStopName?: string;
  pickupTime?: string;
  dropoffTime?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
}

interface RowError { row: number; input: InputRow; error: string }

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const createdBy = req.headers.get('x-user-id') ?? null;

  let body: { rows?: InputRow[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return NextResponse.json({ error: 'rows array is required' }, { status: 400 });
  if (rows.length > 5000) return NextResponse.json({ error: 'Max 5000 rows per import' }, { status: 400 });

  // Preload lookup tables ONCE — resolving per-row would fire 4-5 queries
  // per input, killing throughput on 500+ row imports.
  const [staff, routes] = await Promise.all([
    prisma.staffMember.findMany({
      where: { tenantId, deletedAt: null, employeeId: { not: null } },
      select: { id: true, employeeId: true },
    }),
    prisma.busRoute.findMany({
      where: { deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
      select: {
        id: true, name: true, code: true,
        stops: { select: { id: true, stopName: true } },
      },
    }),
  ]);
  const staffByEmpId = new Map(staff.map(s => [s.employeeId!.toLowerCase(), s.id]));
  const routeByName  = new Map(routes.map(r => [r.name.toLowerCase(), r]));
  const routeByCode  = new Map(routes.filter(r => r.code).map(r => [r.code!.toLowerCase(), r]));

  let created = 0, skipped = 0;
  const errors: RowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      if (!r.employeeId?.trim()) throw new Error('employeeId is required');
      const staffMemberId = staffByEmpId.get(r.employeeId.trim().toLowerCase());
      if (!staffMemberId) throw new Error(`Employee ID "${r.employeeId}" not found in tenant`);

      // Route resolution — prefer code (unique per tenant) then name.
      const route = (r.routeCode && routeByCode.get(r.routeCode.trim().toLowerCase()))
                 ?? (r.routeName && routeByName.get(r.routeName.trim().toLowerCase()));
      if (!route) throw new Error(`Route not found (code="${r.routeCode ?? ''}", name="${r.routeName ?? ''}")`);

      // Stop resolution — must exist on the resolved route.
      let pickupStopId: string | null = null;
      if (r.pickupStopName?.trim()) {
        const s = route.stops.find(x => x.stopName.toLowerCase() === r.pickupStopName!.trim().toLowerCase());
        if (!s) throw new Error(`Pickup stop "${r.pickupStopName}" not on route "${route.name}"`);
        pickupStopId = s.id;
      }
      let dropoffStopId: string | null = null;
      if (r.dropoffStopName?.trim()) {
        const s = route.stops.find(x => x.stopName.toLowerCase() === r.dropoffStopName!.trim().toLowerCase());
        if (!s) throw new Error(`Drop-off stop "${r.dropoffStopName}" not on route "${route.name}"`);
        dropoffStopId = s.id;
      }

      if (r.pickupTime  && !TIME_RE.test(r.pickupTime))  throw new Error('pickupTime must be HH:MM (24h)');
      if (r.dropoffTime && !TIME_RE.test(r.dropoffTime)) throw new Error('dropoffTime must be HH:MM (24h)');

      const effectiveFrom = r.effectiveFrom ? new Date(r.effectiveFrom) : new Date();
      const effectiveTo   = r.effectiveTo   ? new Date(r.effectiveTo)   : null;
      if (isNaN(effectiveFrom.getTime())) throw new Error('effectiveFrom is not a valid date');
      if (effectiveTo && (isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
        throw new Error('effectiveTo must be on/after effectiveFrom');
      }

      // Overlap check — same rule as single POST endpoint. Duplicates
      // are `skipped` rather than errored.
      const overlap = await prisma.routePassenger.findFirst({
        where: {
          tenantId, deletedAt: null, status: 'ACTIVE',
          routeId: route.id, staffMemberId,
          effectiveFrom: { lte: effectiveTo ?? new Date('9999-12-31') },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        },
        select: { id: true },
      });
      if (overlap) { skipped++; continue; }

      await prisma.routePassenger.create({
        data: {
          tenantId, routeId: route.id, staffMemberId,
          pickupStopId, dropoffStopId,
          pickupTime:  r.pickupTime  || null,
          dropoffTime: r.dropoffTime || null,
          effectiveFrom, effectiveTo,
          status: 'ACTIVE',
          notes: r.notes?.trim() || null,
          createdBy,
        },
      });
      created++;
    } catch (err) {
      errors.push({ row: i + 1, input: r, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  return NextResponse.json({
    total: rows.length,
    created,
    skipped,      // active overlap
    errored: errors.length,
    errors,
  });
}
