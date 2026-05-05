/**
 * POST /api/agents/run
 * --------------------
 * Manual trigger endpoint — used by "Run Analysis" buttons in the UI.
 * Body: { agent_id: AgentId, entity_id?: string, tenant_id?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { triggerFullScan } from '@/lib/agents/orchestrator';
import { AgentId } from '@/lib/agents/types';
import { ensureAgentSchema } from '@/lib/agents/schema';

export async function POST(req: NextRequest) {
  await ensureAgentSchema();
  try {
    const { agent_id, tenant_id } = await req.json() as { agent_id: AgentId; tenant_id?: string };

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    const result = await triggerFullScan(agent_id, tenant_id ?? 'default');
    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 });
  } catch (err) {
    console.error('[agents/run]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
