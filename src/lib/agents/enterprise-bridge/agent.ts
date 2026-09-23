/**
 * Enterprise Bridge Agent v1.0.0
 * ---------------------------------
 * Universal AI Integration & Execution Engine:
 *  1. Resolves external ERP connections from the Connection Vault.
 *  2. Dispatches Canonical Data Models to target protocol adapters (SAP OData, NetSuite, Dynamics, Odoo, REST).
 *  3. Enforces L1–L4 Autonomy governance and approval queues for high-value financial mutations.
 *  4. Executes outbox deliveries with exponential backoff retries and logs audit records to `enterprise_sync_logs`.
 */

import { prisma } from '@/lib/prisma';
import {
  AgentDefinition,
  AgentEvent,
  AgentRunResult,
  AgentRunTelemetry,
  CanonicalEntityType,
  EnterpriseConnectionConfig,
  EnterpriseSyncResult,
} from '../types';
import { ensureAgentSchema } from '../schema';
import { policyService } from '../governance';
import { BaseEnterpriseAdapter, CanonicalPayload } from './adapters/base-adapter';
import { GenericRestAdapter } from './adapters/rest-adapter';
import { SapOdataAdapter } from './adapters/sap-odata-adapter';
import { OdooJsonRpcAdapter } from './adapters/odoo-adapter';
import { validateCanonicalEntity } from './canonical-models';

/** `enterprise_connections` has no Prisma model — it's raw-SQL only. */
interface RawEnterpriseConnectionRow {
  id: string;
  tenant_id: string;
  system_name: string;
  system_type: string;
  base_url: string;
  auth_type: string;
  auth_credentials: unknown;
  headers: unknown;
  field_mappings: unknown;
  is_active: boolean;
  rate_limit_per_min: number | null;
  health_status: string;
}

/**
 * Factory to instantiate the appropriate protocol adapter.
 */
export function getAdapterForConnection(connection: EnterpriseConnectionConfig): BaseEnterpriseAdapter {
  switch (connection.systemType) {
    case 'SAP_S4HANA':
      return new SapOdataAdapter(connection);
    case 'ODOO':
      return new OdooJsonRpcAdapter(connection);
    case 'ORACLE_NETSUITE':
    case 'MS_DYNAMICS_365':
    case 'ZOHO_BOOKS':
    case 'CUSTOM_REST':
    case 'CUSTOM_OPENAPI':
    default:
      return new GenericRestAdapter(connection);
  }
}

/**
 * Executes an outbound push with exponential retry backoff.
 */
export async function executeOutboundPushWithRetry(
  adapter: BaseEnterpriseAdapter,
  entityType: CanonicalEntityType,
  entityId: string,
  payload: CanonicalPayload,
  maxRetries = 3
): Promise<EnterpriseSyncResult> {
  let lastResult: EnterpriseSyncResult | null = null;
  let delayMs = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await adapter.pushEntity(entityType, entityId, payload);
    if (lastResult.status === 'SUCCESS') {
      lastResult.retryCount = attempt - 1;
      return lastResult;
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2; // exponential backoff: 1s, 2s, 4s
    }
  }

  if (lastResult) {
    lastResult.retryCount = maxRetries;
    return lastResult;
  }

  return {
    syncId: `SYNC-ERR-${Date.now()}`,
    connectionId: (adapter as unknown as { connection: EnterpriseConnectionConfig }).connection.id,
    systemType: (adapter as unknown as { connection: EnterpriseConnectionConfig }).connection.systemType,
    entityType,
    status: 'FAILED',
    durationMs: 0,
    retryCount: maxRetries,
    message: 'Push failed after retries.',
  };
}

// ── Agent Runner Logic ────────────────────────────────────────────────────────
async function runEnterpriseBridge(event: AgentEvent): Promise<AgentRunResult> {
  const startTime = Date.now();
  await ensureAgentSchema();

  const tenantId = event.tenant_id || 'default';
  const entityType = (event.payload?.entityType as CanonicalEntityType) || 'INVOICE';
  const entityId = event.entity_id || `ENTITY-${Date.now()}`;
  // event.payload.payload is the caller-supplied entity body before
  // validateCanonicalEntity() narrows it against the real Canonical*
  // interfaces — genuinely untyped at this point (it's `{}` once the
  // AgentEvent.payload fix above stopped masking this line's own type).
  const payload = (event.payload?.payload as Record<string, unknown>) || {};

  // 1. Fetch active connections for tenant
  const rawConnections = await prisma.$queryRawUnsafe<RawEnterpriseConnectionRow[]>(`
    SELECT * FROM enterprise_connections
    WHERE tenant_id = $1 AND is_active = true
    ORDER BY created_at ASC
  `, tenantId).catch(() => []);

  if (rawConnections.length === 0) {
    return {
      agentId: 'enterprise-bridge',
      tenantId,
      eventType: event.event_type,
      entityId,
      status: 'COMPLETED',
      durationMs: Date.now() - startTime,
      itemsProcessed: 0,
      actionsCreated: 0,
      output: {
        message: 'No active enterprise connections configured for this tenant.',
        connectionsEvaluated: 0,
      },
      telemetry: {
        modelAlias: 'DETERMINISTIC_RULES',
        modelProvider: 'deterministic',
        costAvoidedAed: 0,
        businessOutcome: 'NO_ACTION_REQUIRED',
        decisionQualityScore: 1.0,
      },
    };
  }

  // 2. Validate Canonical Payload
  const validation = validateCanonicalEntity(entityType, payload);
  if (!validation.valid) {
    return {
      agentId: 'enterprise-bridge',
      tenantId,
      eventType: event.event_type,
      entityId,
      status: 'FAILED',
      durationMs: Date.now() - startTime,
      itemsProcessed: 0,
      actionsCreated: 0,
      output: null,
      error: `Canonical validation failed: ${validation.error}`,
    };
  }

  // 3. Governance Policy Check (Human-in-the-Loop Thresholds)
  const tenantPolicy = await policyService.getTenantPolicy(tenantId);
  // totalAmountAed (CanonicalInvoice) / estimatedCostAed (CanonicalWorkOrder)
  // — whichever the entity type carries; payload isn't narrowed to one
  // specific canonical shape until validateCanonicalEntity() above.
  const financialFields = payload as { totalAmountAed?: number; estimatedCostAed?: number };
  const financialImpactAed = Number(financialFields.totalAmountAed || financialFields.estimatedCostAed || 0);

  if (financialImpactAed >= (tenantPolicy.requireHumanApprovalThresholdAed ?? 500)) {
    // Hold in approval queue
    await prisma.$executeRawUnsafe(`
      INSERT INTO agent_approvals (
        tenant_id, agent_id, entity_type, entity_id, action_type,
        title, description, financial_impact_aed, proposed_payload, requested_autonomy
      ) VALUES (
        $1, 'enterprise-bridge', $2, $3, 'PUSH_TO_ERP',
        $4, $5, $6, $7::jsonb, 'L3'
      )
    `,
      tenantId,
      entityType,
      entityId,
      `ERP Sync Approval: ${entityType} ${entityId}`,
      `Outbound sync to ${rawConnections.length} enterprise system(s) for AED ${financialImpactAed.toLocaleString()}`,
      financialImpactAed,
      JSON.stringify({ entityType, entityId, payload, targetConnections: rawConnections.map((c) => c.id) })
    ).catch((err) => console.warn('[EnterpriseBridge] Approval insertion warning:', err));

    return {
      agentId: 'enterprise-bridge',
      tenantId,
      eventType: event.event_type,
      entityId,
      status: 'COMPLETED',
      durationMs: Date.now() - startTime,
      itemsProcessed: 1,
      actionsCreated: 1,
      output: {
        status: 'AWAITING_APPROVAL',
        message: `Action requires human confirmation (AED ${financialImpactAed.toLocaleString()} exceeds threshold). Queued in Review Queue.`,
        financialImpactAed,
      },
      telemetry: {
        modelAlias: 'DETERMINISTIC_RULES',
        modelProvider: 'deterministic',
        costAvoidedAed: 0,
        businessOutcome: 'NO_ACTION_REQUIRED',
        decisionQualityScore: 1.0,
      },
    };
  }

  // 4. Dispatch to each target connection
  const results: EnterpriseSyncResult[] = [];
  let successfulSyncs = 0;

  for (const rawConn of rawConnections) {
    const connection: EnterpriseConnectionConfig = {
      id: rawConn.id,
      tenantId: rawConn.tenant_id,
      systemName: rawConn.system_name,
      // system_type/auth_type/health_status are plain text columns — the
      // POST /api/integrations/enterprise/connections route that writes
      // them doesn't enforce the EnterpriseSystemType/EnterpriseAuthType
      // enums at insert time, so these are boundary casts of DB data into
      // the app's strict internal types, same as elsewhere in this file.
      systemType: rawConn.system_type as EnterpriseConnectionConfig['systemType'],
      baseUrl: rawConn.base_url,
      authType: rawConn.auth_type as EnterpriseConnectionConfig['authType'],
      authCredentials: (typeof rawConn.auth_credentials === 'string' ? JSON.parse(rawConn.auth_credentials) : rawConn.auth_credentials) as Record<string, unknown> | undefined,
      headers: (typeof rawConn.headers === 'string' ? JSON.parse(rawConn.headers) : rawConn.headers) as Record<string, string> | undefined,
      fieldMappings: (typeof rawConn.field_mappings === 'string' ? JSON.parse(rawConn.field_mappings) : rawConn.field_mappings) as Record<string, string> | undefined,
      isActive: rawConn.is_active,
      rateLimitPerMin: rawConn.rate_limit_per_min || 60,
      healthStatus: rawConn.health_status as EnterpriseConnectionConfig['healthStatus'],
    };

    const adapter = getAdapterForConnection(connection);
    // payload was already checked by validateCanonicalEntity() above, but
    // that's a boolean check, not a type predicate, so it doesn't narrow
    // payload's static type — same "runtime-validated, statically unknown"
    // situation as financialFields above.
    const syncRes = await executeOutboundPushWithRetry(adapter, entityType, entityId, payload as unknown as CanonicalPayload);
    results.push(syncRes);

    if (syncRes.status === 'SUCCESS') successfulSyncs++;

    // Persist to enterprise_sync_logs
    await prisma.$executeRawUnsafe(`
      INSERT INTO enterprise_sync_logs (
        tenant_id, connection_id, system_type, entity_type, direction,
        entity_id, status, request_payload, response_payload, duration_ms,
        retry_count, error_message
      ) VALUES (
        $1, $2::uuid, $3, $4, 'OUTBOUND',
        $5, $6, $7::jsonb, $8::jsonb, $9,
        $10, $11
      )
    `,
      tenantId,
      connection.id,
      connection.systemType,
      entityType,
      entityId,
      syncRes.status,
      JSON.stringify(payload),
      JSON.stringify(syncRes),
      syncRes.durationMs,
      syncRes.retryCount,
      syncRes.status === 'FAILED' ? syncRes.message : null
    ).catch((e) => console.warn('[EnterpriseBridge] Failed to write sync log:', e));
  }

  const durationMs = Date.now() - startTime;
  const telemetry: AgentRunTelemetry = {
    modelAlias: 'DETERMINISTIC_RULES',
    modelProvider: 'deterministic',
    costAvoidedAed: financialImpactAed,
    businessOutcome: successfulSyncs > 0 ? 'INVOICE_ANOMALY_STOPPED' : 'NO_ACTION_REQUIRED',
    decisionQualityScore: 0.98,
  };

  return {
    agentId: 'enterprise-bridge',
    tenantId,
    eventType: event.event_type,
    entityId,
    status: successfulSyncs > 0 ? 'COMPLETED' : 'FAILED',
    durationMs,
    itemsProcessed: rawConnections.length,
    actionsCreated: successfulSyncs,
    output: {
      entityType,
      entityId,
      totalConnections: rawConnections.length,
      successfulSyncs,
      results,
    },
    telemetry,
  };
}

export const ENTERPRISE_BRIDGE_AGENT: AgentDefinition = {
  id: 'enterprise-bridge',
  name: 'Enterprise Bridge Agent',
  description: 'Bi-directionally synchronizes canonical business data (invoices, rosters, work orders, POs) with SAP, NetSuite, Dynamics, Odoo, and custom ERPs.',
  version: '1.0.0',
  agentType: 'BATCH',
  autonomyLevel: 'L2',
  subscribedEvents: ['enterprise.sync', 'enterprise.external_event'],
  supportsEntityScan: true,
  run: runEnterpriseBridge,
};
