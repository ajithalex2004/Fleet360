-- Clear AI circuit breakers that budget overruns tripped automatically.
--
-- PolicyService.checkBudgetQuota used to write circuit_breaker_triggered =
-- true when today's spend passed the daily cap, and nothing ever set it back,
-- so a single over-budget day locked a tenant out of every agent for good.
-- The check now works the daily and monthly caps out from recorded spend on
-- every run and persists nothing; circuit_breaker_triggered is only a manual
-- kill switch from here on.
--
-- Every true flag today is assumed to be one of those automatic trips: there
-- was no UI to set it, and only PUT /api/agents/policy could. A tenant over
-- its cap is still refused by the spend-based check after this reset.

-- agent_approvals / tenant_ai_policies have FORCE ROW LEVEL SECURITY, which
-- binds the migration owner too: without the platform context the UPDATE
-- below would see no rows.
SELECT set_config('app.tenant_id', '*', false);

UPDATE tenant_ai_policies
   SET circuit_breaker_triggered = FALSE,
       updated_at = NOW()
 WHERE circuit_breaker_triggered = TRUE;

SELECT set_config('app.tenant_id', '', false);
