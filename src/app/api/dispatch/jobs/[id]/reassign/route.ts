/**
 * POST /api/dispatch/jobs/[id]/reassign
 *
 * Admin-initiated reassignment — puts a job back to PENDING status and
 * immediately re-runs the Smart Dispatch Optimiser so the system produces
 * a fresh ranked driver/vehicle list.
 *
 * Body:
 *   reason?     string  — free-text reason (e.g. "driver unavailable")
 *   adminId?    string  — user ID of the admin triggering the reassign
 *
 * Response: { ok: true, jobId, status: "PENDING", optimiserTriggered: true }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma }                    from '@/lib/prisma';
import { ensureDispatchSchema }      from '@/lib/dispatch/schema';
import { dispatch as agentDispatch } from '@/lib/agents/orchestrator';

type Row = Record<string, unknown>;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureDispatchSchema();

    const { id: jobId } = await params;
    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { reason, adminId } = body as { reason?: string; adminId?: string };

    // ── Fetch job to confirm it exists and get tenantId ──
    const [job] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT id, tenant_id, status FROM dispatch_jobs WHERE id = $1::uuid LIMIT 1`,
      jobId,
    );

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Only jobs in terminal-ish states can be reassigned
    const reassignableStatuses = ['ASSIGNED', 'EN_ROUTE', 'REJECTED', 'TIMED_OUT', 'CANCELLED'];
    if (!reassignableStatuses.includes(String(job.status))) {
      return NextResponse.json(
        {
          error: `Job status "${job.status}" cannot be reassigned. Must be one of: ${reassignableStatuses.join(', ')}`,
        },
        { status: 409 },
      );
    }

    const tenantId = String(job.tenant_id);

    // ── Reset job to PENDING + record reassign metadata ──
    await prisma.$executeRawUnsafe(
      `UPDATE dispatch_jobs
       SET status     = 'PENDING',
           driver_id  = NULL,
           vehicle_id = NULL,
           metadata   = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{reassign}',
             $2::jsonb
           ),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      jobId,
      JSON.stringify({
        at:       new Date().toISOString(),
        reason:   reason ?? 'admin_reassign',
        adminId:  adminId ?? null,
        prevStatus: String(job.status),
      }),
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
}
