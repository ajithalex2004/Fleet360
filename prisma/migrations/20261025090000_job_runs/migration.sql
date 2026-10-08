-- Durable job-run records and claims (architecture audit A8).
--
-- Every run of a background job (src/lib/jobs/registry.ts), however it is
-- triggered — the in-process scheduler on any web replica, a platform admin,
-- or an external cron — is claimed here first by POST /api/jobs/run
-- (src/lib/jobs/job-runs.ts):
--   * one row per (job, scope, occurrence): the scheduler's occurrence is the
--     minute it fired for, so two replicas firing the same tick produce one
--     run;
--   * a job (per scope) does not start while another run of it holds a live
--     lease, so a run longer than its interval does not overlap itself;
--   * an expired lease (a crashed worker) is closed as FAILED and the job can
--     run again.
-- The row then records the outcome. Platform table: no tenant data, no RLS;
-- `scope` is the tenant a job was run for, or '*'.

CREATE TABLE IF NOT EXISTS public.job_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name         TEXT        NOT NULL,
  scope            TEXT        NOT NULL DEFAULT '*',
  occurrence       TEXT        NOT NULL,
  trigger          TEXT        NOT NULL,
  owner            TEXT        NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ NULL,
  duration_ms      INTEGER     NULL,
  summary          TEXT        NULL,
  error            TEXT        NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_runs_occurrence
  ON public.job_runs (job_name, scope, occurrence);
CREATE INDEX IF NOT EXISTS idx_job_runs_running
  ON public.job_runs (job_name, scope) WHERE status = 'RUNNING';
CREATE INDEX IF NOT EXISTS idx_job_runs_started
  ON public.job_runs (started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_runs TO fleet360_app;
