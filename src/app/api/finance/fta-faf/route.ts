export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { extractTenantTaxMetadata, normalizeTrn } from '@/lib/finance/uae';
import {
  buildFtaFafReport,
  serializeFtaFafCsv,
  type FafGeneralLedgerRecord,
  type FafPurchaseRecord,
  type FafSupplyRecord,
} from '@/lib/finance/fta-faf';
import { excludeMirrored } from '@/lib/finance/mirrored-revenue';

const VAT_NOT_MIRRORED = excludeMirrored(['RENTAL', 'LOGISTICS', 'LEASING']);

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
      const format = searchParams.get('format') ?? 'json';
      const currency = searchParams.get('currency') ?? 'AED';

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { code: true, name: true, localizedName: true, trn: true, address: true },
      });

    const cleanTrn = normalizeTrn(tenant?.trn);
    if (!cleanTrn) {
      return NextResponse.json(
        { error: 'Tenant TRN must be configured before generating FTA Audit File' },
        { status: 422 },
      );
    }

    const sellerMeta = extractTenantTaxMetadata({
      localizedName: tenant?.localizedName,
      address: tenant?.address,
      trn: cleanTrn,
    });

    // Query General Ledger entries for the period
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

    const generalLedger: FafGeneralLedgerRecord[] = glRows.map((gl) => ({
      transactionDate: gl.entry_date instanceof Date ? gl.entry_date.toISOString().slice(0, 10) : String(gl.entry_date ?? start).slice(0, 10),
      accountCode: String(gl.account_code ?? '9999'),
      accountName: String(gl.account_name ?? 'General Account'),
      transactionDescription: String(gl.line_desc || gl.narration || `JE ${gl.je_number}`),
      transactionId: String(gl.je_number || gl.je_id),
      debit: Number(gl.debit_amount ?? 0),
      credit: Number(gl.credit_amount ?? 0),
    }));

    const totalDebit = Number(generalLedger.reduce((s, g) => s + g.debit, 0).toFixed(2));
    const totalCredit = Number(generalLedger.reduce((s, g) => s + g.credit, 0).toFixed(2));

    // Invoices / Customer supplies
    const invoiceRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT invoice_number, client_name, client_address, subtotal, discount_amount,
              vat_rate, vat_amount, currency, issue_date, branch, source_payload
         FROM finance_invoices
        WHERE tenant_id = $3 AND deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
          AND issue_date BETWEEN $1::date AND $2::date${VAT_NOT_MIRRORED}
        ORDER BY issue_date ASC`,
      start, end, tenantId
    );

    const fafSupplies: FafSupplyRecord[] = [];
    for (const r of invoiceRows) {
      const netVal = Math.max(0, Number(r.subtotal ?? 0) - Number(r.discount_amount ?? 0));
      const vatVal = Number(r.vat_amount ?? 0);
      const issDate = r.issue_date instanceof Date ? r.issue_date.toISOString().slice(0, 10) : String(r.issue_date ?? start).slice(0, 10);
      fafSupplies.push({
        invoiceNo: String(r.invoice_number ?? 'INV'),
        invoiceDate: issDate,
        customerName: String(r.client_name ?? 'Customer'),
        emirate: String(r.branch || r.client_address || sellerMeta.emirate || 'Dubai'),
        lineNo: 1,
        description: `Tax Invoice ${r.invoice_number}`,
        supplyValueAed: netVal,
        vatValueAed: vatVal,
        taxCode: vatVal > 0 ? 'SR' : 'ZR',
        currency: String(r.currency || currency || 'AED'),
      });
    }

    // Purchases
    const payableRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT payable_number, vendor_name, subtotal, vat_amount, total_amount, currency, issue_date, description
         FROM finance_payables
        WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED', 'POSTED')
          AND issue_date BETWEEN $1::date AND $2::date
        ORDER BY issue_date ASC`,
      start, end, tenantId
    );

    const fafPurchases: FafPurchaseRecord[] = [];
    for (const p of payableRows) {
      fafPurchases.push({
        invoiceNo: String(p.payable_number ?? 'AP'),
        invoiceDate: p.issue_date instanceof Date ? p.issue_date.toISOString().slice(0, 10) : String(p.issue_date ?? start).slice(0, 10),
        supplierName: String(p.vendor_name ?? 'Vendor'),
        lineNo: 1,
        description: String(p.description ?? `AP Payable ${p.payable_number}`),
        purchaseValueAed: Number(p.subtotal ?? 0),
        vatValueAed: Number(p.vat_amount ?? 0),
        taxCode: Number(p.vat_amount ?? 0) > 0 ? 'SR' : 'ZR',
        currency: String(p.currency || currency || 'AED'),
      });
    }

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
    );

    if (format === 'csv') {
      const csv = serializeFtaFafCsv(fafReport);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="FTA_FAF_${tenant?.code || 'UAE'}_${year}_Q${quarter}.csv"`,
          'X-FTA-FAF-Version': 'FAF v1.0.0',
        },
      });
    }

    return NextResponse.json({
      CompanyInfo: {
        TaxablePersonNameEn: fafReport.compInfo.companyNameEn,
        TaxablePersonNameAr: fafReport.compInfo.companyNameAr,
        TaxRegistrationNumber: fafReport.compInfo.trn,
        PeriodStart: fafReport.compInfo.periodStart,
        PeriodEnd: fafReport.compInfo.periodEnd,
        FAFVersion: fafReport.fafVersion,
        CreationDate: fafReport.creationDate,
      },
      GeneralLedger: {
        TotalDebit: totalDebit,
        TotalCredit: totalCredit,
        IsBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
        EntriesCount: generalLedger.length,
        Lines: generalLedger,
      },
      Supply: {
        Customers: fafReport.customers,
        Suppliers: fafReport.suppliers,
        CustomerSupplies: fafReport.customerSupplies,
        SupplierPurchases: fafReport.supplierPurchases,
      },
      Vat201Boxes: fafReport.vat201Boxes,
      faf: fafReport,
    });
    });
  } catch (err) {
    console.error('[finance/fta-faf GET]', err);
    return NextResponse.json({ error: 'Failed to generate FTA Audit File' }, { status: 500 });
  }
}
