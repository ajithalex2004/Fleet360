/**
 * Webhook Notification Dispatcher for Document Intelligence
 * -----------------------------------------------------------
 * Dispatches real-time webhook event notifications to external ERPs/systems
 * configured in `enterprise_connections`.
 *
 * Supported Events:
 *  - `DOCUMENT_EXTRACTED`: Document processed, structured data available
 *  - `COMMERCIAL_ANOMALY_FLAGGED`: Commercial variance detected (>5% deviation / missing PO)
 *  - `DOCUMENT_APPROVED`: Human-in-the-loop approved extraction, populated into record
 *  - `DOCUMENT_REJECTED`: Reviewer rejected extraction
 *  - `DOCUMENT_EXPIRING_ALERT`: Sweeper identified document expiring within 30 days
 *  - `DOCUMENT_EXPIRED`: Sweeper transitioned document to expired
 *
 * Security:
 *  - Computes HMAC-SHA256 signature header (`x-fleet360-signature`) using the tenant's secret.
 *  - Logs transactional dispatch to `enterprise_sync_logs` (direction 'OUTBOUND', entity 'DOCUMENT').
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { erpFetch } from '@/lib/agents/enterprise-bridge/erp-fetch';

export type DocumentWebhookEvent =
  | 'DOCUMENT_EXTRACTED'
  | 'COMMERCIAL_ANOMALY_FLAGGED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_REJECTED'
  | 'DOCUMENT_EXPIRING_ALERT'
  | 'DOCUMENT_EXPIRED';

export interface WebhookDispatchPayload {
  event: DocumentWebhookEvent;
  timestamp: string;
  tenantId: string;
  documentId: string;
  data: Record<string, unknown>;
}

// An `enterprise_connections` row as returned by the SELECT below.
// `auth_credentials`/`headers` are JSONB columns whose driver representation
// may be a JSON string or an already-parsed object, so they're typed loosely
// (unknown) and narrowed at their one use site below.
interface EnterpriseConnectionRow {
  id: string;
  system_type: string;
  base_url: string;
  auth_credentials: unknown;
  headers: unknown;
}

export interface WebhookDeliveryResult {
  connectionId?: string;
  targetUrl: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  httpStatus?: number;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Computes HMAC-SHA256 signature for the given payload string and secret.
 */
export function generateWebhookSignature(payloadString: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

/**
 * Dispatches a document webhook event to all active external connections for the tenant,
 * or to a configured environment fallback webhook endpoint.
 */
export async function dispatchDocumentWebhook(
  tenantId: string,
  event: DocumentWebhookEvent,
  data: Record<string, unknown>
): Promise<WebhookDeliveryResult[]> {
  const documentId = (data.documentId || data.extractionId || 'UNKNOWN') as string;
  const timestamp = new Date().toISOString();

  const payload: WebhookDispatchPayload = {
    event,
    timestamp,
    tenantId,
    documentId,
    data,
  };

  const payloadString = JSON.stringify(payload);
  const results: WebhookDeliveryResult[] = [];

  // 1. Fetch active enterprise connections for this tenant
  let connections: EnterpriseConnectionRow[] = [];

  try {
    const rows = await prisma.$queryRawUnsafe<EnterpriseConnectionRow[]>(`
      SELECT id, system_type, base_url, auth_credentials, headers
      FROM enterprise_connections
      WHERE tenant_id = $1 AND is_active = true
    `, tenantId);
    if (rows && rows.length > 0) {
      connections = rows;
    }
  } catch (dbErr) {
    // If table doesn't exist yet or connection lookup fails
    console.warn('[WebhookDispatcher] Connection lookup warning:', dbErr);
  }

  // Fallback webhook endpoint if configured via environment (operator-set,
  // so it is not subject to the tenant-URL checks of erpFetch).
  const fallbackWebhookUrl = process.env.DOCUMENT_WEBHOOK_URL;
  const fallbackSecret = process.env.DOCUMENT_WEBHOOK_SECRET;

  const targets: Array<{
    connectionId?: string;
    systemType: string;
    url: string;
    secret: string;
    customHeaders: Record<string, string>;
    tenantUrl: boolean;
  }> = [];
  const skipped: WebhookDeliveryResult[] = [];

  for (const conn of connections) {
    if (conn.base_url) {
      const creds = (typeof conn.auth_credentials === 'string' ? JSON.parse(conn.auth_credentials) : conn.auth_credentials || {}) as { webhookSecret?: string };
      const url = conn.base_url.endsWith('/') ? `${conn.base_url}api/webhooks/fleet360` : `${conn.base_url}/api/webhooks/fleet360`;
      // Signed with the connection's own webhook secret only. It used to fall
      // back to the ERP API key, or to a default secret that is in this
      // repository, so anyone could forge a "Fleet360" signature.
      if (!creds.webhookSecret) {
        skipped.push({ targetUrl: url, status: 'SKIPPED', errorMessage: 'Connection has no webhook secret; rotate one to receive document webhooks.', durationMs: 0 });
        continue;
      }
      const headers = (typeof conn.headers === 'string' ? JSON.parse(conn.headers) : conn.headers || {}) as Record<string, string>;
      targets.push({
        connectionId: conn.id,
        systemType: conn.system_type || 'EXTERNAL_ERP',
        url,
        secret: creds.webhookSecret,
        customHeaders: headers,
        tenantUrl: true,
      });
    }
  }

  if (targets.length === 0 && skipped.length === 0 && fallbackWebhookUrl) {
    if (!fallbackSecret) {
      console.warn('[WebhookDispatcher] DOCUMENT_WEBHOOK_URL is set without DOCUMENT_WEBHOOK_SECRET; not sending unsigned webhooks.');
    } else {
      targets.push({
        systemType: 'CUSTOM_REST',
        url: fallbackWebhookUrl,
        secret: fallbackSecret,
        customHeaders: {},
        tenantUrl: false,
      });
    }
  }

  if (targets.length === 0 && skipped.length > 0) return skipped;
  results.push(...skipped);

  if (targets.length === 0) {
    return [
      {
        targetUrl: 'NONE_CONFIGURED',
        status: 'SKIPPED',
        errorMessage: 'No active enterprise connections or webhook endpoints configured for tenant',
        durationMs: 0,
      },
    ];
  }

  for (const target of targets) {
    const startTime = Date.now();
    const signature = generateWebhookSignature(payloadString, target.secret);

    try {
      const requestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...target.customHeaders,
          // After the connection's own headers so they cannot override them.
          'x-fleet360-event': event,
          'x-fleet360-signature': signature,
          'x-fleet360-tenant': tenantId,
        },
        body: payloadString,
      };
      // A tenant-entered URL goes through the SSRF-guarded client.
      const response = target.tenantUrl
        ? await erpFetch(target.url, { ...requestInit, timeoutMs: 5000 })
        : await fetch(target.url, { ...requestInit, redirect: 'manual', signal: AbortSignal.timeout(5000) });

      const durationMs = Date.now() - startTime;
      const ok = response.ok;
      const httpStatus = response.status;
      const respText = await response.text().catch(() => '');

      // Log to enterprise_sync_logs
      try {
        await prisma.$queryRawUnsafe(`
          INSERT INTO enterprise_sync_logs (
            tenant_id, connection_id, system_type, entity_type, direction,
            entity_id, status, request_payload, response_payload,
            http_status, duration_ms, error_message
          ) VALUES (
            $1, $2::uuid, $3, 'DOCUMENT', 'OUTBOUND',
            $4, $5, $6::jsonb, $7::jsonb,
            $8, $9, $10
          )
        `,
          tenantId,
          target.connectionId || null,
          target.systemType,
          documentId,
          ok ? 'SUCCESS' : 'FAILED',
          payloadString,
          JSON.stringify({ status: httpStatus, body: respText.slice(0, 500) }),
          httpStatus,
          durationMs,
          ok ? null : `HTTP ${httpStatus}: ${respText.slice(0, 200)}`
        );
      } catch (logErr) {
        console.warn('[WebhookDispatcher] Failed to write audit log:', logErr);
      }

      results.push({
        connectionId: target.connectionId,
        targetUrl: target.url,
        status: ok ? 'SUCCESS' : 'FAILED',
        httpStatus,
        durationMs,
        errorMessage: ok ? undefined : `HTTP ${httpStatus}`,
      });
    } catch (fetchErr) {
      const durationMs = Date.now() - startTime;
      const errMsg = fetchErr instanceof Error ? fetchErr.message : 'Network dispatch error';

      try {
        await prisma.$queryRawUnsafe(`
          INSERT INTO enterprise_sync_logs (
            tenant_id, connection_id, system_type, entity_type, direction,
            entity_id, status, request_payload, http_status, duration_ms, error_message
          ) VALUES (
            $1, $2::uuid, $3, 'DOCUMENT', 'OUTBOUND',
            $4, 'FAILED', $5::jsonb, 0, $6, $7
          )
        `,
          tenantId,
          target.connectionId || null,
          target.systemType,
          documentId,
          payloadString,
          durationMs,
          errMsg
        );
      } catch {
        // ignore
      }

      results.push({
        connectionId: target.connectionId,
        targetUrl: target.url,
        status: 'FAILED',
        durationMs,
        errorMessage: errMsg,
      });
    }
  }

  return results;
}
