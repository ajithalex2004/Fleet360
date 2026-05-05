/**
 * POST /api/agents/ingest
 * -----------------------
 * Universal webhook entry point for the standalone plugin.
 * Any external fleet platform sends an AgentEvent here.
 * The orchestrator routes it to the correct agent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { dispatch } from '@/lib/agents/orchestrator';
import { AgentEvent } from '@/lib/agents/types';
import { ensureAgentSchema } from '@/lib/agents/schema';

export async function POST(req: NextRequest) {
  await ensureAgentSchema();
  try {
    const body = await req.json() as AgentEvent;

    if (!body.agent_id || !body.event_type || !body.tenant_id) {
      return NextResponse.json(
        { error: 'agent_id, event_type, and tenant_id are required' },
        { status: 400 },
      );
    }

    // For async (callback_url provided), fire and return 202
    if (body.callback_url) {
      dispatch(body).then(async (result) => {
        try {
          await fetch(body.callback_url!, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(result),
          });
        } catch { /* best-effort callback */ }
      });
      return NextResponse.json({ accepted: true, message: 'Agent dispatched asynchronously' }, { status: 202 });
    }

    // Synchronous — wait for result
    const result = await dispatch(body);
    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 });
  } catch (err) {
    console.error('[agents/ingest]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
