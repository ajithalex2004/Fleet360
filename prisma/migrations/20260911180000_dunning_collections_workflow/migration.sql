-- Dunning & Collections — safe automated dispatch workflow.
--
-- Additive. Fixes (at the data layer): dunning previously computed
-- outstanding amounts independently of the canonical invoice-balance
-- logic, had no suppression mechanism, no persisted collection-stage
-- state, and a workaround (removed here) that fabricated a synthetic
-- LeaseContract2 row when no real contract could be resolved.
--
-- Production dispatch stays disabled (DUNNING_DISPATCH_ENABLED unset)
-- until the release sequence in the design plan passes — this migration
-- only lays down the schema.

-- ============================================================
-- lease_invoices — dunning collection state
-- ============================================================

ALTER TABLE "lease_invoices" ADD COLUMN IF NOT EXISTS "current_dunning_stage" TEXT;
ALTER TABLE "lease_invoices" ADD COLUMN IF NOT EXISTS "dunning_stage_updated_at" TIMESTAMPTZ(6);
ALTER TABLE "lease_invoices" ADD COLUMN IF NOT EXISTS "dunning_collection_cycle" INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_lease_invoices_tenant_id_id' AND conrelid = 'lease_invoices'::regclass
  ) THEN
    ALTER TABLE "lease_invoices" ADD CONSTRAINT "uq_lease_invoices_tenant_id_id" UNIQUE ("tenant_id", "id");
  END IF;
END $$;

-- ============================================================
-- lessees / lease_contracts_v2 — composite-FK targets
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_lessees_tenant_id' AND conrelid = 'lessees'::regclass
  ) THEN
    ALTER TABLE "lessees" ADD CONSTRAINT "uq_lessees_tenant_id" UNIQUE ("tenant_id", "id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_lease_contracts_v2_tenant_id_id' AND conrelid = 'lease_contracts_v2'::regclass
  ) THEN
    ALTER TABLE "lease_contracts_v2" ADD CONSTRAINT "uq_lease_contracts_v2_tenant_id_id" UNIQUE ("tenant_id", "id");
  END IF;
END $$;

-- ============================================================
-- lease_dunning_activities — contract_id becomes nullable
-- (removes the need for the synthetic-contract-creation workaround)
-- ============================================================

ALTER TABLE "lease_dunning_activities" ALTER COLUMN "contract_id" DROP NOT NULL;

-- ============================================================
-- lease_dunning_notices
-- ============================================================

CREATE TABLE IF NOT EXISTS "lease_dunning_notices" (
  "id"                          TEXT NOT NULL,
  "created_at"                  TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                  TIMESTAMPTZ(6),
  "tenant_id"                   TEXT NOT NULL,
  "invoice_id"                  TEXT NOT NULL,
  "contract_id"                 TEXT,
  "lessee_id"                   TEXT NOT NULL,
  "collection_cycle"            INTEGER NOT NULL DEFAULT 1,
  "collection_stage"            TEXT NOT NULL,
  "occurrence_seq"              INTEGER NOT NULL DEFAULT 1,
  "policy_version"              TEXT NOT NULL DEFAULT 'v1',
  "outstanding_amount_at_queue" DECIMAL NOT NULL,
  "currency"                    TEXT NOT NULL DEFAULT 'AED',
  "queued_at"                   TIMESTAMPTZ(6) NOT NULL,
  "dispatch_status"             TEXT NOT NULL DEFAULT 'PENDING',
  "current_attempt_token"       TEXT,
  "send_attempt_count"          INTEGER NOT NULL DEFAULT 0,
  "max_send_attempts"           INTEGER NOT NULL DEFAULT 3,
  "next_attempt_at"             TIMESTAMPTZ(6),
  "suppressed_reason"           TEXT,
  "approved_by"                 TEXT,
  "approved_at"                 TIMESTAMPTZ(6),

  CONSTRAINT "lease_dunning_notices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_lease_dunning_notices_key" UNIQUE ("tenant_id", "invoice_id", "collection_cycle", "collection_stage", "occurrence_seq"),
  CONSTRAINT "uq_lease_dunning_notices_tenant_id_id" UNIQUE ("tenant_id", "id")
);

CREATE INDEX IF NOT EXISTS "idx_lease_dunning_notices_tenant_id" ON "lease_dunning_notices"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lease_dunning_notices_invoice_id" ON "lease_dunning_notices"("invoice_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_notices_invoice' AND conrelid = 'lease_dunning_notices'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_notices" ADD CONSTRAINT "fk_lease_dunning_notices_invoice"
      FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "lease_invoices"("tenant_id", "id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_notices_lessee' AND conrelid = 'lease_dunning_notices'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_notices" ADD CONSTRAINT "fk_lease_dunning_notices_lessee"
      FOREIGN KEY ("tenant_id", "lessee_id") REFERENCES "lessees"("tenant_id", "id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_notices_contract' AND conrelid = 'lease_dunning_notices'::regclass
  ) THEN
    -- MATCH SIMPLE (default): a NULL contract_id is not checked, matching
    -- "no real contract resolved" staying null rather than fabricated.
    ALTER TABLE "lease_dunning_notices" ADD CONSTRAINT "fk_lease_dunning_notices_contract"
      FOREIGN KEY ("tenant_id", "contract_id") REFERENCES "lease_contracts_v2"("tenant_id", "id") ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE "lease_dunning_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_dunning_notices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_dunning_notices";
CREATE POLICY tenant_isolation ON "lease_dunning_notices"
USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- ============================================================
-- lease_dunning_dispatch_attempts
-- ============================================================

CREATE TABLE IF NOT EXISTS "lease_dunning_dispatch_attempts" (
  "id"                    TEXT NOT NULL,
  "created_at"            TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ(6),
  "tenant_id"             TEXT NOT NULL,
  "notice_id"             TEXT NOT NULL,
  "attempt_token"         TEXT NOT NULL,
  "attempt_seq"           INTEGER NOT NULL,
  "reserved_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enqueued_at"           TIMESTAMPTZ(6),
  "prepared_amount"       DECIMAL,
  "prepared_currency"     TEXT,
  "prepared_recipients"   JSONB,
  "claimed_at"            TIMESTAMPTZ(6),
  "outcome"               TEXT NOT NULL DEFAULT 'PENDING',
  "outcome_at"            TIMESTAMPTZ(6),
  "error_class"           TEXT,
  "error_message"         TEXT,
  "provider_response_ref" TEXT,
  "resolved_by"           TEXT,
  "resolved_at"           TIMESTAMPTZ(6),
  "resolution"            TEXT,

  CONSTRAINT "lease_dunning_dispatch_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_lease_dunning_dispatch_attempts_token" UNIQUE ("tenant_id", "attempt_token")
);

CREATE INDEX IF NOT EXISTS "idx_lease_dunning_dispatch_attempts_tenant_id" ON "lease_dunning_dispatch_attempts"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lease_dunning_dispatch_attempts_notice_id" ON "lease_dunning_dispatch_attempts"("notice_id");
-- Supports the enqueue-when-due sweep's selection (enqueued_at IS NULL, outcome='PENDING').
CREATE INDEX IF NOT EXISTS "idx_lease_dunning_dispatch_attempts_unenqueued" ON "lease_dunning_dispatch_attempts"("notice_id") WHERE "enqueued_at" IS NULL AND "outcome" = 'PENDING';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_dispatch_attempts_notice' AND conrelid = 'lease_dunning_dispatch_attempts'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_dispatch_attempts" ADD CONSTRAINT "fk_lease_dunning_dispatch_attempts_notice"
      FOREIGN KEY ("tenant_id", "notice_id") REFERENCES "lease_dunning_notices"("tenant_id", "id") ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE "lease_dunning_dispatch_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_dunning_dispatch_attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_dunning_dispatch_attempts";
CREATE POLICY tenant_isolation ON "lease_dunning_dispatch_attempts"
USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- ============================================================
-- lease_dunning_stage_transitions — append-only
-- ============================================================

CREATE TABLE IF NOT EXISTS "lease_dunning_stage_transitions" (
  "id"               TEXT NOT NULL,
  "created_at"       TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "tenant_id"        TEXT NOT NULL,
  "invoice_id"       TEXT NOT NULL,
  "collection_cycle" INTEGER NOT NULL,
  "previous_stage"   TEXT,
  "new_stage"        TEXT NOT NULL,
  "reason"           TEXT,
  "policy_version"   TEXT NOT NULL DEFAULT 'v1',
  "transitioned_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "transitioned_by"  TEXT,

  CONSTRAINT "lease_dunning_stage_transitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_lease_dunning_stage_transitions_tenant_id" ON "lease_dunning_stage_transitions"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lease_dunning_stage_transitions_invoice_id" ON "lease_dunning_stage_transitions"("invoice_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_stage_transitions_invoice' AND conrelid = 'lease_dunning_stage_transitions'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_stage_transitions" ADD CONSTRAINT "fk_lease_dunning_stage_transitions_invoice"
      FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "lease_invoices"("tenant_id", "id") ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE "lease_dunning_stage_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_dunning_stage_transitions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_dunning_stage_transitions";
CREATE POLICY tenant_isolation ON "lease_dunning_stage_transitions"
USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- Enforced append-only at the database level: the runtime role can SELECT
-- and INSERT but not UPDATE or DELETE. A compromised or buggy code path
-- cannot rewrite dunning history, independent of any application check.
-- Applied best-effort — some environments' migration role may not have
-- grant privileges on the runtime role; failure here does not block the
-- rest of this migration.
DO $$ BEGIN
  REVOKE UPDATE, DELETE ON "lease_dunning_stage_transitions" FROM "fleet360_app";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not REVOKE UPDATE/DELETE on lease_dunning_stage_transitions for fleet360_app — role may not exist in this environment yet, or the migration role lacks GRANT privileges. Apply manually once the role exists.';
END $$;

-- ============================================================
-- lease_dunning_suppressions
-- ============================================================

CREATE TABLE IF NOT EXISTS "lease_dunning_suppressions" (
  "id"         TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "tenant_id"  TEXT NOT NULL,
  "scope"      TEXT NOT NULL,
  "lessee_id"  TEXT,
  "invoice_id" TEXT,
  "contract_id" TEXT,
  "reason"     TEXT,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMPTZ(6),
  "created_by" TEXT,
  "lifted_by"  TEXT,
  "lifted_at"  TIMESTAMPTZ(6),

  CONSTRAINT "lease_dunning_suppressions_pkey" PRIMARY KEY ("id"),
  -- Scope/target consistency, enforced at the DB level, not just by
  -- application convention.
  CONSTRAINT "chk_lease_dunning_suppressions_scope_target" CHECK (
    (scope = 'CUSTOMER'  AND lessee_id IS NOT NULL AND invoice_id IS NULL AND contract_id IS NULL) OR
    (scope = 'INVOICE'   AND invoice_id IS NOT NULL) OR
    (scope = 'CONTRACT'  AND contract_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "idx_lease_dunning_suppressions_tenant_id" ON "lease_dunning_suppressions"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lease_dunning_suppressions_invoice_id" ON "lease_dunning_suppressions"("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_lease_dunning_suppressions_lessee_id" ON "lease_dunning_suppressions"("lessee_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_suppressions_lessee' AND conrelid = 'lease_dunning_suppressions'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_suppressions" ADD CONSTRAINT "fk_lease_dunning_suppressions_lessee"
      FOREIGN KEY ("tenant_id", "lessee_id") REFERENCES "lessees"("tenant_id", "id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_suppressions_invoice' AND conrelid = 'lease_dunning_suppressions'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_suppressions" ADD CONSTRAINT "fk_lease_dunning_suppressions_invoice"
      FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "lease_invoices"("tenant_id", "id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_suppressions_contract' AND conrelid = 'lease_dunning_suppressions'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_suppressions" ADD CONSTRAINT "fk_lease_dunning_suppressions_contract"
      FOREIGN KEY ("tenant_id", "contract_id") REFERENCES "lease_contracts_v2"("tenant_id", "id") ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE "lease_dunning_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_dunning_suppressions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_dunning_suppressions";
CREATE POLICY tenant_isolation ON "lease_dunning_suppressions"
USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- ============================================================
-- lease_dunning_legal_approvals
-- ============================================================

CREATE TABLE IF NOT EXISTS "lease_dunning_legal_approvals" (
  "id"               TEXT NOT NULL,
  "created_at"       TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "tenant_id"        TEXT NOT NULL,
  "invoice_id"       TEXT NOT NULL,
  "collection_cycle" INTEGER NOT NULL,
  "requested_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by"      TEXT,
  "approved_at"      TIMESTAMPTZ(6),
  "notes"            TEXT,

  CONSTRAINT "lease_dunning_legal_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_lease_dunning_legal_approvals_key" UNIQUE ("tenant_id", "invoice_id", "collection_cycle")
);

CREATE INDEX IF NOT EXISTS "idx_lease_dunning_legal_approvals_tenant_id" ON "lease_dunning_legal_approvals"("tenant_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_legal_approvals_invoice' AND conrelid = 'lease_dunning_legal_approvals'::regclass
  ) THEN
    ALTER TABLE "lease_dunning_legal_approvals" ADD CONSTRAINT "fk_lease_dunning_legal_approvals_invoice"
      FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "lease_invoices"("tenant_id", "id") ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE "lease_dunning_legal_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_dunning_legal_approvals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_dunning_legal_approvals";
CREATE POLICY tenant_isolation ON "lease_dunning_legal_approvals"
USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));
