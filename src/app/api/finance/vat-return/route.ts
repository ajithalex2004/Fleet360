export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { extractTenantTaxMetadata, normalizeTrn } from '@/lib/finance/uae';
import { buildFtaFafReport, type FafPurchaseRecord, type FafSupplyRecord } from '@/lib/finance/fta-faf';
import { excludeMirrored, exchangeCommissionSqlPredicate } from '@/lib/finance/mirrored-revenue';

const VAT_NOT_MIRRORED = excludeMirrored(['RENTAL', 'LOGISTICS', 'LEASING']);
const EXCH_PRED = exchangeCommissionSqlPredicate();

function parseQuarter(periodParam?: string | null, yearParam?: string | null, quarterParam?: string | null) {
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.ceil((now.getMonth() + 1) / 3);

  if (periodParam) {
    const match = periodParam.match(/^(\d{4})[-_]?[Qq]?(\d)$/i);
    if (match) {
      year = parseInt(match[1]);
      quarter = parseInt(match[2]);
    }
  } else {
    if (yearParam) year = parseInt(yearParam);
    if (quarterParam) quarter = parseInt(quarterParam);
  }

  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, endMonth, 0));
  const end = endDate.toISOString().split('T')[0];

  return { year, quarter, start, end };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const { searchParams } = new URL(req.url);
      const { year, quarter, start, end } = parseQuarter(
        searchParams.get('period'),
        searchParams.get('year'),
        searchParams.get('quarter'),
      );

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { code: true, name: true, localizedName: true, trn: true, address: true },
      });

      const cleanTrn = normalizeTrn(tenant?.trn);

      const sellerMeta = extractTenantTaxMetadata({
        localizedName: tenant?.localizedName,
        address: tenant?.address,
        trn: cleanTrn || undefined,
      });

      type RevRow = { total: number | null };

      const logisticsRev = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(customer_rate_amount),0) AS total FROM logistics_shipment_orders
         WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
           AND created_at::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const logisticsTax = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(customer_rate_amount * 0.05),0) AS total FROM logistics_shipment_orders
         WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
           AND created_at::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const racRev = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(
                  SUM(
                    COALESCE(
                      ri.taxable_amount,
                      CASE
                        WHEN COALESCE(ri.invoice_type, 'STANDARD') = 'CREDIT_NOTE' THEN ri.subtotal
                        ELSE ri.subtotal - COALESCE(ri.discount_amount, 0)
                      END
                    )
                  ),
                  0
                ) AS total
           FROM rental_invoices ri
          WHERE ri.tenant_id::text = $3
            AND ri.deleted_at IS NULL
            AND UPPER(COALESCE(ri.status, '')) NOT IN ('DRAFT', 'VOID', 'CANCELLED')
            AND ri.invoice_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const racTax = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(ri.tax_amount), 0) AS total
           FROM rental_invoices ri
          WHERE ri.tenant_id::text = $3
            AND ri.deleted_at IS NULL
            AND UPPER(COALESCE(ri.status, '')) NOT IN ('DRAFT', 'VOID', 'CANCELLED')
            AND ri.invoice_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const leasingRev = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(sub_total),0) AS total FROM lease_invoices
         WHERE tenant_id = $3 AND UPPER(COALESCE(status, '')) NOT IN ('DRAFT','CANCELLED','VOID')
           AND issue_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const leasingTax = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(vat_amount),0) AS total FROM lease_invoices
         WHERE tenant_id = $3 AND UPPER(COALESCE(status, '')) NOT IN ('DRAFT','CANCELLED','VOID')
           AND issue_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const financeInvRev = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(total_amount - vat_amount),0) AS total FROM finance_invoices
         WHERE tenant_id = $3 AND deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
           AND issue_date BETWEEN $1::date AND $2::date${VAT_NOT_MIRRORED} AND NOT ${EXCH_PRED}`, start, end, tenantId
      );
      const financeInvTax = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(vat_amount),0) AS total FROM finance_invoices
         WHERE tenant_id = $3 AND deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
           AND issue_date BETWEEN $1::date AND $2::date${VAT_NOT_MIRRORED} AND NOT ${EXCH_PRED}`, start, end, tenantId
      );
      const creditNoteRev = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(subtotal),0) AS total FROM finance_credit_notes
         WHERE tenant_id = $3 AND deleted_at IS NULL
           AND UPPER(COALESCE(status, '')) IN ('ISSUED', 'APPLIED', 'REFUNDED')
           AND issue_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const creditNoteTax = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(vat_amount),0) AS total FROM finance_credit_notes
         WHERE tenant_id = $3 AND deleted_at IS NULL
           AND UPPER(COALESCE(status, '')) IN ('ISSUED', 'APPLIED', 'REFUNDED')
           AND issue_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const exchangeCommRev = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(total_amount - vat_amount),0) AS total FROM finance_invoices
         WHERE tenant_id = $3 AND deleted_at IS NULL
           AND ${EXCH_PRED}
           AND payment_status NOT IN ('DRAFT', 'CANCELLED')
           AND issue_date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const exchangeCommTax = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(vat_amount),0) AS total FROM finance_invoices
         WHERE tenant_id = $3 AND deleted_at IS NULL
           AND ${EXCH_PRED}
           AND payment_status NOT IN ('DRAFT', 'CANCELLED')
           AND issue_date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const payableRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT payable_number, vendor_name, subtotal, vat_amount, total_amount, currency, issue_date, description
           FROM finance_payables
          WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED', 'POSTED')
            AND issue_date BETWEEN $1::date AND $2::date
          ORDER BY issue_date ASC`, start, end, tenantId
      );
      const expenseRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT expense_no, category, sub_category, reference_no, amount, vat_amount, total_amount, currency, expense_date, description
           FROM finance_expenses
          WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED', 'PAID') AND COALESCE(vat_amount, 0) > 0
            AND expense_date BETWEEN $1::date AND $2::date
          ORDER BY expense_date ASC`, start, end, tenantId
      );

    const logRevVal = Math.round(Number(logisticsRev[0]?.total ?? 0) * 100) / 100;
    const racRevVal = Math.round(Number(racRev[0]?.total ?? 0) * 100) / 100;
    const leaseRevVal = Math.round(Number(leasingRev[0]?.total ?? 0) * 100) / 100;
    const finRevVal = Math.round(Number(financeInvRev[0]?.total ?? 0) * 100) / 100;
    const cnRevVal = Math.round(Number(creditNoteRev[0]?.total ?? 0) * 100) / 100;
    const exchRevVal = Math.round(Number(exchangeCommRev[0]?.total ?? 0) * 100) / 100;

    const logVatVal = Math.round(Number(logisticsTax[0]?.total ?? 0) * 100) / 100;
    const racVatVal = Math.round(Number(racTax[0]?.total ?? 0) * 100) / 100;
    const leaseVatVal = Math.round(Number(leasingTax[0]?.total ?? 0) * 100) / 100;
    const finVatVal = Math.round(Number(financeInvTax[0]?.total ?? 0) * 100) / 100;
    const cnVatVal = Math.round(Number(creditNoteTax[0]?.total ?? 0) * 100) / 100;
    const exchVatVal = Math.round(Number(exchangeCommTax[0]?.total ?? 0) * 100) / 100;

    const totalRevenue = Math.round((logRevVal + racRevVal + leaseRevVal + finRevVal + exchRevVal - cnRevVal) * 100) / 100;
    const totalVatCollected = Math.round((logVatVal + racVatVal + leaseVatVal + finVatVal + exchVatVal - cnVatVal) * 100) / 100;

    const payablesInputVat = payableRows.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0);
    const expensesInputVat = expenseRows.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0);
    const inputVat = Math.round((payablesInputVat + expensesInputVat) * 100) / 100;

    const payablesTotalSpend = payableRows.reduce((s, r) => s + Number(r.subtotal ?? 0), 0);
    const expensesTotalSpend = expenseRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const totalStandardRatedExpenses = Math.round((payablesTotalSpend + expensesTotalSpend) * 100) / 100;

    const fafSupplies: FafSupplyRecord[] = [];
    if (totalRevenue > 0) {
      fafSupplies.push({
        invoiceNo: `SALES-Q${quarter}-${year}`,
        invoiceDate: end,
        customerName: 'Commercial Operations',
        emirate: sellerMeta.emirate || 'Dubai',
        description: `Standard rated supplies Q${quarter} ${year}`,
        supplyValueAed: totalRevenue,
        vatValueAed: totalVatCollected,
        taxCode: 'SR',
      });
    }

    const fafPurchases: FafPurchaseRecord[] = [];
    for (const p of payableRows) {
      fafPurchases.push({
        invoiceNo: String(p.payable_number ?? 'AP'),
        invoiceDate: p.issue_date instanceof Date ? p.issue_date.toISOString().slice(0, 10) : String(p.issue_date ?? start).slice(0, 10),
        supplierName: String(p.vendor_name ?? 'Vendor'),
        description: String(p.description ?? 'Payable'),
        purchaseValueAed: Number(p.subtotal ?? 0),
        vatValueAed: Number(p.vat_amount ?? 0),
        taxCode: Number(p.vat_amount ?? 0) > 0 ? 'SR' : 'ZR',
      });
    }
    for (const e of expenseRows) {
      const vatVal = Number(e.vat_amount ?? 0);
      const expNo = String(e.expense_no ?? 'EXP');
      fafPurchases.push({
        invoiceNo: expNo,
        invoiceDate: e.expense_date instanceof Date ? e.expense_date.toISOString().slice(0, 10) : String(e.expense_date ?? start).slice(0, 10),
        supplierName: String(e.reference_no || e.sub_category || e.category || 'Supplier'),
        description: String(e.description ?? `Expense ${expNo}`),
        purchaseValueAed: Number(e.amount ?? 0),
        vatValueAed: vatVal,
        taxCode: vatVal > 0 ? 'SR' : 'ZR',
      });
    }

    const fafReport = buildFtaFafReport(
      {
        companyNameEn: tenant?.name || 'Fleet360 Operator LLC',
        companyNameAr: sellerMeta.nameAr || undefined,
        trn: cleanTrn,
        periodStart: start,
        periodEnd: end,
        defaultEmirate: sellerMeta.emirate,
      },
      fafSupplies,
      fafPurchases,
    );

    const netVat = Math.round((totalVatCollected - inputVat) * 100) / 100;

    return NextResponse.json({
      period: `Q${quarter} ${year}`,
      periodStart: start,
      periodEnd: end,
      box1_standard_rated_supplies: Math.max(0, totalRevenue),
      box1_vat: Math.max(0, totalVatCollected),
      box8_standard_rated_expenses: totalStandardRatedExpenses,
      box8_vat: inputVat,
      box14_net_vat: netVat,
      netVatPayable: Math.max(0, netVat),
      vatRefundable: netVat < 0 ? Math.abs(netVat) : 0,
      emirateBreakdown: fafReport.vat201Boxes.box1StandardRatedByEmirate,
      breakdown: {
        logistics: { revenue: logRevVal, vat: logVatVal },
        rac: { revenue: racRevVal, vat: racVatVal },
        leasing: { revenue: leaseRevVal, vat: leaseVatVal },
        invoices: { revenue: finRevVal, vat: finVatVal },
        creditNotes: { revenue: cnRevVal, vat: cnVatVal },
        exchangeCommissions: { revenue: exchRevVal, vat: exchVatVal },
      },
      vat201Boxes: fafReport.vat201Boxes,
    });
    });
  } catch (err) {
    console.error('[finance/vat-return GET]', err);
    return NextResponse.json({ error: 'Failed to generate VAT return' }, { status: 500 });
  }
}
