export const dynamic = 'force-dynamic';

/**
 * /api/leasing/amendments — leasing amendment processing (raw-SQL backend).
 *
 * Tenant scoping: requires x-tenant-id. The schema is provisioned with a
 * `tenant_id` column by ensureTable(); reads filter by tenant; creates
 * stamp the new row with the same tenantId.
 *
 * Note: this route manages a hand-rolled `leasing_amendments` table (not a
 * Prisma model) via raw SQL. The auto-CREATE statement adds `tenant_id`
 * for new installs; existing databases without the column will get it
 * added in place via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
 *
 * Workflow: DRAFT → SUBMITTED → APPROVED → IMPLEMENTED
 *                              → REJECTED
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

type AmendmentRow = {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  tenant_id: string | null;
  amendment_no: string;
  contract_id: string | null;
  contract_no: string | null;
  lessee_name: string;
  vehicle_no: string | null;
  vehicle_name: string | null;
  amendment_type: string;
  description: string;
  original_value: string | null;
  new_value: string | null;
  financial_impact: string;
  vat_amount: string;
  total_impact: string;
  effective_date: string | null;
  status: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  implemented_at: string | null;
  notes: string | null;
};

type CountRow = { status: string; cnt: bigint };
type TypeCountRow = { amendment_type: string; cnt: bigint };
type TotalRow = { total: string | null };
type SeqRow = { seq: bigint };

function mapAmendment(r: AmendmentRow) {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    tenantId: r.tenant_id,
    amendmentNo: r.amendment_no,
    contractId: r.contract_id,
    contractNo: r.contract_no,
    lesseeName: r.lessee_name,
    vehicleNo: r.vehicle_no,
    vehicleName: r.vehicle_name,
    amendmentType: r.amendment_type,
    description: r.description,
    originalValue: r.original_value,
    newValue: r.new_value,
    financialImpact: parseFloat(r.financial_impact),
    vatAmount: parseFloat(r.vat_amount),
    totalImpact: parseFloat(r.total_impact),
    effectiveDate: r.effective_date,
    status: r.status,
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    rejectedBy: r.rejected_by,
    rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason,
    implementedAt: r.implemented_at,
    notes: r.notes,
  };
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const sp = req.nextUrl.searchParams;
        const status        = sp.get('status')         ?? '';
        const amendmentType = sp.get('amendment_type') ?? '';
        const search        = sp.get('search')         ?? '';
        const page          = Math.max(1, Number(sp.get('page')  ?? 1));
        const limit         = Math.min(100, Number(sp.get('limit') ?? 20));
        const offset        = (page - 1) * limit;

        const conds: string[] = ['a.deleted_at IS NULL', 'a.tenant_id = $1'];
        const params: unknown[] = [tenantId];
        let pi = 2;

        if (status)        { conds.push(`a.status = $${pi++}`);           params.push(status); }
        if (amendmentType) { conds.push(`a.amendment_type = $${pi++}`);   params.push(amendmentType); }
        if (search) {
          conds.push(`(a.contract_no ILIKE $${pi} OR a.lessee_name ILIKE $${pi} OR a.amendment_no ILIKE $${pi})`);
          params.push(`%${search}%`);
          pi++;
        }

        const where = `WHERE ${conds.join(' AND ')}`;

        const [rows, countRows, statusCounts, typeCounts, financialRow] = await Promise.all([
          tx.$queryRawUnsafe<AmendmentRow[]>(
            `SELECT a.* FROM leasing_amendments a ${where} ORDER BY a.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
            ...params, limit, offset
          ).catch(() => [] as AmendmentRow[]),

          tx.$queryRawUnsafe<[{ cnt: bigint }]>(
            `SELECT COUNT(*) AS cnt FROM leasing_amendments a ${where}`,
            ...params
          ).catch(() => [{ cnt: BigInt(0) }]),

          tx.$queryRawUnsafe<CountRow[]>(
            `SELECT status, COUNT(*) AS cnt FROM leasing_amendments WHERE deleted_at IS NULL AND tenant_id = $1 GROUP BY status`,
            tenantId
          ).catch(() => [] as CountRow[]),

          tx.$queryRawUnsafe<TypeCountRow[]>(
            `SELECT amendment_type, COUNT(*) AS cnt FROM leasing_amendments WHERE deleted_at IS NULL AND tenant_id = $1 GROUP BY amendment_type`,
            tenantId
          ).catch(() => [] as TypeCountRow[]),

          tx.$queryRawUnsafe<TotalRow[]>(
            `SELECT SUM(financial_impact)::TEXT AS total FROM leasing_amendments WHERE deleted_at IS NULL AND tenant_id = $1 AND financial_impact > 0`,
            tenantId
          ).catch(() => [{ total: '0' }]),
        ]);

        const total = Number(countRows[0]?.cnt ?? 0);
        const statusMap = Object.fromEntries(statusCounts.map(s => [s.status, Number(s.cnt)]));
        const typeMap   = Object.fromEntries(typeCounts.map(t => [t.amendment_type, Number(t.cnt)]));

        const thisMonth = new Date().toISOString().slice(0, 7);
        const [approvedThisMonthRow] = await tx.$queryRawUnsafe<[{ cnt: bigint }]>(
          `SELECT COUNT(*) AS cnt FROM leasing_amendments WHERE tenant_id = $1 AND status = 'APPROVED' AND TO_CHAR(approved_at, 'YYYY-MM') = $2`,
          tenantId, thisMonth
        ).catch(() => [{ cnt: BigInt(0) }]);

        return NextResponse.json({
          data: rows.map(mapAmendment),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
          summary: {
            byStatus: statusMap,
            byType: typeMap,
            totalFinancialImpact: parseFloat(financialRow[0]?.total ?? '0'),
            approvedThisMonth: Number(approvedThisMonthRow?.cnt ?? 0),
            pendingApproval: statusMap['SUBMITTED'] ?? 0,
          },
        });
        } catch (err) {
        console.error('[amendments GET]', err);
        return NextResponse.json({ error: 'Failed to load amendments' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

        const {
          contractId, contractNo, lesseeName, vehicleNo, vehicleName,
          amendmentType, description, originalValue, newValue,
          financialImpact = 0, effectiveDate, submittedBy, notes,
        } = body;

        if (!lesseeName?.trim()) {
          return NextResponse.json({ error: 'lessee_name is required' }, { status: 400 });
        }
        if (!amendmentType?.trim()) {
          return NextResponse.json({ error: 'amendment_type is required' }, { status: 400 });
        }
        if (!description?.trim()) {
          return NextResponse.json({ error: 'description is required' }, { status: 400 });
        }

        const validTypes = ['MILEAGE_UPGRADE', 'VEHICLE_SWAP', 'TERM_EXTENSION', 'RATE_CHANGE', 'ADDITIONAL_SERVICE', 'OTHER'];
        if (!validTypes.includes(amendmentType)) {
          return NextResponse.json({ error: `amendment_type must be one of: ${validTypes.join(', ')}` }, { status: 400 });
        }

        if (contractId) {
          const owned = await tx.leaseContract2.findFirst({
            where: { id: contractId, tenantId },
            select: { id: true },
          });
          if (!owned) {
            return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
          }
        }

        const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
        const [seqRow] = await tx.$queryRawUnsafe<SeqRow[]>(
          `SELECT COUNT(*) + 1 AS seq FROM leasing_amendments WHERE tenant_id = $1 AND amendment_no LIKE $2`,
          tenantId, `LAM-${yyyymm}-%`
        );
        const seq = String(Number(seqRow?.seq ?? 1)).padStart(4, '0');
        const amendmentNo = `LAM-${yyyymm}-${seq}`;

        const impact    = parseFloat(String(financialImpact)) || 0;
        const vatAmount = impact > 0 ? parseFloat((impact * 0.05).toFixed(2)) : 0;
        const totalImpact = parseFloat((impact + vatAmount).toFixed(2));

        type NewRow = { id: string; amendment_no: string };
        const [row] = await tx.$queryRawUnsafe<NewRow[]>(
          `INSERT INTO leasing_amendments
             (tenant_id, amendment_no, contract_id, contract_no, lessee_name, vehicle_no, vehicle_name,
              amendment_type, description, original_value, new_value,
              financial_impact, vat_amount, total_impact, effective_date,
              submitted_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id, amendment_no`,
          tenantId,
          amendmentNo,
          contractId   || null,
          contractNo   || null,
          lesseeName.trim(),
          vehicleNo    || null,
          vehicleName  || null,
          amendmentType,
          description.trim(),
          originalValue || null,
          newValue      || null,
          impact,
          vatAmount,
          totalImpact,
          effectiveDate || null,
          submittedBy   || null,
          notes         || null
        );

        return NextResponse.json({ id: row.id, amendmentNo: row.amendment_no }, { status: 201 });
        } catch (err) {
        console.error('[amendments POST]', err);
        return NextResponse.json({ error: 'Failed to create amendment' }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const id = req.nextUrl.searchParams.get('id');
        if (!id) {
          return NextResponse.json({ error: 'id query param required' }, { status: 400 });
        }

        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { action, approvedBy, rejectedBy, rejectionReason } = body;

        const [current] = await tx.$queryRawUnsafe<AmendmentRow[]>(
          `SELECT * FROM leasing_amendments WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          id, tenantId
        );
        if (!current) {
          return NextResponse.json({ error: 'Amendment not found' }, { status: 404 });
        }

        const now = new Date().toISOString();

        if (action === 'SUBMIT') {
          if (current.status !== 'DRAFT') {
            return NextResponse.json({ error: 'Only DRAFT amendments can be submitted' }, { status: 400 });
          }
          await tx.$executeRawUnsafe(
            `UPDATE leasing_amendments SET status='SUBMITTED', submitted_at=$1, updated_at=$2 WHERE id=$3 AND tenant_id=$4`,
            now, now, id, tenantId
          );
        } else if (action === 'APPROVE') {
          if (current.status !== 'SUBMITTED') {
            return NextResponse.json({ error: 'Only SUBMITTED amendments can be approved' }, { status: 400 });
          }
          await tx.$executeRawUnsafe(
            `UPDATE leasing_amendments SET status='APPROVED', approved_by=$1, approved_at=$2, updated_at=$3 WHERE id=$4 AND tenant_id=$5`,
            approvedBy || 'System', now, now, id, tenantId
          );
        } else if (action === 'REJECT') {
          if (current.status !== 'SUBMITTED') {
            return NextResponse.json({ error: 'Only SUBMITTED amendments can be rejected' }, { status: 400 });
          }
          if (!rejectionReason?.trim()) {
            return NextResponse.json({ error: 'rejection_reason is required' }, { status: 400 });
          }
          await tx.$executeRawUnsafe(
            `UPDATE leasing_amendments SET status='REJECTED', rejected_by=$1, rejected_at=$2, rejection_reason=$3, updated_at=$4 WHERE id=$5 AND tenant_id=$6`,
            rejectedBy || 'System', now, rejectionReason.trim(), now, id, tenantId
          );
        } else if (action === 'IMPLEMENT') {
          if (current.status !== 'APPROVED') {
            return NextResponse.json({ error: 'Only APPROVED amendments can be implemented' }, { status: 400 });
          }
          await tx.$executeRawUnsafe(
            `UPDATE leasing_amendments SET status='IMPLEMENTED', implemented_at=$1, updated_at=$2 WHERE id=$3 AND tenant_id=$4`,
            now, now, id, tenantId
          );
        } else {
          return NextResponse.json({ error: `Unknown action: ${action}. Must be SUBMIT, APPROVE, REJECT, or IMPLEMENT` }, { status: 400 });
        }

        const [updated] = await tx.$queryRawUnsafe<AmendmentRow[]>(
          `SELECT * FROM leasing_amendments WHERE id = $1 AND tenant_id = $2`, id, tenantId
        );
        return NextResponse.json(mapAmendment(updated));
      } catch (err) {
        console.error('[amendments PATCH]', err);
        return NextResponse.json({ error: 'Failed to update amendment' }, { status: 500 });
      }
  });
}

