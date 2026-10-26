-- Open anomaly-flag dedup becomes per tenant (step 1 of 2).
--
-- idx_anomaly_flags_open_dedup is UNIQUE (entity_id, detector_id) WHERE
-- status = 'OPEN', with no tenant_id. Two tenants that share an entity_id
-- (synthetic ids, matching invoice numbers) collide on it: the second
-- tenant's ON CONFLICT ... DO UPDATE targets the first tenant's open flag.
-- RLS turns that into an error rather than an overwrite, which the writers
-- catch and log, so the second tenant's flag is silently never stored.
--
-- This step only adds the per-tenant index. It can't hold duplicates the old
-- one doesn't, so it builds cleanly, and with both indexes present both the
-- old writers (ON CONFLICT (entity_id, detector_id)) and the new ones
-- (ON CONFLICT (tenant_id, entity_id, detector_id)) keep working — this can
-- be applied before the code that uses it is deployed.
--
-- Step 2, once that code is live everywhere: a later migration runs
--   DROP INDEX IF EXISTS ai.idx_anomaly_flags_open_dedup;
-- which is what actually lets two tenants hold open flags on the same entity.

CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_flags_open_dedup_tenant
  ON ai.agent_anomaly_flags (tenant_id, entity_id, detector_id)
  WHERE status = 'OPEN';
