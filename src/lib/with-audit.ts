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
 *     { entityType: 'LeaseContract2', action: 'CREATE',
 *       describe: (req, res) => `Created contract ${res?.contractNumber}` },
 *   );
 *
 * For finer-grained logs in a handler (e.g. log AFTER reading the created
 * row's ID), call `logAudit()` directly from the handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logAudit, type AuditPayload } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

// `ctx` is required whenever a real Ctx shape was inferred (dynamic
// routes) -- Next.js's generated route validator rejects an exported
// handler whose second parameter type includes `| undefined` for those.
// It stays optional when Ctx is left at its `unknown` default (routes
// with no dynamic segments, whose inner handler only takes `req`) so
// those call sites -- including tests that invoke the exported handler
// with just one argument -- keep typechecking.
type Handler<Ctx = unknown> = unknown extends Ctx
  ? (req: NextRequest, ctx?: Ctx) => Promise<NextResponse> | NextResponse
  : (req: NextRequest, ctx: Ctx) => Promise<NextResponse> | NextResponse;

interface WithAuditOptions<Body = unknown> {
  entityType: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT' | 'CANCEL' | 'EXPORT' | 'VIEW';
  /** Optional: derive a human-readable description from request + response body. */
  describe?: (req: NextRequest, responseBody: Body) => string | undefined;
  /** Optional: derive entityId/entityName from response body. */
  extractEntity?: (responseBody: Body) => { id?: string; name?: string };
}

export function withAudit<Ctx = unknown, Body = unknown>(
  // `ctx` is declared required (not optional) here so that dynamic-segment
  // route handlers — which always destructure a required
  // `{ params: Promise<{ id: string }> }` second argument — are assignable.
  // A function accepting fewer params (the common case: no ctx at all) is
  // still assignable to a function type expecting more, so non-dynamic
  // routes' `(req) => ...` handlers keep working unchanged. The exported
  // wrapper below stays `Handler<Ctx>` (ctx optional), matching how Next.js
  // actually invokes route handlers — with or without a second argument.
  handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse> | NextResponse,
  opts: WithAuditOptions<Body>
): Handler<Ctx> {
  // Explicit params -- the conditional Handler<Ctx> return type above cannot
  // contextually type this arrow function's parameters.
  return (async (req: NextRequest, ctx?: Ctx) => {
    let response: NextResponse;
    try {
      // `ctx` here is `Ctx | undefined` (this wrapper's own signature keeps
      // it optional for non-dynamic routes); Next.js only omits it for
      // routes with no dynamic segments, in which case `handler` itself
      // ignores the second argument, so the cast is safe at the one call
      // site that actually invokes the caller-supplied handler.
      response = await handler(req, ctx as Ctx);
    } catch (err) {
      captureException(err, { context: `route:${opts.entityType}.${opts.action}` });
      throw err;
    }

    // Only log successful mutations. 4xx/5xx responses are intentionally not audited.
    if (response.status >= 200 && response.status < 300) {
      // Best-effort: re-read the response body for entity extraction.
      let body: unknown = null;
      try { body = await response.clone().json(); } catch { /* non-JSON, fine */ }

      const entity = opts.extractEntity?.(body as Body) ?? {};
      const description = opts.describe?.(req, body as Body);

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
  }) as Handler<Ctx>;
}
