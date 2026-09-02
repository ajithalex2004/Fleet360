/**
 * In-process cron scheduler for JOB_REGISTRY (G2 fix).
 *
 * Root cause: vercel.json's `crons` array is Vercel-only config and is
 * silently ignored on Railway, which is where this app actually deploys —
 * there is no railway.json/toml cron equivalent either. Result: every job
 * in JOB_REGISTRY only ran if a human or external system called
 * /api/jobs/run by hand.
 *
 * Railway runs this app as a single long-lived container (numReplicas: 1),
 * not a serverless function, so scheduling in-process — inside the same
 * server that already handles HTTP traffic, started once from
 * instrumentation-node.ts on boot — is the natural fix: no extra Railway
 * service, no external scheduler infra, and it reuses JOB_REGISTRY exactly
 * as /api/jobs/run does, so `?job=` manual runs and the CRON_SECRET auth
 * story stay the single source of truth for what a job does.
 *
 * Schedules below are inferred from each job's JOB_REGISTRY description —
 * the codebase never wrote down explicit cadences except dunning-sweep,
 * which vercel.json pinned to "0 2 * * *"; that's used here as the one
 * ground truth and the anchor for staggering the rest so heavier sweeps
 * don't all fire at once. Override any of them via JOB_CRON_<NAME> env
 * vars (name uppercased, hyphens to underscores) without a code change;
 * set the value to "off" to disable a specific job.
 */

import cron from 'node-cron';
import { JOB_REGISTRY, type JobContext, type JobDef } from '@/lib/jobs/registry';

const TIMEZONE = 'Asia/Dubai';

const DEFAULT_SCHEDULES: Record<string, string> = {
  // Frequent — near-real-time operational sweeps.
  'outbox-publisher':                    '* * * * *',
  'auto-close-trips':                    '*/15 * * * *',
  'alert-trip-overdue':                  '*/15 * * * *',
  'push-scheduler':                      '*/5 * * * *',
  // Daily batch sweeps — staggered through the early morning so they
  // don't all hit the DB connection cap (see SWEEP_CONCURRENCY_CAP in
  // prisma-sweep.ts) at once.
  'document-expiry-sweep':               '0 1 * * *',
  'insurance-expiry-sweep':               '15 1 * * *',
  'bookings-sweep-penalties':            '30 1 * * *',
  'dunning-sweep':                       '0 2 * * *',
  'bus-ops-generate-schedule-templates': '30 2 * * *',
  'inquiries-sweep-followups':           '0 9 * * *',
  'attendance-sweep-no-show':            '0 17 * * *',
  // Weekly / monthly.
  'mileage-sweep-stale':                 '0 4 * * 0',
  'fuel-sweep-bill':                     '0 3 1 * *',
  'traffic-fines-sweep-bill':            '30 3 1 * *',
};

function envKeyFor(jobName: string): string {
  return `JOB_CRON_${jobName.toUpperCase().replace(/-/g, '_')}`;
}

function scheduleFor(job: JobDef): string | null {
  const override = process.env[envKeyFor(job.name)];
  if (override === 'off' || override === 'disabled') return null;
  return override || DEFAULT_SCHEDULES[job.name] || null;
}

let started = false;

/** Idempotent — safe to call more than once, only the first call schedules anything. */
export function startJobScheduler(): void {
  if (started) return;
  if (process.env.DISABLE_JOB_SCHEDULER === 'true') {
    console.log('[job-scheduler] disabled via DISABLE_JOB_SCHEDULER=true');
    return;
  }
  started = true;

  let registered = 0;
  for (const job of JOB_REGISTRY) {
    const expr = scheduleFor(job);
    if (!expr) {
      console.warn(`[job-scheduler] no schedule for "${job.name}" — skipped (set ${envKeyFor(job.name)} to enable)`);
      continue;
    }
    if (!cron.validate(expr)) {
      console.error(`[job-scheduler] invalid cron expression for "${job.name}": "${expr}" — skipped`);
      continue;
    }
    cron.schedule(expr, () => void runScheduled(job), { timezone: TIMEZONE });
    registered++;
  }
  console.log(`[job-scheduler] started — ${registered}/${JOB_REGISTRY.length} jobs scheduled (tz ${TIMEZONE})`);
}

async function runScheduled(job: JobDef): Promise<void> {
  // No inbound HTTP request exists for a cron tick. Every handler in
  // JOB_REGISTRY reads only ctx.tenantId/ctx.searchParams (verified via
  // grep across src/lib/jobs) — ctx.request is unused, so this stand-in
  // is safe despite JobContext typing it as non-optional.
  const ctx: JobContext = {
    tenantId: null,
    userId: 'system:cron',
    searchParams: new URLSearchParams(),
    request: undefined as unknown as JobContext['request'],
  };

  const start = Date.now();
  try {
    const result = await job.handler(ctx);
    const durationMs = Date.now() - start;
    console.info(`[job-scheduler] ${job.name} -> ${result.status} in ${durationMs}ms - ${result.summary}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[job-scheduler] ${job.name} threw after ${durationMs}ms:`, err);
  }
}
