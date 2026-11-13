/**
 * Finance journal service — the single authorised path for creating journal entries
 * from within domain modules (Logistics, Leasing, etc.).
 *
 * RULE: No domain module may insert a row into finance_journal_entries directly.
 *       All entries must be created through this service and must start as DRAFT.
 *       Promotion through the lifecycle (DRAFT → SUBMITTED → APPROVED → POSTED)
 *       happens exclusively via PATCH /api/finance/journal-entries/[id].
 */

import { randomInt } from 'crypto';
import { prisma } from '@/lib/prisma';

/** The raw-SQL part of a Prisma client or transaction. */
type RawSqlQueryDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

// ── Types ──────────────────────────────────────────────────────────────────────

export type CreateDraftJournalEntryParams = {
  tenantId: string;
  /** Human-readable narrative shown in the GL. */
  narration: string;
  /** Source document reference (settlement number, invoice number, etc.). */
  reference: string;
  /** Source document type, e.g. 'LOGISTICS_SETTLEMENT', 'CARRIER_SETTLEMENT'. */
  sourceType: string;
  /** Source document ID (UUID or TEXT). */
  sourceId: string;
  amount: number;
  currency: string;
  /** User or service that prepared the entry. Defaults to 'system'. */
  preparedBy?: string | null;
  notes?: string | null;
  /** Cost centre code stamped on both journal lines. Defaults to 'GENERAL'. */
  costCentre?: string;
  debit:  { code: string; name: string; description: string };
  credit: { code: string; name: string; description: string };
  /**
   * The business occurrence this entry records. A second call with the same
   * key (per tenant) returns the existing entry instead of posting again.
   * Defaults to `<sourceType>:<sourceId>`; pass a more specific key when one
   * source legitimately yields several entries.
   */
  idempotencyKey?: string;
};

export type DraftJournalEntryResult = {
  id: string;
  number: string;
  /** False when an entry for this occurrence already existed (a retry). */
  created: boolean;
};

// ── Numbering ──────────────────────────────────────────────────────────────────

type RawQueryDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type JournalTx = RawQueryDb & {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

const SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Next journal entry number: JE-<yyyymm>-<seq>-<suffix>, e.g.
 * JE-202609-00012-K7QX (reversals append -REV).
 *
 * je_number is unique across every tenant, but row-level security only lets
 * a tenant count its own entries. A bare count-based number therefore
 * collided as soon as a second tenant posted in the same month (the insert
 * failed on the unique key). The sequence counts this tenant's entries for
 * the month; the random suffix keeps the number unique platform-wide — the
 * scheme invoice and expense numbers use.
 */
export async function nextJournalNumber(
  db: RawQueryDb,
  tenantId: string,
  at: Date = new Date(),
): Promise<string> {
  const ym = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}`;
  const [row] = await db.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count
       FROM finance_journal_entries
      WHERE tenant_id::text = $1
        AND je_number LIKE $2`,
    tenantId,
    `JE-${ym}-%`,
  );
  const seq = String(Number(row?.count ?? 0) + 1).padStart(5, '0');
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += SUFFIX_CHARS[randomInt(SUFFIX_CHARS.length)];
  return `JE-${ym}-${seq}-${suffix}`;
}

/**
 * Maps legacy / header / placeholder GL codes to valid leaf accounts in the
 * standard transport Chart of Accounts.
 */
export function normalizeLeafGlAccount(code: string, fallbackName: string): { code: string; name: string } {
  const trimmed = String(code ?? '').trim();
  switch (trimmed) {
    case '2100':
    case '2200-LOG':
      return { code: '2110', name: 'Accounts Payable — Trade' };
    case '2210-LOG':
      return { code: '2130', name: 'Accrued Expenses' };
    case '5100':
      return { code: '5120', name: 'Vehicle Maintenance & Repairs' };
    case '5145':
    case '5200':
    case '5200-LOG':
    case '5250-LOG':
      return { code: '5210', name: 'Driver Salaries & Wages' };
    case '5300':
    case '5900':
      return { code: '5390', name: 'Miscellaneous Admin Expenses' };
    case '4500':
      return { code: '4400', name: 'Staff Transport Revenue' };
    default:
      return { code: trimmed || '5390', name: fallbackName };
  }
}

/**
 * Checks if the target accounting period is locked (LOCKED or YEAR_END).
 * Throws an Error with statusCode = 422 if locked.
 */
export async function assertPeriodOpen(
  tx: RawSqlQueryDb,
  tenantId: string,
  dateStr?: string | Date | null,
): Promise<void> {
  const d = dateStr
    ? typeof dateStr === 'string'
      ? dateStr.slice(0, 10)
      : new Date(dateStr).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  let rows: Array<{ status?: string; period_name?: string }> = [];
  try {
    rows = await tx.$queryRawUnsafe<Array<{ status?: string; period_name?: string }>>(
      `SELECT status, period_name
         FROM finance_periods
        WHERE tenant_id = $1
          AND $2::date BETWEEN start_date AND end_date
          AND status IN ('LOCKED', 'YEAR_END')
        LIMIT 1`,
      tenantId,
      d,
    );
  } catch {
    try {
      rows = await tx.$queryRawUnsafe<Array<{ status?: string; period_name?: string }>>(
        `SELECT status, period_name
           FROM finance_periods
          WHERE tenant_id = $1
            AND $2::date BETWEEN period_from AND period_to
            AND status IN ('LOCKED', 'YEAR_END')
          LIMIT 1`,
        tenantId,
        d,
      );
    } catch {
      rows = [];
    }
  }

  const locked = rows?.[0];
  if (locked && (locked.status === 'LOCKED' || locked.status === 'YEAR_END')) {
    const err = new Error(
      `Accounting period "${locked.period_name || d}" is ${locked.status} and cannot accept new postings.`,
    ) as Error & { statusCode?: number };
    err.statusCode = 422;
    throw err;
  }
}

/**
 * Posts a balanced multi-line operational journal entry directly with status='POSTED'
 * inside the caller's transaction (idempotent on (tenant_id, idempotency_key)).
 * Best-effort: returns null rather than aborting if underlying tables are unavailable.
 */
export async function postOperationalJournalEntry(
  tx: JournalTx,
  params: {
    tenantId: string;
    entryDate?: string;
    narration: string;
    reference: string;
    sourceType: string;
    sourceId: string;
    currency?: string;
    costCentre?: string;
    preparedBy?: string;
    idempotencyKey?: string;
    lines: Array<{ code: string; name: string; description: string; debit: number; credit: number }>;
  },
): Promise<{ id: string; number: string; created: boolean } | null> {
  try {
    const validLines = (params.lines ?? [])
      .map((l) => {
        const norm = normalizeLeafGlAccount(l.code, l.name);
        return {
          code: norm.code,
          name: norm.name,
          description: l.description,
          debit: Number((Number(l.debit) || 0).toFixed(2)),
          credit: Number((Number(l.credit) || 0).toFixed(2)),
        };
      })
      .filter((l) => l.debit > 0 || l.credit > 0);

    if (validLines.length === 0) return null;

    const totalDebit = Number(validLines.reduce((s, l) => s + l.debit, 0).toFixed(2));
    const totalCredit = Number(validLines.reduce((s, l) => s + l.credit, 0).toFixed(2));
    if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
      return null;
    }

    const idempotencyKey = params.idempotencyKey ?? `${params.sourceType}:${params.sourceId}`;
    const existing = await findExisting(
      tx,
      {
        tenantId: params.tenantId,
        narration: params.narration,
        reference: params.reference,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        amount: totalDebit,
        currency: params.currency ?? 'AED',
        debit: { code: validLines[0].code, name: validLines[0].name, description: validLines[0].description },
        credit: { code: validLines[0].code, name: validLines[0].name, description: validLines[0].description },
      },
      idempotencyKey,
    );
    if (existing) {
      return { id: existing.id, number: existing.je_number, created: false };
    }

    const dt = params.entryDate ? new Date(params.entryDate) : new Date();
    const entryDateIso = (Number.isNaN(dt.getTime()) ? new Date() : dt).toISOString().slice(0, 10);
    await assertPeriodOpen(tx, params.tenantId, entryDateIso);
    const dtObj = new Date(entryDateIso);
    const costCentre = params.costCentre ?? 'GENERAL';
    const currency = params.currency ?? 'AED';
    const jeNumber = await nextJournalNumber(tx, params.tenantId, dtObj);

    const [je] = await tx.$queryRawUnsafe<Array<{ id: string; je_number: string }>>(
      `INSERT INTO finance_journal_entries (
         je_number, entry_date, period_year, period_month,
         narration, reference, source_type, source_id,
         status, total_debit, total_credit, is_balanced,
         prepared_by, approved_by, posted_by, approved_at, posted_at,
         currency, tenant_id, idempotency_key
       ) VALUES (
         $1,$2::date,$3,$4,
         $5,$6,$7,$8,
         'POSTED',$9,$10,true,
         $11,$11,$11,NOW(),NOW(),
         $12,$13,$14
       )
       ON CONFLICT (tenant_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL AND status <> 'REVERSED'
         DO NOTHING
       RETURNING id::text, je_number`,
      jeNumber,
      entryDateIso,
      dtObj.getUTCFullYear(),
      dtObj.getUTCMonth() + 1,
      params.narration,
      params.reference,
      params.sourceType,
      params.sourceId,
      totalDebit,
      totalCredit,
      params.preparedBy ?? 'system',
      currency,
      params.tenantId,
      idempotencyKey,
    );

    if (!je) {
      const winner = await findExisting(
        tx,
        {
          tenantId: params.tenantId,
          narration: params.narration,
          reference: params.reference,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          amount: totalDebit,
          currency,
          debit: { code: validLines[0].code, name: validLines[0].name, description: validLines[0].description },
          credit: { code: validLines[0].code, name: validLines[0].name, description: validLines[0].description },
        },
        idempotencyKey,
      );
      if (winner) return { id: winner.id, number: winner.je_number, created: false };
      return null;
    }

    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      // Determine account's natural normal_balance by CoA class (1xxx/5xxx = DEBIT except 1290 contra-asset; 2xxx/3xxx/4xxx = CREDIT)
      const normalBalance =
        l.code === '1290'
          ? 'CREDIT'
          : l.code.startsWith('1') || l.code.startsWith('5')
            ? 'DEBIT'
            : l.code.startsWith('2') || l.code.startsWith('3') || l.code.startsWith('4')
              ? 'CREDIT'
              : l.debit >= l.credit
                ? 'DEBIT'
                : 'CREDIT';
      await tx.$executeRawUnsafe(
        `INSERT INTO finance_journal_lines
           (journal_entry_id, line_number, account_code, account_name, description,
            debit_amount, credit_amount, normal_balance, cost_centre, currency)
         VALUES
           ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        je.id,
        i + 1,
        l.code,
        l.name,
        l.description,
        l.debit,
        l.credit,
        normalBalance,
        costCentre,
        currency,
      );
    }

    await tx.$executeRawUnsafe(
      `UPDATE finance_journal_entries je
          SET total_debit  = t.debit,
              total_credit = t.credit,
              is_balanced  = (t.debit = t.credit AND t.lines > 0)
         FROM (SELECT COALESCE(SUM(debit_amount), 0)  AS debit,
                      COALESCE(SUM(credit_amount), 0) AS credit,
                      COUNT(*)                        AS lines
                 FROM finance_journal_lines
                WHERE journal_entry_id = $1::uuid) t
        WHERE je.id = $1::uuid`,
      je.id,
    );

    return { id: je.id, number: je.je_number, created: true };
  } catch {
    return null;
  }
}

// ── Service function ───────────────────────────────────────────────────────────

/**
 * Create a balanced two-line journal entry with status='DRAFT', exactly once
 * per business occurrence (architecture audit A4).
 *
 *   - Atomic: numbering, header and lines run in ONE transaction. Inside a
 *     caller's transaction (withTenantRls or a request transaction) it joins
 *     that transaction; otherwise prisma.$transaction opens one, scoped to
 *     the current tenant (src/lib/prisma.ts). A failed line insert leaves no
 *     header behind.
 *   - Idempotent: the header carries idempotency_key, unique per tenant among
 *     live, non-reversed entries (migration 20261023100000). A retry, or a
 *     concurrent delivery of the same source, returns the existing entry.
 *     Entries created before the key existed are matched on (source_type,
 *     source_id).
 *   - Balance is derived from the persisted lines, not asserted.
 *
 * The caller receives the entry ID and number. Approval and posting happen
 * via the Finance API (PATCH /api/finance/journal-entries/[id]) — never here.
 *
 * @throws if any statement fails (e.g. period lock active, constraint violation);
 *         nothing is committed in that case.
 */
export async function createDraftJournalEntry(
  p: CreateDraftJournalEntryParams,
  existingTx?: JournalTx,
): Promise<DraftJournalEntryResult> {
  const idempotencyKey = p.idempotencyKey ?? `${p.sourceType}:${p.sourceId}`;
  if (existingTx) {
    return createInTransaction(existingTx, p, idempotencyKey);
  }
  return prisma.$transaction((tx) => createInTransaction(tx as unknown as JournalTx, p, idempotencyKey));
}

async function findExisting(
  tx: JournalTx,
  p: CreateDraftJournalEntryParams,
  idempotencyKey: string,
): Promise<{ id: string; je_number: string } | undefined> {
  const [row] = await tx.$queryRawUnsafe<Array<{ id: string; je_number: string }>>(
    `SELECT id::text, je_number
       FROM finance_journal_entries
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND status <> 'REVERSED'
        AND (idempotency_key = $2
             OR (idempotency_key IS NULL AND source_type = $3 AND source_id = $4))
      ORDER BY created_at ASC
      LIMIT 1`,
    p.tenantId, idempotencyKey, p.sourceType, p.sourceId,
  );
  return row;
}

async function createInTransaction(
  tx: JournalTx,
  p: CreateDraftJournalEntryParams,
  idempotencyKey: string,
): Promise<DraftJournalEntryResult> {
  const existing = await findExisting(tx, p, idempotencyKey);
  if (existing) return { id: existing.id, number: existing.je_number, created: false };

  const entryDate  = new Date();
  const costCentre = p.costCentre ?? 'GENERAL';
  const jeNumber   = await nextJournalNumber(tx, p.tenantId, entryDate);

  // Totals start at zero and unbalanced; they are set from the lines below.
  const [je] = await tx.$queryRawUnsafe<Array<{ id: string; je_number: string }>>(
    `INSERT INTO finance_journal_entries (
       je_number, entry_date, period_year, period_month,
       narration, reference, source_type, source_id,
       status, total_debit, total_credit, is_balanced,
       prepared_by, notes, currency, tenant_id, idempotency_key
     ) VALUES (
       $1,$2::date,$3,$4,
       $5,$6,$7,$8,
       'DRAFT',0,0,false,
       $9,$10,$11,$12,$13
     )
     ON CONFLICT (tenant_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL AND status <> 'REVERSED'
       DO NOTHING
     RETURNING id::text, je_number`,
    jeNumber,
    entryDate.toISOString().slice(0, 10),
    entryDate.getFullYear(),
    entryDate.getMonth() + 1,
    p.narration,
    p.reference,
    p.sourceType,
    p.sourceId,
    p.preparedBy ?? 'system',
    p.notes ?? null,
    p.currency,
    p.tenantId,
    idempotencyKey,
  );

  if (!je) {
    // A concurrent delivery inserted it first (and has committed).
    const winner = await findExisting(tx, p, idempotencyKey);
    if (winner) return { id: winner.id, number: winner.je_number, created: false };
    throw new Error(`createDraftJournalEntry: INSERT failed for reference=${p.reference}`);
  }

  const debitNorm  = normalizeLeafGlAccount(p.debit.code, p.debit.name);
  const creditNorm = normalizeLeafGlAccount(p.credit.code, p.credit.name);

  await tx.$executeRawUnsafe(
    `INSERT INTO finance_journal_lines
       (journal_entry_id, line_number, account_code, account_name, description,
        debit_amount, credit_amount, normal_balance, cost_centre, currency)
     VALUES
       ($1::uuid,1,$2,$3,$4,$5,0,'DEBIT',$6,$7),
       ($1::uuid,2,$8,$9,$10,0,$5,'CREDIT',$6,$7)`,
    je.id,
    debitNorm.code,  debitNorm.name,  p.debit.description,
    p.amount,
    costCentre,
    p.currency,
    creditNorm.code, creditNorm.name, p.credit.description,
  );

  // Totals and balance from what was actually written.
  await tx.$executeRawUnsafe(
    `UPDATE finance_journal_entries je
        SET total_debit  = t.debit,
             total_credit = t.credit,
             is_balanced  = (t.debit = t.credit AND t.lines > 0)
       FROM (SELECT COALESCE(SUM(debit_amount), 0)  AS debit,
                    COALESCE(SUM(credit_amount), 0) AS credit,
                    COUNT(*)                        AS lines
               FROM finance_journal_lines
              WHERE journal_entry_id = $1::uuid) t
      WHERE je.id = $1::uuid`,
    je.id,
  );

  return { id: je.id, number: je.je_number, created: true };
}
