-- agent_roi_metrics: count accepted runs, so the acceptance rate can be kept.
--
-- updateDailyRoiMetrics wrote acceptance_rate_pct once, on the day's first
-- run (100 or 0), and its ON CONFLICT update never touched it again. It also
-- counted every COMPLETED run as accepted. The rate is now
-- accepted_executions / total_executions, and only explicit human feedback
-- (ACCEPTED, AUTO_EXECUTED) counts as accepted.
--
-- Backfill recounts accepted runs from agent_runs.human_feedback per
-- tenant / agent / day and recomputes the rate.

-- agent_runs / agent_roi_metrics have FORCE ROW LEVEL SECURITY, which binds
-- the migration owner too: without the platform context nothing is visible.
SELECT set_config('app.tenant_id', '*', false);

ALTER TABLE agent_roi_metrics
  ADD COLUMN IF NOT EXISTS accepted_executions INT NOT NULL DEFAULT 0;

UPDATE agent_roi_metrics AS m
   SET accepted_executions = LEAST(r.accepted, m.total_executions)
  FROM (
    SELECT tenant_id, agent_id, created_at::date AS period_date,
           COUNT(*) FILTER (WHERE human_feedback IN ('ACCEPTED', 'AUTO_EXECUTED'))::int AS accepted
      FROM agent_runs
     GROUP BY tenant_id, agent_id, created_at::date
  ) AS r
 WHERE r.tenant_id = m.tenant_id
   AND r.agent_id = m.agent_id
   AND r.period_date = m.period_date;

UPDATE agent_roi_metrics
   SET acceptance_rate_pct = CASE
         WHEN total_executions > 0
         THEN ROUND(100.0 * accepted_executions / total_executions, 2)
         ELSE 0
       END;

SELECT set_config('app.tenant_id', '', false);
