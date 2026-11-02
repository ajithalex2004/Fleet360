export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/enterprise/connections/[id]/webhook-secret
 * ------------------------------------------------------------------
 * Issues a new inbound webhook secret for one of the caller's tenant's
 * connections and returns it once. The previous secret stops working
 * immediately. Connections created before secrets were issued have none,
 * and their webhooks are refused until one is created here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { generateWebhookSecret } from '@/lib/agents/enterprise-bridge/connection-secrets';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handlePOST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  const webhookSecret = generateWebhookSecret();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE enterprise_connections
            SET auth_credentials = COALESCE(auth_credentials, '{}'::jsonb) || jsonb_build_object('webhookSecret', $1::text)
          WHERE id = $2::uuid AND tenant_id = $3
          RETURNING id::text`,
        webhookSecret,
        id,
        tenantId,
      );
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, connectionId: rows[0].id, webhookSecret });
    } catch (err: unknown) {
      console.error('[enterprise/connections/:id/webhook-secret POST]', err);
      return NextResponse.json({ error: 'Failed to rotate webhook secret' }, { status: 500 });
    }
  });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
