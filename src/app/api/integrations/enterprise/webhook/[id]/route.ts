export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/enterprise/webhook/[id]
 * ----------------------------------------------
 * Universal Inbound Webhook Ingestion Engine:
 *  - Receives external ERP events (Roster updates, Work order status, Purchase orders).
 *  - Requires the connection's own webhook secret (x-webhook-secret or Bearer).
 *  - Translates payload into Canonical Agent Event and dispatches relevant Fleet360 AI Agent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { dispatch } from '@/lib/agents/orchestrator';
import { getAgentsForEvent } from '@/lib/agents/registry';
import type { AgentId } from '@/lib/agents/types';
import { secretsMatch, webhookSecretOf } from '@/lib/agents/enterprise-bridge/connection-secrets';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureAgentSchema();
  const { id: connectionId } = await params;

  try {
    const rawConnections = await withPlatformAdmin(prisma, (tx) =>
      tx.$queryRawUnsafe<any[]>(`
        SELECT * FROM enterprise_connections
        WHERE id = $1::uuid AND is_active = true
        LIMIT 1
      `, connectionId)
    );

    if (rawConnections.length === 0) {
      return NextResponse.json({ error: 'Invalid or inactive enterprise connection' }, { status: 404 });
    }

    const connection = rawConnections[0];
    const tenantId = connection.tenant_id;

    // ── Authentication: the connection's own webhook secret, always ─────────
    // It used to accept the ERP's API key or token, a header value, or a
    // server-wide env secret, and to skip the check entirely when none was
    // set, so a connection without a secret took unauthenticated requests.
    // The secret is read from headers only: a ?secret= query parameter ends
    // up in access logs.
    const expectedSecret = webhookSecretOf(connection.auth_credentials);
    if (!expectedSecret) {
      return NextResponse.json(
        { error: 'Unauthorized enterprise webhook request', message: 'This connection has no webhook secret. Rotate one in Fleet360 to receive webhooks.' },
        { status: 401 }
      );
    }
    const incomingSecret =
      req.headers.get('x-webhook-secret') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';
    if (!incomingSecret || !secretsMatch(incomingSecret, expectedSecret)) {
      return NextResponse.json(
        { error: 'Unauthorized enterprise webhook request' },
        { status: 401 }
      );
    }

    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody) as Record<string, any>;

    // Only agents that handle inbound ERP events may be named; any other
    // agent id used to be dispatched as given.
    let dispatchAgent: AgentId | null = null;
    if (body.targetAgent !== undefined) {
      const allowed: string[] = (await getAgentsForEvent('enterprise.external_event')).map((a) => a.id);
      if (typeof body.targetAgent !== 'string' || !allowed.includes(body.targetAgent)) {
        return NextResponse.json(
          { error: 'Bad Request', message: `targetAgent must be one of: ${allowed.join(', ') || '(none)'}` },
          { status: 400 }
        );
      }
      dispatchAgent = body.targetAgent as AgentId;
    }

    // Audit log inbound webhook event under tenant RLS
    await withTenantRls(prisma, tenantId, async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO enterprise_sync_logs (
          tenant_id, connection_id, system_type, entity_type, direction,
          entity_id, status, request_payload, response_payload, duration_ms
        ) VALUES (
          $1, $2::uuid, $3, $4, 'INBOUND',
          $5, 'SUCCESS', $6::jsonb, $7::jsonb, 0
        )
      `,
        tenantId,
        connection.id,
        connection.system_type,
        body.entityType || 'ROSTER',
        body.entityId || `WEBHOOK-${Date.now()}`,
        JSON.stringify(body),
        JSON.stringify({ received: true, timestamp: new Date().toISOString() })
      ).catch(() => {});
    });

    // Dispatch to Agent Orchestrator if actionable event
    if (dispatchAgent) {
      await dispatch({
        agent_id: dispatchAgent,
        tenant_id: tenantId,
        event_type: 'enterprise.external_event',
        entity_id: body.entityId,
        // AgentEvent only has a `payload` field (no `metadata`); the
        // enterprise-bridge agent already expects event.payload.payload
        // to be the caller-supplied entity body (see agent.ts:99-103).
        payload: { sourceSystem: connection.system_type, payload: body },
      }).catch((e) => console.warn('[EnterpriseWebhook] Dispatch failed:', e));
    }

    return NextResponse.json({
      success: true,
      connectionId,
      systemName: connection.system_name,
      message: 'Inbound ERP event ingested and queued for agent execution.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
