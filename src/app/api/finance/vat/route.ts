export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { excludeMirrored } from '@/lib/finance/mirrored-revenue';
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

/**
 * GET  /api/finance/vat  — returns { summary, returns } or ?format=faf (UAE FTA Audit File v1.0.0 CSV)
 * POST /api/finance/vat  — create a new VAT return record
 */

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth   = startMonth + 2;
  const start = `${year}-${String(startMonth).padStart(2,'0')}-01`;
  const endDate = new Date(year, endMonth, 0);
  const end = endDate.toISOString().split('T')[0];
  return { start, end };
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year    = parseInt(searchParams.get('year')    ?? String(now.getFullYear()));
    const quarter = parseInt(searchParams.get('quarter') ?? String(Math.ceil((now.getMonth() + 1) / 3)));
    const format  = searchParams.get('format') ?? 'json';
    const { start, end } = quarterRange(year, quarter);

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { code: true, name: true, localizedName: true, trn: true, address: true },
    }).catch(() => null);

    const sellerMeta = extractTenantTaxMetadata({
      localizedName: tenant?.localizedName,
      address: tenant?.address,
      trn: tenant?.trn,
    });

    type RevRow = { total: number | null };
    const zero = () => Promise.resolve([{ total: 0 }] as RevRow[]);

    const logisticsRev = await tx.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(customer_rate_amount),0) AS total FROM logistics_shipment_orders
       WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
         AND created_at::date BETWEEN $1::date AND $2::date`, start, end, tenantId
    ).catch(zero);
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
    ).catch(zero);
    const leasingRev = await tx.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(monthly_rate),0) AS total FROM lease_contracts_v2
       WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1::date AND $2::date`, start, end, tenantId
    ).catch(zero);
    const financeInvRev = await tx.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount - vat_amount),0) AS total FROM finance_invoices
       WHERE tenant_id = $3 AND deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
         AND issue_date BETWEEN $1::date AND $2::date${VAT_NOT_MIRRORED}`, start, end, tenantId
    ).catch(zero);

    const logisticsTax = await tx.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(customer_rate_amount * 0.05 / 1.05),0) AS total FROM logistics_shipment_orders
       WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
         AND created_at::date BETWEEN $1::date AND $2::date`, start, end, tenantId
    ).catch(zero);
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
    ).catch(zero);
    const leasingTax = await tx.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(monthly_rate * 0.05),0) AS total FROM lease_contracts_v2
       WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1::date AND $2::date`, start, end, tenantId
    ).catch(zero);
    const financeInvTax = await tx.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(vat_amount),0) AS total FROM finance_invoices
       WHERE tenant_id = $3 AND deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
         AND issue_date BETWEEN $1::date AND $2::date${VAT_NOT_MIRRORED}`, start, end, tenantId
    ).catch(zero);
    const invoiceRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT invoice_number, client_name, client_address, subtotal, discount_amount,
              vat_rate, vat_amount, currency, issue_date, branch, source_payload
         FROM finance_invoices
        WHERE tenant_id = $3 AND deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
          AND issue_date BETWEEN $1::date AND $2::date${VAT_NOT_MIRRORED}
        ORDER BY issue_date ASC`,
      start, end, tenantId
    ).catch(() => [] as Array<Record<string, unknown>>);
    const payableRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT payable_number, vendor_name, subtotal, vat_amount, total_amount, currency, issue_date, description
         FROM finance_payables
        WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED', 'POSTED')
          AND issue_date BETWEEN $1::date AND $2::date
        ORDER BY issue_date ASC`,
      start, end, tenantId
    ).catch(() => [] as Array<Record<string, unknown>>);
    const expenseRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT expense_number, vendor_name, amount, vat_amount, total_amount, currency, expense_date, description
         FROM finance_expenses
        WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('APPROVED', 'PAID') AND COALESCE(vat_amount, 0) > 0
          AND expense_date BETWEEN $1::date AND $2::date
        ORDER BY expense_date ASC`,
      start, end, tenantId
    ).catch(() => [] as Array<Record<string, unknown>>);

    const logRevVal = Math.round(Number(logisticsRev[0]?.total ?? 0) * 100) / 100;
    const racRevVal = Math.round(Number(racRev[0]?.total ?? 0) * 100) / 100;
    const leaseRevVal = Math.round(Number(leasingRev[0]?.total ?? 0) * 100) / 100;
    const finRevVal = Math.round(Number(financeInvRev[0]?.total ?? 0) * 100) / 100;

    const logVatVal = Math.round(Number(logisticsTax[0]?.total ?? 0) * 100) / 100;
    const racVatVal = Math.round(Number(racTax[0]?.total ?? 0) * 100) / 100;
    const leaseVatVal = Math.round(Number(leasingTax[0]?.total ?? 0) * 100) / 100;
    const finVatVal = Math.round(Number(financeInvTax[0]?.total ?? 0) * 100) / 100;

    const totalRevenue = logRevVal + racRevVal + leaseRevVal + finRevVal;
    const totalVatCollected = logVatVal + racVatVal + leaseVatVal + finVatVal;

    type InputVatRow = { total: number | null };
    const [inputVatRow] = await tx.$queryRawUnsafe<InputVatRow[]>(
      `SELECT COALESCE(SUM(total_cost),0) AS total FROM fuel_logs
       WHERE tenant_id = $3 AND created_at::date BETWEEN $1::date AND $2::date`, start, end, tenantId
    ).catch(() => [{ total: 0 }]);
    const fuelSpend = Math.round(Number(inputVatRow?.total ?? 0) * 100) / 100;
    const fuelInputVat = Math.round(fuelSpend * 0.05 * 100) / 100;

    const payablesInputVat = payableRows.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0);
    const expensesInputVat = expenseRows.reduce((s, r) => s + Number(r.vat_amount ?? 0), 0);
    const inputVat = Math.round((fuelInputVat + payablesInputVat + expensesInputVat) * 100) / 100;

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
    if (leaseRevVal > 0) {
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

    const fafPurchases: FafPurchaseRecord[] = [];
    if (fuelSpend > 0) {
      fafPurchases.push({
        invoiceNo: `FUEL-Q${quarter}-${year}`,
        invoiceDate: end,
        supplierName: 'Fleet Fuel & Maintenance Suppliers',
        lineNo: 1,
        description: `Recoverable fleet fuel & maintenance input spend Q${quarter} ${year}`,
        purchaseValueAed: fuelSpend,
        vatValueAed: fuelInputVat,
        taxCode: 'SR',
      });
    }
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
      fafPurchases.push({
        invoiceNo: String(e.expense_number ?? 'EXP'),
        invoiceDate: expDate,
        supplierName: String(e.vendor_name ?? 'Supplier'),
        lineNo: 1,
        description: String(e.description ?? `Expense ${e.expense_number}`),
        purchaseValueAed: netVal,
        vatValueAed: vatVal,
        taxCode: vatVal > 0 ? 'SR' : 'ZR',
        currency: String(e.currency || 'AED'),
      });
    }

    const fafReport = buildFtaFafReport(
      {
        companyNameEn: tenant?.name || 'Fleet360 Operator LLC',
        companyNameAr: sellerMeta.nameAr || undefined,
        trn: normalizeTrn(tenant?.trn) || '100000000000003',
        corporateTaxTrn: sellerMeta.corporateTaxTrn || undefined,
        periodStart: start,
        periodEnd: end,
        defaultEmirate: sellerMeta.emirate,
      },
      fafSupplies,
      fafPurchases,
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
      },
      vat201Boxes: fafReport.vat201Boxes,
    };

    const returns = await tx.vatReturn.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }).catch(() => []);

    return NextResponse.json({ summary, returns });
  });
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
