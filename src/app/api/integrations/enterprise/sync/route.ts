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
import { ENTERPRISE_BRIDGE_AGENT } from '@/lib/agents/enterprise-bridge/agent';
import { CanonicalEntityType } from '@/lib/agents/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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

      const runResult = await ENTERPRISE_BRIDGE_AGENT.run({
        agent_id: 'enterprise-bridge',
        tenant_id: tenantId,
        event_type: 'enterprise.sync',
        entity_id: entityId,
        metadata: { entityType, payload },
      });

      return NextResponse.json(runResult);
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  });
}
