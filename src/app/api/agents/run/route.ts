export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/run
 * --------------------
 * Manual trigger endpoint — used by "Run Analysis" buttons in the UI.
 * Body: { agent_id: AgentId, entity_id?: string } — always runs for the caller's tenant
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { triggerFullScan } from '@/lib/agents/orchestrator';
import { AgentId } from '@/lib/agents/types';
import { ensureAgentSchema } from '@/lib/agents/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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
    const { agent_id } = await req.json() as { agent_id: AgentId };

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    const result = await triggerFullScan(agent_id, tenantId);
    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 });
    } catch (err) {
    console.error('[agents/run]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
