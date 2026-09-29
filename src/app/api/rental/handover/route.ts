export const dynamic = 'force-dynamic';

/**
 * RAC Handover/Return Checklists API — /api/rental/handover
 * Manages vehicle pickup and return inspection records
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

async function nextNo(): Promise<string> {
  const [r] = await prisma
    .$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text as count FROM rental_handovers`,
    )
    .catch(() => [{ count: '0' }]);
  const seq = (parseInt(r?.count ?? '0') + 1).toString().padStart(4, '0');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `RHO-${ym}-${seq}`;
}

/* ─── GET ─── */
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const sp = req.nextUrl.searchParams;
      const handoverType = sp.get('handoverType');
      const status = sp.get('status');
      const search = sp.get('search');
      const agreementNo = sp.get('agreementNo');
      const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
      const limit = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset = (page - 1) * limit;

      let where = `WHERE 1=1`;
      const params: unknown[] = [];
      let pi = 1;

      if (handoverType) {
        where += ` AND handover_type=$${pi++}`;
        params.push(handoverType);
      }
      if (status && status !== 'ALL') {
        where += ` AND status=$${pi++}`;
        params.push(status);
      }
      if (agreementNo) {
        where += ` AND agreement_no=$${pi++}`;
        params.push(agreementNo);
      }
      if (search) {
        where += ` AND (customer_name ILIKE $${pi} OR handover_no ILIKE $${pi} OR agreement_no ILIKE $${pi} OR vehicle_no ILIKE $${pi})`;
        params.push(`%${search}%`);
        pi++;
      }

      const [rows, kpiRows] = await Promise.all([
        tx
          .$queryRawUnsafe<Row[]>(
            `SELECT * FROM rental_handovers ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
            ...params,
            limit,
            offset,
          )
          .catch(() => []),
        tx
          .$queryRawUnsafe<{
            pending_pickups: string;
            pending_returns: string;
            completed_today: string;
            avg_condition: string;
          }[]>(
            `SELECT
               COUNT(*) FILTER (WHERE handover_type='PICKUP' AND status='PENDING')::text AS pending_pickups,
               COUNT(*) FILTER (WHERE handover_type='RETURN' AND status='PENDING')::text AS pending_returns,
               COUNT(*) FILTER (WHERE status='COMPLETED' AND DATE(signed_at) = CURRENT_DATE)::text AS completed_today,
               COALESCE(AVG(condition_score),0)::text AS avg_condition
             FROM rental_handovers`,
          )
          .catch(() => [
            { pending_pickups: '0', pending_returns: '0', completed_today: '0', avg_condition: '0' },
          ]),
      ]);

      const kpi = kpiRows[0] ?? {
        pending_pickups: '0',
        pending_returns: '0',
        completed_today: '0',
        avg_condition: '0',
      };

      return NextResponse.json({
        data: rows,
        kpis: {
          pendingPickups: parseInt(kpi.pending_pickups),
          pendingReturns: parseInt(kpi.pending_returns),
          completedToday: parseInt(kpi.completed_today),
          avgConditionScore: parseFloat(parseFloat(kpi.avg_condition).toFixed(1)),
        },
        page,
        limit,
      });
  });
}

/* ─── POST ─── */
export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const handoverNo = await nextNo();

      const accessories = body.accessories ?? [];
      const checklistItems = body.checklistItems ?? [];

      const [row] = await tx
        .$queryRawUnsafe<Row[]>(
          `INSERT INTO rental_handovers
             (handover_no, agreement_id, agreement_no, customer_name,
              vehicle_id, vehicle_no, vehicle_name,
              handover_type, handover_date,
              fuel_level, odometer_reading, condition_score,
              body_condition, interior_condition, tyres_condition,
              keys_count, spare_key, salik_tag, parking_card,
              accessories, checklist_items,
              notes, signed_by, signed_at, status, branch_id, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22,$23,$24::timestamptz,$25,$26,$27)
           RETURNING *`,
          handoverNo,
          body.agreementId ?? null,
          body.agreementNo ?? null,
          body.customerName ?? null,
          body.vehicleId ?? null,
          body.vehicleNo ?? null,
          body.vehicleName ?? null,
          body.handoverType ?? 'PICKUP',
          body.handoverDate ?? new Date().toISOString(),
          body.fuelLevel ?? 4,
          body.odometerReading ?? 0,
          body.conditionScore ?? 3,
          body.bodyCondition ?? 'Good',
          body.interiorCondition ?? 'Clean',
          body.tyresCondition ?? 'Good',
          body.keysCount ?? 1,
          body.spareKey ?? false,
          body.salikTag ?? false,
          body.parkingCard ?? false,
          JSON.stringify(accessories),
          JSON.stringify(checklistItems),
          body.notes ?? null,
          body.signedBy ?? null,
          body.signedAt ?? null,
          body.status ?? 'PENDING',
          body.branchId ?? null,
          tenantId,
        )
        .catch(() => []);

      if (!row) return NextResponse.json({ error: 'Failed to create handover' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

/* ─── PATCH ─── */
export async function PATCH(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { id, signOff, ...fields } = body;

      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

      const sets: string[] = [];
      const params: unknown[] = [];
      let pi = 1;

      // Sign-off action: mark COMPLETED
      if (signOff) {
        sets.push(`status='COMPLETED'`, `signed_by=$${pi++}`, `signed_at=NOW()`);
        params.push(fields.signedBy ?? 'SYSTEM');
      }

      const fieldMap: Record<string, string> = {
        status: 'status',
        fuelLevel: 'fuel_level',
        odometerReading: 'odometer_reading',
        conditionScore: 'condition_score',
        bodyCondition: 'body_condition',
        interiorCondition: 'interior_condition',
        tyresCondition: 'tyres_condition',
        keysCount: 'keys_count',
        spareKey: 'spare_key',
        salikTag: 'salik_tag',
        parkingCard: 'parking_card',
        notes: 'notes',
        branchId: 'branch_id',
      };

      for (const [k, col] of Object.entries(fieldMap)) {
        if (k in fields && !signOff) {
          sets.push(`${col}=$${pi++}`);
          params.push(fields[k]);
        }
      }

      if (fields.accessories !== undefined) {
        sets.push(`accessories=$${pi++}::jsonb`);
        params.push(JSON.stringify(fields.accessories));
      }
      if (fields.checklistItems !== undefined) {
        sets.push(`checklist_items=$${pi++}::jsonb`);
        params.push(JSON.stringify(fields.checklistItems));
      }

      if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

      sets.push(`updated_at=NOW()`);
      params.push(id);

      const [row] = await tx
        .$queryRawUnsafe<Row[]>(
          `UPDATE rental_handovers SET ${sets.join(',')} WHERE id::text=$${pi} RETURNING *`,
          ...params,
        )
        .catch(() => []);

      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
  });
}

