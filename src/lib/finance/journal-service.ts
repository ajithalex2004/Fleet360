/**
 * Finance journal service — the single authorised path for creating journal entries
 * from within domain modules (Logistics, Leasing, etc.).
 *
 * RULE: No domain module may insert a row into finance_journal_entries directly.
 *       All entries must be created through this service and must start as DRAFT.
 *       Promotion through the lifecycle (DRAFT → SUBMITTED → APPROVED → POSTED)
 *       happens exclusively via PATCH /api/finance/journal-entries/[id].
 */

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
};

export type DraftJournalEntryResult = {
  id: string;
  number: string;
};

// ── Service function ───────────────────────────────────────────────────────────

/**
 * Create a balanced two-line journal entry with status='DRAFT'.
 *
 * The caller receives the entry ID and number. Approval and posting happen
 * via the Finance API (PATCH /api/finance/journal-entries/[id]) — never here.
 *
 * @throws if the INSERT fails (e.g. period lock active, constraint violation).
 */
export async function createDraftJournalEntry(
  p: CreateDraftJournalEntryParams,
): Promise<DraftJournalEntryResult> {
  const entryDate  = new Date();
  const ym         = `${entryDate.getFullYear()}${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
  const costCentre = p.costCentre ?? 'GENERAL';

  // Tenant-scoped sequential number within the month.
  const [seqRow] = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count
       FROM finance_journal_entries
      WHERE tenant_id::text = $1
        AND je_number LIKE $2`,
    p.tenantId,
    `JE-${ym}-%`,
  ).catch(() => [{ count: 0 }]);
  const jeNumber = `JE-${ym}-${String(Number(seqRow?.count ?? 0) + 1).padStart(5, '0')}`;

  const [je] = await prisma.$queryRawUnsafe<Array<{ id: string; je_number: string }>>(
    `INSERT INTO finance_journal_entries (
       je_number, entry_date, period_year, period_month,
       narration, reference, source_type, source_id,
       status, total_debit, total_credit, is_balanced,
       prepared_by, notes, currency, tenant_id
     ) VALUES (
       $1,$2::date,$3,$4,
       $5,$6,$7,$8,
       'DRAFT',$9,$9,true,
       $10,$11,$12,$13
     )
     RETURNING id::text, je_number`,
    jeNumber,
    entryDate.toISOString().slice(0, 10),
    entryDate.getFullYear(),
    entryDate.getMonth() + 1,
    p.narration,
    p.reference,
    p.sourceType,
    p.sourceId,
    p.amount,
    p.preparedBy ?? 'system',
    p.notes ?? null,
    p.currency,
    p.tenantId,
  );

  if (!je) throw new Error(`createDraftJournalEntry: INSERT failed for reference=${p.reference}`);

  await prisma.$executeRawUnsafe(
    `INSERT INTO finance_journal_lines
       (journal_entry_id, line_number, account_code, account_name, description,
        debit_amount, credit_amount, normal_balance, cost_centre, currency)
     VALUES
       ($1,1,$2,$3,$4,$5,0,'DEBIT',$6,$7),
       ($1,2,$8,$9,$10,0,$5,'CREDIT',$6,$7)`,
    je.id,
    p.debit.code,  p.debit.name,  p.debit.description,
    p.amount,
    costCentre,
    p.currency,
    p.credit.code, p.credit.name, p.credit.description,
  );

  return { id: je.id, number: je.je_number };
}
