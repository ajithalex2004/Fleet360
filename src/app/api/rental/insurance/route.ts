export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { nextRentalSerial, withSavepoint } from '@/lib/rental/locks';
import {
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';

/**
 * RAC Insurance Documentation API
 * Table: rental_insurance_policies
 *
 * GET    /api/rental/insurance?status=&search=
 * POST   /api/rental/insurance  — create new policy (`rental:create:insurance`)
 * PATCH  /api/rental/insurance  — update policy fields (`rental:edit:insurance`)
 * DELETE /api/rental/insurance  — soft-delete policy (`rental:delete:insurance`)
 */

function computeStatus(startDate: string, endDate: string): string {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (now < start) return 'PENDING';
  if (now > end) return 'EXPIRED';
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 30) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'insurance',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { searchParams } = new URL(req.url);
      const status = searchParams.get('status') ?? '';
      const search = searchParams.get('search') ?? '';
      const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 100) || 100));

      const conds: string[] = ['p.tenant_id::text = $1', 'p.deleted_at IS NULL'];
      const params: unknown[] = [tenantId];
      let pi = 2;

      if (status && status !== 'ALL') {
        if (status === 'EXPIRING_SOON') {
          conds.push(`p.end_date > NOW() AND p.end_date <= NOW() + INTERVAL '30 days'`);
        } else if (status === 'EXPIRED') {
          conds.push(`p.end_date < NOW()`);
        } else if (status === 'ACTIVE') {
          conds.push(`p.end_date > NOW() + INTERVAL '30 days' AND p.start_date <= NOW()`);
        } else {
          conds.push(`p.status = $${pi++}`);
          params.push(status);
        }
      }

      if (search) {
        conds.push(
          `(p.vehicle_no ILIKE $${pi} ESCAPE '\\' OR p.policy_no ILIKE $${pi} ESCAPE '\\' OR p.insurer ILIKE $${pi} ESCAPE '\\' OR p.vehicle_name ILIKE $${pi} ESCAPE '\\')`,
        );
        params.push(`%${escapeIlikePattern(search)}%`);
        pi++;
      }

      const where = `WHERE ${conds.join(' AND ')}`;

      type PolicyRow = {
        id: string;
        policy_no: string;
        vehicle_id: string | null;
        vehicle_no: string;
        vehicle_name: string | null;
        insurer: string;
        policy_type: string;
        coverage_amount: string | null;
        excess_amount: string;
        premium_annual: string | null;
        start_date: string;
        end_date: string;
        status: string;
        document_url: string | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
        expiry_days_remaining: number;
      };

      const policies = await withSavepoint<PolicyRow[]>(
        tx,
        'rental_ins_list',
        () =>
          tx.$queryRawUnsafe<PolicyRow[]>(
            `SELECT p.*,
                    CAST(CEIL(EXTRACT(EPOCH FROM (p.end_date::TIMESTAMPTZ - NOW())) / 86400) AS INT) AS expiry_days_remaining
               FROM rental_insurance_policies p
               ${where}
               ORDER BY p.end_date ASC
               LIMIT $${pi}`,
            ...params,
            limit,
          ),
        [],
      );

      type StatRow = {
        total: bigint;
        active: bigint;
        expiring_soon: bigint;
        expired: bigint;
        cancelled: bigint;
      };
      const statRows = await withSavepoint<StatRow[]>(
        tx,
        'rental_ins_stats',
        () =>
          tx.$queryRawUnsafe<StatRow[]>(
            `SELECT
               COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
               COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date > NOW() + INTERVAL '30 days' AND start_date <= NOW()) AS active,
               COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date > NOW() AND end_date <= NOW() + INTERVAL '30 days') AS expiring_soon,
               COUNT(*) FILTER (WHERE deleted_at IS NULL AND end_date < NOW()) AS expired,
               COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'CANCELLED') AS cancelled
             FROM rental_insurance_policies
             WHERE tenant_id::text = $1`,
            tenantId,
          ),
        [{ total: 0n, active: 0n, expiring_soon: 0n, expired: 0n, cancelled: 0n }],
      );
      const stats = statRows[0] ?? {
        total: 0n,
        active: 0n,
        expiring_soon: 0n,
        expired: 0n,
        cancelled: 0n,
      };

      type PremiumRow = { total_premium: string | null };
      const premRows = await withSavepoint<PremiumRow[]>(
        tx,
        'rental_ins_prem',
        () =>
          tx.$queryRawUnsafe<PremiumRow[]>(
            `SELECT SUM(premium_annual) AS total_premium
               FROM rental_insurance_policies
              WHERE tenant_id::text = $1
                AND deleted_at IS NULL
                AND end_date > NOW()`,
            tenantId,
          ),
        [{ total_premium: null }],
      );
      const premRow = premRows[0] ?? { total_premium: null };

      return NextResponse.json({
        policies: policies.map((p) => ({
          id: p.id,
          policyNo: p.policy_no,
          vehicleId: p.vehicle_id,
          vehicleNo: p.vehicle_no,
          vehicleName: p.vehicle_name,
          insurer: p.insurer,
          policyType: p.policy_type,
          coverageAmount: p.coverage_amount ? Number(p.coverage_amount) : null,
          excessAmount: Number(p.excess_amount),
          premiumAnnual: p.premium_annual ? Number(p.premium_annual) : null,
          startDate: p.start_date,
          endDate: p.end_date,
          status: p.status,
          documentUrl: p.document_url,
          notes: p.notes,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
          expiryDaysRemaining: p.expiry_days_remaining,
        })),
        stats: {
          total: Number(stats.total),
          active: Number(stats.active),
          expiringSoon: Number(stats.expiring_soon),
          expired: Number(stats.expired),
          cancelled: Number(stats.cancelled),
          totalPremiumAed: premRow.total_premium ? Number(premRow.total_premium) : 0,
        },
      });
    } catch (err) {
      console.error('[insurance GET]', err);
      return NextResponse.json({ error: 'Failed to load insurance policies' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'insurance',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const {
        vehicleId,
        vehicleNo,
        vehicleName,
        insurer,
        policyType = 'COMPREHENSIVE',
        coverageAmount,
        excessAmount = 0,
        premiumAnnual,
        startDate,
        endDate,
        documentUrl,
        notes,
      } = body;

      if (typeof vehicleNo !== 'string' || !vehicleNo.trim()) {
        return NextResponse.json({ error: 'Vehicle No is required' }, { status: 400 });
      }
      if (typeof insurer !== 'string' || !insurer.trim()) {
        return NextResponse.json({ error: 'Insurer is required' }, { status: 400 });
      }
      if (typeof startDate !== 'string' || !startDate.trim() || Number.isNaN(Date.parse(startDate))) {
        return NextResponse.json({ error: 'Valid start date is required' }, { status: 400 });
      }
      if (typeof endDate !== 'string' || !endDate.trim() || Number.isNaN(Date.parse(endDate))) {
        return NextResponse.json({ error: 'Valid end date is required' }, { status: 400 });
      }

      const parsedExcess = Number(excessAmount ?? 0);
      if (!Number.isFinite(parsedExcess) || parsedExcess < 0) {
        return NextResponse.json({ error: 'excessAmount must be zero or more' }, { status: 400 });
      }
      const parsedCoverage =
        coverageAmount !== undefined && coverageAmount !== null && coverageAmount !== ''
          ? Number(coverageAmount)
          : null;
      if (parsedCoverage !== null && (!Number.isFinite(parsedCoverage) || parsedCoverage < 0)) {
        return NextResponse.json({ error: 'coverageAmount must be zero or more' }, { status: 400 });
      }
      const parsedPremium =
        premiumAnnual !== undefined && premiumAnnual !== null && premiumAnnual !== ''
          ? Number(premiumAnnual)
          : null;
      if (parsedPremium !== null && (!Number.isFinite(parsedPremium) || parsedPremium < 0)) {
        return NextResponse.json({ error: 'premiumAnnual must be zero or more' }, { status: 400 });
      }

      const safeDocumentUrl = validateSafeDocumentOrSignatureUrl(documentUrl, {
        allowPdfDataUrl: true,
        fieldName: 'documentUrl',
      });

      const normalizedVehicleId =
        typeof vehicleId === 'string' && vehicleId.trim() ? vehicleId.trim() : null;
      if (normalizedVehicleId) {
        await assertRentalForeignKeysInTenant(tx, tenantId, { vehicleId: normalizedVehicleId });
      }

      const now = new Date();
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const policyNo = await nextRentalSerial(tx, {
        tenantId,
        series: `rental-insurance:${ym}`,
        prefix: `RIP-${ym}-`,
        table: 'rental_insurance_policies',
        column: 'policy_no',
        padWidth: 4,
      });

      const status = computeStatus(startDate, endDate);

      type NewPolicy = { id: string; policy_no: string };
      const [policy] = await tx.$queryRawUnsafe<NewPolicy[]>(
        `INSERT INTO rental_insurance_policies
           (tenant_id, policy_no, vehicle_id, vehicle_no, vehicle_name, insurer, policy_type,
            coverage_amount, excess_amount, premium_annual, start_date, end_date, status, document_url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, policy_no`,
        tenantId,
        policyNo,
        normalizedVehicleId,
        vehicleNo.trim(),
        typeof vehicleName === 'string' && vehicleName.trim() ? vehicleName.trim() : null,
        insurer.trim(),
        typeof policyType === 'string' && policyType.trim() ? policyType.trim() : 'COMPREHENSIVE',
        parsedCoverage,
        parsedExcess,
        parsedPremium,
        startDate,
        endDate,
        status,
        safeDocumentUrl,
        typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      );

      return NextResponse.json({ id: policy.id, policyNo: policy.policy_no }, { status: 201 });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[insurance POST]', err);
      return NextResponse.json({ error: 'Failed to create insurance policy' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'insurance',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );
      const { id, ...fields } = body;

      if (typeof id !== 'string' || !id.trim()) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }
      const policyId = id.trim();

      if ('documentUrl' in fields) {
        fields.documentUrl = validateSafeDocumentOrSignatureUrl(fields.documentUrl, {
          allowPdfDataUrl: true,
          fieldName: 'documentUrl',
        });
      }

      if ('vehicleId' in fields && typeof fields.vehicleId === 'string' && fields.vehicleId.trim()) {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          vehicleId: fields.vehicleId.trim(),
        });
      }

      const colMap: Record<string, string> = {
        vehicleId: 'vehicle_id',
        vehicleNo: 'vehicle_no',
        vehicleName: 'vehicle_name',
        insurer: 'insurer',
        policyType: 'policy_type',
        coverageAmount: 'coverage_amount',
        excessAmount: 'excess_amount',
        premiumAnnual: 'premium_annual',
        startDate: 'start_date',
        endDate: 'end_date',
        status: 'status',
        documentUrl: 'document_url',
        notes: 'notes',
      };

      const setClauses: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let pi = 1;

      for (const [key, col] of Object.entries(colMap)) {
        if (key in fields) {
          setClauses.push(`${col} = $${pi++}`);
          const val = fields[key];
          params.push(val === '' ? null : val);
        }
      }

      if (fields.startDate || fields.endDate) {
        type DateRow = { start_date: string; end_date: string };
        const [cur] = await tx.$queryRawUnsafe<DateRow[]>(
          `SELECT start_date, end_date
             FROM rental_insurance_policies
            WHERE id::text = $1
              AND tenant_id::text = $2
              AND deleted_at IS NULL
            LIMIT 1`,
          policyId,
          tenantId,
        );
        if (!cur) {
          return NextResponse.json({ error: 'Insurance policy not found' }, { status: 404 });
        }
        const newStart = String(fields.startDate || cur.start_date);
        const newEnd = String(fields.endDate || cur.end_date);
        const newStatus = computeStatus(newStart, newEnd);
        if (!('status' in fields)) {
          setClauses.push(`status = $${pi++}`);
          params.push(newStatus);
        }
      }

      params.push(policyId, tenantId);
      const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE rental_insurance_policies
            SET ${setClauses.join(', ')}
          WHERE id::text = $${pi}
            AND tenant_id::text = $${pi + 1}
            AND deleted_at IS NULL
          RETURNING id::text AS id`,
        ...params,
      );
      if (updated.length === 0) {
        return NextResponse.json({ error: 'Insurance policy not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[insurance PATCH]', err);
      return NextResponse.json({ error: 'Failed to update insurance policy' }, { status: 500 });
    }
  });
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'insurance',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const queryId = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  const bodyRaw = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );
  const policyId = queryId || (typeof body.id === 'string' ? body.id.trim() : '');
  if (!policyId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const deleted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE rental_insurance_policies
            SET deleted_at = NOW(),
                updated_at = NOW()
          WHERE id::text = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          RETURNING id::text AS id`,
        policyId,
        tenantId,
      );
      if (deleted.length === 0) {
        return NextResponse.json({ error: 'Insurance policy not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error('[insurance DELETE]', err);
      return NextResponse.json({ error: 'Failed to delete insurance policy' }, { status: 500 });
    }
  });
}
