-- Fleet360 Exchange: compliance documents are reviewed before they count as valid.
--
-- A partner's uploaded trade licence, tax certificate or insurance used to be
-- stored as VALID straight away, so "valid" only meant "uploaded". Uploads now
-- start as PENDING and a platform administrator approves (VALID) or rejects
-- (REJECTED) them from /admin/exchange-partners.
--
-- Additive only: a new default for status and three nullable review columns.
-- Documents already stored keep their current status.

ALTER TABLE partner_compliance_docs ALTER COLUMN status SET DEFAULT 'PENDING';

ALTER TABLE partner_compliance_docs ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE partner_compliance_docs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE partner_compliance_docs ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
