-- One PENDING approval per (tenant, agent, action, entity).
--
-- agent_approvals had no unique index, so the agents' "ON CONFLICT DO
-- NOTHING" never fired, and batch agents running every few minutes queued
-- the same proposal again on every run. All writers now go through
-- PolicyService.createApprovalItem, which upserts against this index (a
-- later run refreshes the pending item instead of adding a duplicate).
--
-- Existing duplicates are not deleted: all but the newest PENDING row of
-- each group are marked EXPIRED with a note, so the index can be built and
-- the history stays.

-- agent_approvals / tenant_ai_policies have FORCE ROW LEVEL SECURITY, which
-- binds the migration owner too: without the platform context the UPDATE
-- below would see no rows.
SELECT set_config('app.tenant_id', '*', false);

UPDATE agent_approvals AS a
   SET status = 'EXPIRED',
       review_notes = concat_ws(' | ', a.review_notes, 'Superseded duplicate (dedup migration)')
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY tenant_id, agent_id, action_type, entity_id
             ORDER BY created_at DESC, id DESC
           ) AS rn
      FROM agent_approvals
     WHERE status = 'PENDING'
  ) AS d
 WHERE a.id = d.id
   AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_approvals_pending_dedup
  ON agent_approvals (tenant_id, agent_id, action_type, entity_id)
  WHERE status = 'PENDING';

SELECT set_config('app.tenant_id', '', false);
