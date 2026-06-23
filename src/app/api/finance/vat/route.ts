import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const endDate = new Date(year, endMonth, 0);
  const end = endDate.toISOString().split('T')[0];
  return { start, end };
}

type RevRow = { total: number | null };
type VatReturnRow = Record<string, unknown>;

const zero = () => Promise.resolve([{ total: 0 }] as RevRow[]);

export async function GET(req: NextRequest) {
  await ensureOperationalTenantColumn('vat_returns').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', {
    requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
  });
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get('year') ?? String(now.getFullYear()), 10);
  const quarter = parseInt(searchParams.get('quarter') ?? String(Math.ceil((now.getMonth() + 1) / 3)), 10);
  const { start, end } = quarterRange(year, quarter);

  const [
    logisticsRev, racRev, leasingRev, financeInvRev,
    logisticsTax, racTax, leasingTax, financeInvTax,
  ] = await Promise.all([
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM logistics_bookings
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
         AND created_at::date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM rental_agreements
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(monthly_rate),0) AS total FROM lease_agreements
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount - vat_amount),0) AS total FROM finance_invoices
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND payment_status NOT IN ('DRAFT','CANCELLED')
         AND issue_date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0) AS total FROM logistics_bookings
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
         AND created_at::date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0) AS total FROM rental_agreements
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(monthly_rate * 0.05),0) AS total FROM lease_agreements
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(vat_amount),0) AS total FROM finance_invoices
       WHERE deleted_at IS NULL AND tenant_id::text = $3
         AND payment_status NOT IN ('DRAFT','CANCELLED')
         AND issue_date BETWEEN $1 AND $2`,
      start, end, ctx.tenantId,
    ).catch(zero),
  ]);

  const totalRevenue = [logisticsRev, racRev, leasingRev, financeInvRev]
    .reduce((sum, r) => sum + Number(r[0]?.total ?? 0), 0);
  const totalVatCollected = [logisticsTax, racTax, leasingTax, financeInvTax]
    .reduce((sum, r) => sum + Number(r[0]?.total ?? 0), 0);

  const [inputVatRow] = await prisma.$queryRawUnsafe<RevRow[]>(
    `SELECT COALESCE(SUM(total_cost),0) AS total FROM fuel_logs
     WHERE tenant_id::text = $3
       AND created_at::date BETWEEN $1 AND $2`,
    start, end, ctx.tenantId,
  ).catch(() => [{ total: 0 }]);
  const inputVat = Math.round(Number(inputVatRow?.total ?? 0) * 0.05 * 100) / 100;
  const netVat = Math.round((totalVatCollected - inputVat) * 100) / 100;

  const summary = {
    period: `Q${quarter} ${year}`,
    periodStart: start,
    periodEnd: end,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalVatCollected: Math.round(totalVatCollected * 100) / 100,
    inputVat,
    netVatPayable: Math.max(0, netVat),
    vatRefundable: netVat < 0 ? Math.abs(netVat) : 0,
    breakdown: {
      logistics: { revenue: Math.round(Number(logisticsRev[0]?.total ?? 0) * 100) / 100, vat: Math.round(Number(logisticsTax[0]?.total ?? 0) * 100) / 100 },
      rac: { revenue: Math.round(Number(racRev[0]?.total ?? 0) * 100) / 100, vat: Math.round(Number(racTax[0]?.total ?? 0) * 100) / 100 },
      leasing: { revenue: Math.round(Number(leasingRev[0]?.total ?? 0) * 100) / 100, vat: Math.round(Number(leasingTax[0]?.total ?? 0) * 100) / 100 },
      invoices: { revenue: Math.round(Number(financeInvRev[0]?.total ?? 0) * 100) / 100, vat: Math.round(Number(financeInvTax[0]?.total ?? 0) * 100) / 100 },
    },
  };

  const returns = await prisma.$queryRawUnsafe<VatReturnRow[]>(
    `SELECT * FROM vat_returns
     WHERE tenant_id::text = $1
     ORDER BY created_at DESC`,
    ctx.tenantId,
  ).catch(() => []);

  return NextResponse.json({ summary, returns });
}

export async function POST(req: NextRequest) {
  await ensureOperationalTenantColumn('vat_returns').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  try {
    const body = await req.json();
    const [vatReturn] = await prisma.$queryRawUnsafe<VatReturnRow[]>(
      `INSERT INTO vat_returns
        (period_start, period_end, total_sales, total_vat_output, total_vat_input, net_vat_due, status, filed_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      new Date(body.periodStart),
      new Date(body.periodEnd),
      body.totalSales ?? 0,
      body.outputTax ?? body.totalVatOutput ?? 0,
      body.inputTax ?? body.totalVatInput ?? 0,
      body.netTax ?? body.netVatDue ?? 0,
      body.status ?? 'DRAFT',
      body.submissionDate ? new Date(body.submissionDate) : null,
      ctx.tenantId,
    ).catch(() => []);

    if (!vatReturn) {
      return NextResponse.json({ error: 'Failed to create VAT return' }, { status: 500 });
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'FinanceVatReturn',
      entityId: String(vatReturn.id ?? ''),
      action: 'CREATE',
      after: vatReturn,
      summary: `Created VAT return for ${String(body.periodStart ?? '')} to ${String(body.periodEnd ?? '')}.`,
      riskSeverity: 'medium',
    });

    return NextResponse.json(vatReturn, { status: 201 });
  } catch (err) {
    console.error('[finance/vat POST]', err);
    return NextResponse.json({ error: 'Failed to create VAT return' }, { status: 500 });
  }
}
