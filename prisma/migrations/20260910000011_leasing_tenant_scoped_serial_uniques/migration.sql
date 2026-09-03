-- G13 (.audit-reports/LEASING-FUNCTIONALITY-GAP-DOCUMENT.md): leasing serial
-- numbers (invoice, quotation, contract, renewal, inquiry, termination,
-- insurance policy/claim, pre-billing statement, traffic fine, direct-debit
-- mandate) were generated per-tenant (`count(where: {tenantId}) + 1`) but
-- enforced by a GLOBAL unique index/constraint. With 164 real tenants in
-- production, tenant B's first invoice computing "INV-000001" collides with
-- tenant A's -- not a rare race, a guaranteed collision the moment a second
-- tenant creates its first row of any of these types.
--
-- Three of these (lease_quotations, lease_contracts_v2, lease_invoices) were
-- *supposed* to already be fixed by 20260815140000_tenant_001_leasing_rental_isolation,
-- which added the correct composite (tenant_id, number) unique index for all
-- three -- but its `DROP CONSTRAINT IF EXISTS <name>` calls targeted the old
-- global uniques by name, and all three were originally created via
-- `CREATE UNIQUE INDEX` (not `ADD CONSTRAINT UNIQUE`), so they were never
-- registered as table constraints. DROP CONSTRAINT silently no-op'd on all
-- three (IF EXISTS suppressed the error), leaving the old global unique
-- INDEX fully active alongside the new composite one. Confirmed via direct
-- production introspection (pg_indexes / information_schema.table_constraints)
-- before writing this file -- the three "fixed" tables still had both.
--
-- This migration:
--   1. Drops the seven old global unique indexes that were never touched.
--   2. Creates the seven correct (tenant_id, number) partial unique indexes.
--   3. Drops the three old global unique indexes left behind by the
--      earlier migration's constraint/index name mismatch (their composite
--      replacements already exist and are left alone).
--
-- Safe to run against live data: every DROP INDEX only relaxes a constraint
-- (existing rows already satisfy the weaker composite constraint, since they
-- already satisfied the stricter global one), and every CREATE UNIQUE INDEX
-- is IF NOT EXISTS / trivially satisfied by data that was already globally
-- unique. No column, no NOT NULL, no FK touched here.
--
-- G14 (same document): LeaseContract2 -> Lessee / LeaseBranch FK constraints
-- are also confirmed already present in production (fk_lease_contracts_v2_tenant,
-- fk_lease_contracts_v2_opening_branch, fk_lease_contracts_v2_closing_branch) --
-- schema.prisma's "Layer 2.7 ... a follow-up migration adds the FK constraint"
-- comments were stale documentation, not a real gap. No migration needed for G14.

-- ── 1 & 2: seven tables that never got a tenant-scoped uniqueness fix ──────

ALTER TABLE lease_inquiries DROP CONSTRAINT IF EXISTS lease_inquiries_inquiry_number_key;
DROP INDEX IF EXISTS lease_inquiries_inquiry_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_inquiries_tenant_number
  ON lease_inquiries(tenant_id, inquiry_number)
  WHERE inquiry_number IS NOT NULL;

ALTER TABLE lease_insurance_policies DROP CONSTRAINT IF EXISTS lease_insurance_policies_policy_no_key;
DROP INDEX IF EXISTS lease_insurance_policies_policy_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_insurance_policies_tenant_policy_no
  ON lease_insurance_policies(tenant_id, policy_no)
  WHERE policy_no IS NOT NULL;

ALTER TABLE lease_insurance_claims DROP CONSTRAINT IF EXISTS lease_insurance_claims_claim_no_key;
DROP INDEX IF EXISTS lease_insurance_claims_claim_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_insurance_claims_tenant_claim_no
  ON lease_insurance_claims(tenant_id, claim_no)
  WHERE claim_no IS NOT NULL;

ALTER TABLE lease_traffic_fines DROP CONSTRAINT IF EXISTS lease_traffic_fines_fine_no_key;
DROP INDEX IF EXISTS lease_traffic_fines_fine_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_traffic_fines_tenant_fine_no
  ON lease_traffic_fines(tenant_id, fine_no)
  WHERE fine_no IS NOT NULL;

ALTER TABLE lease_early_terminations DROP CONSTRAINT IF EXISTS lease_early_terminations_termination_no_key;
DROP INDEX IF EXISTS lease_early_terminations_termination_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_early_terminations_tenant_termination_no
  ON lease_early_terminations(tenant_id, termination_no)
  WHERE termination_no IS NOT NULL;

ALTER TABLE lease_renewals DROP CONSTRAINT IF EXISTS lease_renewals_renewal_no_key;
DROP INDEX IF EXISTS lease_renewals_renewal_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_renewals_tenant_renewal_no
  ON lease_renewals(tenant_id, renewal_no)
  WHERE renewal_no IS NOT NULL;

ALTER TABLE lease_pre_billing_statements DROP CONSTRAINT IF EXISTS lease_pre_billing_statements_statement_no_key;
DROP INDEX IF EXISTS lease_pre_billing_statements_statement_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_pre_billing_statements_tenant_statement_no
  ON lease_pre_billing_statements(tenant_id, statement_no)
  WHERE statement_no IS NOT NULL;

ALTER TABLE lease_direct_debits DROP CONSTRAINT IF EXISTS lease_direct_debits_mandate_ref_key;
DROP INDEX IF EXISTS lease_direct_debits_mandate_ref_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_direct_debits_tenant_mandate_ref
  ON lease_direct_debits(tenant_id, mandate_ref)
  WHERE mandate_ref IS NOT NULL;

-- ── 3: three tables where the composite index already exists, but the old ──
-- ── global index was left behind because the prior migration's DROP       ──
-- ── CONSTRAINT call didn't match (these were plain indexes, not           ──
-- ── constraints) ────────────────────────────────────────────────────────

DROP INDEX IF EXISTS lease_quotations_quotation_number_key;
DROP INDEX IF EXISTS lease_contracts_v2_contract_number_key;
DROP INDEX IF EXISTS lease_invoices_invoice_no_key;
