export const dynamic = 'force-dynamic';

/**
 * GET & POST /api/integrations/enterprise/connections
 * ----------------------------------------------------
 * Manage multi-tenant enterprise ERP connections (SAP, NetSuite, Dynamics, Odoo, REST).
 *
 * Responses never contain auth_credentials or header values. A new
 * connection gets its own inbound webhook secret, returned once in the
 * POST response (rotate it with POST .../connections/[id]/webhook-secret).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { getAdapterForConnection } from '@/lib/agents/enterprise-bridge/agent';
import { checkErpUrl } from '@/lib/agents/enterprise-bridge/erp-fetch';
import { generateWebhookSecret, toPublicConnection } from '@/lib/agents/enterprise-bridge/connection-secrets';
import { EnterpriseConnectionConfig } from '@/lib/agents/types';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const connections = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`
        SELECT * FROM enterprise_connections
        WHERE tenant_id = $1
        ORDER BY created_at DESC
      `, tenantId);

      return NextResponse.json({ connections: connections.map(toPublicConnection) });
    } catch (err: unknown) {
      console.error('[enterprise/connections GET]', err);
      return NextResponse.json({ error: 'Failed to load connections' }, { status: 500 });
    }
  });
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const {
    systemName,
    systemType,
    baseUrl,
    authType = 'API_KEY',
    authCredentials = {},
    headers = {},
    fieldMappings = {},
    rateLimitPerMin = 60,
    testNow = true,
  } = body as {
    systemName?: string;
    systemType?: EnterpriseConnectionConfig['systemType'];
    baseUrl?: string;
    authType?: EnterpriseConnectionConfig['authType'];
    authCredentials?: Record<string, unknown>;
    headers?: Record<string, string>;
    fieldMappings?: Record<string, string>;
    rateLimitPerMin?: number;
    testNow?: boolean;
  };

  if (!systemName || !systemType || !baseUrl) {
    return NextResponse.json({ error: 'systemName, systemType, and baseUrl are required' }, { status: 400 });
  }
  // https, public host. The address itself is checked again on every
  // request the adapters make (erp-fetch.ts).
  const urlCheck = checkErpUrl(baseUrl);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  }

  // The inbound webhook secret is Fleet360's to issue, never the caller's.
  const webhookSecret = generateWebhookSecret();
  const credentials = { ...(authCredentials && typeof authCredentials === 'object' ? authCredentials : {}), webhookSecret };

  let healthStatus = 'UNTESTED';
  let healthMessage = 'Connection saved without test.';
  if (testNow) {
    const adapter = getAdapterForConnection({
      id: 'TEMP',
      tenantId,
      systemName,
      systemType,
      baseUrl,
      authType,
      authCredentials: credentials,
      headers,
      fieldMappings,
      isActive: true,
      rateLimitPerMin,
      healthStatus: 'UNTESTED',
    });
    // Outside the database transaction: a slow ERP must not hold a connection.
    const testRes = await adapter.testConnection();
    healthStatus = testRes.success ? 'HEALTHY' : 'ERROR';
    healthMessage = testRes.message;
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`
        INSERT INTO enterprise_connections (
          tenant_id, system_name, system_type, base_url, auth_type,
          auth_credentials, headers, field_mappings, rate_limit_per_min,
          health_status, health_message, is_active
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::jsonb, $7::jsonb, $8::jsonb, $9,
          $10, $11, true
        )
        RETURNING *
      `,
        tenantId,
        systemName,
        systemType,
        urlCheck.url.toString(),
        authType,
        JSON.stringify(credentials),
        JSON.stringify(headers),
        JSON.stringify(fieldMappings),
        rateLimitPerMin,
        healthStatus,
        healthMessage
      );

      return NextResponse.json({
        success: true,
        connection: toPublicConnection(rows[0]),
        // Shown once: configure it as the ERP's x-webhook-secret header.
        webhookSecret,
        testResult: { healthStatus, healthMessage },
      });
    } catch (err: unknown) {
      console.error('[enterprise/connections POST]', err);
      return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
    }
  });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
