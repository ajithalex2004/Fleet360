-- One live generated journal entry per business occurrence (architecture
-- audit A4).
--
-- createDraftJournalEntry (src/lib/finance/journal-service.ts) stamps
-- idempotency_key (default '<source_type>:<source_id>') and inserts with
-- ON CONFLICT DO NOTHING against this index, returning the existing entry on
-- a retry instead of posting the same source twice. Soft-deleted and
-- REVERSED entries leave the index, so a source can be posted again after a
-- reversal. Existing rows keep a NULL key: the service matches them by
-- (source_type, source_id) instead. Additive; no backfill.

ALTER TABLE finance.finance_journal_entries
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_journal_entries_idempotency
  ON finance.finance_journal_entries (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL AND status <> 'REVERSED';
