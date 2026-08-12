-- =====================================================================
-- Migration: Introduce logical domain schemas (finance, ai)
-- =====================================================================
--
-- Purpose: Enforce domain ownership at the database level by moving
-- every table that belongs to a domain into its own PostgreSQL schema.
--
-- Phase 1 covers the two most bounded domains:
--   finance schema — all finance_* tables
--   ai schema      — agent_anomaly_flags
--
-- Backward compatibility: ALTER ROLE ... SET search_path ensures all
-- existing unqualified SQL (SELECT * FROM finance_invoices) continues
-- to resolve correctly via search_path lookup. Raw SQL in the codebase
-- can be schema-qualified incrementally; no big-bang refactor required.
--
-- Prisma: schema.prisma is updated in the same commit to add
-- previewFeatures = ["multiSchema"] and @@schema("finance") on every
-- finance model. Prisma-generated SQL is then fully schema-qualified
-- (SELECT ... FROM "finance"."finance_invoices") and does not depend on
-- search_path.
--
-- DB Roles (created here, activated in .env by the operator):
--   fleet360_api_role — full access to public + finance + ai
--   fleet360_ai_role  — SELECT on public, full access to ai,
--                       NO access to finance (enforced by REVOKE)
--
-- Run: prisma migrate deploy
-- =====================================================================

-- ── 1. Create logical schemas ─────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS ai;

-- ── 2. Move finance_* tables to finance schema ────────────────────────────────
--
-- Order respects FK constraints (parent before child):
--   finance_journal_entries  → finance_journal_lines
--   finance_reminder_schedules → finance_reminder_log
--   finance_bank_accounts    → finance_bank_statements
--   finance_bank_statements  → finance_bank_statement_lines
--   finance_invoices         → finance_payments
--
-- All indexes, RLS policies, and sequences travel with the table.
-- Cross-schema FK: finance_invoices.branch_id → public.tenant_branches(id)
-- is automatically updated to reference the fully-qualified path.

-- Independent tables (no intra-finance FK deps)
-- Each wrapped in IF EXISTS so the migration is safe in environments
-- where some finance_* tables haven't been created yet (the dev DB
-- has a hand-mutated public schema; not every finance_* table exists
-- in public before this migration runs).
ALTER TABLE IF EXISTS public.finance_budgets           SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_pdc_cheques       SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_expenses          SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_tax_categories    SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_vat_audit_logs    SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_credit_notes      SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_collection_cases  SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_bank_accounts     SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_chart_of_accounts SET SCHEMA finance;

-- Parent before child: bank statement tree
ALTER TABLE IF EXISTS public.finance_bank_statements      SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_bank_statement_lines SET SCHEMA finance;

-- Parent before child: journal tree
ALTER TABLE IF EXISTS public.finance_journal_entries SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_journal_lines   SET SCHEMA finance;

-- Parent before child: reminder tree
ALTER TABLE IF EXISTS public.finance_reminder_schedules SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_reminder_log       SET SCHEMA finance;

-- Parent before child: invoice/payment tree
ALTER TABLE IF EXISTS public.finance_invoices  SET SCHEMA finance;
ALTER TABLE IF EXISTS public.finance_payments  SET SCHEMA finance;

-- ── 3. Move AI domain tables to ai schema ─────────────────────────────────────

ALTER TABLE public.agent_anomaly_flags SET SCHEMA ai;

-- ── 4. Backward-compatible search_path ───────────────────────────────────────
--
-- Set the default search_path for the current database role so that all
-- existing unqualified queries (SELECT * FROM finance_invoices) continue
-- to resolve via search_path lookup without any code changes.
--
-- This uses ALTER ROLE CURRENT_USER which does not require superuser —
-- each Postgres role may alter its own settings. In Neon the migration
-- typically runs as neondb_owner, so this sets the path for that role.
--
-- The AI backend should connect as fleet360_ai_role (created below),
-- whose search_path deliberately excludes finance.

ALTER ROLE CURRENT_USER SET search_path = "$user", public, finance, ai;

-- ── 5. Create domain DB roles ─────────────────────────────────────────────────
--
-- fleet360_api_role  — Next.js API backend, operational writes everywhere
-- fleet360_ai_role   — Go/Gin AI backend, read-only on public, write on ai,
--                      explicitly barred from finance.*
--
-- After running this migration:
--   1. Create login users in Neon (or managed Postgres):
--        CREATE USER fleet360_api LOGIN PASSWORD '...';
--        CREATE USER fleet360_ai  LOGIN PASSWORD '...';
--        GRANT fleet360_api_role TO fleet360_api;
--        GRANT fleet360_ai_role  TO fleet360_ai;
--   2. Update API_DATABASE_URL  → fleet360_api credentials
--      Update AI_DATABASE_URL   → fleet360_ai credentials
--      (or use Neon's branch-level DB roles)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    CREATE ROLE fleet360_api_role NOLOGIN;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_ai_role') THEN
    CREATE ROLE fleet360_ai_role NOLOGIN;
  END IF;
END $$;

-- ── 6. Grant schema USAGE ─────────────────────────────────────────────────────

-- API role: access all three schemas
GRANT USAGE ON SCHEMA public  TO fleet360_api_role;
GRANT USAGE ON SCHEMA finance TO fleet360_api_role;
GRANT USAGE ON SCHEMA ai      TO fleet360_api_role;

-- AI role: public (read fleet/dispatch data) + ai (write outputs), NOT finance
GRANT USAGE ON SCHEMA public TO fleet360_ai_role;
GRANT USAGE ON SCHEMA ai     TO fleet360_ai_role;
-- Intentionally NO: GRANT USAGE ON SCHEMA finance TO fleet360_ai_role;

-- ── 7. Grant table-level permissions ─────────────────────────────────────────

-- API role: full DML on all schemas
GRANT ALL ON ALL TABLES IN SCHEMA public  TO fleet360_api_role;
GRANT ALL ON ALL TABLES IN SCHEMA finance TO fleet360_api_role;
GRANT ALL ON ALL TABLES IN SCHEMA ai      TO fleet360_api_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public  TO fleet360_api_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA finance TO fleet360_api_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ai      TO fleet360_api_role;

-- Future tables in finance and ai inherit these grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT ALL ON TABLES    TO fleet360_api_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT ALL ON SEQUENCES TO fleet360_api_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai      GRANT ALL ON TABLES    TO fleet360_api_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai      GRANT ALL ON SEQUENCES TO fleet360_api_role;

-- AI role: SELECT on public (fleet/dispatch/route data), full DML on ai only
GRANT SELECT ON ALL TABLES    IN SCHEMA public TO fleet360_ai_role;
GRANT USAGE  ON ALL SEQUENCES IN SCHEMA public TO fleet360_ai_role;
GRANT ALL ON ALL TABLES    IN SCHEMA ai TO fleet360_ai_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ai TO fleet360_ai_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON TABLES    TO fleet360_ai_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON SEQUENCES TO fleet360_ai_role;

-- Set the AI role's search_path: public + ai only — finance is invisible
ALTER ROLE fleet360_ai_role SET search_path = "$user", public, ai;

-- ── 8. Enforce: AI role explicitly CANNOT write finance tables ─────────────────
--
-- Belt-and-suspenders: even if someone grants USAGE on finance to the AI
-- role later, the REVOKE below removes DML. Must be re-run if new grants
-- are added. The authoritative rule is: fleet360_ai_role has no access
-- to the finance schema whatsoever.
--
-- This is a no-op today (role has no finance grants yet) but documents
-- intent and is idempotent.
REVOKE ALL ON SCHEMA finance FROM fleet360_ai_role;
