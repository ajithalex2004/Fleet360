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
        const status = sp.get('status');
        const vehicleId = sp.get('vehicleId');
        const { take, skip, page, limit } = paginate(sp);

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (status) {
          params.push(status);
          conditions.push(`fvi.status = $${params.length}`);
        }
        if (vehicleId) {
          params.push(vehicleId);
          conditions.push(`fvi.vehicle_id = $${params.length}`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const countParams = [...params];
        const dataParams = [...params];
        dataParams.push(take, skip);

        const [countResult, rows] = await Promise.all([
          tx.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) as count
             FROM fleet_vehicle_insurance fvi
             LEFT JOIN vehicles v ON v.id = fvi.vehicle_id::text
             ${where}`,
            ...countParams,
          ),
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT fvi.*, v.vehicle_code, v.make, v.model, v.license_plate
             FROM fleet_vehicle_insurance fvi
             LEFT JOIN vehicles v ON v.id = fvi.vehicle_id::text
             ${where}
             ORDER BY fvi.end_date ASC
             LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
            ...dataParams,
          ),
        ]);

        const total = Number(countResult[0].count);
        const data = rows.map(rowToCamel);

        return NextResponse.json(paginatedResponse(data, total, page, limit));
      } catch (e) {
        console.error('Error fetching insurance records:', e);
        return NextResponse.json({ error: 'Failed to fetch insurance records' }, { status: 500 });
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

        const record = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `INSERT INTO fleet_vehicle_insurance (
            id, vehicle_id, policy_number, insurer, policy_type,
            start_date, end_date, premium_amount, coverage_amount,
            deductible, renewal_reminder_days, document_url, notes,
            status, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, $13,
            $14, $15, $16
          ) RETURNING *`,
          id,
          body.vehicleId ?? null,
          body.policyNumber ?? null,
          body.insurer ?? null,
          body.policyType ?? null,
          body.startDate ?? null,
          body.endDate ?? null,
          body.premiumAmount ?? null,
          body.coverageAmount ?? null,
          body.deductible ?? null,
          body.renewalReminderDays ?? null,
          body.documentUrl ?? null,
          body.notes ?? null,
          'ACTIVE',
          now,
          now,
        );

        // Update vehicle insurance_expiry_date
        if (body.vehicleId && body.endDate) {
          await tx.$executeRawUnsafe(
            `UPDATE vehicles SET insurance_expiry_date = $1, updated_at = $2 WHERE id = $3`,
            body.endDate,
            now,
            body.vehicleId,
          );
        }

        return NextResponse.json(rowToCamel(record[0]), { status: 201 });
        } catch (e) {
        console.error('Error creating insurance record:', e);
        return NextResponse.json({ error: 'Failed to create insurance record' }, { status: 500 });
      }
  });
}

