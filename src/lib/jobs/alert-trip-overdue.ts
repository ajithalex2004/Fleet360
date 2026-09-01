/**
 * alert-trip-overdue — periodic sweep for TRIP_OVERDUE.
 *
 * A trip is "overdue" when now > scheduled arrival + tolerance AND its
 * status is still SCHEDULED, DEPARTED, or IN_TRANSIT (never COMPLETED
 * or CANCELLED). Publishes one `alert.condition_detected` per matching
 * trip; the Alert Engine's dedup guard on
 * (tenant_id, dedupe_key='TRIP_OVERDUE:<scheduleId>') ensures we only
 * raise once per trip until it's acknowledged or resolved.
 *
 * Cron cadence: every 5-10 minutes is fine. Sweep window is limited to
 * the last 24h of scheduled trips so a long-running deployment never
 * scans the full trip history.
 */

import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';
import type { JobContext, JobResult } from './registry';

/** Trip is late once now - arrivalTime > this many minutes. */
const OVERDUE_TOLERANCE_MIN = 15;
/** Only scan trips scheduled within the last N hours to bound the query. */
const SCAN_WINDOW_HOURS = 24;

interface OverdueTrip {
  id: string;
  tenant_id: string | null;
  trip_number: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  departure_time: Date;
  arrival_time: Date | null;
  status: string | null;
  route_variant_version_id: string | null;
}

export async function runAlertTripOverdue(_ctx: JobContext): Promise<JobResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OVERDUE_TOLERANCE_MIN * 60_000);
  const windowStart = new Date(now.getTime() - SCAN_WINDOW_HOURS * 3600_000);

  // Raw SQL because we filter on both status IN (...) and
  // arrival_time < cutoff — cleaner than a large Prisma where clause,
  // and we only need a handful of scalar columns.
  const rows = await prisma.$queryRaw<OverdueTrip[]>`
    SELECT id, tenant_id, trip_number, vehicle_id, driver_id,
           departure_time, arrival_time, status, route_variant_version_id
      FROM trip_schedules
     WHERE deleted_at IS NULL
       AND status IN ('SCHEDULED', 'STARTED', 'EN_ROUTE', 'DEPARTED', 'IN_TRANSIT')
       AND arrival_time IS NOT NULL
       AND arrival_time < ${cutoff}
       AND departure_time > ${windowStart}
       AND tenant_id IS NOT NULL
     ORDER BY arrival_time ASC
     LIMIT 500
  `;

  let raised = 0;
  const errors: string[] = [];
  for (const t of rows) {
    if (!t.tenant_id || !t.arrival_time) continue;
    const overdueMin = Math.round((now.getTime() - t.arrival_time.getTime()) / 60_000);
    try {
      await raiseAlert({
        tenantId:     t.tenant_id,
        code:         'TRIP_OVERDUE',
        sourceModule: 'bus-ops',
        subjectType:  'TripSchedule',
        subjectId:    t.id,
        title:        `Trip ${t.trip_number ?? t.id.slice(0, 8)} · ${overdueMin} min overdue`,
        description:  `Status is ${t.status ?? 'SCHEDULED'}. Scheduled to arrive ${t.arrival_time.toISOString()}, now ${overdueMin} min past.`,
        severity:     overdueMin > 60 ? 'HIGH' : 'MEDIUM',
        actor:        'system:cron',
        context: {
          scheduleId:            t.id,
          tripNumber:            t.trip_number,
          vehicleId:             t.vehicle_id,
          driverId:              t.driver_id,
          departureTime:         t.departure_time.toISOString(),
          scheduledArrivalTime:  t.arrival_time.toISOString(),
          status:                t.status,
          overdueMinutes:        overdueMin,
        },
      });
      raised++;
    } catch (e) {
      errors.push(t.id);
      console.error('[alert-trip-overdue]', t.id, e);
    }
  }

  return {
    status: 'ok',
    summary: `Scanned ${rows.length} candidate trips, raised ${raised} TRIP_OVERDUE alerts${errors.length ? ` (${errors.length} errors)` : ''}.`,
    data: { scanned: rows.length, raised, errors: errors.length, windowHours: SCAN_WINDOW_HOURS, toleranceMin: OVERDUE_TOLERANCE_MIN },
  };
}
