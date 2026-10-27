import { prisma } from '@/lib/prisma';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { getSchedulerState } from '@/lib/jobs/scheduler';

export interface SchedulerHealth {
  status: 'active' | 'degraded' | 'disabled' | 'inactive';
  isTicking: boolean;
  started: boolean;
  disabled: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  secondsSinceLastTick: number | null;
  totalConfiguredJobs: number;
  timezone: string;
  lastDbRunAt: string | null;
  lastDbJobName: string | null;
  lastDbStatus: string | null;
  jobSchedules: Array<{ name: string; schedule: string }>;
}

export interface JobRunsHealth {
  status: 'healthy' | 'warning' | 'critical';
  total24h: number;
  succeeded24h: number;
  failed24h: number;
  runningNow: number;
  failureRatePercent: number;
  message: string;
  lastRun: {
    id?: string;
    jobName: string;
    status: string;
    startedAt: string;
    durationMs: number | null;
    trigger: string;
    summary: string | null;
    error: string | null;
  } | null;
  recentFailures: Array<{
    id: string;
    jobName: string;
    scope: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    error: string | null;
    summary: string | null;
  }>;
}

export interface OutboxHealth {
  status: 'healthy' | 'degraded' | 'critical';
  pendingCount: number;
  stuckCount: number;
  parkedCount: number;
  published24h: number;
  totalEvents: number;
  lagMs: number | null;
  oldestPendingAt: string | null;
  message: string;
  pendingByType: Array<{
    eventType: string;
    count: number;
    oldestOccurredAt: string | null;
  }>;
}

export interface BackgroundJobsAndOutboxHealth {
  scheduler: SchedulerHealth;
  jobRuns24h: JobRunsHealth;
  outbox: OutboxHealth;
}

export async function getBackgroundJobsAndOutboxHealth(): Promise<BackgroundJobsAndOutboxHealth> {
  const inProcessState = getSchedulerState();

  return runOutsideRlsScope(async () => {
    // 1. Query job_runs for last 24h stats & latest run
    const [jobStatsRow] = await prisma.$queryRawUnsafe<Array<{
      total24h: number | bigint;
      succeeded24h: number | bigint;
      failed24h: number | bigint;
      runningNow: number | bigint;
    }>>(`
      SELECT
        COUNT(*)::int AS "total24h",
        COUNT(*) FILTER (WHERE status = 'SUCCEEDED')::int AS "succeeded24h",
        COUNT(*) FILTER (WHERE status = 'FAILED')::int AS "failed24h",
        COUNT(*) FILTER (WHERE status = 'RUNNING')::int AS "runningNow"
      FROM job_runs
      WHERE started_at >= NOW() - INTERVAL '24 hours'
    `).catch(() => [{ total24h: 0, succeeded24h: 0, failed24h: 0, runningNow: 0 }]);

    const total24h = Number(jobStatsRow?.total24h ?? 0);
    const succeeded24h = Number(jobStatsRow?.succeeded24h ?? 0);
    const failed24h = Number(jobStatsRow?.failed24h ?? 0);
    const runningNow = Number(jobStatsRow?.runningNow ?? 0);
    const failureRatePercent = total24h > 0 ? Number(((failed24h / total24h) * 100).toFixed(2)) : 0;

    // Latest overall job run
    const [latestRunRow] = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobName: string;
      status: string;
      startedAt: string;
      durationMs: number | null;
      trigger: string;
      summary: string | null;
      error: string | null;
    }>>(`
      SELECT
        id::text,
        job_name AS "jobName",
        status,
        started_at::text AS "startedAt",
        duration_ms AS "durationMs",
        trigger,
        summary,
        error
      FROM job_runs
      ORDER BY started_at DESC
      LIMIT 1
    `).catch(() => []);

    // Recent failures in last 24h
    const failureRows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobName: string;
      scope: string;
      startedAt: string;
      finishedAt: string | null;
      durationMs: number | null;
      error: string | null;
      summary: string | null;
    }>>(`
      SELECT
        id::text,
        job_name AS "jobName",
        scope,
        started_at::text AS "startedAt",
        finished_at::text AS "finishedAt",
        duration_ms AS "durationMs",
        error,
        summary
      FROM job_runs
      WHERE status = 'FAILED'
        AND started_at >= NOW() - INTERVAL '24 hours'
      ORDER BY started_at DESC
      LIMIT 5
    `).catch(() => []);

    // 2. Query event_outbox queue stats & lag
    const [outboxRow] = await prisma.$queryRawUnsafe<Array<{
      totalEvents: number | bigint;
      pending: number | bigint;
      parked: number | bigint;
      stuck: number | bigint;
      published24h: number | bigint;
      lagMs: number | null;
      oldestPendingAt: string | null;
    }>>(`
      SELECT
        COUNT(*)::int AS "totalEvents",
        COUNT(*) FILTER (WHERE published_at IS NULL AND (failed_at IS NULL OR retry_count < 5))::int AS "pending",
        COUNT(*) FILTER (WHERE published_at IS NULL AND failed_at IS NOT NULL AND retry_count >= 5)::int AS "parked",
        COUNT(*) FILTER (WHERE published_at IS NULL AND ((failed_at IS NOT NULL AND retry_count >= 5) OR (claim_expires_at IS NOT NULL AND claim_expires_at < NOW() AND retry_count > 0)))::int AS "stuck",
        COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '24 hours')::int AS "published24h",
        EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at) FILTER (WHERE published_at IS NULL AND (failed_at IS NULL OR retry_count < 5)))) * 1000 AS "lagMs",
        MIN(occurred_at) FILTER (WHERE published_at IS NULL AND (failed_at IS NULL OR retry_count < 5))::text AS "oldestPendingAt"
      FROM event_outbox
    `).catch(() => [{
      totalEvents: 0,
      pending: 0,
      parked: 0,
      stuck: 0,
      published24h: 0,
      lagMs: null,
      oldestPendingAt: null,
    }]);

    const totalEvents = Number(outboxRow?.totalEvents ?? 0);
    const pendingCount = Number(outboxRow?.pending ?? 0);
    const parkedCount = Number(outboxRow?.parked ?? 0);
    const stuckCount = Number(outboxRow?.stuck ?? 0);
    const published24h = Number(outboxRow?.published24h ?? 0);
    const lagMs = outboxRow?.lagMs != null ? Math.round(Number(outboxRow.lagMs)) : null;
    const oldestPendingAt = outboxRow?.oldestPendingAt ?? null;

    // Top pending event types
    const pendingTypeRows = await prisma.$queryRawUnsafe<Array<{
      eventType: string;
      count: number | bigint;
      oldestOccurredAt: string | null;
    }>>(`
      SELECT
        event_type AS "eventType",
        COUNT(*)::int AS "count",
        MIN(occurred_at)::text AS "oldestOccurredAt"
      FROM event_outbox
      WHERE published_at IS NULL AND (failed_at IS NULL OR retry_count < 5)
      GROUP BY event_type
      ORDER BY "count" DESC
      LIMIT 5
    `).catch(() => []);

    // 3. Scheduler Status Evaluation
    // Active if in-process loop is ticking or last db run was recent (< 5 min)
    const isDbRecent = latestRunRow?.startedAt
      ? Date.now() - new Date(latestRunRow.startedAt).getTime() < 5 * 60 * 1000
      : false;

    let schedulerStatus: 'active' | 'degraded' | 'disabled' | 'inactive' = 'inactive';
    if (inProcessState.disabled) {
      schedulerStatus = 'disabled';
    } else if (inProcessState.isTicking || isDbRecent) {
      schedulerStatus = 'active';
    } else if (inProcessState.started) {
      schedulerStatus = 'degraded';
    }

    // 4. Job Runs Health Evaluation
    let jobHealthStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    let jobMessage = 'All background jobs running smoothly';
    if (failed24h > 10 || failureRatePercent >= 10) {
      jobHealthStatus = 'critical';
      jobMessage = `Elevated job failure rate: ${failed24h} failures (${failureRatePercent}%) in last 24h`;
    } else if (failed24h > 0) {
      jobHealthStatus = 'warning';
      jobMessage = `${failed24h} job failure(s) recorded in the last 24h`;
    } else if (total24h === 0) {
      jobMessage = 'No job runs recorded in the last 24h';
    }

    // 5. Outbox Health Evaluation
    let outboxStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    let outboxMessage = 'Event outbox queue drained and up to date';
    if (parkedCount > 0 || (lagMs !== null && lagMs >= 300_000)) {
      outboxStatus = 'critical';
      outboxMessage = parkedCount > 0
        ? `${parkedCount} dead-letter (parked) event(s) require operator attention`
        : `Severe outbox lag: ${Math.round(lagMs! / 1000)}s dispatch delay`;
    } else if (pendingCount > 25 || stuckCount > 0 || (lagMs !== null && lagMs >= 60_000)) {
      outboxStatus = 'degraded';
      outboxMessage = stuckCount > 0
        ? `${stuckCount} stuck or retrying event(s) awaiting worker drain`
        : `${pendingCount} events pending in queue (${Math.round((lagMs ?? 0) / 1000)}s lag)`;
    }

    return {
      scheduler: {
        status: schedulerStatus,
        isTicking: inProcessState.isTicking || isDbRecent,
        started: inProcessState.started,
        disabled: inProcessState.disabled,
        startedAt: inProcessState.startedAt,
        lastTickAt: inProcessState.lastTickAt,
        secondsSinceLastTick: inProcessState.secondsSinceLastTick,
        totalConfiguredJobs: inProcessState.jobCount,
        timezone: inProcessState.timezone,
        lastDbRunAt: latestRunRow?.startedAt ?? null,
        lastDbJobName: latestRunRow?.jobName ?? null,
        lastDbStatus: latestRunRow?.status ?? null,
        jobSchedules: inProcessState.configuredJobs,
      },
      jobRuns24h: {
        status: jobHealthStatus,
        total24h,
        succeeded24h,
        failed24h,
        runningNow,
        failureRatePercent,
        message: jobMessage,
        lastRun: latestRunRow
          ? {
              id: latestRunRow.id,
              jobName: latestRunRow.jobName,
              status: latestRunRow.status,
              startedAt: latestRunRow.startedAt,
              durationMs: latestRunRow.durationMs,
              trigger: latestRunRow.trigger,
              summary: latestRunRow.summary,
              error: latestRunRow.error,
            }
          : null,
        recentFailures: failureRows.map((r) => ({
          id: r.id,
          jobName: r.jobName,
          scope: r.scope,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          durationMs: r.durationMs,
          error: r.error,
          summary: r.summary,
        })),
      },
      outbox: {
        status: outboxStatus,
        pendingCount,
        stuckCount,
        parkedCount,
        published24h,
        totalEvents,
        lagMs,
        oldestPendingAt,
        message: outboxMessage,
        pendingByType: pendingTypeRows.map((r) => ({
          eventType: r.eventType,
          count: Number(r.count),
          oldestOccurredAt: r.oldestOccurredAt,
        })),
      },
    };
  });
}
