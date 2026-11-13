/**
 * Rent-A-Car (RAC) Double-Entry General Ledger Posting & Security Deposit Sync
 *
 * Posts balanced `POSTED` `finance_journal_entries` + `finance_journal_lines`
 * against the exact leaf accounts in `finance.finance_coa_template`:
 *
 *   Assets:
 *     - `1110` — Cash in Hand (`CASH`)
 *     - `1120` — Cash at Bank (`CARD`, `PREAUTH_CAPTURE`, `BANK`, `BANK_TRANSFER`, `ONLINE`)
 *     - `1160` — PDC Receivable (Post-Dated Cheques Held) (`CHEQUE`, `PDC`)
 *     - `1131` — Trade Receivables — RAC (AR control leaf for RAC)
 *
 *   Liabilities:
 *     - `2120` — VAT Payable (Output VAT) (UAE 5% standard-rated supplies)
 *     - `2150` — Customer Deposits & Advances (RAC cash/card collected deposits)
 *     - `2160` — Traffic Fines & Tolls Clearing (non-taxable statutory pass-through, FTA VATP006/VATP040)
 *
 *   Income:
 *     - `4110` — RAC — Daily Rental (<7 days, extensions, ancillaries, fuel/km/late fees)
 *     - `4120` — RAC — Weekly / Monthly Rental (>=7 days base tariff)
 *     - `4130` — RAC — Damage & Insurance Recovery (CDW/PAI/SCDW & vehicle damage charges)
 *     - `4140` — RAC — Fine & Toll Admin Surcharges (5%-taxable handling & admin fees)
 */

import type { TxClient } from '@/lib/rls';
import { ensureTenantChartOfAccounts } from '@/lib/finance/chart-of-accounts';
import { postOperationalJournalEntry, type JournalTx } from '@/lib/finance/journal-service';
import { nextDocumentNumber } from '@/lib/finance/document-number';
import { withSavepoint } from '@/lib/rental/locks';

export const RAC_GL_ACCOUNTS = {
  CASH_IN_HAND:        { code: '1110', name: 'Cash in Hand' },
  CASH_AT_BANK:        { code: '1120', name: 'Cash at Bank' },
  AR_RAC:              { code: '1131', name: 'Trade Receivables — RAC' },
  PDC_RECEIVABLE:      { code: '1160', name: 'PDC Receivable (Post-Dated Cheques Held)' },
  OUTPUT_VAT:          { code: '2120', name: 'VAT Payable (Output VAT)' },
  CUSTOMER_DEPOSITS:   { code: '2150', name: 'Customer Deposits & Advances' },
  FINES_CLEARING:      { code: '2160', name: 'Traffic Fines & Tolls Clearing' },
  REV_DAILY:           { code: '4110', name: 'RAC — Daily Rental' },
  REV_WEEKLY_MONTHLY:  { code: '4120', name: 'RAC — Weekly / Monthly Rental' },
  REV_DAMAGE_INS:      { code: '4130', name: 'RAC — Damage & Insurance Recovery' },
  REV_ADMIN_SURCHARGE: { code: '4140', name: 'RAC — Fine & Toll Admin Surcharges' },
} as const;

export type RacInvoiceLineForGl = {
  lineType?: string | null;
  description?: string | null;
  amount: number;
  taxable?: boolean | null;
  quantity?: number | null;
  unitLabel?: string | null;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Maps a payment / refund method to the appropriate asset or liability leaf account.
 */
export function resolveSettlementGlAccount(paymentMethod?: string | null): { code: string; name: string } {
  const m = String(paymentMethod ?? 'CARD').trim().toUpperCase();
  if (m === 'CASH') return RAC_GL_ACCOUNTS.CASH_IN_HAND;
  if (m === 'CHEQUE' || m === 'PDC') return RAC_GL_ACCOUNTS.PDC_RECEIVABLE;
  if (m === 'DEPOSIT' || m === 'DEPOSIT_DEDUCTION' || m === 'SECURITY_DEPOSIT') {
    return RAC_GL_ACCOUNTS.CUSTOMER_DEPOSITS;
  }
  return RAC_GL_ACCOUNTS.CASH_AT_BANK;
}

/**
 * Classifies an individual RAC invoice line item into its CoA revenue or
 * statutory clearing leaf account.
 */
export function classifyRacLineCreditAccount(
  line: RacInvoiceLineForGl,
  rentalDaysHint?: number | null,
): { code: string; name: string; isClearing: boolean } {
  const t = String(line.lineType ?? 'RENTAL').trim().toUpperCase();
  const desc = String(line.description ?? '').toUpperCase();

  // Statutory traffic fine principal, UAE Knowledge & Innovation Dirham (AED 20),
  // and statutory pass-through tolls when explicitly out-of-scope (0% VAT per UAE FTA VATP006 / VATP040)
  if (
    (t === 'FINE' ||
      t === 'TRAFFIC_FINE' ||
      t === 'STATUTORY_FINE' ||
      t === 'KNOWLEDGE_FEE' ||
      t === 'INNOVATION_FEE' ||
      desc.includes('KNOWLEDGE & INNOVATION') ||
      desc.includes('KNOWLEDGE DIRHAM') ||
      desc.includes('INNOVATION DIRHAM')) &&
    line.taxable === false
  ) {
    return { ...RAC_GL_ACCOUNTS.FINES_CLEARING, isClearing: true };
  }

  // Taxable RAC administrative surcharges on fines/tolls (5% standard-rated UAE VAT)
  if (
    t === 'ADMIN_FEE' ||
    t === 'FINE_ADMIN_FEE' ||
    t === 'TOLL_ADMIN_FEE' ||
    t === 'KNOWLEDGE_FEE' ||
    desc.includes('ADMIN FEE') ||
    desc.includes('HANDLING FEE') ||
    desc.includes('ADMIN SURCHARGE')
  ) {
    return { ...RAC_GL_ACCOUNTS.REV_ADMIN_SURCHARGE, isClearing: false };
  }

  // Insurance waivers (CDW/SCDW/PAI) & vehicle damage recovery
  if (
    t === 'INSURANCE' ||
    t === 'DAMAGE' ||
    t === 'DAMAGE_RECOVERY' ||
    t === 'CDW' ||
    t === 'SCDW' ||
    t === 'PAI'
  ) {
    return { ...RAC_GL_ACCOUNTS.REV_DAMAGE_INS, isClearing: false };
  }

  // Base rental tariff >= 7 days -> Weekly / Monthly Rental leaf (4120)
  if (t === 'RENTAL') {
    const days =
      rentalDaysHint != null && rentalDaysHint > 0
        ? rentalDaysHint
        : String(line.unitLabel ?? 'day').toLowerCase() === 'day'
          ? Number(line.quantity ?? 1)
          : 1;
    if (days >= 7) {
      return { ...RAC_GL_ACCOUNTS.REV_WEEKLY_MONTHLY, isClearing: false };
    }
  }

  return { ...RAC_GL_ACCOUNTS.REV_DAILY, isClearing: false };
}

/**
 * Ensures the tenant's Chart of Accounts and the two RAC statutory/surcharge
 * leaf accounts (`2160`, `4140`) exist before posting GL lines.
 */
export async function ensureRacGlLeafAccounts(tx: TxClient, tenantId: string): Promise<void> {
  await withSavepoint(
    tx,
    'rac_gl_ensure_coa',
    async () => {
      await ensureTenantChartOfAccounts(tx, tenantId);
      await tx.$executeRawUnsafe(
        `INSERT INTO finance.finance_chart_of_accounts
           (tenant_id, account_code, account_name, account_type, account_subtype, parent_code,
            description, is_header, is_active, is_system, normal_balance, currency, sort_order)
         VALUES
           ($1, '2160', 'Traffic Fines & Tolls Clearing', 'LIABILITY', 'CURRENT', '2100',
            'Non-taxable statutory RTA/Police fines and Salik/Darb pass-through clearing', FALSE, TRUE, FALSE, 'CREDIT', 'AED', 49),
           ($1, '4140', 'RAC — Fine & Toll Admin Surcharges', 'INCOME', 'REVENUE', '4100',
            '5% VAT-taxable administrative handling surcharges on RAC traffic fines and tolls', FALSE, TRUE, FALSE, 'CREDIT', 'AED', 74)
         ON CONFLICT (tenant_id, account_code) DO NOTHING`,
        tenantId,
      );
    },
    undefined,
  );
}

/**
 * Decomposes an invoice's net pre-VAT charges across CoA credit buckets so
 * `SUM(bucketCredits) + taxAmount === totalAmount` to the exact 0.01 AED.
 */
export function buildRacInvoiceCreditBuckets(args: {
  subtotal: number;
  discountAmount?: number;
  taxAmount: number;
  totalAmount: number;
  lines?: RacInvoiceLineForGl[];
  rentalDaysHint?: number | null;
}): Array<{ code: string; name: string; amount: number }> {
  const tax = round2(Math.max(0, args.taxAmount));
  const total = round2(Math.max(0, args.totalAmount));
  const targetNet = round2(Math.max(0, total - tax));
  if (targetNet <= 0 && tax <= 0) return [];

  const buckets = new Map<string, { code: string; name: string; amount: number; isClearing: boolean }>();
  const rawLines = (args.lines ?? []).filter((l) => String(l.lineType ?? '').toUpperCase() !== 'DISCOUNT');

  let explicitDiscountFromLines = 0;
  for (const l of args.lines ?? []) {
    if (String(l.lineType ?? '').toUpperCase() === 'DISCOUNT' || Number(l.amount) < 0) {
      explicitDiscountFromLines = round2(explicitDiscountFromLines + Math.abs(Number(l.amount) || 0));
    }
  }

  for (const l of rawLines) {
    const amt = round2(Number(l.amount) || 0);
    if (amt <= 0) continue;
    const acct = classifyRacLineCreditAccount(l, args.rentalDaysHint);
    const prev = buckets.get(acct.code);
    if (prev) {
      prev.amount = round2(prev.amount + amt);
    } else {
      buckets.set(acct.code, { ...acct, amount: amt });
    }
  }

  if (buckets.size === 0 && targetNet > 0) {
    const fallbackAcct =
      (args.rentalDaysHint ?? 1) >= 7 ? RAC_GL_ACCOUNTS.REV_WEEKLY_MONTHLY : RAC_GL_ACCOUNTS.REV_DAILY;
    buckets.set(fallbackAcct.code, { ...fallbackAcct, amount: targetNet, isClearing: false });
  }

  // Apply commercial discount across revenue buckets (never reducing statutory 2160 fine principal first)
  let grossSum = round2(Array.from(buckets.values()).reduce((s, b) => s + b.amount, 0));
  const discountToApply = round2(Math.max(0, grossSum - targetNet));
  if (discountToApply > 0 && grossSum > 0) {
    const revBuckets = Array.from(buckets.values()).filter((b) => !b.isClearing && b.amount > 0);
    const revSum = round2(revBuckets.reduce((s, b) => s + b.amount, 0));
    if (revSum > 0) {
      let remainingDisc = Math.min(discountToApply, revSum);
      for (let i = 0; i < revBuckets.length; i++) {
        const b = revBuckets[i];
        const share =
          i === revBuckets.length - 1
            ? remainingDisc
            : round2((discountToApply * b.amount) / revSum);
        const applied = Math.min(b.amount, share);
        b.amount = round2(b.amount - applied);
        remainingDisc = round2(remainingDisc - applied);
      }
    }
  }

  // Final 0.01 rounding reconciliation on primary bucket so debits === credits
  const finalList = Array.from(buckets.values()).filter((b) => b.amount > 0);
  const currentNet = round2(finalList.reduce((s, b) => s + b.amount, 0));
  const diff = round2(targetNet - currentNet);
  if (Math.abs(diff) > 0 && finalList.length > 0) {
    finalList[0].amount = round2(Math.max(0, finalList[0].amount + diff));
  }

  return finalList
    .filter((b) => b.amount > 0)
    .map(({ code, name, amount }) => ({ code, name, amount }));
}

/**
 * Posts the double-entry Revenue + Output VAT + Statutory Clearing journal entry
 * when a non-DRAFT RAC Tax Invoice is issued (`SENT` / `ISSUED` / `UNPAID` / `PAID`).
 */
export async function postRacInvoiceIssuedGl(
  tx: TxClient,
  args: {
    tenantId: string;
    invoiceId: string;
    invoiceNo: string;
    agreementNo?: string | null;
    invoiceDate?: string | Date | null;
    status?: string | null;
    currency?: string | null;
    subtotal: number;
    discountAmount?: number;
    taxAmount: number;
    totalAmount: number;
    lines?: RacInvoiceLineForGl[];
    rentalDaysHint?: number | null;
    preparedBy?: string | null;
  },
): Promise<{ id: string; number: string; created: boolean } | null> {
  const st = String(args.status ?? 'ISSUED').trim().toUpperCase();
  if (st === 'DRAFT' || st === 'VOID' || st === 'CANCELLED') return null;

  const total = round2(args.totalAmount);
  const tax = round2(Math.max(0, args.taxAmount));
  if (total <= 0) return null;

  return withSavepoint<{ id: string; number: string; created: boolean } | null>(
    tx,
    'rac_gl_inv_issued',
    async () => {
      await ensureRacGlLeafAccounts(tx, args.tenantId);

      const creditBuckets = buildRacInvoiceCreditBuckets({
        subtotal: args.subtotal,
        discountAmount: args.discountAmount,
        taxAmount: tax,
        totalAmount: total,
        lines: args.lines,
        rentalDaysHint: args.rentalDaysHint,
      });

      const jeLines: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [
        {
          code: RAC_GL_ACCOUNTS.AR_RAC.code,
          name: RAC_GL_ACCOUNTS.AR_RAC.name,
          description: `RAC Tax Invoice ${args.invoiceNo}${args.agreementNo ? ` (${args.agreementNo})` : ''}`,
          debit: total,
          credit: 0,
        },
      ];

      for (const b of creditBuckets) {
        jeLines.push({
          code: b.code,
          name: b.name,
          description: `${b.name} — ${args.invoiceNo}`,
          debit: 0,
          credit: b.amount,
        });
      }

      if (tax > 0) {
        jeLines.push({
          code: RAC_GL_ACCOUNTS.OUTPUT_VAT.code,
          name: RAC_GL_ACCOUNTS.OUTPUT_VAT.name,
          description: `UAE Output VAT (5%) — ${args.invoiceNo}`,
          debit: 0,
          credit: tax,
        });
      }

      const entryDate = args.invoiceDate
        ? typeof args.invoiceDate === 'string'
          ? args.invoiceDate.slice(0, 10)
          : new Date(args.invoiceDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      return postOperationalJournalEntry(tx as unknown as JournalTx, {
        tenantId: args.tenantId,
        entryDate,
        narration: `RAC Tax Invoice ${args.invoiceNo}${args.agreementNo ? ` — Agreement ${args.agreementNo}` : ''}`,
        reference: args.invoiceNo,
        sourceType: 'RENTAL_INVOICE',
        sourceId: args.invoiceId,
        currency: args.currency ?? 'AED',
        costCentre: 'PC-RAC',
        preparedBy: args.preparedBy ?? 'system',
        idempotencyKey: `RAC_INVOICE_ISSUED:${args.invoiceId}`,
        lines: jeLines,
      });
    },
    null,
  );
}

/**
 * Posts a balanced Tax Credit Note / Void reversal journal entry (UAE VAT Art. 61),
 * reversing Output VAT (`2120`), revenue (`4110`/`4120`/`4130`/`4140`), and/or
 * statutory clearing (`2160`) against `1131 Trade Receivables — RAC`.
 */
export async function postRacCreditNoteOrVoidGl(
  tx: TxClient,
  args: {
    tenantId: string;
    creditNoteOrInvoiceId: string;
    documentNo: string;
    parentInvoiceNo?: string | null;
    entryDate?: string | Date | null;
    currency?: string | null;
    subtotalMagnitude: number;
    taxMagnitude: number;
    totalMagnitude: number;
    lines?: RacInvoiceLineForGl[];
    rentalDaysHint?: number | null;
    preparedBy?: string | null;
  },
): Promise<{ id: string; number: string; created: boolean } | null> {
  const total = round2(Math.abs(args.totalMagnitude));
  const tax = round2(Math.abs(args.taxMagnitude));
  const sub = round2(Math.abs(args.subtotalMagnitude));
  if (total <= 0) return null;

  return withSavepoint<{ id: string; number: string; created: boolean } | null>(
    tx,
    'rac_gl_credit_note',
    async () => {
      await ensureRacGlLeafAccounts(tx, args.tenantId);

      const positiveLines = (args.lines ?? []).map((l) => ({
        ...l,
        amount: Math.abs(Number(l.amount) || 0),
      }));

      const debitBuckets = buildRacInvoiceCreditBuckets({
        subtotal: sub,
        taxAmount: tax,
        totalAmount: total,
        lines: positiveLines,
        rentalDaysHint: args.rentalDaysHint,
      });

      const jeLines: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [];

      for (const b of debitBuckets) {
        jeLines.push({
          code: b.code,
          name: b.name,
          description: `Reversal (${args.documentNo})${args.parentInvoiceNo ? ` against ${args.parentInvoiceNo}` : ''}`,
          debit: b.amount,
          credit: 0,
        });
      }

      if (tax > 0) {
        jeLines.push({
          code: RAC_GL_ACCOUNTS.OUTPUT_VAT.code,
          name: RAC_GL_ACCOUNTS.OUTPUT_VAT.name,
          description: `UAE Output VAT Reversal (Art. 61) — ${args.documentNo}`,
          debit: tax,
          credit: 0,
        });
      }

      jeLines.push({
        code: RAC_GL_ACCOUNTS.AR_RAC.code,
        name: RAC_GL_ACCOUNTS.AR_RAC.name,
        description: `AR Credit / Reversal — ${args.documentNo}`,
        debit: 0,
        credit: total,
      });

      const entryDate = args.entryDate
        ? typeof args.entryDate === 'string'
          ? args.entryDate.slice(0, 10)
          : new Date(args.entryDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      return postOperationalJournalEntry(tx as unknown as JournalTx, {
        tenantId: args.tenantId,
        entryDate,
        narration: `RAC Tax Credit / Void ${args.documentNo}${args.parentInvoiceNo ? ` (Ref ${args.parentInvoiceNo})` : ''}`,
        reference: args.documentNo,
        sourceType: 'RENTAL_CREDIT_NOTE',
        sourceId: args.creditNoteOrInvoiceId,
        currency: args.currency ?? 'AED',
        costCentre: 'PC-RAC',
        preparedBy: args.preparedBy ?? 'system',
        idempotencyKey: `RAC_CREDIT_NOTE:${args.creditNoteOrInvoiceId}`,
        lines: jeLines,
      });
    },
    null,
  );
}

/**
 * Posts a Cash / Bank / PDC / Deposit-Deduction settlement against `1131 Trade Receivables — RAC`.
 */
export async function postRacInvoicePaymentGl(
  tx: TxClient,
  args: {
    tenantId: string;
    paymentId: string;
    receiptNo: string;
    invoiceNo: string;
    amount: number;
    paymentMethod?: string | null;
    paidAt?: string | Date | null;
    currency?: string | null;
    preparedBy?: string | null;
  },
): Promise<{ id: string; number: string; created: boolean } | null> {
  const amt = round2(args.amount);
  if (amt <= 0) return null;

  return withSavepoint<{ id: string; number: string; created: boolean } | null>(
    tx,
    'rac_gl_inv_payment',
    async () => {
      await ensureRacGlLeafAccounts(tx, args.tenantId);
      const debitAcct = resolveSettlementGlAccount(args.paymentMethod);

      const entryDate = args.paidAt
        ? typeof args.paidAt === 'string'
          ? args.paidAt.slice(0, 10)
          : new Date(args.paidAt).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      return postOperationalJournalEntry(tx as unknown as JournalTx, {
        tenantId: args.tenantId,
        entryDate,
        narration: `RAC Receipt ${args.receiptNo} for Invoice ${args.invoiceNo} (${args.paymentMethod ?? 'CARD'})`,
        reference: args.receiptNo,
        sourceType: 'RENTAL_PAYMENT',
        sourceId: args.paymentId,
        currency: args.currency ?? 'AED',
        costCentre: 'PC-RAC',
        preparedBy: args.preparedBy ?? 'system',
        idempotencyKey: `RAC_INVOICE_PAYMENT:${args.paymentId}`,
        lines: [
          {
            code: debitAcct.code,
            name: debitAcct.name,
            description: `Receipt ${args.receiptNo} (${args.paymentMethod ?? 'CARD'})`,
            debit: amt,
            credit: 0,
          },
          {
            code: RAC_GL_ACCOUNTS.AR_RAC.code,
            name: RAC_GL_ACCOUNTS.AR_RAC.name,
            description: `Settlement of ${args.invoiceNo}`,
            debit: 0,
            credit: amt,
          },
        ],
      });
    },
    null,
  );
}

/**
 * Records an actually-collected RAC security deposit (NOT a mere card pre-auth
 * hold!) in both `finance_security_deposits` and the General Ledger (`DR 1110/1120`,
 * `CR 2150 Customer Deposits & Advances`).
 */
export async function recordRacSecurityDepositCollected(
  tx: TxClient,
  args: {
    tenantId: string;
    agreementId: string;
    agreementNo?: string | null;
    customerName: string;
    vehiclePlate?: string | null;
    vehicleType?: string | null;
    branch?: string | null;
    amount: number;
    collectionMethod?: string | null;
    collectionDate?: string | Date | null;
    currency?: string | null;
    preparedBy?: string | null;
  },
): Promise<{ depositId: string | null; journalId: string | null }> {
  const amt = round2(args.amount);
  if (amt <= 0) return { depositId: null, journalId: null };

  const method = String(args.collectionMethod ?? 'CARD').trim().toUpperCase();
  // An uncaptured card pre-authorization hold is an off-balance-sheet bank hold,
  // NOT cash received into the company's bank account!
  if (method === 'PREAUTH' || method === 'CARD_PREAUTH' || method === 'HOLD') {
    return { depositId: null, journalId: null };
  }

  return withSavepoint<{ depositId: string | null; journalId: string | null }>(
    tx,
    'rac_gl_dep_collect',
    async () => {
      await ensureRacGlLeafAccounts(tx, args.tenantId);

      const dateIso = args.collectionDate
        ? typeof args.collectionDate === 'string'
          ? args.collectionDate.slice(0, 10)
          : new Date(args.collectionDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      let depositId: string | null = null;
      const existingDep = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM finance_security_deposits
          WHERE tenant_id = $1
            AND (contract_id = $2 OR ($3 <> '' AND contract_id = $3))
          ORDER BY created_at DESC
          LIMIT 1`,
        args.tenantId,
        args.agreementId,
        args.agreementNo ?? '',
      );

      if (existingDep[0]?.id) {
        depositId = existingDep[0].id;
      } else {
        const depositNo = await nextDocumentNumber(tx, args.tenantId, 'FSD');
        const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `INSERT INTO finance_security_deposits
             (tenant_id, deposit_no, contract_id, contract_type, customer_name, vehicle_no,
              vehicle_type, branch, collected_amount, collection_date, collection_method, status, notes)
           VALUES ($1, $2, $3, 'RENTAL', $4, $5, $6, $7, $8::numeric, $9::date, $10, 'HELD', $11)
           RETURNING id::text AS id`,
          args.tenantId,
          depositNo,
          args.agreementNo ?? args.agreementId,
          args.customerName || 'Rental Customer',
          args.vehiclePlate || '—',
          args.vehicleType ?? null,
          args.branch || 'Dubai',
          amt,
          dateIso,
          method,
          `Security deposit collected on RAC agreement ${args.agreementNo ?? args.agreementId}`,
        );
        depositId = inserted[0]?.id ?? null;
      }

      const debitAcct = resolveSettlementGlAccount(method);
      const je = await postOperationalJournalEntry(tx as unknown as JournalTx, {
        tenantId: args.tenantId,
        entryDate: dateIso,
        narration: `RAC Security Deposit Collected — ${args.agreementNo ?? args.agreementId}`,
        reference: args.agreementNo ?? args.agreementId,
        sourceType: 'RENTAL_SECURITY_DEPOSIT',
        sourceId: args.agreementId,
        currency: args.currency ?? 'AED',
        costCentre: 'PC-RAC',
        preparedBy: args.preparedBy ?? 'system',
        idempotencyKey: `RAC_DEPOSIT_COLLECT:${args.agreementId}`,
        lines: [
          {
            code: debitAcct.code,
            name: debitAcct.name,
            description: `Security deposit received (${method}) — ${args.agreementNo ?? args.agreementId}`,
            debit: amt,
            credit: 0,
          },
          {
            code: RAC_GL_ACCOUNTS.CUSTOMER_DEPOSITS.code,
            name: RAC_GL_ACCOUNTS.CUSTOMER_DEPOSITS.name,
            description: `Customer deposit liability — ${args.agreementNo ?? args.agreementId}`,
            debit: 0,
            credit: amt,
          },
        ],
      });

      return { depositId, journalId: je?.id ?? null };
    },
    { depositId: null, journalId: null },
  );
}

/**
 * Posts a direct cash/bank refund of a collected RAC security deposit
 * (`DR 2150 Customer Deposits & Advances` / `CR 1110|1120`).
 */
export async function postRacSecurityDepositRefundGl(
  tx: TxClient,
  args: {
    tenantId: string;
    agreementId: string;
    agreementNo?: string | null;
    refundAmount: number;
    refundMethod?: string | null;
    refundDate?: string | Date | null;
    idempotencySuffix?: string;
    currency?: string | null;
    preparedBy?: string | null;
  },
): Promise<{ id: string; number: string; created: boolean } | null> {
  const amt = round2(args.refundAmount);
  if (amt <= 0) return null;

  const method = String(args.refundMethod ?? 'CARD').trim().toUpperCase();
  if (method === 'PREAUTH' || method === 'PREAUTH_RELEASE' || method === 'HOLD') {
    return null;
  }

  return withSavepoint<{ id: string; number: string; created: boolean } | null>(
    tx,
    'rac_gl_dep_refund',
    async () => {
      await ensureRacGlLeafAccounts(tx, args.tenantId);
      const creditAcct = resolveSettlementGlAccount(method);
      const dateIso = args.refundDate
        ? typeof args.refundDate === 'string'
          ? args.refundDate.slice(0, 10)
          : new Date(args.refundDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const suffix = args.idempotencySuffix ?? 'FINAL';
      return postOperationalJournalEntry(tx as unknown as JournalTx, {
        tenantId: args.tenantId,
        entryDate: dateIso,
        narration: `RAC Security Deposit Refund — ${args.agreementNo ?? args.agreementId}`,
        reference: args.agreementNo ?? args.agreementId,
        sourceType: 'RENTAL_DEPOSIT_REFUND',
        sourceId: args.agreementId,
        currency: args.currency ?? 'AED',
        costCentre: 'PC-RAC',
        preparedBy: args.preparedBy ?? 'system',
        idempotencyKey: `RAC_DEPOSIT_REFUND:${args.agreementId}:${suffix}`,
        lines: [
          {
            code: RAC_GL_ACCOUNTS.CUSTOMER_DEPOSITS.code,
            name: RAC_GL_ACCOUNTS.CUSTOMER_DEPOSITS.name,
            description: `Security deposit refund — ${args.agreementNo ?? args.agreementId}`,
            debit: amt,
            credit: 0,
          },
          {
            code: creditAcct.code,
            name: creditAcct.name,
            description: `Deposit payout (${method}) — ${args.agreementNo ?? args.agreementId}`,
            debit: 0,
            credit: amt,
          },
        ],
      });
    },
    null,
  );
}
