-- Move runtime DDL out of src/app/api/agents/ecosystem/route.ts.
-- agent_configs holds per-agent behaviour thresholds (schedule_cron,
-- threshold JSON) for the AI agent ecosystem — genuinely platform-global
-- configuration, not tenant data, so no tenant_id/RLS applies (same
-- category as platform_settings).

CREATE TABLE IF NOT EXISTS agent_configs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT        NOT NULL UNIQUE,
  thresholds  JSONB       NOT NULL DEFAULT '{}',
  schedule_cron TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
