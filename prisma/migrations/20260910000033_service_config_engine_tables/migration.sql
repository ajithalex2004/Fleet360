-- Move runtime DDL out of src/lib/service-config/{schema,rules-schema,scopes-schema}.ts.
--
-- DDL-only, no RLS: every query across all three files uses the bare
-- prisma client, never a tenant-scoped transaction (same architecture as
-- workflow-db.ts). Enabling RLS on any of these 5 tables would make the
-- whole service-config engine (categories/types catalogue, scope tree,
-- versioned rules) return zero rows. Unlike workflow-db.ts's admin
-- routes, the one route checked here (types/[id]/rules/[category])
-- already validates tenant ownership at the app layer via ownsType()
-- and getScope() before touching rules/scopes data, so there's no
-- equivalent confirmed cross-tenant read to fix alongside this move.
--
-- service_rules' migration is transcribed verbatim from its multi-phase
-- 2B -> 2D -> 2E history in rules-schema.ts, with one correctness fix:
-- the original's `ADD PRIMARY KEY (id)` relied on a JS try/catch to
-- swallow the "multiple primary keys" error on a table that already has
-- one from a prior run. A migration can't rely on that — an error here
-- would roll back the whole migration transaction — so it's replaced
-- with an explicit existence check via pg_constraint.

-- ── service_categories / service_types / service_module_mapping ────────────

CREATE TABLE IF NOT EXISTS service_categories (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT         NOT NULL,
  key          TEXT         NOT NULL,
  name         TEXT         NOT NULL,
  description  TEXT,
  icon         TEXT,
  tone         TEXT         NOT NULL DEFAULT 'violet',
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  is_system    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_service_categories_tenant
  ON service_categories (tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS service_types (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT         NOT NULL,
  category_id       UUID         NOT NULL,
  key               TEXT         NOT NULL,
  name              TEXT         NOT NULL,
  description       TEXT,
  icon              TEXT,
  tone              TEXT         NOT NULL DEFAULT 'violet',
  default_priority  TEXT         NOT NULL DEFAULT 'Medium',
  sort_order        INTEGER      NOT NULL DEFAULT 0,
  is_system         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_service_types_tenant_category
  ON service_types (tenant_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_types_tenant
  ON service_types (tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS service_module_mapping (
  service_type_id              UUID         PRIMARY KEY,
  linked_module                TEXT         NOT NULL,
  sub_module                   TEXT,
  workflow_engine_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
  notification_engine_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  approval_engine_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
  finance_engine_enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  dispatch_engine_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── service_scopes (Phase 2E scope tree) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_scopes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT         NOT NULL,
  parent_scope_id UUID,
  level           TEXT         NOT NULL DEFAULT 'COMPANY',
  key             TEXT         NOT NULL,
  name            TEXT         NOT NULL,
  description     TEXT,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  is_root         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_service_scopes_tenant
  ON service_scopes (tenant_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_scopes_root
  ON service_scopes (tenant_id) WHERE is_root = TRUE AND deleted_at IS NULL;

-- ── service_rules (Phase 2B -> 2D -> 2E) ─────────────────────────────────────

-- 2B base schema.
CREATE TABLE IF NOT EXISTS service_rules (
  service_type_id  UUID         NOT NULL,
  category         TEXT         NOT NULL,
  rules            JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by       TEXT
);

-- 2D — versioning columns.
ALTER TABLE service_rules ADD COLUMN IF NOT EXISTS id UUID;
ALTER TABLE service_rules ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ;
ALTER TABLE service_rules ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ;

UPDATE service_rules SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE service_rules SET effective_from = updated_at WHERE effective_from IS NULL;

ALTER TABLE service_rules ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE service_rules ALTER COLUMN id SET NOT NULL;
ALTER TABLE service_rules ALTER COLUMN effective_from SET DEFAULT NOW();
ALTER TABLE service_rules ALTER COLUMN effective_from SET NOT NULL;

ALTER TABLE service_rules DROP CONSTRAINT IF EXISTS service_rules_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'service_rules'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE service_rules ADD PRIMARY KEY (id);
  END IF;
END $$;

-- 2E — scope_id column. NULL means "tenant root scope"; backfilled per
-- tenant by service-config/schema.ts ensureSeededForTenant. The unique
-- index treats NULL scope_id as a sentinel UUID so a tenant can only
-- have one active row per (type, category) at the implicit root.
ALTER TABLE service_rules ADD COLUMN IF NOT EXISTS scope_id UUID;

-- Replace the older 2D index (no scope) with the scope-aware one.
DROP INDEX IF EXISTS uq_service_rules_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_rules_active_scoped
  ON service_rules (
    service_type_id, category,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_rules_history
  ON service_rules (service_type_id, category, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_service_rules_scope
  ON service_rules (scope_id) WHERE effective_to IS NULL;
