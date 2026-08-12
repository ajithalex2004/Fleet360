/**
 * Centralized job registry for Fleet360.
 *
 * Every background sweep / cron task registers itself here as a typed JobDef.
 * The single dispatcher route (POST /api/jobs/run?job=<name>) picks the right
 * handler, enforces CRON_SECRET auth in one place, and returns a standard
 * envelope so monitoring is uniform across all jobs.
 *
 * Adding a new job:
 *  1. Write the business logic as a plain async function in src/lib/jobs/<name>.ts
 *  2. Import it here and add an entry to JOB_REGISTRY.
 *  3. Add a Vercel cron entry in vercel.json pointing to /api/jobs/run?job=<name>.
 *
 * No HTTP call is made to the job's original route — those routes delegate here
 * via `runJob()` so they remain available for manual/ad-hoc invocation.
 */

import type { NextRequest } from 'next/server';

// ── Job definition ────────────────────────────────────────────────────────────

export interface JobContext {
  /** Authenticated tenant from x-tenant-id header, or null for system jobs. */
  tenantId: string | null;
  /** Authenticated user from x-user-id header, or 'system:cron' for cron jobs. */
  userId: string;
  /** Raw query params passed to the dispatcher — jobs can read ?dryRun, etc. */
  searchParams: URLSearchParams;
  /** Original request — use sparingly; prefer structured context fields. */
  request: NextRequest;
}

export interface JobResult {
  /** Short machine-readable status. */
  status: 'ok' | 'error' | 'skipped';
  /** Human-readable summary for logs / monitoring. */
  summary: string;
  /** Any additional structured data the job wants to surface. */
  data?: Record<string, unknown>;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export interface JobDef {
  /** Unique machine name — used in ?job= query param and vercel.json. */
  name: string;
  /** Human-readable description shown in job list endpoint. */
  description: string;
  /** Handler function. */
  handler: JobHandler;
  /** Estimated max duration in seconds (for Vercel maxDuration). */
  maxDurationSec?: number;
}

// ── Job imports ───────────────────────────────────────────────────────────────

import { runAutoCloseTrips }         from '@/lib/jobs/auto-close-trips';
import { runDunningSweep }           from '@/lib/jobs/dunning-sweep';
import { runOutboxPublisher }        from '@/lib/jobs/outbox-publisher';
import {
  runFuelSweepBill,
  runTrafficFinesSweepBill,
  runDocumentExpirySweep,
  runInsuranceExpirySweep,
  runMileageSweepStale,
  runInquiriesSweepFollowups,
  runBookingsSweepPenalties,
  runAttendanceSweepNoShow,
  runPushScheduler,
} from '@/lib/jobs/sweep-adapters';

// ── Registry ──────────────────────────────────────────────────────────────────

export const JOB_REGISTRY: JobDef[] = [
  {
    name:           'auto-close-trips',
    description:    'Auto-close bus/school trips still IN_PROGRESS 4h past scheduled arrival',
    handler:        runAutoCloseTrips,
    maxDurationSec: 60,
  },
  {
    name:           'dunning-sweep',
    description:    'Daily AR dunning sweep — classify overdue lease invoices and send reminders',
    handler:        runDunningSweep,
    maxDurationSec: 120,
  },
  {
    name:           'fuel-sweep-bill',
    description:    'Monthly fuel-log billing sweep — consolidate pending fuel logs into lease invoices',
    handler:        runFuelSweepBill,
    maxDurationSec: 120,
  },
  {
    name:           'traffic-fines-sweep-bill',
    description:    'Monthly traffic-fines sweep — generate lease invoices for unpaid fines',
    handler:        runTrafficFinesSweepBill,
    maxDurationSec: 120,
  },
  {
    name:           'document-expiry-sweep',
    description:    'Daily sweep for expiring lease documents — send alerts',
    handler:        runDocumentExpirySweep,
    maxDurationSec: 60,
  },
  {
    name:           'insurance-expiry-sweep',
    description:    'Daily sweep for expiring vehicle insurance policies',
    handler:        runInsuranceExpirySweep,
    maxDurationSec: 60,
  },
  {
    name:           'mileage-sweep-stale',
    description:    'Weekly sweep to mark stale mileage readings',
    handler:        runMileageSweepStale,
    maxDurationSec: 60,
  },
  {
    name:           'inquiries-sweep-followups',
    description:    'Daily leasing inquiry follow-up sweep',
    handler:        runInquiriesSweepFollowups,
    maxDurationSec: 60,
  },
  {
    name:           'bookings-sweep-penalties',
    description:    'Daily rental booking late-return penalty sweep',
    handler:        runBookingsSweepPenalties,
    maxDurationSec: 60,
  },
  {
    name:           'attendance-sweep-no-show',
    description:    'Daily school-bus attendance no-show sweep',
    handler:        runAttendanceSweepNoShow,
    maxDurationSec: 60,
  },
  {
    name:           'push-scheduler',
    description:    'Run push notification scheduler',
    handler:        runPushScheduler,
    maxDurationSec: 60,
  },
  {
    name:           'outbox-publisher',
    description:    'Domain event outbox publisher — polls event_outbox and fans out to consumers',
    handler:        runOutboxPublisher,
    maxDurationSec: 60,
  },
];

export const JOB_MAP = new Map<string, JobDef>(
  JOB_REGISTRY.map(j => [j.name, j]),
);

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Returns true when the request is authorised to run a job.
 * Accepted: valid CRON_SECRET Bearer header OR an authenticated operator
 * session (x-tenant-id set by middleware).
 */
export function isJobAuthorized(request: NextRequest): boolean {
  // Logged-in operator — middleware already validated the session.
  if (request.headers.get('x-tenant-id')) return true;

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Require the secret in production; allow unauthenticated in dev.
    return process.env.NODE_ENV !== 'production';
  }
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return got === expected;
}
