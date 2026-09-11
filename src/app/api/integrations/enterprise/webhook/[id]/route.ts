export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/enterprise/webhook/[id]
 * ----------------------------------------------
 * Universal Inbound Webhook Ingestion Engine:
 *  - Receives external ERP events (Roster updates, Work order status, Purchase orders).
 *  - Validates connection & optional secret.
 *  - Translates payload into Canonical Agent Event and dispatches relevant Fleet360 AI Agent.
 */
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { dispatch } from '@/lib/agents/orchestrator';

export const runtime = 'nodejs';

function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureAgentSchema();
  const connectionId = params.id;

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

    // ── Enforce Authentication on Webhook Calls ──────────────────────────────
    // Resolve expected secrets from auth_credentials or connection headers
    const creds = typeof connection.auth_credentials === 'string'
      ? JSON.parse(connection.auth_credentials)
      : (connection.auth_credentials || {});
    const customHeaders = typeof connection.headers === 'string'
      ? JSON.parse(connection.headers)
      : (connection.headers || {});

    const expectedSecret =
      creds.webhookSecret ||
      creds.apiKey ||
      creds.token ||
      creds.secret ||
      customHeaders['x-webhook-secret'] ||
      process.env.ENTERPRISE_WEBHOOK_SECRET;

    if (expectedSecret) {
      const incomingSecret =
        req.headers.get('x-webhook-secret') ||
        req.headers.get('x-api-key') ||
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
        req.nextUrl.searchParams.get('secret');

      if (!incomingSecret || !safeCompare(incomingSecret, expectedSecret)) {
        return NextResponse.json(
          { error: 'Unauthorized enterprise webhook request' },
          { status: 401 }
        );
      }
    }

    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody) as Record<string, any>;

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
    if (body.targetAgent) {
      await dispatch({
        agent_id: body.targetAgent,
        tenant_id: tenantId,
        event_type: 'enterprise.external_event',
        entity_id: body.entityId,
        metadata: { sourceSystem: connection.system_type, payload: body },
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
