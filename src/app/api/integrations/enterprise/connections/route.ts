export const dynamic = 'force-dynamic';

/**
 * GET & POST /api/integrations/enterprise/connections
 * ----------------------------------------------------
 * Manage multi-tenant enterprise ERP connections (SAP, NetSuite, Dynamics, Odoo, REST).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { getAdapterForConnection } from '@/lib/agents/enterprise-bridge/agent';
import { EnterpriseConnectionConfig } from '@/lib/agents/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const connections = await prisma.$queryRawUnsafe<any[]>(`
        SELECT * FROM enterprise_connections
        WHERE tenant_id = $1
        ORDER BY created_at DESC
      `, tenantId);

      // Mask sensitive credentials
      const sanitized = connections.map((c) => ({
        id: c.id,
        tenantId: c.tenant_id,
        systemName: c.system_name,
        systemType: c.system_type,
        baseUrl: c.base_url,
        authType: c.auth_type,
        headers: typeof c.headers === 'string' ? JSON.parse(c.headers) : c.headers,
        fieldMappings: typeof c.field_mappings === 'string' ? JSON.parse(c.field_mappings) : c.field_mappings,
        isActive: c.is_active,
        rateLimitPerMin: c.rate_limit_per_min,
        healthStatus: c.health_status,
        healthMessage: c.health_message,
        lastSyncAt: c.last_sync_at,
        createdAt: c.created_at,
      }));

      return NextResponse.json({ connections: sanitized });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  });
}

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
      } = body;

      if (!systemName || !systemType || !baseUrl) {
        return NextResponse.json({ error: 'systemName, systemType, and baseUrl are required' }, { status: 400 });
      }

      let healthStatus = 'UNTESTED';
      let healthMessage = 'Connection saved without test.';

      const tempConfig: EnterpriseConnectionConfig = {
        id: 'TEMP',
        tenantId,
        systemName,
        systemType,
        baseUrl,
        authType,
        authCredentials,
        headers,
        fieldMappings,
        isActive: true,
        rateLimitPerMin,
        healthStatus: 'UNTESTED',
      };

      if (testNow) {
        const adapter = getAdapterForConnection(tempConfig);
        const testRes = await adapter.testConnection();
        healthStatus = testRes.success ? 'HEALTHY' : 'ERROR';
        healthMessage = testRes.message;
      }

      const rows = await prisma.$queryRawUnsafe<any[]>(`
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
        baseUrl,
        authType,
        JSON.stringify(authCredentials),
        JSON.stringify(headers),
        JSON.stringify(fieldMappings),
        rateLimitPerMin,
        healthStatus,
        healthMessage
      );

      return NextResponse.json({
        success: true,
        connection: rows[0],
        testResult: { healthStatus, healthMessage },
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  });
}
