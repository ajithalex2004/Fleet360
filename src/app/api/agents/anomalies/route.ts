export const dynamic = 'force-dynamic';

/**
 * GET  /api/agents/anomalies  — list anomaly flags with 8-stream filters
 * PATCH /api/agents/anomalies — update flag status or execute 1-click remediation action
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await ensureAgentSchema();
    try {
      const sp         = req.nextUrl.searchParams;
      const severity   = sp.get('severity');
      const streamType = sp.get('stream_type');
      const entityType = sp.get('entity_type');
      const status     = sp.get('status') ?? 'OPEN';
      const detectorId = sp.get('detector_id');
      const limit      = Math.min(Number(sp.get('limit') ?? 100), 500);
      const offset     = Number(sp.get('offset') ?? 0);

      const conditions: string[] = ['(tenant_id = $1 OR tenant_id = \'default\')'];
      const params: unknown[] = [tenantId];

      if (severity)   { params.push(severity);   conditions.push(`severity = $${params.length}`); }
      if (streamType) { params.push(streamType); conditions.push(`stream_type = $${params.length}`); }
      if (entityType) { params.push(entityType); conditions.push(`entity_type = $${params.length}`); }
      if (status && status !== 'ALL') { params.push(status); conditions.push(`status = $${params.length}`); }
      if (detectorId) { params.push(detectorId); conditions.push(`detector_id = $${params.length}`); }

      const where = `WHERE ${conditions.join(' AND ')}`;
      const countParams = [...params];
      params.push(limit, offset);

      const [countRows, rows, summaryRows, streamSummaryRows] = await Promise.all([
        tx.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT COUNT(*) AS count FROM ai.agent_anomaly_flags ${where}`,
          ...countParams,
        ),
        tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM ai.agent_anomaly_flags ${where}
           ORDER BY
             CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
             financial_exposure_aed DESC NULLS LAST,
             confidence DESC,
             created_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          ...params,
        ),
        tx.$queryRawUnsafe<Array<{ severity: string; count: bigint; total_exposure: number }>>(
          `SELECT severity, COUNT(*) AS count, COALESCE(SUM(financial_exposure_aed), 0)::float8 AS total_exposure
           FROM ai.agent_anomaly_flags
           WHERE (tenant_id = $1 OR tenant_id = 'default') AND status = 'OPEN'
           GROUP BY severity`,
          tenantId,
        ),
        tx.$queryRawUnsafe<Array<{ stream_type: string; count: bigint; total_exposure: number }>>(
          `SELECT COALESCE(stream_type, 'VENDOR_INVOICE') AS stream_type, COUNT(*) AS count, COALESCE(SUM(financial_exposure_aed), 0)::float8 AS total_exposure
           FROM ai.agent_anomaly_flags
           WHERE (tenant_id = $1 OR tenant_id = 'default') AND status = 'OPEN'
           GROUP BY stream_type`,
          tenantId,
        ),
      ]);

      const openCounts = Object.fromEntries(
        summaryRows.map((r) => [r.severity.toLowerCase(), Number(r.count)]),
      );

      const streamCounts = Object.fromEntries(
        streamSummaryRows.map((r) => [r.stream_type, { count: Number(r.count), exposure: Number(r.total_exposure) }]),
      );

      const totalExposureAed = summaryRows.reduce((sum, r) => sum + Number(r.total_exposure ?? 0), 0);

      return NextResponse.json({
        data: rows.map(rowToCamel),
        total: Number(countRows[0]?.count ?? 0),
        limit,
        offset,
        openCounts,
        streamCounts,
        totalExposureAed: parseFloat(totalExposureAed.toFixed(2)),
      });
    } catch (err) {
      console.error('[agents/anomalies GET]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await ensureAgentSchema();
    try {
      const bodyRaw = await req.json() as {
        id: string;
        status?: 'OPEN' | 'REVIEWED' | 'FALSE_POSITIVE' | 'CONFIRMED_ISSUE';
        actionType?: string;
        actionNote?: string;
        reviewedBy?: string;
      };
      const body = stripTenantOwnershipFields(bodyRaw);

      if (!body.id) {
        return NextResponse.json({ error: 'Flag ID is required' }, { status: 400 });
      }

      const newStatus = body.status ?? (body.actionType === 'DISMISS' ? 'FALSE_POSITIVE' : 'CONFIRMED_ISSUE');
      const actionTaken = body.actionType ? `${body.actionType}: ${body.actionNote ?? 'Action executed via Finance Control Layer'}` : undefined;

      await tx.$executeRawUnsafe(
        `UPDATE ai.agent_anomaly_flags
         SET status = $1,
             reviewed_by = $2,
             reviewed_at = NOW(),
             action_taken = COALESCE($3, action_taken),
             action_taken_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE action_taken_at END,
             action_taken_by = CASE WHEN $3 IS NOT NULL THEN $2 ELSE action_taken_by END
         WHERE id = $4::uuid`,
        newStatus,
        body.reviewedBy ?? 'Finance Controller',
        actionTaken ?? null,
        body.id,
      );

      return NextResponse.json({
        ok: true,
        message: `Anomaly ${body.id} updated to ${newStatus}${actionTaken ? ` with action ${body.actionType}` : ''}.`,
      });
    } catch (err) {
      console.error('[agents/anomalies PATCH]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
