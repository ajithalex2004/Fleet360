export const dynamic = 'force-dynamic';

/**
 * POST /api/dispatch/jobs/[id]/reassign
 *
 * Admin-initiated reassignment — releases any currently locked driver/vehicle,
 * puts a job back to PENDING status, and immediately re-runs both the
 * Smart Dispatch Optimiser and the core dispatch engine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma }                    from '@/lib/prisma';
import { ensureDispatchSchema }      from '@/lib/dispatch/schema';
import { runDispatch }               from '@/lib/dispatch/engine';
import { dispatch as agentDispatch } from '@/lib/agents/orchestrator';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();

      const { id: jobId } = await params;
      if (!jobId) {
        return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
      }

      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(bodyRaw);
      const { reason, adminId } = body as { reason?: string; adminId?: string };

      // ── Fetch job scoped strictly to the caller's tenant ──
      const [job] = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, tenant_id, status,
                COALESCE(assigned_driver_id, driver_id)   AS current_driver_id,
                COALESCE(assigned_vehicle_id, vehicle_id) AS current_vehicle_id
         FROM dispatch_jobs
         WHERE id = $1::uuid AND tenant_id = $2
         LIMIT 1`,
        jobId,
        tenantId,
      );

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      // Allow reassigning any active, failed, escalated, or legacy status
      const reassignableStatuses = [
        'OFFERED',
        'ACCEPTED',
        'RETRYING',
        'ESCALATED',
        'FAILED',
        'CANCELLED',
        'ASSIGNED',
        'EN_ROUTE',
        'REJECTED',
        'TIMED_OUT',
      ];
      if (!reassignableStatuses.includes(String(job.status))) {
        return NextResponse.json(
          {
            error: `Job status "${job.status}" cannot be reassigned. Must be one of: ${reassignableStatuses.join(', ')}`,
          },
          { status: 409 },
        );
      }

      // Release previous driver & vehicle locks if any
      if (job.current_driver_id) {
        await tx.$executeRawUnsafe(
          `UPDATE driver_availability
           SET status = 'AVAILABLE', current_job_id = NULL, updated_at = NOW()
           WHERE driver_id = $1 AND (current_job_id IS NULL OR current_job_id = $2::uuid)`,
          String(job.current_driver_id),
          jobId,
        ).catch(() => {});
      }
      if (job.current_vehicle_id) {
        await tx.$executeRawUnsafe(
          `UPDATE vehicles SET status = 'AVAILABLE' WHERE id::text = $1 AND tenant_id::text = $2`,
          String(job.current_vehicle_id),
          tenantId,
        ).catch(() => {});
      }

      // ── Reset job to PENDING + clear both driver/vehicle column pairs + record reassign metadata ──
      const reassignMeta = JSON.stringify({
        at:         new Date().toISOString(),
        reason:     reason ?? 'admin_reassign',
        adminId:    adminId ?? null,
        prevStatus: String(job.status),
      });

      await tx.$executeRawUnsafe(
        `UPDATE dispatch_jobs
         SET status              = 'PENDING',
             assigned_driver_id  = NULL,
             assigned_vehicle_id = NULL,
             driver_id           = NULL,
             vehicle_id          = NULL,
             current_attempt     = 0,
             metadata            = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{reassign}',
               $3::jsonb
             ),
             updated_at          = NOW()
         WHERE id = $1::uuid AND tenant_id = $2`,
        jobId,
        tenantId,
        reassignMeta,
      );

      // ── Fire Smart Dispatch Optimiser — non-blocking ──
      agentDispatch({
        agent_id:   'dispatch-optimiser',
        event_type: 'dispatch.job_reassign',
        tenant_id:  tenantId,
        entity_id:  jobId,
        payload:    { reason: reason ?? 'admin_reassign', adminId },
      }).catch(err =>
        console.warn('[dispatch/jobs/reassign] optimiser trigger failed (non-fatal):', err),
      );

      // ── Re-run the core dispatch engine asynchronously ──
      const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
      runDispatch(jobId, baseUrl).catch(err =>
        console.warn('[dispatch/jobs/reassign] runDispatch failed (non-fatal):', err),
      );

      return NextResponse.json({
        ok:                 true,
        jobId,
        status:             'PENDING',
        optimiserTriggered: true,
      });
    } catch (err) {
      console.error('[dispatch/jobs/reassign POST]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
