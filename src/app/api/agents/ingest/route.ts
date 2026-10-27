export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/ingest
 * -----------------------
 * Universal webhook entry point for the standalone plugin.
 * Any external fleet platform sends an AgentEvent here.
 * The orchestrator routes it to the correct agent.
 *
 * The event always runs for the caller's authorized tenant: a body tenant_id
 * that differs is refused, and every query the agent makes is scoped to that
 * tenant (runAsTenant). callback_url is checked by validateCallbackUrl —
 * https, allowlisted host, public addresses only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { dispatch } from '@/lib/agents/orchestrator';
import { AgentEvent } from '@/lib/agents/types';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { sendCallback, validateCallbackUrl } from '@/lib/agents/callback-url';
import { runAsTenant } from '@/lib/rls-scope';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureAgentSchema();
  try {
    const raw = await req.json() as Partial<AgentEvent> | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Request body must be an AgentEvent object' }, { status: 400 });
    }

    if (raw.tenant_id !== undefined && raw.tenant_id !== tenantId) {
      return NextResponse.json({ error: 'tenant_id does not match the authorized tenant' }, { status: 403 });
    }

    // run_id is always assigned by the orchestrator; api_key is not ours to forward.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { run_id, api_key, ...rest } = stripTenantOwnershipFields(raw);
    const event = { ...rest, tenant_id: tenantId } as AgentEvent;

    if (!event.agent_id || !event.event_type) {
      return NextResponse.json(
        { error: 'agent_id and event_type are required' },
        { status: 400 },
      );
    }

    // For async (callback_url provided), fire and return 202
    if (event.callback_url !== undefined) {
      const check = await validateCallbackUrl(event.callback_url);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }
      runAsTenant(tenantId, () => dispatch(event))
        .then((result) => sendCallback(check.url, result))
        .catch((err) => console.error('[agents/ingest] async dispatch/callback failed:', err));
      return NextResponse.json({ accepted: true, message: 'Agent dispatched asynchronously' }, { status: 202 });
    }

    // Synchronous — wait for result
    const result = await runAsTenant(tenantId, () => dispatch(event));
    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 });
  } catch (err) {
    console.error('[agents/ingest]', err);
    return NextResponse.json({ error: 'Agent dispatch failed' }, { status: 500 });
  }
}
