export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { excludeMirrored, exchangeCommissionSqlPredicate } from '@/lib/finance/mirrored-revenue';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { extractTenantTaxMetadata, normalizeTrn } from '@/lib/finance/uae';
import {
  buildFtaFafReport,
  serializeFtaFafCsv,
  type FafPurchaseRecord,
  type FafSupplyRecord,
} from '@/lib/finance/fta-faf';

// Logistics, rental and lease revenue is taken from their own tables below;
// their mirrored finance_invoices rows would count it (and its VAT) twice.
const VAT_NOT_MIRRORED = excludeMirrored(['RENTAL', 'LOGISTICS', 'LEASING']);
const EXCH_PRED = exchangeCommissionSqlPredicate();

/**
 * GET  /api/finance/vat  — returns { summary, returns } or ?format=faf (UAE FTA Audit File v1.0.0 CSV)
 * POST /api/finance/vat  — create a new VAT return record
 */

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth   = startMonth + 2;
  const start = `${year}-${String(startMonth).padStart(2,'0')}-01`;
  const endDate = new Date(Date.UTC(year, endMonth, 0));
  const end = endDate.toISOString().split('T')[0];
  return { start, end };
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
      const now = new Date();
      const year    = parseInt(searchParams.get('year')    ?? String(now.getFullYear()));
      const quarter = parseInt(searchParams.get('quarter') ?? String(Math.ceil((now.getMonth() + 1) / 3)));
      const format  = searchParams.get('format') ?? 'json';
      const { start, end } = quarterRange(year, quarter);

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { code: true, name: true, localizedName: true, trn: true, address: true },
      });

      const cleanTrn = normalizeTrn(tenant?.trn);
      if ((format === 'faf' || format === 'faf-json' || searchParams.get('format') === 'faf') && !cleanTrn) {
        return NextResponse.json(
          { error: 'Tenant TRN must be configured before generating FTA Audit File' },
          { status: 422 },
        );
      }

      const sellerMeta = extractTenantTaxMetadata({
        localizedName: tenant?.localizedName,
        address: tenant?.address,
        trn: cleanTrn || undefined,
      });

      type RevRow = { total: number | null };

      // 1. Logistics: Tax-exclusive rate amount with standard 5% Output VAT
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

      // 2. RAC (Rent-A-Car): Sourced from rental_invoices
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
            AND (
              UPPER(COALESCE(ri.status, '')) NOT IN ('DRAFT', 'VOID', 'CANCELLED')
              OR EXISTS (
                SELECT 1 FROM rental_invoices cn
                 WHERE cn.parent_invoice_id = ri.id
                   AND cn.tenant_id::text = ri.tenant_id::text
                   AND cn.deleted_at IS NULL
                   AND cn.invoice_type = 'CREDIT_NOTE'
                   AND UPPER(COALESCE(cn.status, '')) NOT IN ('DRAFT', 'VOID', 'CANCELLED')
              )
            )
            AND ri.invoice_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );
      const racTax = await tx.$queryRawUnsafe<RevRow[]>(
        `SELECT COALESCE(SUM(ri.tax_amount), 0) AS total
           FROM rental_invoices ri
          WHERE ri.tenant_id::text = $3
            AND ri.deleted_at IS NULL
            AND (
              UPPER(COALESCE(ri.status, '')) NOT IN ('DRAFT', 'VOID', 'CANCELLED')
              OR EXISTS (
                SELECT 1 FROM rental_invoices cn
                 WHERE cn.parent_invoice_id = ri.id
                   AND cn.tenant_id::text = ri.tenant_id::text
                   AND cn.deleted_at IS NULL
                   AND cn.invoice_type = 'CREDIT_NOTE'
                   AND UPPER(COALESCE(cn.status, '')) NOT IN ('DRAFT', 'VOID', 'CANCELLED')
              )
            )
            AND ri.invoice_date::date BETWEEN $1::date AND $2::date`, start, end, tenantId
      );

      // 3. Corporate Leasing: Sourced from lease_invoices (by issue_date in quarter and non-cancelled status)
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

      // 4. Core Finance Invoices (excluding mirrored modules and Exchange commissions)
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

      // 5. Credit Notes Issued: Net off from revenue and VAT collected
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

      // 6. Freight Exchange Platform Commissions
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
      const invoiceRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT invoice_number, client_name, client_address, subtotal, discount_amount,
                vat_rate, vat_amount, currency, issue_date, branch, source_payload
           FROM finance_invoices
          WHERE tenant_id = $3 AND deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
            AND issue_date BETWEEN $1::date AND $2::date${VAT_NOT_MIRRORED} AND NOT ${EXCH_PRED}
          ORDER BY issue_date ASC`,
        start, end, tenantId
      );
      const payableRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT payable_number, vendor_name, subtotal, vat_amount, total_amount, currency, issue_date, description
           FROM finance_payables
          WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED', 'POSTED')
            AND issue_date BETWEEN $1::date AND $2::date
          ORDER BY issue_date ASC`,
        start, end, tenantId
      );
      const expenseRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT expense_no, category, sub_category, reference_no, amount, vat_amount, total_amount, currency, expense_date, description
           FROM finance_expenses
          WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED', 'PAID') AND COALESCE(vat_amount, 0) > 0
            AND expense_date BETWEEN $1::date AND $2::date
          ORDER BY expense_date ASC`,
        start, end, tenantId
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

    // Net sales supplies and Output VAT (netting off issued credit notes, adding exchange platform commissions)
    const totalRevenue = Math.round((logRevVal + racRevVal + leaseRevVal + finRevVal + exchRevVal - cnRevVal) * 100) / 100;
    const totalVatCollected = Math.round((logVatVal + racVatVal + leaseVatVal + finVatVal + exchVatVal - cnVatVal) * 100) / 100;

    // Deduplicated Input VAT: sourced strictly from verified finance_payables and finance_expenses with valid tax invoices
    const payablesInputVat = payableRows.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0);
    const expensesInputVat = expenseRows.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0);
    const inputVat = Math.round((payablesInputVat + expensesInputVat) * 100) / 100;

    const netVat = Math.round((totalVatCollected - inputVat) * 100) / 100;

    // Build FTA Audit File (FAF v1.0.0) & Form VAT 201 Box 1a-1g breakdown
    const fafSupplies: FafSupplyRecord[] = [];
    for (const r of invoiceRows) {
      const sp = (r.source_payload && typeof r.source_payload === 'object' ? r.source_payload : {}) as Record<string, unknown>;
      const netVal = Math.max(0, Number(r.subtotal ?? 0) - Number(r.discount_amount ?? 0));
      const vatVal = Number(r.vat_amount ?? 0);
      const issDate = r.issue_date instanceof Date ? r.issue_date.toISOString().slice(0, 10) : String(r.issue_date ?? start).slice(0, 10);
      fafSupplies.push({
        invoiceNo: String(r.invoice_number ?? 'INV'),
        invoiceDate: issDate,
        customerName: String(r.client_name ?? 'Customer'),
        customerTrn: sp.customerTrn ? String(sp.customerTrn) : undefined,
        emirate: String(sp.customerEmirate || r.branch || r.client_address || sellerMeta.emirate || 'Dubai'),
        lineNo: 1,
        description: `Tax Invoice ${r.invoice_number}`,
        supplyValueAed: netVal,
        vatValueAed: vatVal,
        taxCode: vatVal > 0 ? 'SR' : 'ZR',
        currency: String(r.currency || 'AED'),
      });
    }

    // Itemized Lease Invoices for FAF
    const leaseInvoiceRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT li.id, li.invoice_no, li.issue_date, li.sub_total, li.vat_amount, li.currency,
              l.name as lessee_name
         FROM lease_invoices li
         LEFT JOIN lessees l ON l.id = li.lessee_id
        WHERE li.tenant_id = $3 AND UPPER(COALESCE(li.status, '')) NOT IN ('DRAFT', 'CANCELLED', 'VOID')
          AND li.issue_date::date BETWEEN $1::date AND $2::date
        ORDER BY li.issue_date ASC`,
      start, end, tenantId
    );

    if (leaseInvoiceRows.length > 0) {
      for (const li of leaseInvoiceRows) {
        const netVal = Number(li.sub_total ?? 0);
        const vatVal = Number(li.vat_amount ?? 0);
        const issDate = li.issue_date instanceof Date ? li.issue_date.toISOString().slice(0, 10) : String(li.issue_date ?? start).slice(0, 10);
        fafSupplies.push({
          invoiceNo: String(li.invoice_no ?? `LSE-${li.id}`),
          invoiceDate: issDate,
          customerName: String(li.lessee_name ?? 'Corporate Leasing Client'),
          emirate: sellerMeta.emirate,
          lineNo: 1,
          description: `Corporate Fleet Lease Invoice ${li.invoice_no ?? li.id}`,
          supplyValueAed: netVal,
          vatValueAed: vatVal,
          taxCode: vatVal > 0 ? 'SR' : 'ZR',
          currency: String(li.currency || 'AED'),
        });
      }
    } else if (leaseRevVal > 0) {
      fafSupplies.push({
        invoiceNo: `LEASE-Q${quarter}-${year}`,
        invoiceDate: end,
        customerName: 'Corporate Leasing Consolidated Supplies',
        emirate: sellerMeta.emirate,
        lineNo: 1,
        description: `Corporate fleet lease supplies Q${quarter} ${year}`,
        supplyValueAed: leaseRevVal,
        vatValueAed: leaseVatVal,
        taxCode: 'SR',
      });
    }

    // Issued Credit Notes (negative supply adjustment)
    const creditNoteRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT cn_number, client_name, subtotal, vat_amount, currency, issue_date
         FROM finance_credit_notes
        WHERE tenant_id = $3 AND deleted_at IS NULL
          AND UPPER(COALESCE(status, '')) IN ('ISSUED', 'APPLIED', 'REFUNDED')
          AND issue_date::date BETWEEN $1::date AND $2::date
        ORDER BY issue_date ASC`,
      start, end, tenantId
    );

    for (const cn of creditNoteRows) {
      const netVal = -Math.abs(Number(cn.subtotal ?? 0));
      const vatVal = -Math.abs(Number(cn.vat_amount ?? 0));
      const issDate = cn.issue_date instanceof Date ? cn.issue_date.toISOString().slice(0, 10) : String(cn.issue_date ?? start).slice(0, 10);
      fafSupplies.push({
        invoiceNo: String(cn.cn_number ?? 'CN'),
        invoiceDate: issDate,
        customerName: String(cn.client_name ?? 'Client'),
        emirate: sellerMeta.emirate,
        lineNo: 1,
        description: `Tax Credit Note ${cn.cn_number}`,
        supplyValueAed: netVal,
        vatValueAed: vatVal,
        taxCode: 'SR',
        currency: String(cn.currency || 'AED'),
      });
    }

    if (logRevVal > 0) {
      fafSupplies.push({
        invoiceNo: `LOG-Q${quarter}-${year}`,
        invoiceDate: end,
        customerName: 'Logistics Module Consolidated Supplies',
        emirate: sellerMeta.emirate,
        lineNo: 1,
        description: `Delivered freight & shipment supplies Q${quarter} ${year}`,
        supplyValueAed: logRevVal,
        vatValueAed: logVatVal,
        taxCode: 'SR',
      });
    }
    if (racRevVal !== 0 || racVatVal !== 0) {
      fafSupplies.push({
        invoiceNo: `RAC-Q${quarter}-${year}`,
        invoiceDate: end,
        customerName: 'Rent-A-Car Module Consolidated Supplies',
        emirate: sellerMeta.emirate,
        lineNo: 1,
        description: `Short-term vehicle rental supplies Q${quarter} ${year}`,
        supplyValueAed: racRevVal,
        vatValueAed: racVatVal,
        taxCode: 'SR',
      });
    }
    if (exchRevVal > 0 || exchVatVal > 0) {
      fafSupplies.push({
        invoiceNo: `EXCH-COMM-Q${quarter}-${year}`,
        invoiceDate: end,
        customerName: 'Freight Exchange Platform Commission',
        emirate: sellerMeta.emirate,
        lineNo: 1,
        description: `Marketplace platform commission Q${quarter} ${year}`,
        supplyValueAed: exchRevVal,
        vatValueAed: exchVatVal,
        taxCode: 'SR',
      });
    }

    const fafPurchases: FafPurchaseRecord[] = [];
    for (const p of payableRows) {
      const netVal = Number(p.subtotal ?? 0);
      const vatVal = Number(p.vat_amount ?? 0);
      const issDate = p.issue_date instanceof Date ? p.issue_date.toISOString().slice(0, 10) : String(p.issue_date ?? start).slice(0, 10);
      fafPurchases.push({
        invoiceNo: String(p.payable_number ?? 'AP'),
        invoiceDate: issDate,
        supplierName: String(p.vendor_name ?? 'Vendor'),
        lineNo: 1,
        description: String(p.description ?? `AP Payable ${p.payable_number}`),
        purchaseValueAed: netVal,
        vatValueAed: vatVal,
        taxCode: vatVal > 0 ? 'SR' : 'ZR',
        currency: String(p.currency || 'AED'),
      });
    }
    for (const e of expenseRows) {
      const netVal = Number(e.amount ?? 0);
      const vatVal = Number(e.vat_amount ?? 0);
      const expDate = e.expense_date instanceof Date ? e.expense_date.toISOString().slice(0, 10) : String(e.expense_date ?? start).slice(0, 10);
      const expNo = String(e.expense_no ?? 'EXP');
      const supplierLabel = String(e.reference_no || e.sub_category || e.category || 'Supplier');
      fafPurchases.push({
        invoiceNo: expNo,
        invoiceDate: expDate,
        supplierName: supplierLabel,
        lineNo: 1,
        description: String(e.description ?? `Expense ${expNo}`),
        purchaseValueAed: netVal,
        vatValueAed: vatVal,
        taxCode: vatVal > 0 ? 'SR' : 'ZR',
        currency: String(e.currency || 'AED'),
      });
    }

    // Query General Ledger transactions for the period (for FAF v1.0.0 GeneralLedger section)
    const glRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT je.id as je_id, je.je_number, je.entry_date, je.narration,
              jl.line_number, jl.account_code, jl.account_name, jl.description as line_desc,
              jl.debit_amount, jl.credit_amount, jl.currency
         FROM finance_journal_entries je
         JOIN finance_journal_lines jl ON jl.journal_entry_id = je.id
        WHERE je.tenant_id = $3 AND je.deleted_at IS NULL AND je.status = 'POSTED'
          AND je.entry_date BETWEEN $1::date AND $2::date
        ORDER BY je.entry_date ASC, je.je_number ASC, jl.line_number ASC`,
      start, end, tenantId
    );

    const generalLedger = glRows.map((gl) => ({
      transactionDate: gl.entry_date instanceof Date ? gl.entry_date.toISOString().slice(0, 10) : String(gl.entry_date ?? start).slice(0, 10),
      accountCode: String(gl.account_code ?? '9999'),
      accountName: String(gl.account_name ?? 'General Account'),
      transactionDescription: String(gl.line_desc || gl.narration || `JE ${gl.je_number}`),
      transactionId: String(gl.je_number || gl.je_id),
      debit: Number(gl.debit_amount ?? 0),
      credit: Number(gl.credit_amount ?? 0),
    }));

    // Customer & Supplier master lists
    const customerRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, name_en, name_ar, tax_registration_number, country,
              address_line1, address_line2, city, state, contact_person
         FROM customers
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
      tenantId
    );

    const fafCustomers = customerRows.map((c) => {
      const addrParts = [c.address_line1, c.address_line2, c.city, c.state]
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean);
      return {
        customerName: String(c.name_en || c.name_ar || 'Customer'),
        customerId: String(c.id),
        customerTrn: c.tax_registration_number ? String(c.tax_registration_number) : undefined,
        country: String(c.country || 'AE'),
        address: addrParts.length > 0 ? addrParts.join(', ') : 'United Arab Emirates',
        contactPerson: c.contact_person ? String(c.contact_person) : undefined,
      };
    });

    const fafReport = buildFtaFafReport(
      {
        companyNameEn: tenant?.name || 'Fleet360 Operator LLC',
        companyNameAr: sellerMeta.nameAr || undefined,
        trn: cleanTrn,
        corporateTaxTrn: sellerMeta.corporateTaxTrn || undefined,
        periodStart: start,
        periodEnd: end,
        defaultEmirate: sellerMeta.emirate,
      },
      fafSupplies,
      fafPurchases,
      generalLedger,
      fafCustomers.length > 0 ? fafCustomers : undefined,
    );

    if (format === 'faf') {
      const csv = serializeFtaFafCsv(fafReport);
      const filename = `FTA_FAF_${tenant?.code || 'UAE'}_Q${quarter}_${year}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-FTA-FAF-Version': 'FAF v1.0.0',
        },
      });
    }

    if (format === 'faf-json') {
      return NextResponse.json({ faf: fafReport });
    }

    const summary = {
      period: `Q${quarter} ${year}`,
      periodStart: start,
      periodEnd:   end,
      totalRevenue:      Math.round(totalRevenue * 100) / 100,
      totalVatCollected: Math.round(totalVatCollected * 100) / 100,
      inputVat,
      netVatPayable: Math.max(0, netVat),
      vatRefundable: netVat < 0 ? Math.abs(netVat) : 0,
      breakdown: {
        logistics: { revenue: logRevVal, vat: logVatVal },
        rac:       { revenue: racRevVal, vat: racVatVal },
        leasing:   { revenue: leaseRevVal, vat: leaseVatVal },
        invoices:  { revenue: finRevVal, vat: finVatVal },
        creditNotes: { revenue: cnRevVal, vat: cnVatVal },
        exchangeCommissions: { revenue: exchRevVal, vat: exchVatVal },
      },
      vat201Boxes: fafReport.vat201Boxes,
    };

    const returns = await tx.vatReturn.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ summary, returns });
    });
  } catch (err) {
    console.error('[finance/vat GET]', err);
    return NextResponse.json({ error: 'Failed to generate VAT report' }, { status: 500 });
  }
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const vatReturn = await tx.vatReturn.create({
        data: {
          tenantId,
          periodFrom:       new Date(body.periodStart),
          periodTo:         new Date(body.periodEnd),
          periodStart:      new Date(body.periodStart),
          periodEnd:        new Date(body.periodEnd),
          totalSales:       body.totalSales       ?? 0,
          totalPurchases:   body.totalPurchases   ?? 0,
          outputTax:        body.outputTax        ?? 0,
          inputTax:         body.inputTax         ?? 0,
          netTax:           body.netTax           ?? 0,
          status:           body.status           ?? 'DRAFT',
          submissionDate:   body.submissionDate   ? new Date(body.submissionDate) : null,
          paymentDate:      body.paymentDate      ? new Date(body.paymentDate) : null,
          notes:            body.notes            ?? null,
        },
      });
      return NextResponse.json(vatReturn, { status: 201 });
    } catch (err) {
      console.error('[finance/vat POST]', err);
      return NextResponse.json({ error: 'Failed to create VAT return' }, { status: 500 });
    }
  });
}
