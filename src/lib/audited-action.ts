/**
 * Privileged actions always leave an audit row.
 *
 * withAuditedAction wraps a route handler for a privileged write (the
 * /api/admin routes and the tenant-admin and platform areas of the
 * authorization matrix; tests/unit/privileged-audit.test.ts fails when one
 * is not wrapped). After the handler runs it records who did what with
 * which outcome, unless the handler already wrote its own, more detailed
 * row (logAudit / logAuditInTx mark the request as audited), so each
 * action is recorded once:
 *
 *   succeeded (2xx/3xx)        action CREATE / UPDATE / DELETE by HTTP method
 *   refused (401/403)          action DENIED
 *   failed (5xx, or it threw)  action FAILED
 *
 * An invalid request (another 4xx: validation, not found, conflict) changed
 * nothing and is not recorded. Refusals are recorded even when the handler
 * audited, since a handler's own audit usually describes a completed change. Rows land in audit_logs
 * (Admin → Audit log) as entity type AdminAction, with the route template,
 * the target id, the actor, their role, any impersonator, IP and user agent.
 *
 * Node runtime only (AsyncLocalStorage, database).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface AuditState {
  audited: boolean;
}

const requestAudit = new AsyncLocalStorage<AuditState>();

/** Called by logAudit / logAuditInTx: this request has written its own audit row. */
export function markAudited(): void {
  const state = requestAudit.getStore();
  if (state) state.audited = true;
}

const ACTION_BY_METHOD: Record<string, string> = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

type RouteContext = { params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]> } | undefined;

/** The route template of `pathname`: dynamic segments replaced by their [param] names. */
export function routeTemplate(pathname: string, params: Record<string, string | string[]>): string {
  const byValue = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) byValue.set(v, name);
  }
  return pathname
    .split('/')
    .map((seg) => {
      const decoded = (() => { try { return decodeURIComponent(seg); } catch { return seg; } })();
      const name = byValue.get(decoded);
      return name ? `[${name}]` : seg;
    })
    .join('/');
}

async function paramsOf(ctx: RouteContext): Promise<Record<string, string | string[]>> {
  try {
    return (await ctx?.params) ?? {};
  } catch {
    return {};
  }
}

function outcomeOf(status: number | null, threw: boolean): { action: string | null; outcome: string } {
  if (threw || status === null) return { action: 'FAILED', outcome: 'error' };
  if (status === 401 || status === 403) return { action: 'DENIED', outcome: `refused ${status}` };
  if (status >= 500) return { action: 'FAILED', outcome: `failed ${status}` };
  return { action: null, outcome: `ok ${status}` };
}

/** Invalid requests (4xx other than refusals) changed nothing: not recorded. */
export const recordsStatus = (status: number) => status < 400 || status === 401 || status === 403 || status >= 500;

async function record(req: Request | undefined, ctx: RouteContext, status: number | null, threw: boolean): Promise<void> {
  if (!req || typeof req.headers?.get !== 'function') return;
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const params = await paramsOf(ctx);
  const template = routeTemplate(url.pathname, params);
  const firstParam = Object.values(params).flat()[0];
  const { action, outcome } = outcomeOf(status, threw);
  const h = req.headers;
  const impersonatedBy = h.get('x-impersonated-by');
  // Loaded lazily: audit.ts imports this module (markAudited).
  const { logAudit } = await import('@/lib/audit');
  await logAudit({
    tenantId: h.get('x-tenant-id') ?? undefined,
    entityType: 'AdminAction',
    entityId: firstParam,
    entityName: `${method} ${template}`,
    action: action ?? ACTION_BY_METHOD[method] ?? method,
    details: `${method} ${url.pathname}: ${outcome}${impersonatedBy ? ` (impersonated by ${impersonatedBy})` : ''}`,
    userId: h.get('x-user-id') ?? undefined,
    userRole: h.get('x-user-role') ?? undefined,
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined,
    userAgent: h.get('user-agent')?.slice(0, 500) ?? undefined,
  });
}

/** Wrap a privileged route handler so every call is audited once (see above). */
export function withAuditedAction<A extends unknown[], R extends Response>(
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const state: AuditState = { audited: false };
    const req = args[0] as Request | undefined;
    const ctx = args[1] as RouteContext;
    let res: R;
    try {
      res = await requestAudit.run(state, () => handler(...args));
    } catch (err) {
      await record(req, ctx, null, true).catch((e) => console.error('[audit] privileged action not recorded:', e));
      throw err;
    }
    const refused = res.status === 401 || res.status === 403;
    if (recordsStatus(res.status) && (!state.audited || refused)) {
      await record(req, ctx, res.status, false).catch((e) => console.error('[audit] privileged action not recorded:', e));
    }
    return res;
  };
}
