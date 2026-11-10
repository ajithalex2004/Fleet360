export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
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

      const conditions: string[] = [
        `(r.tenant_id = $1 OR EXISTS (SELECT 1 FROM dispatch_jobs dj WHERE dj.id::text = r.job_id AND dj.tenant_id = $1))`,
      ];
      const values: unknown[] = [tenantId];

      if (jobId) {
        values.push(jobId);
        conditions.push(`r.job_id = $${values.length}`);
      }

      const query = `
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
          COALESCE(NULLIF(TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')), ''), d.name) AS driver_name,
          COALESCE(v.registration_no, v.license_plate, v.plate_number, r.recommended_vehicle_id) AS vehicle_code,
          v.type AS vehicle_type
        FROM dispatch_optimiser_recommendations r
        LEFT JOIN drivers d  ON d.id::text = r.recommended_driver_id
        LEFT JOIN vehicles v ON v.id::text = r.recommended_vehicle_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.created_at DESC
        LIMIT 100
      `;

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
        // Verify the job belongs to this tenant
        const [job] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM dispatch_jobs WHERE id = $1::uuid AND tenant_id = $2 LIMIT 1`,
          jobId,
          tenantId,
        );
        if (!job) {
          return NextResponse.json({ error: 'Dispatch job not found for this tenant' }, { status: 404 });
        }

        const acceptToken = randomUUID();

        // 1-Click Apply AI Match (scoped to tenant, updating both column pairs)
        await tx.$executeRawUnsafe(`
          UPDATE dispatch_jobs
          SET status              = 'OFFERED',
              assigned_driver_id  = $1,
              assigned_vehicle_id = $2,
              driver_id           = $1,
              vehicle_id          = $2,
              current_attempt     = current_attempt + 1,
              updated_at          = NOW()
          WHERE id = $3::uuid AND tenant_id = $4
        `, driverId, vehicleId, jobId, tenantId);

        await tx.$executeRawUnsafe(`
          INSERT INTO dispatch_attempts (
            dispatch_job_id, attempt_number, driver_id, vehicle_id,
            offered_at, response, accept_token
          ) VALUES ($1::uuid, 1, $2, $3, NOW(), 'PENDING', $4)
        `, jobId, driverId, vehicleId, acceptToken);

        await tx.$executeRawUnsafe(`
          UPDATE driver_availability
          SET status = 'BUSY', current_job_id = $2::uuid, updated_at = NOW()
          WHERE driver_id = $1 AND (tenant_id IS NULL OR tenant_id = $3)
        `, driverId, jobId, tenantId).catch(() => {});

        await tx.$executeRawUnsafe(`
          UPDATE vehicles SET status = 'IN_USE' WHERE id::text = $1 AND tenant_id::text = $2
        `, vehicleId, tenantId).catch(() => {});

        if (recommendationId) {
          await tx.$executeRawUnsafe(`
            UPDATE dispatch_optimiser_recommendations
            SET status = 'APPLIED',
                applied_at = NOW(),
                updated_at = NOW()
            WHERE id = $1::uuid AND (tenant_id = $2 OR tenant_id IS NULL)
          `, recommendationId, tenantId);
        } else {
          await tx.$executeRawUnsafe(`
            UPDATE dispatch_optimiser_recommendations
            SET status = 'APPLIED',
                applied_at = NOW(),
                updated_at = NOW()
            WHERE job_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)
          `, jobId, tenantId);
        }

        return NextResponse.json({
          ok: true,
          acceptToken,
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
