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
): Promise<DraftJournalEntryResult> {
  const idempotencyKey = p.idempotencyKey ?? `${p.sourceType}:${p.sourceId}`;
  return prisma.$transaction((tx) => createInTransaction(tx as unknown as JournalTx, p, idempotencyKey));
}

type JournalTx = RawQueryDb & {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

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

  await tx.$executeRawUnsafe(
    `INSERT INTO finance_journal_lines
       (journal_entry_id, line_number, account_code, account_name, description,
        debit_amount, credit_amount, normal_balance, cost_centre, currency)
     VALUES
       ($1::uuid,1,$2,$3,$4,$5,0,'DEBIT',$6,$7),
       ($1::uuid,2,$8,$9,$10,0,$5,'CREDIT',$6,$7)`,
    je.id,
    p.debit.code,  p.debit.name,  p.debit.description,
    p.amount,
    costCentre,
    p.currency,
    p.credit.code, p.credit.name, p.credit.description,
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
