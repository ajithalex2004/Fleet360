/**
 * UAE Federal Tax Authority (FTA) Tax Audit File (FAF v1.0.0) & Form VAT 201 Engine
 *
 * Generates the official FTA Audit File (FAF) sections:
 * - CompInfo (Company & Tax Period header)
 * - Customer (Master table)
 * - Supplier (Master table)
 * - GeneralLedger (GL Entries)
 * - CustomerSupply (Output VAT supplies with Emirate allocation for Form VAT 201 Box 1a–1g)
 * - SupplierPurchase (Input VAT purchases)
 */

import { EMIRATES, fromEmirateIsoCode, normalizeTrn, type Emirate } from './uae';

export interface FafCompanyInfo {
  companyNameEn: string;
  companyNameAr?: string;
  trn: string;
  corporateTaxTrn?: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  defaultEmirate?: Emirate;
}

export interface FafGeneralLedgerRecord {
  transactionDate: string; // YYYY-MM-DD
  accountCode: string;
  accountName: string;
  transactionDescription: string;
  transactionId: string;
  debit: number;
  credit: number;
  balance?: number;
}

export interface FafCustomerRecord {
  customerName: string;
  customerId: string;
  customerTrn?: string;
  country?: string;
  address?: string;
  contactPerson?: string;
}

export interface FafSupplierRecord {
  supplierName: string;
  supplierId: string;
  supplierTrn?: string;
  country?: string;
  address?: string;
  contactPerson?: string;
}

export interface FafSupplyRecord {
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  customerName: string;
  customerId?: string;
  customerTrn?: string;
  country?: string;
  emirate?: string;
  lineNo?: number;
  description: string;
  supplyValueAed: number;
  vatValueAed: number;
  taxCode?: 'SR' | 'ZR' | 'EX' | 'OOS' | 'RC'; // FTA Tax Codes: SR=Standard 5%, ZR=Zero, EX=Exempt, OOS=Out of Scope, RC=Reverse Charge
  currency?: string;
  supplyFcy?: number;
  vatFcy?: number;
}

export interface FafPurchaseRecord {
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  supplierName: string;
  supplierId?: string;
  supplierTrn?: string;
  country?: string;
  lineNo?: number;
  description: string;
  purchaseValueAed: number;
  vatValueAed: number;
  taxCode?: 'SR' | 'ZR' | 'EX' | 'OOS' | 'RC';
  currency?: string;
  purchaseFcy?: number;
  vatFcy?: number;
}

export interface Vat201EmirateBox {
  box: string;
  emirate: Emirate;
  amountAed: number;
  vatAmountAed: number;
  adjustmentAed: number;
}

export interface FtaFafReport {
  fafVersion: string;
  creationDate: string;
  compInfo: FafCompanyInfo;
  vat201Boxes: {
    box1StandardRatedByEmirate: Vat201EmirateBox[];
    box3ReverseChargeSupplies: { amountAed: number; vatAmountAed: number };
    box6ZeroRatedSupplies: { amountAed: number };
    box7ExemptSupplies: { amountAed: number };
    box8TotalSuppliesAndOutputVat: { amountAed: number; vatAmountAed: number };
    box9StandardRatedExpenses: { amountAed: number; recoverableVatAed: number };
    box12TotalDueTax: number;
    box13RecoverableTax: number;
    box14NetVatPayableOrRefundable: number;
  };
  generalLedger: FafGeneralLedgerRecord[];
  customers: FafCustomerRecord[];
  suppliers: FafSupplierRecord[];
  customerSupplies: FafSupplyRecord[];
  supplierPurchases: FafPurchaseRecord[];
}

const BOX_MAP: Record<Emirate, string> = {
  'Abu Dhabi': '1a',
  'Dubai': '1b',
  'Sharjah': '1c',
  'Ajman': '1d',
  'Umm Al Quwain': '1e',
  'Ras Al Khaimah': '1f',
  'Fujairah': '1g',
};

function csvCell(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds the structured FTA Audit File (FAF) & Form VAT 201 Box report.
 */
export function buildFtaFafReport(
  compInfo: FafCompanyInfo,
  supplies: FafSupplyRecord[],
  purchases: FafPurchaseRecord[],
  generalLedger: FafGeneralLedgerRecord[] = [],
  customers?: FafCustomerRecord[],
  suppliers?: FafSupplierRecord[],
): FtaFafReport {
  const defaultEmirate = compInfo.defaultEmirate || 'Dubai';
  const emirateTotals = new Map<Emirate, { amount: number; vat: number }>();
  for (const em of EMIRATES) {
    emirateTotals.set(em, { amount: 0, vat: 0 });
  }

  let zeroRatedTotal = 0;
  let exemptTotal = 0;
  let reverseChargeAmount = 0;
  let reverseChargeVat = 0;

  const normalizedSupplies = supplies.map((s, idx) => {
    const resolvedEmirate = fromEmirateIsoCode(s.emirate || defaultEmirate, defaultEmirate);
    const code = s.taxCode || (s.vatValueAed > 0 ? 'SR' : 'ZR');
    const supplyVal = Number(s.supplyValueAed.toFixed(2));
    const vatVal = Number(s.vatValueAed.toFixed(2));

    if (code === 'SR') {
      const cur = emirateTotals.get(resolvedEmirate)!;
      cur.amount = Number((cur.amount + supplyVal).toFixed(2));
      cur.vat = Number((cur.vat + vatVal).toFixed(2));
    } else if (code === 'ZR') {
      zeroRatedTotal = Number((zeroRatedTotal + supplyVal).toFixed(2));
    } else if (code === 'EX') {
      exemptTotal = Number((exemptTotal + supplyVal).toFixed(2));
    } else if (code === 'RC') {
      reverseChargeAmount = Number((reverseChargeAmount + supplyVal).toFixed(2));
      reverseChargeVat = Number((reverseChargeVat + vatVal).toFixed(2));
    }

    return {
      ...s,
      lineNo: s.lineNo || idx + 1,
      emirate: resolvedEmirate,
      taxCode: code,
      supplyValueAed: supplyVal,
      vatValueAed: vatVal,
      country: s.country || 'AE',
      currency: s.currency || 'AED',
      customerTrn: normalizeTrn(s.customerTrn),
    };
  });

  const normalizedPurchases = purchases.map((p, idx) => ({
    ...p,
    lineNo: p.lineNo || idx + 1,
    taxCode: p.taxCode || (p.vatValueAed > 0 ? 'SR' : 'ZR'),
    purchaseValueAed: Number(p.purchaseValueAed.toFixed(2)),
    vatValueAed: Number(p.vatValueAed.toFixed(2)),
    country: p.country || 'AE',
    currency: p.currency || 'AED',
    supplierTrn: normalizeTrn(p.supplierTrn),
  }));

  const box1StandardRatedByEmirate: Vat201EmirateBox[] = EMIRATES.map(em => {
    const tot = emirateTotals.get(em)!;
    return {
      box: BOX_MAP[em],
      emirate: em,
      amountAed: tot.amount,
      vatAmountAed: tot.vat,
      adjustmentAed: 0,
    };
  });

  const totalStdSupplies = Number(box1StandardRatedByEmirate.reduce((s, b) => s + b.amountAed, 0).toFixed(2));
  const totalStdOutputVat = Number(box1StandardRatedByEmirate.reduce((s, b) => s + b.vatAmountAed, 0).toFixed(2));
  const totalSuppliesAmount = Number((totalStdSupplies + zeroRatedTotal + exemptTotal + reverseChargeAmount).toFixed(2));
  const totalOutputVat = Number((totalStdOutputVat + reverseChargeVat).toFixed(2));

  const totalPurchasesAmount = Number(normalizedPurchases.reduce((s, p) => s + p.purchaseValueAed, 0).toFixed(2));
  const totalRecoverableVat = Number(normalizedPurchases.reduce((s, p) => s + p.vatValueAed, 0).toFixed(2));
  const netVat = Number((totalOutputVat - totalRecoverableVat).toFixed(2));

  // Derive master customer directory if not supplied
  const resolvedCustomers: FafCustomerRecord[] = customers && customers.length > 0
    ? customers
    : Array.from(
        new Map(
          normalizedSupplies.map(s => [
            s.customerId || s.customerName,
            {
              customerName: s.customerName,
              customerId: s.customerId || s.customerName,
              customerTrn: s.customerTrn,
              country: s.country || 'AE',
              address: s.emirate || 'United Arab Emirates',
              contactPerson: '',
            },
          ]),
        ).values(),
      );

  // Derive master supplier directory if not supplied
  const resolvedSuppliers: FafSupplierRecord[] = suppliers && suppliers.length > 0
    ? suppliers
    : Array.from(
        new Map(
          normalizedPurchases.map(p => [
            p.supplierId || p.supplierName,
            {
              supplierName: p.supplierName,
              supplierId: p.supplierId || p.supplierName,
              supplierTrn: p.supplierTrn,
              country: p.country || 'AE',
              address: 'United Arab Emirates',
              contactPerson: '',
            },
          ]),
        ).values(),
      );

  const cleanTrn = normalizeTrn(compInfo.trn);

  return {
    fafVersion: 'FAF v1.0.0',
    creationDate: new Date().toISOString().slice(0, 10),
    compInfo: {
      ...compInfo,
      trn: cleanTrn,
    },
    vat201Boxes: {
      box1StandardRatedByEmirate,
      box3ReverseChargeSupplies: { amountAed: reverseChargeAmount, vatAmountAed: reverseChargeVat },
      box6ZeroRatedSupplies: { amountAed: zeroRatedTotal },
      box7ExemptSupplies: { amountAed: exemptTotal },
      box8TotalSuppliesAndOutputVat: { amountAed: totalSuppliesAmount, vatAmountAed: totalOutputVat },
      box9StandardRatedExpenses: { amountAed: totalPurchasesAmount, recoverableVatAed: totalRecoverableVat },
      box12TotalDueTax: totalOutputVat,
      box13RecoverableTax: totalRecoverableVat,
      box14NetVatPayableOrRefundable: netVat,
    },
    generalLedger,
    customers: resolvedCustomers,
    suppliers: resolvedSuppliers,
    customerSupplies: normalizedSupplies,
    supplierPurchases: normalizedPurchases,
  };
}

/**
 * Serializes the FTA Audit File (FAF v1.0.0) into the official multi-section CSV format
 * accepted by the UAE Federal Tax Authority EmaraTax portal.
 *
 * Mandatory Sections (FAF v1.0.0):
 *   1. CompInfo
 *   2. GeneralLedger
 *   3. Customer
 *   4. Supplier
 *   5. CustomerSupply
 *   6. SupplierPurchase
 */
export function serializeFtaFafCsv(report: FtaFafReport): string {
  const lines: string[] = [];

  // Section 1: CompInfo
  lines.push('CompInfoStart');
  lines.push('TaxablePersonNameEn,TaxablePersonNameAr,TRN,TaxAgencyName,TAN,TaxAgentName,TAAN,PeriodStart,PeriodEnd,FAFCreationDate,ProductVersion,FAFVersion');
  lines.push([
    csvCell(report.compInfo.companyNameEn),
    csvCell(report.compInfo.companyNameAr || ''),
    csvCell(report.compInfo.trn),
    csvCell(''),
    csvCell(''),
    csvCell(''),
    csvCell(''),
    csvCell(report.compInfo.periodStart),
    csvCell(report.compInfo.periodEnd),
    csvCell(report.creationDate),
    csvCell('Fleet360 Enterprise ERP v2026'),
    csvCell(report.fafVersion),
  ].join(','));
  lines.push('CompInfoEnd');
  lines.push('');

  // Section 2: GeneralLedger
  lines.push('GeneralLedgerStart');
  lines.push('TransactionDate,AccountID,AccountDescription,TransactionDescription,TransactionID,Debit,Credit,Balance');
  let runningGlBalance = 0;
  for (const gl of report.generalLedger || []) {
    const d = Number(gl.debit || 0);
    const c = Number(gl.credit || 0);
    runningGlBalance = Number((runningGlBalance + d - c).toFixed(2));
    const bal = gl.balance != null ? Number(gl.balance).toFixed(2) : runningGlBalance.toFixed(2);
    lines.push([
      csvCell(gl.transactionDate),
      csvCell(gl.accountCode),
      csvCell(gl.accountName),
      csvCell(gl.transactionDescription),
      csvCell(gl.transactionId),
      csvCell(d.toFixed(2)),
      csvCell(c.toFixed(2)),
      csvCell(bal),
    ].join(','));
  }
  lines.push('GeneralLedgerEnd');
  lines.push('');

  // Section 3: Customer Master Directory
  lines.push('CustomerStart');
  lines.push('CustomerName,CustomerID,CustomerTRN,Country,Address,ContactPerson');
  for (const c of report.customers || []) {
    lines.push([
      csvCell(c.customerName),
      csvCell(c.customerId),
      csvCell(c.customerTrn || ''),
      csvCell(c.country || 'AE'),
      csvCell(c.address || ''),
      csvCell(c.contactPerson || ''),
    ].join(','));
  }
  lines.push('CustomerEnd');
  lines.push('');

  // Section 4: Supplier Master Directory
  lines.push('SupplierStart');
  lines.push('SupplierName,SupplierID,SupplierTRN,Country,Address,ContactPerson');
  for (const s of report.suppliers || []) {
    lines.push([
      csvCell(s.supplierName),
      csvCell(s.supplierId),
      csvCell(s.supplierTrn || ''),
      csvCell(s.country || 'AE'),
      csvCell(s.address || ''),
      csvCell(s.contactPerson || ''),
    ].join(','));
  }
  lines.push('SupplierEnd');
  lines.push('');

  // Section 5: UAE Form VAT 201 Summary (Box 1a - 14)
  lines.push('VAT201SummaryStart');
  lines.push('Box,Description,Emirate,AmountAED,VATAmountAED,AdjustmentAED');
  for (const b of report.vat201Boxes.box1StandardRatedByEmirate) {
    lines.push([
      csvCell(b.box),
      csvCell(`Standard rated supplies in ${b.emirate}`),
      csvCell(b.emirate),
      csvCell(b.amountAed.toFixed(2)),
      csvCell(b.vatAmountAed.toFixed(2)),
      csvCell(b.adjustmentAed.toFixed(2)),
    ].join(','));
  }
  lines.push(['3', 'Supplies subject to reverse charge provisions', '', report.vat201Boxes.box3ReverseChargeSupplies.amountAed.toFixed(2), report.vat201Boxes.box3ReverseChargeSupplies.vatAmountAed.toFixed(2), '0.00'].join(','));
  lines.push(['6', 'Zero rated supplies', '', report.vat201Boxes.box6ZeroRatedSupplies.amountAed.toFixed(2), '0.00', '0.00'].join(','));
  lines.push(['7', 'Exempt supplies', '', report.vat201Boxes.box7ExemptSupplies.amountAed.toFixed(2), '0.00', '0.00'].join(','));
  lines.push(['8', 'Total value of due tax for the period', '', report.vat201Boxes.box8TotalSuppliesAndOutputVat.amountAed.toFixed(2), report.vat201Boxes.box8TotalSuppliesAndOutputVat.vatAmountAed.toFixed(2), '0.00'].join(','));
  lines.push(['9', 'Standard rated expenses', '', report.vat201Boxes.box9StandardRatedExpenses.amountAed.toFixed(2), report.vat201Boxes.box9StandardRatedExpenses.recoverableVatAed.toFixed(2), '0.00'].join(','));
  lines.push(['14', 'Net VAT due (or reclaimable) for the period', '', '', report.vat201Boxes.box14NetVatPayableOrRefundable.toFixed(2), '0.00'].join(','));
  lines.push('VAT201SummaryEnd');
  lines.push('');

  // Section 6: CustomerSupply
  lines.push('CustomerSupplyStart');
  lines.push('CustomerName,CustomerID,Country,TRN,InvoiceDate,InvoiceNo,LineNo,ProductDescription,SupplyValueAED,VATValueAED,TaxCode,FCYCode,SupplyFCY,VATFCY,Emirate');
  for (const s of report.customerSupplies) {
    lines.push([
      csvCell(s.customerName),
      csvCell(s.customerId || s.customerName),
      csvCell(s.country || 'AE'),
      csvCell(s.customerTrn || ''),
      csvCell(s.invoiceDate),
      csvCell(s.invoiceNo),
      csvCell(s.lineNo || 1),
      csvCell(s.description),
      csvCell(s.supplyValueAed.toFixed(2)),
      csvCell(s.vatValueAed.toFixed(2)),
      csvCell(s.taxCode || 'SR'),
      csvCell(s.currency || 'AED'),
      csvCell((s.supplyFcy ?? s.supplyValueAed).toFixed(2)),
      csvCell((s.vatFcy ?? s.vatValueAed).toFixed(2)),
      csvCell(s.emirate || 'Dubai'),
    ].join(','));
  }
  lines.push('CustomerSupplyEnd');
  lines.push('');

  // Section 7: SupplierPurchase
  lines.push('SupplierPurchaseStart');
  lines.push('SupplierName,SupplierID,Country,TRN,InvoiceDate,InvoiceNo,LineNo,ProductDescription,PurchaseValueAED,VATValueAED,TaxCode,FCYCode,PurchaseFCY,VATFCY');
  for (const p of report.supplierPurchases) {
    lines.push([
      csvCell(p.supplierName),
      csvCell(p.supplierId || p.supplierName),
      csvCell(p.country || 'AE'),
      csvCell(p.supplierTrn || ''),
      csvCell(p.invoiceDate),
      csvCell(p.invoiceNo),
      csvCell(p.lineNo || 1),
      csvCell(p.description),
      csvCell(p.purchaseValueAed.toFixed(2)),
      csvCell(p.vatValueAed.toFixed(2)),
      csvCell(p.taxCode || 'SR'),
      csvCell(p.currency || 'AED'),
      csvCell((p.purchaseFcy ?? p.purchaseValueAed).toFixed(2)),
      csvCell((p.vatFcy ?? p.vatValueAed).toFixed(2)),
    ].join(','));
  }
  lines.push('SupplierPurchaseEnd');

  return lines.join('\r\n');
}
