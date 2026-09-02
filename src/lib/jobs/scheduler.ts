/**
 * In-process cron scheduler for the jobs in JOB_REGISTRY.
 *
 * Lightweight, zero-dependency cron runner compatible with Next.js 15
 * Node & Edge compiler passes.
 */

const TIMEZONE = 'Asia/Dubai';

const DEFAULT_SCHEDULES: Record<string, string> = {
  // Frequent — near-real-time operational sweeps.
  'outbox-publisher': '* * * * *',
  'auto-close-trips': '*/15 * * * *',
  'alert-trip-overdue': '*/15 * * * *',
  'push-scheduler': '*/5 * * * *',
  // Daily batch sweeps
  'document-expiry-sweep': '0 1 * * *',
  'insurance-expiry-sweep': '15 1 * * *',
  'bookings-sweep-penalties': '30 1 * * *',
  'dunning-sweep': '0 2 * * *',
  'bus-ops-generate-schedule-templates': '30 2 * * *',
  'inquiries-sweep-followups': '0 9 * * *',
  'attendance-sweep-no-show': '0 17 * * *',
  // Weekly / monthly.
  'mileage-sweep-stale': '0 4 * * 0',
  'fuel-sweep-bill': '0 3 1 * *',
  'traffic-fines-sweep-bill': '30 3 1 * *',
};

const JOB_NAMES = Object.keys(DEFAULT_SCHEDULES);

function envKeyFor(jobName: string): string {
  return `JOB_CRON_${jobName.toUpperCase().replace(/-/g, '_')}`;
}

function scheduleFor(jobName: string): string | null {
  const override = process.env[envKeyFor(jobName)];
  if (override === 'off' || override === 'disabled') return null;
  return override || DEFAULT_SCHEDULES[jobName] || null;
}

/**
 * Match a cron field (e.g. "*", "5", "star/15", "1,2") against a numeric value
 */
function matchCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }
  if (field.includes(',')) {
    return field.split(',').some((sub) => matchCronField(sub.trim(), value));
  }
  const exact = parseInt(field, 10);
  return exact === value;
}

/**
 * Check if a 5-part cron expression matches the current date/time in Asia/Dubai
 */
function isCronDue(cronExpr: string, date: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minField, hourField, domField, monField, dowField] = parts;

  // Format into Dubai timezone parts
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    minute: 'numeric',
    hour: 'numeric',
    hour12: false,
    day: 'numeric',
    month: 'numeric',
    weekday: 'narrow',
  });

  const partsObj: Record<string, number> = {};
  const dubaiDate = new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }));

  const minute = dubaiDate.getMinutes();
  const hour = dubaiDate.getHours();
  const dayOfMonth = dubaiDate.getDate();
  const month = dubaiDate.getMonth() + 1; // 1-12
  const dayOfWeek = dubaiDate.getDay(); // 0-6 (Sun-Sat)

  return (
    matchCronField(minField, minute) &&
    matchCronField(hourField, hour) &&
    matchCronField(domField, dayOfMonth) &&
    matchCronField(monField, month) &&
    matchCronField(dowField, dayOfWeek)
  );
}

let started = false;
let timerId: any = null;

/** Idempotent — starts an interval-based cron checker once on boot */
export function startJobScheduler(): void {
  if (started) return;
  if (process.env.DISABLE_JOB_SCHEDULER === 'true') {
    console.log('[job-scheduler] disabled via DISABLE_JOB_SCHEDULER=true');
    return;
  }
  started = true;

  console.log(`[job-scheduler] started — ${JOB_NAMES.length} jobs scheduled (tz ${TIMEZONE})`);

  let lastCheckedMinute = -1;

  timerId = setInterval(() => {
    const now = new Date();
    const currentMinute = now.getMinutes();

    // Only evaluate once per minute
    if (currentMinute === lastCheckedMinute) return;
    lastCheckedMinute = currentMinute;

    for (const name of JOB_NAMES) {
      const expr = scheduleFor(name);
      if (!expr) continue;

      if (isCronDue(expr, now)) {
        void runScheduled(name);
      }
    }
  }, 15000); // Check every 15s to never miss a minute boundary
}

async function runScheduled(jobName: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const url = `${base}/api/jobs/run?job=${encodeURIComponent(jobName)}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.CRON_SECRET) {
    headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`;
  }

  const start = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: '{}' });
    const body = await res.json().catch(() => ({}));
    const durationMs = Date.now() - start;
    if (!res.ok) {
      console.error(`[job-scheduler] ${jobName} -> HTTP ${res.status} in ${durationMs}ms -`, body);
      return;
    }
    console.info(`[job-scheduler] ${jobName} -> ${body.status ?? 'ok'} in ${durationMs}ms - ${body.summary ?? ''}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[job-scheduler] ${jobName} unreachable after ${durationMs}ms:`, err);
  }
}
