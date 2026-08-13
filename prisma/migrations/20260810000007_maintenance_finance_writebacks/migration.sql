-- Migration: maintenance_finance_writebacks
-- Adds finance traceability fields to maintenance_requests so every completed
-- request carries a direct FK to its AP payable and journal entry.

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS finance_payable_id TEXT,
  ADD COLUMN IF NOT EXISTS finance_je_id       TEXT;

COMMENT ON COLUMN maintenance_requests.finance_payable_id
  IS 'FK → finance.finance_payables.id — set when MR reaches COMPLETED/CLOSED';
COMMENT ON COLUMN maintenance_requests.finance_je_id
  IS 'FK → finance_journal_entries.id — DRAFT JE created on MR completion';

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_finance_payable
  ON maintenance_requests (finance_payable_id)
  WHERE finance_payable_id IS NOT NULL;
