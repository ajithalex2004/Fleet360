-- Open anomaly-flag dedup becomes per tenant (step 2 of 2).
--
-- Step 1 (20261031090000_anomaly_flags_tenant_dedup) added
-- idx_anomaly_flags_open_dedup_tenant (tenant_id, entity_id, detector_id)
-- WHERE status = 'OPEN' and kept the old (entity_id, detector_id) index, so
-- the writers deployed at the time kept working. Those writers
-- (finance-anomaly persistFlags, cross-doc-intelligence) now use the
-- per-tenant index as their ON CONFLICT target (live since PR #239), and
-- nothing targets the old index.
--
-- While it exists, two tenants still can't both hold an open flag on the
-- same entity_id / detector: the second tenant's insert hits the old unique
-- index, which its ON CONFLICT doesn't cover, and fails. Dropping it ends
-- that. The per-tenant index stays and still allows only one open flag per
-- tenant, entity and detector.

DROP INDEX IF EXISTS ai.idx_anomaly_flags_open_dedup;
