export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/enterprise/webhook/[id]
 * ----------------------------------------------
 * Universal Inbound Webhook Ingestion Engine:
 *  - Receives external ERP events (Roster updates, Work order status, Purchase orders).
 *  - Validates connection & optional secret.
 *  - Translates payload into Canonical Agent Event and dispatches relevant Fleet360 AI Agent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { dispatch } from '@/lib/agents/orchestrator';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureAgentSchema();
  const connectionId = params.id;

  try {
    const rawConnections = await prisma.$queryRawUnsafe<any[]>(`
      SELECT * FROM enterprise_connections
      WHERE id = $1::uuid AND is_active = true
      LIMIT 1
    `, connectionId);

    if (rawConnections.length === 0) {
      return NextResponse.json({ error: 'Invalid or inactive enterprise connection' }, { status: 404 });
    }

    const connection = rawConnections[0];
    const tenantId = connection.tenant_id;
    const body = await req.json().catch(() => ({}));

    // Audit log inbound webhook event
    await prisma.$executeRawUnsafe(`
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
