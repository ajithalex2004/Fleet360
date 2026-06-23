CREATE TABLE IF NOT EXISTS logistics_master_data (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_order INT NOT NULL DEFAULT 0,
  metadata JSONB,
  created_by TEXT,
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS logistics_master_data_code_key
  ON logistics_master_data (tenant_id, type, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_logistics_master_data_type_status
  ON logistics_master_data (tenant_id, type, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS logistics_shift_handovers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shift_date DATE NOT NULL,
  shift_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  outgoing_user_id TEXT,
  incoming_user_id TEXT,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by TEXT,
  accepted_by TEXT,
  accepted_at TIMESTAMPTZ,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_logistics_shift_handovers_scope
  ON logistics_shift_handovers (tenant_id, shift_date DESC, shift_code);

CREATE TABLE IF NOT EXISTS logistics_change_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  before_json JSONB,
  after_json JSONB,
  summary TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_logistics_change_history_scope
  ON logistics_change_history (tenant_id, entity_type, entity_id, created_at DESC);
