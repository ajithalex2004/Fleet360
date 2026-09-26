export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/run
 * --------------------
 * Manual trigger endpoint — used by "Run Analysis" buttons in the UI.
 * Body: { agent_id: AgentId, entity_id?: string, async?: boolean } — always runs for the caller's tenant
 *
 * By default the response is the finished AgentRunResult. A full scan can
 * take longer than the proxy in front of the app waits (finance-anomaly
 * takes ~30 s), which surfaced as a 502 even though the run completed. With
 * `async: true` the endpoint answers 202 { runId, status: 'RUNNING' } as
 * soon as the run is recorded, and the caller polls
 * GET /api/agents/run?run_id=<runId> until status is no longer RUNNING.
 */
import { after, NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runWithTenantContext } from '@/lib/rls-scope';
import { startFullScan, triggerFullScan } from '@/lib/agents/orchestrator';
import { AgentId } from '@/lib/agents/types';
import { ensureAgentSchema } from '@/lib/agents/schema';

import { requireAuthorizedTenant } from '@/lib/tenant-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureAgentSchema();
  try {
    // A tenant_id in the body is ignored: the scan always runs for the
    // caller's own session tenant. It used to take precedence, letting any
    // user start an agent scan against another tenant.
    const { agent_id, async: runAsync } = await req.json() as { agent_id: AgentId; async?: boolean };

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    if (runAsync) {
      // The agent keeps running after this response is sent, when the
      // request's headers may no longer be readable, so pin the tenant for
      // its queries explicitly.
      const run = await runWithTenantContext(tenantId, () => startFullScan(agent_id, tenantId));
      if (run.kind === 'rejected') {
        return NextResponse.json(run.result, { status: 500 });
      }
      after(run.settled);
      return NextResponse.json({ runId: run.runId, agentId: agent_id, status: 'RUNNING' }, { status: 202 });
    }

    const result = await triggerFullScan(agent_id, tenantId);
    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 });
    } catch (err) {
    console.error('[agents/run]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * GET /api/agents/run?run_id=<uuid>
 * ---------------------------------
 * Status of a run started with `async: true`, in the same shape as the
 * synchronous POST response plus `runId`. Only the caller's tenant's runs
 * are visible.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const runId = req.nextUrl.searchParams.get('run_id') ?? '';
  if (!UUID_RE.test(runId)) {
    return NextResponse.json({ error: 'run_id must be a UUID' }, { status: 400 });
  }

  try {
    const rows = await prisma.$queryRawUnsafe<{
      id: string; agent_id: string; tenant_id: string; event_type: string; entity_id: string | null;
      status: string; duration_ms: number | null; items_processed: number | null;
      actions_created: number | null; output: unknown; error_text: string | null;
    }[]>(
      `SELECT id::text, agent_id, tenant_id, event_type, entity_id, status, duration_ms,
              items_processed, actions_created, output, error_text
       FROM agent_runs WHERE id = $1::uuid AND tenant_id = $2`,
      runId,
      tenantId,
    );
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    return NextResponse.json({
      runId:          row.id,
      agentId:        row.agent_id,
      tenantId:       row.tenant_id,
      eventType:      row.event_type,
      entityId:       row.entity_id ?? undefined,
      status:         row.status,
      durationMs:     row.duration_ms ?? 0,
      itemsProcessed: row.items_processed ?? 0,
      actionsCreated: row.actions_created ?? 0,
      output:         row.status === 'RUNNING' ? null : row.output,
      error:          row.error_text ?? undefined,
    });
  } catch (err) {
    console.error('[agents/run GET]', err);
    return NextResponse.json({ error: 'Failed to read run status' }, { status: 500 });
  }
}
