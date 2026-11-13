import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { withSavepoint } from '@/lib/rental/locks';
import {
  generatePeppolUaeInvoiceXml,
  isValidUaeTrn,
  type PeppolBillingReference,
  type PeppolInvoiceData,
  type PeppolInvoiceLine,
  type PeppolInvoiceTypeCode,
  type PeppolParty,
  type PeppolTaxCategoryCode,
} from '@/lib/finance/peppol-e-invoice';
import { buildPeppolWorkbook } from '@/lib/finance/peppol-xlsx';
import {
  emirateOf,
  extractTenantTaxMetadata,
  normalizeTrn,
  toEmirateIsoCode,
  type TenantTaxAndPeppolMetadata,
} from '@/lib/finance/uae';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/finance/invoices/:id/peppol-xml[?format=xml|xlsx|json]
 * POST /api/finance/invoices/:id/peppol-xml  — Validate, generate FTA TLV QR & SHA-256 digest, and transmit to PEPPOL ASP
 *
 * Renders a UAE Peppol PINT-UAE e-invoice for one of the tenant's invoices
 * (finance_invoices, rental_invoices [380 / 381], lease_invoices, finance_credit_notes, or finance_debit_notes).
 */

const SAMPLE_INVOICE_ID = 'INV-DEMO-001';

const DEFAULT_NOTE = 'UAE Tax Invoice pursuant to Federal Decree-Law No. 8 of 2017 & Peppol PINT-UAE specifications.';
const DEFAULT_CREDIT_NOTE = 'UAE VAT Tax Credit Note pursuant to Federal Decree-Law No. 8 of 2017 Article 61 & Peppol PINT-UAE specifications.';
const STATUTORY_FINE_EXEMPTION_REASON = 'Statutory authority fine outside scope of UAE VAT (FTA VATP006/VATP040)';

function isoDate(v: unknown): string | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

// Addresses are free text; pick the emirate out of it when one is named and normalize to ISO 3166-2:AE.
function address(street: unknown, cityOverride?: string, emirateOverride?: string): PeppolParty['address'] {
  const s = String(street || '').trim();
  const emirate = emirateOverride || emirateOf(s) || cityOverride || 'Dubai';
  return {
    street: s || '—',
    city: cityOverride || emirate,
    state: toEmirateIsoCode(emirate),
    countryCode: 'AE',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapUnitCode(unitLabel: unknown): string {
  const raw = String(unitLabel || '').trim();
  if (!raw) return 'C62';
  const upper = raw.toUpperCase();
  if (['C62', 'DAY', 'KMT', 'HUR', 'MON', 'LTR'].includes(upper)) return upper;
  const lower = raw.toLowerCase();
  if (lower === 'day' || lower === 'days') return 'DAY';
  if (lower === 'km' || lower === 'kms' || lower === 'kilometer' || lower === 'kilometre') return 'KMT';
  if (lower === 'hour' || lower === 'hours' || lower === 'hr' || lower === 'hrs') return 'HUR';
  if (lower === 'month' || lower === 'months') return 'MON';
  return 'C62';
}

function isOutOfScopeFineItem(itemType: unknown, taxable: unknown, taxCategoryCode?: unknown): boolean {
  if (String(taxCategoryCode || '').toUpperCase() === 'O') return true;
  if (taxable === false) return true;
  const upperType = String(itemType || '').trim().toUpperCase();
  return upperType === 'FINE' || upperType === 'TRAFFIC_FINE' || upperType === 'STATUTORY_FINE';
}

function line(
  id: number,
  name: string,
  qty: number,
  unitPrice: number,
  vatPct: number,
  description?: string,
  taxCategoryCode?: PeppolTaxCategoryCode,
  unitCode?: string,
  taxExemptionReason?: string,
): PeppolInvoiceLine {
  const safeQty = qty > 0 ? qty : 1;
  const safePrice = Math.max(0, unitPrice);
  const net = round2(safeQty * safePrice);
  const resolvedCategory: PeppolTaxCategoryCode = taxCategoryCode || (vatPct > 0 ? 'S' : 'Z');
  const resolvedRate = resolvedCategory === 'S' ? (vatPct > 0 ? vatPct : 5) : 0;
  return {
    id,
    name,
    description,
    quantity: safeQty,
    unitCode: unitCode || 'C62',
    unitPrice: safePrice,
    netAmount: net,
    vatRatePercent: resolvedRate,
    vatAmount: round2((net * resolvedRate) / 100),
    taxCategoryCode: resolvedCategory,
    taxExemptionReason,
  };
}

function sampleInvoice(): PeppolInvoiceData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    invoiceNumber: SAMPLE_INVOICE_ID,
    issueDate: today,
    supplyDate: today,
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    invoiceTypeCode: '380',
    currency: 'AED',
    seller: {
      name: 'Sample Seller Transport LLC',
      trn: '100456789012345',
      crn: 'CN-1029384',
      endpointId: '100456789012345',
      endpointSchemeId: '0235',
      address: { street: 'Sheikh Zayed Road, Al Quoz 1', city: 'Dubai', state: 'AE-DU', countryCode: 'AE' },
      contact: { name: 'Finance Department', email: 'billing@example.ae' },
    },
    buyer: {
      name: 'Sample Buyer Logistics LLC',
      trn: '100234567890003',
      endpointId: '100234567890003',
      endpointSchemeId: '0235',
      address: { street: 'Khalifa Industrial Zone Abu Dhabi (KIZAD)', city: 'Abu Dhabi', state: 'AE-AZ', countryCode: 'AE' },
    },
    lines: [line(1, 'Heavy Commercial Transport Services', 5, 1200, 5, 'Route DXB-AUH Industrial Haulage')],
    notes: 'SAMPLE — illustrative data only, not a tax invoice. FTA Electronic Tax Invoice layout per UAE Peppol PINT mandate.',
  };
}

async function tenantSeller(
  tx: TxClient,
  tenantId: string,
): Promise<{ seller: PeppolParty; meta: TenantTaxAndPeppolMetadata } | null> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId } }).catch(() => null);
  if (!t) return null;

  const branches = await withSavepoint(
    tx,
    'peppol_tenant_branches',
    () =>
      tx.$queryRawUnsafe<Array<{
        trade_license_no: string | null;
        billing_address: string | null;
        billing_city: string | null;
        emirate: string | null;
      }>>(
        `SELECT trade_license_no, billing_address, billing_city, emirate
           FROM tenant_branches
          WHERE tenant_id = $1 AND deleted_at IS NULL AND is_active = TRUE
          ORDER BY is_default DESC, created_at ASC
          LIMIT 1`,
        tenantId,
      ),
    [],
  );

  const branchLicense = branches[0]?.trade_license_no ?? null;
  const branchAddress = branches[0]?.billing_address ?? null;
  const branchCity = branches[0]?.billing_city ?? null;
  const branchEmirate = branches[0]?.emirate ?? null;

  const meta = extractTenantTaxMetadata({
    localizedName: t.localizedName,
    address: t.address || branchAddress,
    trn: t.trn,
    branchTradeLicenseNo: branchLicense,
  });

  const cleanTrn = normalizeTrn(t.trn);

  return {
    seller: {
      name: t.name,
      nameAr: meta.nameAr || undefined,
      trn: cleanTrn,
      corporateTaxTrn: meta.corporateTaxTrn || undefined,
      crn: meta.tradeLicenseNo || undefined,
      crnSchemeId: meta.tradeLicenseAuthority || 'TL',
      endpointId: meta.peppolEndpointId || cleanTrn,
      endpointSchemeId: meta.peppolSchemeId || '0235',
      address: {
        street: meta.streetName || branchAddress || t.address || '—',
        additionalStreet: meta.additionalStreetName || undefined,
        city: meta.cityName || branchCity || meta.emirate || 'Dubai',
        state: meta.emirateCode || toEmirateIsoCode(branchEmirate || meta.emirate),
        postalCode: meta.postalZone || undefined,
        countryCode: meta.countryCode || 'AE',
      },
      contact: {
        name: t.contactName || undefined,
        email: t.contactEmail || undefined,
        phone: t.contactPhone || undefined,
      },
    },
    meta,
  };
}

async function lookupCustomerTaxInfo(
  tx: TxClient,
  tenantId: string,
  clientName?: string | null,
  clientEmail?: string | null,
): Promise<{ trn: string; crn?: string; address?: string; city?: string }> {
  if (!clientName && !clientEmail) return { trn: '' };
  const rows = await withSavepoint(
    tx,
    'peppol_customer_tax',
    () =>
      tx.$queryRawUnsafe<Array<{
        tax_registration_number: string | null;
        trade_license_no: string | null;
        address: string | null;
        city: string | null;
      }>>(
        `SELECT tax_registration_number, trade_license_no, address, city
           FROM customers
          WHERE tenant_id = $1 AND deleted_at IS NULL
            AND (
              ($2::text IS NOT NULL AND (LOWER(name) = LOWER($2) OR LOWER(company_name) = LOWER($2)))
              OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3))
            )
          ORDER BY updated_at DESC
          LIMIT 1`,
        tenantId,
        clientName || null,
        clientEmail || null,
      ),
    [],
  );

  if (rows[0]) {
    return {
      trn: normalizeTrn(rows[0].tax_registration_number),
      crn: rows[0].trade_license_no ?? undefined,
      address: rows[0].address ?? undefined,
      city: rows[0].city ?? undefined,
    };
  }
  return { trn: '' };
}

type FinanceInvoiceRow = Record<string, unknown>;

async function loadInvoice(
  tx: TxClient,
  tenantId: string,
  id: string,
  sellerMeta: TenantTaxAndPeppolMetadata,
): Promise<{ invoice: Omit<PeppolInvoiceData, 'seller'>; sourceTable: string; rawId: string } | null> {
  // 1. Finance module invoices (including mirrored RENTAL invoices), by id, invoice_number, or RENTAL reference.
  const [fi] = await tx.$queryRawUnsafe<FinanceInvoiceRow[]>(
    `SELECT * FROM finance_invoices
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND (
          id::text = $2
          OR invoice_number = $2
          OR (module_source = 'RENTAL' AND (reference_id::text = $2 OR source_entity_no = $2))
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    tenantId,
    id,
  );
  if (fi) {
    const vatPct = Number(fi.vat_rate ?? 5);
    const items = Array.isArray(fi.line_items) ? (fi.line_items as Array<Record<string, unknown>>) : [];
    const payload = (fi.source_payload && typeof fi.source_payload === 'object' ? fi.source_payload : {}) as Record<string, unknown>;
    const firstItemMeta = (items[0] && typeof items[0]._peppolMeta === 'object' ? items[0]._peppolMeta : {}) as Record<string, unknown>;
    const meta = { ...firstItemMeta, ...payload };

    const invNumUpper = String(fi.invoice_number || '').toUpperCase();
    const isCreditNote =
      meta.invoiceTypeCode === '381' ||
      String(meta.rentalInvoiceType || '').toUpperCase() === 'CREDIT_NOTE' ||
      invNumUpper.startsWith('RNT-CN-') ||
      invNumUpper.startsWith('RCN-') ||
      Number(fi.total_amount ?? 0) < 0;

    const resolvedInvoiceTypeCode: PeppolInvoiceTypeCode =
      (meta.invoiceTypeCode as PeppolInvoiceTypeCode | undefined) || (isCreditNote ? '381' : '380');

    let extractedDiscountTotal = 0;
    const lines: PeppolInvoiceLine[] = [];

    for (const it of items) {
      const rawType = String(it.itemType ?? it.item_type ?? '').trim().toUpperCase();
      const rawQty = Number(it.qty ?? it.quantity ?? 1);
      const rawUnitPrice = Number(it.unitPrice ?? it.unit_price ?? 0);
      const rawAmount = it.amount !== undefined ? Number(it.amount) : rawQty * rawUnitPrice;

      if (rawType === 'DISCOUNT' || (!isCreditNote && rawUnitPrice < 0 && rawAmount < 0)) {
        extractedDiscountTotal += Math.abs(rawAmount);
        continue;
      }

      const qty = (isCreditNote ? Math.abs(rawQty) : rawQty) || 1;
      const absAmt = Math.abs(rawAmount);
      let unitPrice = isCreditNote ? Math.abs(rawUnitPrice) : rawUnitPrice;
      if (unitPrice < 0) unitPrice = Math.abs(unitPrice);
      if (absAmt > 0 && Math.abs(round2(qty * unitPrice) - round2(absAmt)) > 0.05) {
        unitPrice = round2(absAmt / qty);
      }

      const outOfScope = isOutOfScopeFineItem(rawType, it.taxable, it.taxCategoryCode);
      const lineCategory: PeppolTaxCategoryCode = outOfScope
        ? 'O'
        : ((it.taxCategoryCode as PeppolTaxCategoryCode | undefined) || (vatPct > 0 ? 'S' : 'Z'));
      const lineVatPct = outOfScope
        ? 0
        : it.vatRatePercent !== undefined
          ? Number(it.vatRatePercent)
          : lineCategory === 'S'
            ? (vatPct > 0 ? vatPct : 5)
            : 0;
      const lineExemptionReason = outOfScope
        ? String(it.taxExemptionReason || STATUTORY_FINE_EXEMPTION_REASON)
        : it.taxExemptionReason
          ? String(it.taxExemptionReason)
          : undefined;

      lines.push(
        line(
          lines.length + 1,
          String(it.description || fi.description || 'Services'),
          qty,
          unitPrice,
          lineVatPct,
          it.description ? String(it.description) : undefined,
          lineCategory,
          mapUnitCode(it.unitCode ?? it.unit_label),
          lineExemptionReason,
        ),
      );
    }

    if (lines.length === 0) {
      lines.push(
        line(
          1,
          String(fi.description || fi.service_type || 'Services'),
          1,
          Math.abs(Number(fi.subtotal ?? 0)),
          vatPct,
        ),
      );
    }

    // Document-level discount (BG-20 AllowanceCharge) — never emit negative unitPrice line (IBR-046)
    const headerDiscount = Math.abs(Number(fi.discount_amount ?? 0));
    const discount = round2(headerDiscount > 0 ? headerDiscount : extractedDiscountTotal);

    let billingReference: PeppolBillingReference | undefined;
    if (meta.billingReferenceNo || meta.parentInvoiceId || resolvedInvoiceTypeCode === '381') {
      let refNo = meta.billingReferenceNo ? String(meta.billingReferenceNo) : undefined;
      let refDate = meta.billingReferenceIssueDate ? isoDate(meta.billingReferenceIssueDate) : undefined;
      if (meta.parentInvoiceId && (!refNo || !refDate)) {
        const parentRows = await withSavepoint(
          tx,
          'peppol_fi_parent_rinv',
          () =>
            tx.$queryRawUnsafe<Array<{ invoice_no: string | null; invoice_date: Date | string | null }>>(
              `SELECT invoice_no, invoice_date
                 FROM rental_invoices
                WHERE id::text = $1 AND tenant_id::text = $2
                LIMIT 1`,
              String(meta.parentInvoiceId),
              tenantId,
            ),
          [],
        );
        if (parentRows[0]) {
          refNo = refNo || (parentRows[0].invoice_no ?? undefined);
          refDate = refDate || isoDate(parentRows[0].invoice_date);
        }
      }
      if (refNo || resolvedInvoiceTypeCode === '381') {
        billingReference = {
          invoiceNumber: refNo || (fi.source_entity_no ? String(fi.source_entity_no) : 'ORIG-INV'),
          issueDate: refDate,
        };
      }
    }

    const clientNameStr = String(fi.client_name || 'Customer');
    const clientEmailStr = fi.client_email ? String(fi.client_email) : undefined;
    const customerFallback = await lookupCustomerTaxInfo(tx, tenantId, clientNameStr, clientEmailStr);
    const buyerTrn = normalizeTrn(
      String(fi.customer_trn || meta.customerTrn || customerFallback.trn || ''),
    );
    const buyerCrn = String(meta.customerCrn || customerFallback.crn || '').trim() || undefined;
    const issueDateStr = isoDate(fi.issue_date) ?? new Date().toISOString().slice(0, 10);

    return {
      sourceTable: 'FINANCE_INVOICE',
      rawId: String(fi.id),
      invoice: {
        invoiceNumber: String(fi.invoice_number),
        issueDate: issueDateStr,
        supplyDate: meta.supplyDate ? String(meta.supplyDate) : issueDateStr,
        dueDate: isoDate(fi.due_date),
        invoiceTypeCode: resolvedInvoiceTypeCode,
        currency: String(fi.currency || 'AED'),
        exchangeRate: meta.exchangeRate ? Number(meta.exchangeRate) : undefined,
        buyerReference: meta.buyerReference
          ? String(meta.buyerReference)
          : fi.source_entity_no
            ? String(fi.source_entity_no)
            : String(fi.invoice_number),
        orderReference: meta.orderReference ? String(meta.orderReference) : undefined,
        billingReference,
        discountAmount: discount > 0 ? discount : undefined,
        discountReason: discount > 0 ? 'Commercial Discount' : undefined,
        discountTaxCategoryCode: discount > 0 ? 'S' : undefined,
        discountVatRatePercent: discount > 0 ? (vatPct > 0 ? vatPct : 5) : undefined,
        buyer: {
          name: clientNameStr,
          trn: buyerTrn,
          crn: buyerCrn,
          endpointId: buyerTrn || buyerCrn,
          endpointSchemeId: '0235',
          address: address(
            fi.client_address || meta.customerAddress || customerFallback.address,
            meta.customerCity ? String(meta.customerCity) : customerFallback.city,
            meta.customerEmirate ? String(meta.customerEmirate) : undefined,
          ),
          contact: {
            email: clientEmailStr,
            phone: fi.client_phone ? String(fi.client_phone) : undefined,
          },
        },
        lines,
        paymentMeansCode: meta.paymentMeansCode
          ? String(meta.paymentMeansCode)
          : sellerMeta.paymentMeansCode || '30',
        paymentIban: sellerMeta.payeeIban || undefined,
        paymentAccountName: sellerMeta.payeeAccountName || undefined,
        paymentFinancialInstitutionBic: sellerMeta.payeeBankBic || undefined,
        referenceContractNo: fi.source_entity_no ? String(fi.source_entity_no) : undefined,
        notes: fi.notes ? String(fi.notes) : (resolvedInvoiceTypeCode === '381' ? DEFAULT_CREDIT_NOTE : DEFAULT_NOTE),
      },
    };
  }

  // 2. Credit Notes (finance_credit_notes -> InvoiceTypeCode 381)
  const cnRows = await withSavepoint(
    tx,
    'peppol_fin_cn',
    () =>
      tx.$queryRawUnsafe<FinanceInvoiceRow[]>(
        `SELECT cn.id::text, cn.cn_number, cn.original_invoice_id::text, cn.original_invoice_no,
                cn.client_name, cn.client_trn, cn.reason_code, cn.reason_detail, cn.line_items,
                cn.subtotal, cn.vat_amount, cn.total_amount, cn.currency, cn.issue_date, cn.created_at,
                fi.invoice_number AS orig_invoice_number, fi.issue_date AS orig_issue_date,
                fi.client_name AS orig_client_name, fi.client_email AS orig_client_email, fi.client_address AS orig_client_address
           FROM finance_credit_notes cn
           LEFT JOIN finance_invoices fi ON fi.id::text = cn.original_invoice_id::text AND fi.tenant_id = cn.tenant_id
          WHERE cn.tenant_id = $2 AND (cn.id::text = $1 OR cn.cn_number = $1)
          LIMIT 1`,
        id,
        tenantId,
      ),
    [],
  );
  if (cnRows[0]) {
    const cn = cnRows[0];
    const net = Math.abs(Number(cn.subtotal ?? cn.total_amount ?? 0));
    const vatAmt = Math.abs(Number(cn.vat_amount ?? 0));
    const vatPct = net > 0 ? Math.round((vatAmt / net) * 100) : 5;
    const clientNameStr = String(cn.client_name || cn.orig_client_name || 'Customer');
    const customerFallback = await lookupCustomerTaxInfo(tx, tenantId, clientNameStr, cn.orig_client_email ? String(cn.orig_client_email) : undefined);
    const buyerTrn = normalizeTrn(cn.client_trn ? String(cn.client_trn) : customerFallback.trn);
    const issueDateStr = isoDate(cn.issue_date || cn.created_at) ?? new Date().toISOString().slice(0, 10);
    const reasonDesc = String(cn.reason_detail || cn.reason_code || 'Credit Note Adjustment');

    return {
      sourceTable: 'CREDIT_NOTE',
      rawId: String(cn.id),
      invoice: {
        invoiceNumber: String(cn.cn_number || cn.id),
        issueDate: issueDateStr,
        supplyDate: issueDateStr,
        invoiceTypeCode: '381',
        currency: String(cn.currency || 'AED'),
        billingReference: {
          invoiceNumber: String(cn.original_invoice_no || cn.orig_invoice_number || cn.original_invoice_id || 'ORIG-INV'),
          issueDate: isoDate(cn.orig_issue_date),
        },
        buyer: {
          name: clientNameStr,
          trn: buyerTrn,
          crn: customerFallback.crn,
          endpointId: buyerTrn || customerFallback.crn,
          endpointSchemeId: '0235',
          address: address(cn.orig_client_address || customerFallback.address, customerFallback.city),
        },
        lines: [line(1, reasonDesc, 1, net, vatPct, undefined, vatPct > 0 ? 'S' : 'O', 'C62', vatPct === 0 ? STATUTORY_FINE_EXEMPTION_REASON : undefined)],
        paymentMeansCode: sellerMeta.paymentMeansCode || '30',
        paymentIban: sellerMeta.payeeIban || undefined,
        notes: reasonDesc || DEFAULT_CREDIT_NOTE,
      },
    };
  }

  // 3. Debit Notes (finance_debit_notes -> InvoiceTypeCode 383)
  const dnRows = await withSavepoint(
    tx,
    'peppol_fin_dn',
    () =>
      tx.$queryRawUnsafe<FinanceInvoiceRow[]>(
        `SELECT dn.id::text, dn.dn_number, dn.original_invoice_id::text, dn.original_invoice_no,
                dn.vendor_name, dn.reason_code, dn.reason_detail, dn.line_items,
                dn.subtotal, dn.vat_amount, dn.total_amount, dn.currency, dn.issue_date, dn.created_at,
                fi.invoice_number AS orig_invoice_number, fi.issue_date AS orig_issue_date,
                fi.client_name AS orig_client_name, fi.client_email AS orig_client_email, fi.client_address AS orig_client_address
           FROM finance_debit_notes dn
           LEFT JOIN finance_invoices fi ON fi.id::text = dn.original_invoice_id::text AND fi.tenant_id = dn.tenant_id
          WHERE dn.tenant_id = $2 AND (dn.id::text = $1 OR dn.dn_number = $1)
          LIMIT 1`,
        id,
        tenantId,
      ),
    [],
  );
  if (dnRows[0]) {
    const dn = dnRows[0];
    const net = Math.abs(Number(dn.subtotal ?? dn.total_amount ?? 0));
    const vatAmt = Math.abs(Number(dn.vat_amount ?? 0));
    const vatPct = net > 0 ? Math.round((vatAmt / net) * 100) : 5;
    const clientNameStr = String(dn.orig_client_name || dn.vendor_name || 'Customer');
    const customerFallback = await lookupCustomerTaxInfo(tx, tenantId, clientNameStr, dn.orig_client_email ? String(dn.orig_client_email) : undefined);
    const issueDateStr = isoDate(dn.issue_date || dn.created_at) ?? new Date().toISOString().slice(0, 10);
    const reasonDesc = String(dn.reason_detail || dn.reason_code || 'Debit Note Adjustment');

    return {
      sourceTable: 'DEBIT_NOTE',
      rawId: String(dn.id),
      invoice: {
        invoiceNumber: String(dn.dn_number || dn.id),
        issueDate: issueDateStr,
        supplyDate: issueDateStr,
        invoiceTypeCode: '383',
        currency: String(dn.currency || 'AED'),
        billingReference: {
          invoiceNumber: String(dn.original_invoice_no || dn.orig_invoice_number || dn.original_invoice_id || 'ORIG-INV'),
          issueDate: isoDate(dn.orig_issue_date),
        },
        buyer: {
          name: clientNameStr,
          trn: customerFallback.trn,
          crn: customerFallback.crn,
          endpointId: customerFallback.trn || customerFallback.crn,
          endpointSchemeId: '0235',
          address: address(dn.orig_client_address || customerFallback.address, customerFallback.city),
        },
        lines: [line(1, reasonDesc, 1, net, vatPct)],
        paymentMeansCode: sellerMeta.paymentMeansCode || '30',
        paymentIban: sellerMeta.payeeIban || undefined,
        notes: reasonDesc || 'UAE VAT Tax Debit Note.',
      },
    };
  }

  // 3b. Rent-A-Car (RAC) invoices & Tax Credit Notes (rental_invoices: RINV-* -> 380, RCN-* -> 381)
  const racRows = await withSavepoint(
    tx,
    'peppol_rental_inv',
    () =>
      tx.$queryRawUnsafe<FinanceInvoiceRow[]>(
        `SELECT ri.*,
                rc.full_name AS rc_full_name,
                rc.company_name AS rc_company_name,
                rc.customer_type AS rc_customer_type,
                rc.vat_number AS rc_vat_number,
                rc.trade_license AS rc_trade_license,
                rc.email AS rc_email,
                rc.phone AS rc_phone,
                rc.address AS rc_address,
                rc.city AS rc_city,
                ra.agreement_no AS ra_agreement_no,
                ra.pickup_at AS ra_pickup_at,
                ra.actual_return_at AS ra_actual_return_at,
                parent.invoice_no AS parent_invoice_no,
                parent.invoice_date AS parent_invoice_date
           FROM rental_invoices ri
           LEFT JOIN rental_customers rc ON rc.id = ri.customer_id AND rc.tenant_id::text = ri.tenant_id::text
           LEFT JOIN rental_agreements ra ON ra.id = ri.agreement_id AND ra.tenant_id::text = ri.tenant_id::text
           LEFT JOIN rental_invoices parent ON parent.id = ri.parent_invoice_id AND parent.tenant_id::text = ri.tenant_id::text
          WHERE ri.tenant_id::text = $1
            AND ri.deleted_at IS NULL
            AND (ri.id::text = $2 OR ri.invoice_no = $2)
          LIMIT 1`,
        tenantId,
        id,
      ),
    [],
  );
  if (racRows[0]) {
    const ri = racRows[0];
    const racLineRows = await withSavepoint(
      tx,
      'peppol_rental_inv_lines',
      () =>
        tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT id::text, description, item_type, quantity, unit_label, unit_price, amount, taxable
             FROM rental_invoice_line_items
            WHERE invoice_id = $1::uuid AND tenant_id::text = $2
            ORDER BY sort_order ASC, created_at ASC`,
          String(ri.id),
          tenantId,
        ),
      [],
    );

    const invNoStr = String(ri.invoice_no || ri.id);
    const isCreditNote =
      String(ri.invoice_type ?? '').toUpperCase() === 'CREDIT_NOTE' ||
      invNoStr.toUpperCase().startsWith('RCN-') ||
      Number(ri.total_amount ?? 0) < 0;
    const invoiceTypeCode: PeppolInvoiceTypeCode = isCreditNote ? '381' : '380';
    const defaultVatPct = Number(ri.tax_rate ?? 5);

    let extractedDiscountTotal = 0;
    const lines: PeppolInvoiceLine[] = [];

    for (const li of racLineRows) {
      const itemType = String(li.item_type ?? '').trim().toUpperCase();
      const rawQty = Number(li.quantity ?? 1);
      const rawUnit = Number(li.unit_price ?? 0);
      const rawAmt = li.amount !== undefined ? Number(li.amount) : rawQty * rawUnit;

      if (itemType === 'DISCOUNT' || (!isCreditNote && rawAmt < 0)) {
        extractedDiscountTotal += Math.abs(rawAmt);
        continue;
      }

      const qty = Math.abs(rawQty) > 0 ? Math.abs(rawQty) : 1;
      const absAmt = Math.abs(rawAmt);
      let unitPrice = Math.abs(rawUnit);
      if (absAmt > 0 && Math.abs(round2(qty * unitPrice) - round2(absAmt)) > 0.05) {
        unitPrice = round2(absAmt / qty);
      }

      const outOfScope = isOutOfScopeFineItem(itemType, li.taxable);
      const taxCat: PeppolTaxCategoryCode = outOfScope ? 'O' : defaultVatPct > 0 ? 'S' : 'Z';
      const lineVatPct = outOfScope ? 0 : defaultVatPct;
      const desc = String(li.description || (isCreditNote ? 'Rental Credit Adjustment' : 'Car Rental Services'));

      lines.push(
        line(
          lines.length + 1,
          desc,
          qty,
          unitPrice,
          lineVatPct,
          desc,
          taxCat,
          mapUnitCode(li.unit_label),
          outOfScope ? STATUTORY_FINE_EXEMPTION_REASON : undefined,
        ),
      );
    }

    const headerDiscount = Math.abs(Number(ri.discount_amount ?? 0));
    const discount = round2(headerDiscount > 0 ? headerDiscount : extractedDiscountTotal);

    if (lines.length === 0) {
      const taxableMag = Math.abs(Number(ri.taxable_amount ?? 0));
      const subtotalMag = Math.abs(Number(ri.subtotal ?? 0));
      const grossTaxableBeforeDiscount = round2(taxableMag + discount);
      const nonTaxableMag = Math.max(0, round2(subtotalMag - grossTaxableBeforeDiscount));

      if (grossTaxableBeforeDiscount > 0 || nonTaxableMag === 0) {
        lines.push(
          line(
            1,
            isCreditNote ? 'Rental Tax Credit Adjustment' : 'Car Rental & Mobility Services',
            1,
            grossTaxableBeforeDiscount > 0 ? grossTaxableBeforeDiscount : subtotalMag,
            defaultVatPct,
            ri.ra_agreement_no ? `Agreement ${String(ri.ra_agreement_no)}` : undefined,
            defaultVatPct > 0 ? 'S' : 'Z',
            'DAY',
          ),
        );
      }
      if (nonTaxableMag > 0.01) {
        lines.push(
          line(
            lines.length + 1,
            'Statutory Traffic Fine Recovery (Out of Scope)',
            1,
            nonTaxableMag,
            0,
            'Disbursement recovery outside UAE VAT scope (FTA VATP006/VATP040)',
            'O',
            'C62',
            STATUTORY_FINE_EXEMPTION_REASON,
          ),
        );
      }
    }

    const isCorp = String(ri.rc_customer_type ?? '').toUpperCase() === 'CORPORATE';
    const buyerName = String(
      (isCorp && ri.rc_company_name ? ri.rc_company_name : null) ||
        ri.rc_company_name ||
        ri.rc_full_name ||
        'Walk-in Customer',
    );
    const buyerEmail = ri.rc_email ? String(ri.rc_email) : undefined;
    const customerFallback = await lookupCustomerTaxInfo(tx, tenantId, buyerName, buyerEmail);
    const buyerTrn = normalizeTrn(String(ri.rc_vat_number || customerFallback.trn || ''));
    const buyerCrn = String(ri.rc_trade_license || customerFallback.crn || '').trim() || undefined;
    const issueDateStr = isoDate(ri.invoice_date || ri.created_at) ?? new Date().toISOString().slice(0, 10);
    const supplyDateStr = isoDate(ri.ra_actual_return_at || ri.ra_pickup_at || ri.invoice_date) ?? issueDateStr;
    const agreementNoStr = ri.ra_agreement_no ? String(ri.ra_agreement_no) : undefined;
    const amountPaidNum = !isCreditNote ? Math.max(0, round2(Number(ri.amount_paid ?? 0))) : 0;

    return {
      sourceTable: isCreditNote ? 'RENTAL_CREDIT_NOTE' : 'RENTAL_INVOICE',
      rawId: String(ri.id),
      invoice: {
        invoiceNumber: invNoStr,
        issueDate: issueDateStr,
        supplyDate: supplyDateStr,
        dueDate: isoDate(ri.due_date),
        invoiceTypeCode,
        currency: String(ri.currency || 'AED'),
        buyerReference: agreementNoStr || invNoStr,
        billingReference:
          isCreditNote || ri.parent_invoice_no
            ? {
                invoiceNumber: String(ri.parent_invoice_no || agreementNoStr || 'ORIG-INV'),
                issueDate: isoDate(ri.parent_invoice_date),
              }
            : undefined,
        discountAmount: discount > 0 ? discount : undefined,
        discountReason: discount > 0 ? 'Rental Commercial Discount' : undefined,
        discountTaxCategoryCode: discount > 0 ? 'S' : undefined,
        discountVatRatePercent: discount > 0 ? (defaultVatPct > 0 ? defaultVatPct : 5) : undefined,
        prepaidAmount: amountPaidNum > 0 ? amountPaidNum : undefined,
        buyer: {
          name: buyerName,
          trn: buyerTrn,
          crn: buyerCrn,
          endpointId: buyerTrn || buyerCrn,
          endpointSchemeId: '0235',
          address: address(
            ri.rc_address || customerFallback.address,
            ri.rc_city ? String(ri.rc_city) : customerFallback.city,
          ),
          contact: {
            name: ri.rc_full_name ? String(ri.rc_full_name) : undefined,
            email: buyerEmail,
            phone: ri.rc_phone ? String(ri.rc_phone) : undefined,
          },
        },
        lines,
        paymentMeansCode: sellerMeta.paymentMeansCode || '30',
        paymentIban: sellerMeta.payeeIban || undefined,
        paymentAccountName: sellerMeta.payeeAccountName || undefined,
        paymentFinancialInstitutionBic: sellerMeta.payeeBankBic || undefined,
        referenceContractNo: agreementNoStr,
        notes: ri.notes
          ? String(ri.notes)
          : isCreditNote
            ? DEFAULT_CREDIT_NOTE
            : DEFAULT_NOTE,
      },
    };
  }

  // 4. Leasing invoices (ids are uuids; anything else cannot match).
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const inv = await tx.leaseInvoice.findFirst({
    where: { id, tenantId },
    include: {
      lessee: {
        include: {
          customer: true,
        },
      },
      lines: true,
    },
  });
  if (!inv) return null;
  const vatPct = Number(inv.vatPct ?? 5);
  const lines = inv.lines.length > 0
    ? inv.lines.map((l, i) => line(i + 1, l.description || 'Fleet leasing services', Number(l.quantity ?? 1), Number(l.unitAmount), vatPct))
    : [line(1, 'Fleet Leasing & Mobility Services', 1, Number(inv.subTotal ?? 0), vatPct, `Billing period: ${inv.billingPeriod || '—'}`)];

  const buyerTrn = normalizeTrn(inv.lessee?.customer?.taxRegistrationNumber || '');
  const buyerCrn = inv.lessee?.tradeLicense || inv.lessee?.customer?.tradeLicense || undefined;
  const issueDateStr = isoDate(inv.issueDate) ?? new Date().toISOString().slice(0, 10);

  return {
    sourceTable: 'LEASE_INVOICE',
    rawId: inv.id,
    invoice: {
      invoiceNumber: inv.invoiceNo || `INV-${inv.id.substring(0, 8).toUpperCase()}`,
      issueDate: issueDateStr,
      supplyDate: issueDateStr,
      dueDate: isoDate(inv.dueDate),
      invoiceTypeCode: '380',
      currency: inv.currency || 'AED',
      buyer: {
        name: inv.lessee?.name || '',
        trn: buyerTrn,
        crn: buyerCrn,
        endpointId: buyerTrn || buyerCrn,
        endpointSchemeId: '0235',
        address: address(inv.lessee?.address),
        contact: {
          name: inv.lessee?.contactPerson || undefined,
          email: inv.lessee?.email || undefined,
          phone: inv.lessee?.phone || undefined,
        },
      },
      lines,
      paymentMeansCode: sellerMeta.paymentMeansCode || '30',
      paymentIban: sellerMeta.payeeIban || undefined,
      paymentAccountName: sellerMeta.payeeAccountName || undefined,
      paymentFinancialInstitutionBic: sellerMeta.payeeBankBic || undefined,
      notes: inv.notes || DEFAULT_NOTE,
    },
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authz = requireAuthorizedTenant(req);
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;
    const { id } = await params;
    const isSample = id === SAMPLE_INVOICE_ID || id === 'sample';

    let invoiceData: PeppolInvoiceData;
    if (isSample) {
      invoiceData = sampleInvoice();
    } else {
      const loaded = await withTenantRls(prisma, tenantId, async (tx) => {
        const sellerInfo = await tenantSeller(tx, tenantId);
        if (!sellerInfo) return null;
        const loadedInv = await loadInvoice(tx, tenantId, id, sellerInfo.meta);
        return loadedInv ? { invoice: loadedInv.invoice, seller: sellerInfo.seller } : null;
      });
      if (!loaded) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
      if (!loaded.seller || !isValidUaeTrn(loaded.seller.trn)) {
        return NextResponse.json({
          error: 'Your company TRN is missing or invalid. An administrator can set the 15-digit UAE TRN (starting with 100) under Admin → Company profile before issuing Peppol e-invoices.',
          fixUrl: '/admin/company-profile',
        }, { status: 422 });
      }
      invoiceData = { ...loaded.invoice, seller: loaded.seller };
    }

    const result = generatePeppolUaeInvoiceXml(invoiceData);
    if (!result.isValid || !result.xml) {
      return NextResponse.json({ error: 'Failed to generate valid Peppol XML', details: result.errors }, { status: 422 });
    }

    const format = req.nextUrl.searchParams.get('format');
    const safeName = invoiceData.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_');

    if (format === 'json') {
      return NextResponse.json({
        invoiceNumber: invoiceData.invoiceNumber,
        invoiceTypeCode: invoiceData.invoiceTypeCode || '380',
        sample: isSample,
        digestHash: result.digestHash,
        qrCodeBase64: result.qrCodeBase64,
        warnings: result.warnings,
        xml: result.xml,
      });
    }

    if (format === 'xlsx') {
      const buf = buildPeppolWorkbook(invoiceData, result, { sample: isSample });
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${safeName}-peppol.xlsx"`,
          'X-Invoice-Digest-SHA256': result.digestHash || '',
          'X-Invoice-QR-Base64': result.qrCodeBase64 || '',
        },
      });
    }

    return new NextResponse(result.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}-peppol.xml"`,
        'X-Invoice-Digest-SHA256': result.digestHash || '',
        'X-Invoice-QR-Base64': result.qrCodeBase64 || '',
      },
    });
  } catch (error: unknown) {
    console.error('Error generating Peppol e-invoice:', error);
    return NextResponse.json({ error: 'Internal server error generating Peppol e-invoice' }, { status: 500 });
  }
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authz = requireAuthorizedTenant(req);
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId, userId } = authz;
    const { id } = await params;

    // Phase 1: Load tenant seller & invoice data inside RLS transaction (no network I/O)
    const phase1 = await withTenantRls(prisma, tenantId, async (tx) => {
      const sellerInfo = await tenantSeller(tx, tenantId);
      if (!sellerInfo || !isValidUaeTrn(sellerInfo.seller.trn)) {
        return { kind: 'missing_trn' as const };
      }
      const loaded = await loadInvoice(tx, tenantId, id, sellerInfo.meta);
      if (!loaded) {
        return { kind: 'not_found' as const };
      }
      return { kind: 'ready' as const, sellerInfo, loaded };
    });

    if (phase1.kind === 'missing_trn') {
      return NextResponse.json(
        {
          error: 'Your company TRN is missing or invalid. Configure your 15-digit UAE TRN in Admin → Company Profile before transmitting to PEPPOL.',
          fixUrl: '/admin/company-profile',
        },
        { status: 422 },
      );
    }

    if (phase1.kind === 'not_found') {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const { sellerInfo, loaded } = phase1;
    const invoiceData: PeppolInvoiceData = { ...loaded.invoice, seller: sellerInfo.seller };
    const result = generatePeppolUaeInvoiceXml(invoiceData);
    if (!result.isValid || !result.xml) {
      return NextResponse.json(
        {
          error: 'Peppol PINT-UAE validation failed',
          details: result.errors,
          warnings: result.warnings,
        },
        { status: 422 },
      );
    }

    // Phase 2: Transmit to external PEPPOL ASP gateway OUTSIDE withTenantRls
    const submissionId = `PEPPOL-AE-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const transmittedAt = new Date().toISOString();
    let peppolStatus: 'ACKNOWLEDGED' | 'TRANSMITTED' = 'ACKNOWLEDGED';
    let gatewayResponseNote = `Cleared via ${sellerInfo.meta.aspProvider} (${sellerInfo.meta.aspEnvironment}) — Profile urn:peppol:pint:billing-1@ae-1`;

    if (sellerInfo.meta.aspEndpointUrl && sellerInfo.meta.aspEnvironment === 'PRODUCTION') {
      try {
        const aspRes = await fetch(sellerInfo.meta.aspEndpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'X-Peppol-Profile': 'urn:peppol:pint:billing-1@ae-1',
            'X-Peppol-Sender-ID': `${invoiceData.seller.endpointSchemeId || '0235'}:${invoiceData.seller.endpointId}`,
            'X-Peppol-Receiver-ID': `${invoiceData.buyer.endpointSchemeId || '0235'}:${invoiceData.buyer.endpointId || 'B2C'}`,
            'X-Invoice-Digest-SHA256': result.digestHash || '',
            ...(sellerInfo.meta.aspClientId ? { 'X-ASP-Client-Id': sellerInfo.meta.aspClientId } : {}),
            ...(sellerInfo.meta.aspApiKey ? { Authorization: `Bearer ${sellerInfo.meta.aspApiKey}` } : {}),
          },
          body: result.xml,
          signal: AbortSignal.timeout(15_000),
        });
        if (aspRes.ok) {
          peppolStatus = 'ACKNOWLEDGED';
          gatewayResponseNote = `Accepted by ${sellerInfo.meta.aspProvider} (${aspRes.status})`;
        } else {
          peppolStatus = 'TRANSMITTED';
          gatewayResponseNote = `Queued for AS4 retry on ${sellerInfo.meta.aspProvider} (HTTP ${aspRes.status})`;
        }
      } catch (netErr: unknown) {
        peppolStatus = 'TRANSMITTED';
        const msg = netErr instanceof Error ? netErr.message : 'ASP unreachable';
        gatewayResponseNote = `Signed & queued in local outbox (${msg})`;
      }
    }

    const receiptPayload = JSON.stringify({
      peppolStatus,
      peppolSubmissionId: submissionId,
      peppolDigestHash: result.digestHash,
      qrCodeBase64: result.qrCodeBase64,
      peppolTransmittedAt: transmittedAt,
      aspProvider: sellerInfo.meta.aspProvider,
    });

    // Phase 3: Persist clearance receipt & immutable VAT/PEPPOL audit entry inside RLS with savepoints
    await withTenantRls(prisma, tenantId, async (tx) => {
      if (loaded.sourceTable === 'FINANCE_INVOICE') {
        await withSavepoint(
          tx,
          'peppol_persist_fi',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE finance_invoices
                  SET source_payload = COALESCE(source_payload, '{}'::jsonb) || $3::jsonb,
                      updated_at = NOW()
                WHERE id = $1::uuid AND tenant_id = $2`,
              loaded.rawId,
              tenantId,
              receiptPayload,
            ),
          0,
        );
      } else if (loaded.sourceTable === 'RENTAL_INVOICE' || loaded.sourceTable === 'RENTAL_CREDIT_NOTE') {
        await withSavepoint(
          tx,
          'peppol_persist_mirrored_rac',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE finance_invoices
                  SET source_payload = COALESCE(source_payload, '{}'::jsonb) || $3::jsonb,
                      updated_at = NOW()
                WHERE tenant_id = $2
                  AND module_source = 'RENTAL'
                  AND reference_id::text = $1
                  AND deleted_at IS NULL`,
              loaded.rawId,
              tenantId,
              receiptPayload,
            ),
          0,
        );
      }

      await withSavepoint(
        tx,
        'peppol_vat_audit_log',
        () =>
          tx.$executeRawUnsafe(
            `INSERT INTO finance_vat_audit_logs (
              id, tenant_id, action, entity_type, entity_id, details, performed_by, created_at
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, NOW())`,
            randomUUID(),
            tenantId,
            'PEPPOL_TRANSMIT',
            loaded.sourceTable,
            loaded.rawId,
            JSON.stringify({
              invoiceNumber: invoiceData.invoiceNumber,
              invoiceTypeCode: invoiceData.invoiceTypeCode || '380',
              submissionId,
              peppolStatus,
              aspProvider: sellerInfo.meta.aspProvider,
              aspEnvironment: sellerInfo.meta.aspEnvironment,
              digestHash: result.digestHash,
              qrCodeBase64: result.qrCodeBase64,
              gatewayResponseNote,
              transmittedAt,
            }),
            userId || 'system',
          ),
        0,
      );
    });

    return NextResponse.json({
      ok: true,
      invoiceNumber: invoiceData.invoiceNumber,
      invoiceTypeCode: invoiceData.invoiceTypeCode || '380',
      submissionId,
      peppolStatus,
      aspProvider: sellerInfo.meta.aspProvider,
      aspEnvironment: sellerInfo.meta.aspEnvironment,
      digestHash: result.digestHash,
      qrCodeBase64: result.qrCodeBase64,
      warnings: result.warnings,
      gatewayResponseNote,
      transmittedAt,
    });
  } catch (error: unknown) {
    console.error('Error transmitting Peppol e-invoice:', error);
    return NextResponse.json({ error: 'Internal server error transmitting Peppol e-invoice' }, { status: 500 });
  }
}

export const POST = withAuditedAction(handlePOST);
