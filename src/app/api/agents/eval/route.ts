export const dynamic = 'force-dynamic';

/**
 * /api/agents/eval
 * ----------------
 * GET: Retrieves historical AI quality evaluation metrics & drift status.
 * POST: Triggers automated ground-truth benchmark suites and persists regression scores.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { BenchmarkRunner } from '@/lib/agents/eval';

const runner = new BenchmarkRunner();

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT id::text, agent_id AS "agentId", tenant_id AS "tenantId",
                metric_category AS "metricCategory", metric_name AS "metricName",
                metric_value::float8 AS "metricValue", is_positive_outcome AS "isPositiveOutcome",
                notes, recorded_at::text AS "recordedAt"
         FROM agent_evaluation_metrics
         WHERE tenant_id = $1 OR tenant_id = 'benchmark_tenant'
         ORDER BY recorded_at DESC
         LIMIT 50`,
        tenantId,
      ).catch(() => []);

      return NextResponse.json({ ok: true, data: rows, count: rows.length });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to retrieve evaluation metrics' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async () => {
      // Execute the ground truth benchmark suite
      const financeResult = await runner.runFinanceAnomalyBenchmark();

      // Persist benchmark outcome for the requesting tenant
      await runner.recordEvaluationMetric({
        agentId: 'finance-anomaly',
        tenantId,
        metricCategory: 'ACCURACY',
        metricName: 'DECISION_QUALITY_SCORE',
        metricValue: financeResult.metrics.decisionQualityScore,
        isPositiveOutcome: financeResult.passed,
        notes: `On-demand live evaluation run: Precision=${financeResult.metrics.precision}, Recall=${financeResult.metrics.recall}`,
      });

      return NextResponse.json({
        ok: true,
        message: 'Ground-truth benchmark suite executed successfully',
        benchmarkResult: financeResult,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Failed to execute evaluation suite' },
      { status: 500 },
    );
  }
}
