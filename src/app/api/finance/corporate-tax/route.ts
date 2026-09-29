export const dynamic = 'force-dynamic';

/**
 * UAE Corporate Tax API — /api/finance/corporate-tax
 * UAE CT: 9% on taxable income above AED 375,000 threshold (Small Business Relief up to AED 3M revenue)
 * FTA return periods, exemptions, tax group registration
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { fixedAssetsTenantScoped } from '@/lib/finance/fixed-assets-scope';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

function toN(v: unknown): number { return parseFloat(String(v ?? 0)) || 0; }

async function computeRevenue(from: string, to: string, tenantId: string): Promise<number> {
  const [rev] = await prisma.$queryRawUnsafe<{t:string}[]>(
    `SELECT COALESCE(SUM(subtotal),0)::text as t FROM finance_invoices
     WHERE tenant_id = $3 AND deleted_at IS NULL AND issue_date BETWEEN $1::date AND $2::date
       AND payment_status NOT IN ('DRAFT','CANCELLED')`, from, to, tenantId
  ).catch(()=>[{t:'0'}]);
  const [rac] = await prisma.$queryRawUnsafe<{t:string}[]>(
    `SELECT COALESCE(SUM(total_amount),0)::text as t FROM rental_invoices
     WHERE tenant_id = $3 AND deleted_at IS NULL AND created_at::date BETWEEN $1::date AND $2::date`, from, to, tenantId
  ).catch(()=>[{t:'0'}]);
  const [lg] = await prisma.$queryRawUnsafe<{t:string}[]>(
    `SELECT COALESCE(SUM(customer_rate_amount),0)::text as t FROM logistics_shipment_orders
     WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED') AND created_at::date BETWEEN $1::date AND $2::date`, from, to, tenantId
  ).catch(()=>[{t:'0'}]);
  return toN(rev?.t) + toN(rac?.t) + toN(lg?.t);
}

async function computeDeductions(from: string, to: string, tenantId: string): Promise<number> {
  const [fuel]  = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_cost),0)::text as t FROM fuel_logs WHERE tenant_id = $3 AND created_at::date BETWEEN $1::date AND $2::date`, from, to, tenantId).catch(()=>[{t:'0'}]);
  const [maint] = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(COALESCE(actual_cost, estimated_cost, 0)),0)::text as t FROM maintenance_requests WHERE tenant_id = $3 AND deleted_at IS NULL AND status='COMPLETED' AND created_at::date BETWEEN $1::date AND $2::date`, from, to, tenantId).catch(()=>[{t:'0'}]);
  // Depreciation from the fixed asset register, only where it is tenant-scoped
  // (it used to sum every tenant's schedule).
  const [dep]   = await fixedAssetsTenantScoped(prisma)
    ? await prisma.$queryRawUnsafe<{t:string}[]>(
        `SELECT COALESCE(SUM(ds.depreciation),0)::text as t
           FROM finance_depreciation_schedule ds
           JOIN finance_fixed_assets fa ON fa.id::text = ds.asset_id AND fa.tenant_id = ds.tenant_id
          WHERE fa.tenant_id = $3
            AND ds.period_year || '-' || LPAD(ds.period_month::text,2,'0') || '-01' BETWEEN $1 AND $2`,
        from, to, tenantId).catch(()=>[{t:'0'}])
    : [{t:'0'}];
  const [exp]   = await prisma.$queryRawUnsafe<{t:string}[]>(`SELECT COALESCE(SUM(total_amount),0)::text as t FROM finance_expenses WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED','PAID') AND expense_date BETWEEN $1::date AND $2::date`, from, to, tenantId).catch(()=>[{t:'0'}]);
  return toN(fuel?.t) + toN(maint?.t) + toN(dep?.t) + toN(exp?.t);
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp   = req.nextUrl.searchParams;
      const type = sp.get('type') ?? 'returns';

      if (type === 'estimate') {
        const year = parseInt(sp.get('year') ?? String(new Date().getFullYear()));
        const from = `${year}-01-01`;
        const to   = `${year}-12-31`;

        const [revenue, deductions, returns] = await Promise.all([
          computeRevenue(from, to, tenantId),
          computeDeductions(from, to, tenantId),
          tx.$queryRawUnsafe<{adj_type:string; amount:string}[]>(
            `SELECT adj_type, SUM(amount)::text as amount FROM finance_ct_adjustments
              WHERE tenant_id=$2 AND return_id IN (
               SELECT id::text FROM finance_ct_returns WHERE tenant_id=$2 AND tax_year=$1 AND deleted_at IS NULL
             ) GROUP BY adj_type`, year, tenantId
          ).catch(()=>[]),
        ]);

        const addBacks   = returns.filter(r => r.adj_type === 'ADD_BACK').reduce((s,r) => s + toN(r.amount), 0);
        const extraDeduct = returns.filter(r => r.adj_type === 'DEDUCTION').reduce((s,r) => s + toN(r.amount), 0);
        const exempt     = returns.filter(r => r.adj_type === 'EXEMPT').reduce((s,r) => s + toN(r.amount), 0);

        const isSBREligible  = revenue <= 3_000_000;
        const taxableIncome  = Math.max(0, revenue - deductions + addBacks - extraDeduct - exempt);
        const threshold      = 375_000;
        const aboveThreshold = Math.max(0, taxableIncome - threshold);
        const ctLiability    = isSBREligible ? 0 : Math.round(aboveThreshold * 0.09 * 100) / 100;
        const effectiveRate  = taxableIncome > 0 ? Math.round((ctLiability / taxableIncome) * 1000) / 10 : 0;

        return NextResponse.json({
          year, revenue: Math.round(revenue*100)/100, deductions: Math.round(deductions*100)/100,
          addBacks, extraDeductions: extraDeduct, exemptIncome: exempt,
          taxableIncome: Math.round(taxableIncome*100)/100,
          threshold, aboveThreshold: Math.round(aboveThreshold*100)/100,
          ctRate: 9, ctLiability, effectiveRate,
          isSBREligible, sbrThreshold: 3_000_000,
          filingDeadline: `${year + 1}-09-30`,  // 9 months after FY end
        });
      }

      if (type === 'adjustments') {
        const returnId = sp.get('returnId');
        if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 });
        const rows = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `SELECT * FROM finance_ct_adjustments WHERE tenant_id=$2 AND return_id=$1 ORDER BY created_at`, returnId, tenantId
        ).catch(()=>[]);
        return NextResponse.json({ data: rows });
      }

      // Default: list returns
      const returns = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
        `SELECT * FROM finance_ct_returns WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY tax_year DESC, period_from DESC`,
        tenantId,
      ).catch(()=>[]);
      return NextResponse.json({ data: returns });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (body.action === 'add_adjustment') {
        const { returnId, adjType, description, amount, reference, notes } = body;
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `INSERT INTO finance_ct_adjustments (return_id, adj_type, description, amount, reference, notes, tenant_id)
           VALUES ($1,$2,$3,$4::numeric,$5,$6,$7) RETURNING *`,
          returnId, adjType, description, amount, reference ?? null, notes ?? null, tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {}, { status: 201 });
      }

      if (body.action === 'file') {
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_ct_returns SET status='FILED', filed_at=NOW(), updated_at=NOW()
            WHERE id::text=$1 AND tenant_id=$2 RETURNING *`, body.returnId, tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {});
      }

      if (body.action === 'record_payment') {
        const { returnId, amount } = body;
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_ct_returns SET tax_paid=$2::numeric, balance_due=ct_liability-$2::numeric, updated_at=NOW()
            WHERE id::text=$1 AND tenant_id=$3 RETURNING *`,
          returnId, amount, tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {});
      }

      // Create return
      const { taxYear, periodFrom, periodTo, notes } = body;
      const revenue    = await computeRevenue(periodFrom, periodTo, tenantId);
      const deductions = await computeDeductions(periodFrom, periodTo, tenantId);
      const taxableIncome   = Math.max(0, revenue - deductions);
      const isSBR           = revenue <= 3_000_000;
      const aboveThreshold  = Math.max(0, taxableIncome - 375_000);
      const ctLiability     = isSBR ? 0 : Math.round(aboveThreshold * 0.09 * 100) / 100;
      const filingDeadline  = `${taxYear + 1}-09-30`;

      const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
        `INSERT INTO finance_ct_returns
           (tax_year, period_from, period_to, revenue, allowable_deductions, taxable_income,
            taxable_above_threshold, ct_liability, balance_due, is_sbr_eligible, filing_deadline, notes, tenant_id)
         VALUES ($1,$2::date,$3::date,$4,$5,$6,$7,$8,$8,$9,$10::date,$11,$12) RETURNING *`,
        taxYear, periodFrom, periodTo,
        Math.round(revenue*100)/100, Math.round(deductions*100)/100, Math.round(taxableIncome*100)/100,
        Math.round(aboveThreshold*100)/100, ctLiability,
        isSBR, filingDeadline, notes ?? null, tenantId
      ).catch(()=>[]);

      if (!row) return NextResponse.json({ error: 'Failed to create return' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

