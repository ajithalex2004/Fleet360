export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/enterprise/sync
 * ---------------------------------------
 * Triggers an outbound sync of a canonical entity through Enterprise Bridge Agent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
// dispatch(), not the agent's run(): the budget caps, circuit breaker and
// disabledAgents apply, and the run is recorded in agent_runs.
import { dispatch } from '@/lib/agents/orchestrator';
import { CanonicalEntityType } from '@/lib/agents/types';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const body = await req.json();
      const { entityType, entityId, payload } = body as {
        entityType: CanonicalEntityType;
        entityId: string;
        payload: any;
      };

      if (!entityType || !entityId || !payload) {
        return NextResponse.json(
          { error: 'entityType, entityId, and payload are required' },
          { status: 400 }
        );
      }

      const runResult = await dispatch({
        agent_id: 'enterprise-bridge',
        tenant_id: tenantId,
        event_type: 'enterprise.sync',
        entity_id: entityId,
        payload: { entityType, payload },
      });

      return NextResponse.json(runResult);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
