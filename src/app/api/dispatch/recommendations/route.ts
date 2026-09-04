export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { dispatch as agentDispatch } from '@/lib/agents/orchestrator';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();
      await ensureAgentSchema();

      const sp = new URL(req.url).searchParams;
      const jobId = sp.get('jobId');

      let query = `
        SELECT
          r.id,
          r.job_id,
          r.job_service_type,
          r.job_priority,
          r.recommended_driver_id,
          r.recommended_vehicle_id,
          r.composite_score::float8,
          r.factor_scores,
          r.candidates_evaluated,
          r.reason,
          r.confidence::float8,
          r.status,
          r.applied_at,
          r.created_at,
          d.first_name || ' ' || COALESCE(d.last_name, '') AS driver_name,
          COALESCE(v.vehicle_code, v.plate_number, r.recommended_vehicle_id) AS vehicle_code,
          v.type AS vehicle_type
        FROM dispatch_optimiser_recommendations r
        LEFT JOIN drivers d ON d.id = r.recommended_driver_id
        LEFT JOIN vehicles v ON v.id = r.recommended_vehicle_id
      `;

      const values: unknown[] = [];
      if (jobId) {
        query += ` WHERE r.job_id = $1`;
        values.push(jobId);
      }

      query += ` ORDER BY r.created_at DESC LIMIT 100`;

      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(query, ...values);

      return NextResponse.json({
        data: rows.map(r => ({
          ...r,
          composite_score: Number(r.composite_score ?? 0),
          confidence: Number(r.confidence ?? 0),
        })),
      });
    } catch (err) {
      console.error('[dispatch/recommendations GET]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();
      await ensureAgentSchema();

      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(bodyRaw) as {
        jobId?: string;
        recommendationId?: string;
        driverId?: string;
        vehicleId?: string;
        action?: 'TRIGGER_AI' | 'APPLY_MATCH';
      };

      const { jobId, recommendationId, driverId, vehicleId, action } = body;

      if (action === 'TRIGGER_AI' || (!action && !driverId && jobId)) {
        // Trigger Smart Dispatch Optimiser for this job
        await agentDispatch({
          agent_id: 'dispatch-optimiser',
          event_type: 'dispatch.job_created',
          tenant_id: tenantId,
          entity_id: jobId ?? undefined,
        });

        return NextResponse.json({
          ok: true,
          message: `Smart Dispatch Optimizer triggered for ${jobId ? `job ${jobId}` : 'pending jobs'}.`,
        });
      }

      if (jobId && driverId && vehicleId) {
        // 1-Click Apply AI Match
        await tx.$executeRawUnsafe(`
          UPDATE dispatch_jobs
          SET status = 'OFFERED',
              assigned_driver_id = $1,
              assigned_vehicle_id = $2,
              current_attempt = current_attempt + 1,
              updated_at = NOW()
          WHERE id = $3::uuid
        `, driverId, vehicleId, jobId);

        await tx.$executeRawUnsafe(`
          INSERT INTO dispatch_attempts (
            dispatch_job_id, attempt_number, driver_id, vehicle_id,
            offered_at, response
          ) VALUES ($1::uuid, 1, $2, $3, NOW(), 'PENDING')
        `, jobId, driverId, vehicleId);

        if (recommendationId) {
          await tx.$executeRawUnsafe(`
            UPDATE dispatch_optimiser_recommendations
            SET status = 'APPLIED',
                applied_at = NOW(),
                updated_at = NOW()
            WHERE id = $1::uuid
          `, recommendationId);
        } else {
          await tx.$executeRawUnsafe(`
            UPDATE dispatch_optimiser_recommendations
            SET status = 'APPLIED',
                applied_at = NOW(),
                updated_at = NOW()
            WHERE job_id = $1
          `, jobId);
        }

        return NextResponse.json({
          ok: true,
          message: `Job ${jobId} successfully auto-assigned to Driver ${driverId} and Vehicle ${vehicleId}.`,
        });
      }

      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    } catch (err) {
      console.error('[dispatch/recommendations POST]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
