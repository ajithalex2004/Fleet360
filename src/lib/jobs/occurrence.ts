/**
 * The scheduler's occurrence key for a job run: the UTC minute it fired for.
 * POST /api/jobs/run claims each (job, scope, occurrence) once
 * (src/lib/jobs/job-runs.ts), so replicas firing the same tick run it once.
 *
 * Kept free of Node-only imports: the scheduler is reached from
 * src/instrumentation-node.ts, which Next.js also compiles for the Edge
 * runtime, where 'crypto' and 'os' (used by job-runs.ts) do not resolve.
 */
export function scheduledOccurrence(at: Date): string {
  return at.toISOString().slice(0, 16) + 'Z';
}
