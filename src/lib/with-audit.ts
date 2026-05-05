/**
 * withAudit — declarative audit logging for API route handlers.
 *
 * Wrap a Next.js route handler to log a `logAudit()` event after a successful
 * mutation. Failed responses (non-2xx) are NOT logged so audit log stays
 * accurate.
 *
 * Why this pattern:
 *   - One central place to read tenant/user from request headers (set by
 *     middleware via x-tenant-id, x-user-id, x-user-role).
 *   - Routes don't repeat the boilerplate.
 *   - Non-mutation routes don't need this; only POST/PUT/PATCH/DELETE do.
 *
 * Usage:
 *   export const POST = withAudit(
 *     async (req: NextRequest) => { ... return NextResponse.json(created); },
 *     { entityType: 'LeaseContract', action: 'CREATE',
 *       describe: (req, res) => `Created contract ${res?.contractNumber}` },
 *   );
 *
 * For finer-grained logs in a handler (e.g. log AFTER reading the created
 * row's ID), call `logAudit()` directly from the handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logAudit, type AuditPayload } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

type Handler = (req: NextRequest, ctx?: any) => Promise<NextResponse> | NextResponse;

interface WithAuditOptions {
  entityType: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT' | 'CANCEL' | 'EXPORT' | 'VIEW';
  /** Optional: derive a human-readable description from request + response body. */
  describe?: (req: NextRequest, responseBody: any) => string | undefined;
  /** Optional: derive entityId/entityName from response body. */
  extractEntity?: (responseBody: any) => { id?: string; name?: string };
}

export function withAudit(handler: Handler, opts: WithAuditOptions): Handler {
  return async (req, ctx) => {
    let response: NextResponse;
    try {
      response = await handler(req, ctx);
    } catch (err) {
      captureException(err, { context: `route:${opts.entityType}.${opts.action}` });
      throw err;
    }

    // Only log successful mutations. 4xx/5xx responses are intentionally not audited.
    if (response.status >= 200 && response.status < 300) {
      // Best-effort: re-read the response body for entity extraction.
      let body: unknown = null;
      try { body = await response.clone().json(); } catch { /* non-JSON, fine */ }

      const entity = opts.extractEntity?.(body) ?? {};
      const description = opts.describe?.(req, body);

      const payload: AuditPayload = {
        tenantId:    req.headers.get('x-tenant-id')   ?? undefined,
        userId:      req.headers.get('x-user-id')     ?? undefined,
        userRole:    req.headers.get('x-user-role')   ?? undefined,
        ipAddress:   req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
        userAgent:   req.headers.get('user-agent')    ?? undefined,
        entityType:  opts.entityType,
        entityId:    entity.id,
        entityName:  entity.name,
        action:      opts.action,
        details:     description,
      };

      // Fire-and-forget — never block the response on audit logging.
      void logAudit(payload);
    }

    return response;
  };
}
