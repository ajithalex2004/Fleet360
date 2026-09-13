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
import { verifySession } from '@/lib/tenant-session';

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
  /** Specific operator roles authorized to run this job (SUPER_ADMIN always permitted). */
  allowedRoles?: string[];
}

// ── Job imports ───────────────────────────────────────────────────────────────

import { runAutoCloseTrips }         from '@/lib/jobs/auto-close-trips';
import { runDunningSweep }           from '@/lib/jobs/dunning-sweep';
import { runDunningReconciliation }  from '@/lib/jobs/dunning-reconciliation';
import { runFleetDocumentsSweep }    from '@/lib/jobs/fleet-documents-sweep';
import { runOutboxPublisher }        from '@/lib/jobs/outbox-publisher';
import { runBusOpsGenerateScheduleTemplates } from '@/lib/jobs/bus-ops-generate-schedule-templates';
import { runAlertTripOverdue }       from '@/lib/jobs/alert-trip-overdue';
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
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATIONS', 'DISPATCHER', 'FLEET_MANAGER'],
  },
  {
    name:           'alert-trip-overdue',
    description:    'Raise TRIP_OVERDUE alerts for trips past scheduled arrival + tolerance',
    handler:        runAlertTripOverdue,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATIONS', 'DISPATCHER', 'FLEET_MANAGER'],
  },
  {
    name:           'dunning-sweep',
    description:    'Daily AR dunning sweep — classify overdue lease invoices into collection stages and queue dispatch notices',
    handler:        runDunningSweep,
    maxDurationSec: 120,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FINANCE'],
  },
  {
    name:           'dunning-reconciliation',
    description:    'Dunning dispatch reconciliation — recovers stale claims, enqueues due retries, and resumes paused/failed notices',
    handler:        runDunningReconciliation,
    maxDurationSec: 120,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FINANCE'],
  },
  {
    name:           'fuel-sweep-bill',
    description:    'Monthly fuel-log billing sweep — consolidate pending fuel logs into lease invoices',
    handler:        runFuelSweepBill,
    maxDurationSec: 120,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FINANCE'],
  },
  {
    name:           'traffic-fines-sweep-bill',
    description:    'Monthly traffic-fines sweep — generate lease invoices for unpaid fines',
    handler:        runTrafficFinesSweepBill,
    maxDurationSec: 120,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FINANCE'],
  },
  {
    name:           'document-expiry-sweep',
    description:    'Daily sweep for expiring lease documents — send alerts',
    handler:        runDocumentExpirySweep,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FLEET_MANAGER', 'OPERATIONS'],
  },
  {
    name:           'insurance-expiry-sweep',
    description:    'Daily sweep for expiring vehicle insurance policies',
    handler:        runInsuranceExpirySweep,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FLEET_MANAGER', 'OPERATIONS'],
  },
  {
    name:           'fleet-documents-sweep',
    description:    'Daily fleet document-expiry sweep — auto-grounds/restores vehicles and notifies staff',
    handler:        runFleetDocumentsSweep,
    maxDurationSec: 600,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FLEET_MANAGER', 'OPERATIONS'],
  },
  {
    name:           'mileage-sweep-stale',
    description:    'Weekly sweep to mark stale mileage readings',
    handler:        runMileageSweepStale,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'FLEET_MANAGER', 'OPERATIONS'],
  },
  {
    name:           'inquiries-sweep-followups',
    description:    'Daily leasing inquiry follow-up sweep',
    handler:        runInquiriesSweepFollowups,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'SALES', 'OPERATIONS'],
  },
  {
    name:           'bookings-sweep-penalties',
    description:    'Daily rental booking late-return penalty sweep',
    handler:        runBookingsSweepPenalties,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATIONS', 'FLEET_MANAGER'],
  },
  {
    name:           'attendance-sweep-no-show',
    description:    'Daily school-bus attendance no-show sweep',
    handler:        runAttendanceSweepNoShow,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATIONS', 'DISPATCHER'],
  },
  {
    name:           'push-scheduler',
    description:    'Run push notification scheduler',
    handler:        runPushScheduler,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN'],
  },
  {
    name:           'outbox-publisher',
    description:    'Domain event outbox publisher — polls event_outbox and fans out to consumers',
    handler:        runOutboxPublisher,
    maxDurationSec: 60,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN'],
  },
  {
    name:           'bus-ops-generate-schedule-templates',
    description:    'Nightly TripSchedule generation from active BusOpsScheduleTemplates (rolling 7-day window; override via ?days=N)',
    handler:        runBusOpsGenerateScheduleTemplates,
    maxDurationSec: 300,
    allowedRoles:   ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATIONS', 'DISPATCHER'],
  },
];

export const JOB_MAP = new Map<string, JobDef>(
  JOB_REGISTRY.map(j => [j.name, j]),
);

// ── Auth helper ───────────────────────────────────────────────────────────────

export interface JobAuthResult {
  authorized: boolean;
  isCron: boolean;
  tenantId: string | null;
  userId: string;
  error?: string;
  status?: number;
}

/**
 * Validates authorization for background sweep / cron jobs.
 *
 * Rules:
 *  1. Valid CRON_SECRET Bearer header -> Authorized system scheduler (isCron=true, system:cron).
 *  2. Authenticated operator session -> Must have a cryptographically verified session
 *     (xl-session cookie verified via verifySession). Unauthenticated client headers
 *     (x-user-id, x-tenant-id, x-user-role) are NEVER trusted and strictly rejected with 401.
 *  3. Operator role must be authorized for the specific job requested (e.g. DISPATCHER cannot run billing).
 *  4. Operators cannot forge or cross into other tenants: tenantId is strictly bound to session tenant.
 */
export async function verifyJobAuthorization(
  request: NextRequest,
  jobName?: string | null
): Promise<JobAuthResult> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  // 1. System Scheduler Auth via CRON_SECRET
  if (cronSecret && authHeader === cronSecret) {
    const requestedTenant = request.headers.get('x-tenant-id') || request.nextUrl.searchParams.get('tenantId');
    return {
      authorized: true,
      isCron: true,
      tenantId: requestedTenant ? requestedTenant.trim() : null,
      userId: 'system:cron',
    };
  }

  // Allow dev bypass only if explicitly outside production and secret not configured
  if (!cronSecret && process.env.NODE_ENV !== 'production' && !request.cookies.get('xl-session')) {
    return {
      authorized: true,
      isCron: true,
      tenantId: null,
      userId: 'dev:unauthenticated',
    };
  }

  // 2. Operator Session Auth — Cryptographic verification of session cookie
  const sessionToken = request.cookies.get('xl-session')?.value;
  const session = sessionToken ? await verifySession(sessionToken) : null;

  // Unauthenticated requests carrying arbitrary forged headers are strictly rejected
  if (!session) {
    return {
      authorized: false,
      isCron: false,
      tenantId: null,
      userId: 'anonymous',
      error: 'Unauthorized: Valid operator session required',
      status: 401,
    };
  }

  const sessionTenant = session.tenantId;
  const userId = session.userId;
  const role = session.role ?? 'OPERATOR';

  // 3. Job-Specific Role Gate
  const jobDef = jobName ? JOB_MAP.get(jobName) : null;
  const allowedRoles = jobDef?.allowedRoles ?? [
    'SUPER_ADMIN',
    'TENANT_ADMIN',
    'FLEET_MANAGER',
    'OPERATIONS',
    'DISPATCHER',
    'FINANCE',
  ];

  if (role !== 'SUPER_ADMIN' && !allowedRoles.includes(role)) {
    return {
      authorized: false,
      isCron: false,
      tenantId: sessionTenant,
      userId,
      error: `Forbidden: role '${role}' is not authorized to execute job '${jobName || 'unknown'}'`,
      status: 403,
    };
  }

  // 4. Forbid cross-tenant header spoofing for non-super-admins
  const requestedTenant =
    request.headers.get('x-requested-tenant-id') || request.nextUrl.searchParams.get('tenantId');
  if (requestedTenant && requestedTenant !== sessionTenant && role !== 'SUPER_ADMIN') {
    return {
      authorized: false,
      isCron: false,
      tenantId: sessionTenant,
      userId,
      error: 'Forbidden: cross-tenant execution not permitted',
      status: 403,
    };
  }

  return {
    authorized: true,
    isCron: false,
    tenantId: requestedTenant && role === 'SUPER_ADMIN' ? requestedTenant : sessionTenant,
    userId,
  };
}

export async function isJobAuthorized(
  request: NextRequest,
  jobName?: string | null
): Promise<boolean> {
  const res = await verifyJobAuthorization(request, jobName);
  return res.authorized;
}
