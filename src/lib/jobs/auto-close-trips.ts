/**
 * Job adapter: auto-close-trips
 * Wraps the logic from src/app/api/cron/auto-close-trips/route.ts
 */
import type { JobContext, JobResult } from '@/lib/jobs/registry';
import { prisma } from '@/lib/prisma';
import { runSweep } from '@/lib/prisma-sweep';


const STALE_HOURS = 4;

interface StaleTrip {
  id: string;
  status: string;
  departure_time: Date;
  arrival_time: Date;
  actual_departure_at: Date | null;
  driver_id: string;
  tenant_id: string;
}

export async function runAutoCloseTrips(ctx: JobContext): Promise<JobResult> {
  const tenantHeader = ctx.tenantId ?? undefined;

  const stalePerTenant = await runSweep(async ({ tx, tenantId }) => {
    return tx.$queryRaw<StaleTrip[]>`
      SELECT id, status, departure_time, arrival_time,
             actual_departure_at, driver_id, tenant_id
        FROM trip_schedules
       WHERE status = 'IN_PROGRESS'
         AND deleted_at IS NULL
         AND tenant_id = ${tenantId}::uuid
         AND arrival_time < NOW() - (${STALE_HOURS} || ' hours')::interval
    `;
  }, { tenantHeader });

  const allStale = stalePerTenant.flatMap(r => r.result);
  const closed: string[] = [];
  const skipped: string[] = [];

  for (const t of allStale) {
    if (t.status !== 'IN_PROGRESS') { skipped.push(t.id); continue; }
    const now = new Date();
    const startIso = t.actual_departure_at?.toISOString() ?? t.departure_time.toISOString();
    const durationMin = Math.max(0, Math.round((now.getTime() - new Date(startIso).getTime()) / 60_000));
    const overdueHours = Math.round((now.getTime() - t.arrival_time.getTime()) / 3_600_000);
    try {
      await prisma.$transaction(async closeTx => {
        await closeTx.$executeRaw`
          UPDATE trip_schedules
             SET status = 'AUTO_CLOSED',
                 actual_arrival_at = ${now.toISOString()}::timestamptz,
                 duration_minutes  = ${durationMin},
                 updated_at        = NOW()
           WHERE id = ${t.id} AND status = 'IN_PROGRESS'
        `;
        await closeTx.$executeRaw`
          INSERT INTO trip_state_transitions
            (id, tenant_id, trip_id, driver_id, transition, at, source, notes)
          VALUES (
            gen_random_uuid(), ${t.tenant_id}::uuid, ${t.id},
            ${t.driver_id}::uuid, 'AUTO_CLOSED',
            ${now.toISOString()}::timestamptz, 'SYSTEM',
            ${`Auto-closed: ${overdueHours}h past scheduled arrival`}
          )
        `;
      });
      closed.push(t.id);
    } catch (e) {
      console.warn(`[auto-close-trips] failed to close ${t.id}:`, e);
      skipped.push(t.id);
    }
  }

  return {
    status: 'ok',
    summary: `Closed ${closed.length} stale trip(s) across ${stalePerTenant.length} tenant(s); skipped ${skipped.length}`,
    data: { tenantsScanned: stalePerTenant.length, scanned: allStale.length, closed, skipped },
  };
}
