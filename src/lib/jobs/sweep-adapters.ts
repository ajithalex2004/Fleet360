/**
 * Job adapters: simple sweep delegates
 * These wrap the existing per-route sweep functions with the standard
 * JobContext → JobResult interface. The actual business logic lives in
 * the original route files; this layer just adapts the calling convention.
 */

import type { JobContext, JobResult } from '@/lib/jobs/registry';

// ── Helper to forward a job as an internal HTTP call to the original route ────
// This is the zero-refactor path: we call the existing route via fetch so the
// sweeps keep working without duplicating logic. All sweeps accept POST and
// check CRON_SECRET or x-tenant-id, so we forward both.

async function forwardToRoute(path: string, ctx: JobContext): Promise<JobResult> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const qs   = ctx.searchParams.toString();
  const url  = `${base}${path}${qs ? '?' + qs : ''}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (process.env.CRON_SECRET) {
    headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`;
  }
  if (ctx.tenantId) {
    headers['x-tenant-id'] = ctx.tenantId;
    headers['x-user-id']   = ctx.userId;
  }

  try {
    const res  = await fetch(url, { method: 'POST', headers, body: '{}' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: 'error', summary: `Route ${path} returned ${res.status}`, data: body };
    }
    return { status: 'ok', summary: `Route ${path} completed`, data: body };
  } catch (err) {
    return { status: 'error', summary: `Route ${path} unreachable: ${String(err)}` };
  }
}

// ── Individual adapters ───────────────────────────────────────────────────────

export async function runFuelSweepBill(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/leasing/fuel/sweep-bill', ctx);
}

export async function runTrafficFinesSweepBill(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/leasing/traffic-fines/sweep-bill', ctx);
}

export async function runDocumentExpirySweep(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/leasing/documents/sweep-expiry', ctx);
}

export async function runInsuranceExpirySweep(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/leasing/insurance/sweep-expiry', ctx);
}

export async function runMileageSweepStale(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/leasing/mileage-readings/sweep-stale', ctx);
}

export async function runInquiriesSweepFollowups(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/leasing/inquiries/sweep-followups', ctx);
}

export async function runBookingsSweepPenalties(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/rental/bookings/sweep-penalties', ctx);
}

export async function runAttendanceSweepNoShow(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/school-bus/attendance/sweep-no-show', ctx);
}

export async function runPushScheduler(ctx: JobContext): Promise<JobResult> {
  return forwardToRoute('/api/push/run-scheduler', ctx);
}
