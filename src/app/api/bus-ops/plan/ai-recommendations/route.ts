export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { dispatch as agentDispatch } from '@/lib/agents/orchestrator';
import { runStaffTransportPlannerAgent } from '@/lib/agents/staff-transport-planner/agent';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import { revalidateCache } from '@/lib/server-cache';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureAgentSchema();

      const sp = new URL(req.url).searchParams;
      const status = sp.get('status');

      let query = `
        SELECT
          id,
          tenant_id,
          plan_name,
          shift_coverage,
          total_employees_covered,
          baseline_vehicles_needed,
          optimized_vehicles_needed,
          vehicles_saved,
          daily_distance_saved_km::float8,
          monthly_cost_saved_aed::float8,
          annual_cost_saved_aed::float8,
          routes,
          vehicle_reuse_chains,
          status,
          applied_at,
          applied_by,
          agent_run_id,
          created_at,
          updated_at
        FROM bus_ops_plan_recommendations
        WHERE tenant_id = $1
      `;

      const values: unknown[] = [tenantId];
      if (status) {
        query += ` AND status = $2`;
        values.push(status);
      }

      query += ` ORDER BY created_at DESC LIMIT 50`;

      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(query, ...values);

      return NextResponse.json({
        data: rows.map(r => ({
          ...r,
          daily_distance_saved_km: Number(r.daily_distance_saved_km ?? 0),
          monthly_cost_saved_aed: Number(r.monthly_cost_saved_aed ?? 0),
          annual_cost_saved_aed: Number(r.annual_cost_saved_aed ?? 0),
        })),
      });
    } catch (err) {
      console.error('[bus-ops/plan/ai-recommendations GET]', err);
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

  const permError = requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureAgentSchema();

      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(bodyRaw) as {
        action?: 'TRIGGER_AI' | 'APPLY_RECOMMENDATION';
        recommendationId?: string;
        options?: {
          shiftIds?: string[];
          manifestIds?: string[];
          dryRun?: boolean;
        };
      };

      const { action, recommendationId, options } = body;

      if (action === 'TRIGGER_AI' || !action) {
        // Run Staff Transport Planner Agent directly
        const result = await runStaffTransportPlannerAgent(tenantId, options);
        return NextResponse.json({
          ok: true,
          message: 'Staff Transport Planner Agent executed successfully.',
          result,
        });
      }

      if (action === 'APPLY_RECOMMENDATION' && recommendationId) {
        // 1. Fetch recommendation
        const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`
          SELECT * FROM bus_ops_plan_recommendations
          WHERE id = $1::uuid AND tenant_id = $2
        `, recommendationId, tenantId);

        if (!rows || rows.length === 0) {
          return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
        }

        const rec = rows[0];
        const today = new Date().toISOString().slice(0, 10);

        // 2. Commit as a StaffTransportPlan in Prisma
        const createdPlan = await tx.staffTransportPlan.create({
          data: {
            tenantId,
            name: String(rec.plan_name || 'AI Staff Transport Plan'),
            description: `Generated and applied via Staff Transport Planning Agent (${rec.vehicles_saved} vehicles saved, AED ${rec.monthly_cost_saved_aed}/mo savings)`,
            dateFrom: new Date(`${today}T00:00:00Z`),
            dateTo: new Date(`${today}T23:59:59Z`),
            workRules: {},
            blockOptions: {},
            runs: (rec.routes ?? []) as unknown as object,
            blocks: (rec.vehicle_reuse_chains ?? []) as unknown as object,
            rosters: [],
            summary: {
              vehiclesSaved: rec.vehicles_saved,
              monthlyCostSavedAed: rec.monthly_cost_saved_aed,
              annualCostSavedAed: rec.annual_cost_saved_aed,
              dailyDistanceSavedKm: rec.daily_distance_saved_km,
              totalEmployeesCovered: rec.total_employees_covered,
              baselineVehiclesNeeded: rec.baseline_vehicles_needed,
              optimizedVehiclesNeeded: rec.optimized_vehicles_needed,
            } as unknown as object,
            status: 'APPLIED',
          },
        });

        // 3. Mark recommendation as APPLIED
        await tx.$executeRawUnsafe(`
          UPDATE bus_ops_plan_recommendations
          SET status = 'APPLIED',
              applied_at = NOW(),
              applied_by = 'bus-ops-admin',
              updated_at = NOW()
          WHERE id = $1::uuid
        `, recommendationId);

        revalidateCache(['staff-transport-plans']);

        return NextResponse.json({
          ok: true,
          message: `Recommendation applied and created Staff Transport Plan ${createdPlan.id}.`,
          planId: createdPlan.id,
        });
      }

      return NextResponse.json({ error: 'Invalid action or missing recommendationId' }, { status: 400 });
    } catch (err) {
      console.error('[bus-ops/plan/ai-recommendations POST]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
