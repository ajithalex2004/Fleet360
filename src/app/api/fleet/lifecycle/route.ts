export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const vehicleId = sp.get('vehicleId');
      const eventType = sp.get('eventType');
      const { take, skip, page, limit } = paginate(sp);

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (vehicleId) {
        params.push(String(vehicleId).trim());
        conditions.push(`fle.vehicle_id = $${params.length}`);
      }
      if (eventType) {
        params.push(eventType);
        conditions.push(`fle.event_type = $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countParams = [...params];
      const dataParams = [...params];
      dataParams.push(take, skip);

      const [countResult, rows] = await Promise.all([
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count
           FROM fleet_lifecycle_events fle
           LEFT JOIN vehicles v ON v.id = fle.vehicle_id
           ${where}`,
          ...countParams,
        ),
        tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT fle.*, v.vehicle_code, v.make, v.model, v.license_plate
           FROM fleet_lifecycle_events fle
           LEFT JOIN vehicles v ON v.id = fle.vehicle_id
           ${where}
           ORDER BY fle.event_date DESC, fle.created_at DESC
           LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          ...dataParams,
        ),
      ]);

      let total = Number(countResult[0]?.count ?? 0);
      let data = rows.map(rowToCamel);

      // If querying a specific vehicle and no events have been recorded yet,
      // synthesize the founding ACTIVATION event from the vehicle's creation/purchase info
      if (vehicleId && data.length === 0) {
        const vehicleRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT id, vehicle_code, make, model, license_plate, lifecycle_stage, status, purchase_date, created_at
           FROM vehicles
           WHERE id = $1 AND deleted_at IS NULL`,
          vehicleId,
        );

        if (vehicleRows.length > 0) {
          const v = vehicleRows[0];
          const initialDate = (v.purchase_date || v.created_at || new Date().toISOString()) as string;
          const initialEvent = {
            id: `init-${v.id}`,
            vehicleId: String(v.id),
            eventType: 'ACTIVATION',
            eventDate: initialDate,
            description: `Vehicle registered in Fleet Master (${v.make || ''} ${v.model || ''})`,
            toStage: (v.lifecycle_stage as string) || 'OPERATIONAL',
            fromStage: null,
            referenceNo: (v.vehicle_code as string) || null,
            performedBy: 'System / Fleet Master Record',
            cost: null,
            metadata: { synthetic: true },
            notes: 'Initial registration record from vehicle master.',
            createdAt: initialDate,
            updatedAt: initialDate,
            vehicleCode: v.vehicle_code,
            make: v.make,
            model: v.model,
            licensePlate: v.license_plate,
          };
          data = [initialEvent];
          total = 1;
        }
      }

      return NextResponse.json(paginatedResponse(data, total, page, limit));
    } catch (e) {
      console.error('Error fetching lifecycle events:', e);
      return NextResponse.json({ error: 'Failed to fetch lifecycle events' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const eventDate = body.eventDate ? new Date(body.eventDate).toISOString() : now;

      const record = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `INSERT INTO fleet_lifecycle_events (
          id, vehicle_id, event_type, event_date, description,
          reference_no, performed_by, from_stage, to_stage,
          cost, metadata, notes, created_at, updated_at
        ) VALUES (
          $1::uuid, $2, $3, $4::timestamptz, $5,
          $6, $7, $8, $9,
          $10::numeric, $11::jsonb, $12, $13::timestamptz, $14::timestamptz
        ) RETURNING *`,
        id,
        body.vehicleId ? String(body.vehicleId) : null,
        body.eventType ?? 'NOTE',
        eventDate,
        body.description ?? 'Lifecycle event recorded',
        body.referenceNo ?? null,
        body.performedBy ?? 'Fleet Manager',
        body.fromStage ?? null,
        body.toStage ?? null,
        body.cost != null && body.cost !== '' ? Number(body.cost) : null,
        body.metadata ? JSON.stringify(body.metadata) : null,
        body.notes ?? null,
        now,
        now,
      );

      // If toStage is provided, update the vehicle's lifecycle_stage
      if (body.toStage && body.vehicleId) {
        await tx.$executeRawUnsafe(
          `UPDATE vehicles SET lifecycle_stage = $1, updated_at = $2::timestamptz WHERE id = $3`,
          body.toStage,
          now,
          String(body.vehicleId),
        );
      }

      return NextResponse.json(rowToCamel(record[0]), { status: 201 });
    } catch (e) {
      console.error('Error creating lifecycle event:', e);
      return NextResponse.json({ error: 'Failed to create lifecycle event' }, { status: 500 });
    }
  });
}
