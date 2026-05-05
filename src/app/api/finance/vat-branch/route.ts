import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/finance/vat-branch
 * Consolidated UAE FTA VAT Return with per-branch breakdown.
 *
 * Query params:
 *   tenantId   — required
 *   startDate  — YYYY-MM-DD
 *   endDate    — YYYY-MM-DD
 *   quarter    — e.g. "Q1-2026" (alternative to startDate/endDate)
 */

function num(v: unknown): number {
  return v === null || v === undefined ? 0 : parseFloat(String(v));
}

function quarterDates(q: string): { start: string; end: string } | null {
  const match = q.match(/^Q([1-4])-(\d{4})$/);
  if (!match) return null;
  const [, qNum, year] = match;
  const startMonth = (parseInt(qNum) - 1) * 3;
  const start = new Date(parseInt(year), startMonth, 1);
  const end   = new Date(parseInt(year), startMonth + 3, 0);
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId') ?? '';
  const quarter  = searchParams.get('quarter') ?? '';

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  let startDate = searchParams.get('startDate') ?? '';
  let endDate   = searchParams.get('endDate')   ?? '';

  if (quarter) {
    const qDates = quarterDates(quarter);
    if (qDates) { startDate = qDates.start; endDate = qDates.end; }
  }

  if (!startDate) {
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    startDate = qStart.toISOString().split('T')[0];
    endDate   = now.toISOString().split('T')[0];
  }

  // ── Tenant info ─────────────────────────────────────────────────────────
  type TenantRow = { name: string; trn?: string; code?: string; contact_email?: string };
  const [tenant] = await prisma.$queryRawUnsafe<TenantRow[]>(
    `SELECT name, trn, code, contact_email FROM tenants WHERE id = $1`,
    tenantId
  ).catch(() => [] as TenantRow[]);

  // ── VAT by branch (output tax on sales) ─────────────────────────────────
  type VatRow = {
    branch_id: string | null;
    branch_name: string | null;
    emirate: string | null;
    trade_license_no: string | null;
    trade_license_authority: string | null;
    cost_center_code: string | null;
    taxable_supplies: string | number;
    vat_output: string | number;
    zero_rated: string | number;
    exempt: string | number;
    invoice_count: bigint;
  };

  const vatByBranch = await prisma.$queryRawUnsafe<VatRow[]>(
    `SELECT
       b.id                     AS branch_id,
       b.branch_name,
       b.emirate,
       b.trade_license_no,
       b.trade_license_authority,
       b.cost_center_code,
       COALESCE(SUM(CASE WHEN i.vat_rate > 0 THEN i.subtotal ELSE 0 END), 0)   AS taxable_supplies,
       COALESCE(SUM(i.vat_amount), 0)                                            AS vat_output,
       COALESCE(SUM(CASE WHEN i.vat_rate = 0 THEN i.subtotal ELSE 0 END), 0)   AS zero_rated,
       0                                                                          AS exempt,
       COUNT(i.id)                                                                AS invoice_count
     FROM tenant_branches b
     LEFT JOIN finance_invoices i
       ON i.branch_id = b.id
       AND i.deleted_at IS NULL
       AND i.payment_status NOT IN ('DRAFT','CANCELLED')
       AND i.issue_date BETWEEN $1::date AND $2::date
     WHERE b.tenant_id = $3
       AND b.deleted_at IS NULL
     GROUP BY b.id, b.branch_name, b.emirate, b.trade_license_no, b.trade_license_authority, b.cost_center_code
     ORDER BY b.emirate ASC, taxable_supplies DESC`,
    startDate, endDate, tenantId
  ).catch(err => { console.error('[vat-branch output]', err); return [] as VatRow[]; });

  // Unassigned invoices (no branch)
  type UnassRow = { taxable_supplies: string|number; vat_output: string|number; zero_rated: string|number; invoice_count: bigint };
  const [unassigned] = await prisma.$queryRawUnsafe<UnassRow[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN vat_rate > 0 THEN subtotal ELSE 0 END), 0) AS taxable_supplies,
       COALESCE(SUM(vat_amount), 0)                                       AS vat_output,
       COALESCE(SUM(CASE WHEN vat_rate = 0 THEN subtotal ELSE 0 END), 0) AS zero_rated,
       COUNT(id) AS invoice_count
     FROM finance_invoices
     WHERE tenant_id = $1
       AND branch_id IS NULL
       AND deleted_at IS NULL
       AND payment_status NOT IN ('DRAFT','CANCELLED')
       AND issue_date BETWEEN $2::date AND $3::date`,
    tenantId, startDate, endDate
  ).catch(() => [] as UnassRow[]).then(r => r.length ? r : [{ taxable_supplies: 0, vat_output: 0, zero_rated: 0, invoice_count: BigInt(0) }]);

  // ── Input VAT (purchases / expenses) ────────────────────────────────────
  type InputRow = {
    branch_id: string | null;
    branch_name: string | null;
    input_vat: string | number;
    taxable_purchases: string | number;
  };

  const inputVatByBranch = await prisma.$queryRawUnsafe<InputRow[]>(
    `SELECT
       b.id          AS branch_id,
       b.branch_name,
       COALESCE(SUM(e.vat_amount), 0)   AS input_vat,
       COALESCE(SUM(e.amount), 0)        AS taxable_purchases
     FROM tenant_branches b
     LEFT JOIN finance_expenses e
       ON e.branch_id = b.id
       AND e.deleted_at IS NULL
       AND e.expense_date BETWEEN $1::date AND $2::date
     WHERE b.tenant_id = $3
       AND b.deleted_at IS NULL
     GROUP BY b.id, b.branch_name`,
    startDate, endDate, tenantId
  ).catch(() => [] as InputRow[]);

  const inputMap: Record<string, { input_vat: number; taxable_purchases: number }> = {};
  for (const r of inputVatByBranch) {
    if (r.branch_id) inputMap[String(r.branch_id)] = { input_vat: num(r.input_vat), taxable_purchases: num(r.taxable_purchases) };
  }

  // ── Build per-branch VAT lines ───────────────────────────────────────────
  const branchLines = vatByBranch.map(r => {
    const bid      = r.branch_id ? String(r.branch_id) : null;
    const inputs   = bid ? (inputMap[bid] ?? { input_vat: 0, taxable_purchases: 0 }) : { input_vat: 0, taxable_purchases: 0 };
    return {
      branch_id:             bid,
      branch_name:           r.branch_name ?? 'Unknown',
      emirate:               r.emirate ?? null,
      trade_license_no:      r.trade_license_no ?? null,
      trade_license_authority: r.trade_license_authority ?? null,
      cost_center_code:      r.cost_center_code ?? null,
      taxable_supplies:      Math.round(num(r.taxable_supplies) * 100) / 100,
      output_vat:            Math.round(num(r.vat_output) * 100) / 100,
      zero_rated_supplies:   Math.round(num(r.zero_rated) * 100) / 100,
      exempt_supplies:       0,
      invoice_count:         Number(r.invoice_count),
      taxable_purchases:     Math.round(inputs.taxable_purchases * 100) / 100,
      input_vat:             Math.round(inputs.input_vat * 100) / 100,
      net_vat_position:      Math.round((num(r.vat_output) - inputs.input_vat) * 100) / 100,
    };
  });

  // Add unassigned if non-zero
  if (num(unassigned.taxable_supplies) > 0) {
    branchLines.push({
      branch_id:             null,
      branch_name:           'Unassigned',
      emirate:               null,
      trade_license_no:      null,
      trade_license_authority: null,
      cost_center_code:      null,
      taxable_supplies:      Math.round(num(unassigned.taxable_supplies) * 100) / 100,
      output_vat:            Math.round(num(unassigned.vat_output) * 100) / 100,
      zero_rated_supplies:   Math.round(num(unassigned.zero_rated) * 100) / 100,
      exempt_supplies:       0,
      invoice_count:         Number(unassigned.invoice_count),
      taxable_purchases:     0,
      input_vat:             0,
      net_vat_position:      Math.round(num(unassigned.vat_output) * 100) / 100,
    });
  }

  // ── Consolidated FTA totals ──────────────────────────────────────────────
  const consolidated = branchLines.reduce((acc, b) => ({
    taxable_supplies:     acc.taxable_supplies     + b.taxable_supplies,
    output_vat:           acc.output_vat           + b.output_vat,
    zero_rated_supplies:  acc.zero_rated_supplies  + b.zero_rated_supplies,
    exempt_supplies:      acc.exempt_supplies      + b.exempt_supplies,
    taxable_purchases:    acc.taxable_purchases    + b.taxable_purchases,
    input_vat:            acc.input_vat            + b.input_vat,
    invoice_count:        acc.invoice_count        + b.invoice_count,
  }), { taxable_supplies: 0, output_vat: 0, zero_rated_supplies: 0, exempt_supplies: 0, taxable_purchases: 0, input_vat: 0, invoice_count: 0 });

  const net_vat_payable = Math.round((consolidated.output_vat - consolidated.input_vat) * 100) / 100;

  return NextResponse.json({
    tenant: {
      id:            tenantId,
      name:          tenant?.name ?? tenantId,
      trn:           tenant?.trn ?? null,
      code:          tenant?.code ?? null,
      contact_email: tenant?.contact_email ?? null,
    },
    period: {
      start:   startDate,
      end:     endDate,
      quarter: quarter || null,
    },
    branch_lines: branchLines,
    consolidated: {
      ...consolidated,
      taxable_supplies:    Math.round(consolidated.taxable_supplies    * 100) / 100,
      output_vat:          Math.round(consolidated.output_vat          * 100) / 100,
      zero_rated_supplies: Math.round(consolidated.zero_rated_supplies * 100) / 100,
      taxable_purchases:   Math.round(consolidated.taxable_purchases   * 100) / 100,
      input_vat:           Math.round(consolidated.input_vat           * 100) / 100,
      net_vat_payable,
      refund_due: net_vat_payable < 0,
    },
    fta_filing: {
      due_date:      null, // Filled by frontend based on quarter
      reference_trn: tenant?.trn ?? null,
      filing_basis:  'ACCRUAL',
    },
  });
}
