/**
 * GET /api/admin/service-config/types/[id]/rules/[category]?scopeId=...
 *   Returns the resolved rules at the requested scope, walking the
 *   parent chain so admins see what would actually apply if they save
 *   nothing here. Defaults to the tenant root scope when scopeId is
 *   omitted.
 *
 *   Response also reports `ownedScope`: the scope_id whose row was
 *   selected (== requested scope when the rule is overridden here, or
 *   an ancestor scope when inherited; null when running on defaults).
 *
 * PUT /api/admin/service-config/types/[id]/rules/[category]?scopeId=...
 *   Body: full rules object for that category. Saves an active row at
 *   the requested scope. Defaults to root when scopeId omitted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import {
  loadRulesForChain, saveRules,
} from '@/lib/service-config/rules-schema';
import {
  ensureRootScope, getScope, loadScopeChain,
} from '@/lib/service-config/scopes-schema';
import {
  RULE_CATEGORIES, RULE_DEFAULTS,
  type RuleCategory,
} from '@/types/service-rules';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string; category: string }>; }

async function ownsType(tenantId: string, typeId: string): Promise<{ ok: true; key: string } | { ok: false }> {
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
    `SELECT key FROM service_types
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    typeId, tenantId,
  ).catch(() => []);
  return rows[0] ? { ok: true, key: rows[0].key } : { ok: false };
}

function isValidCategory(c: string): c is RuleCategory {
  return (RULE_CATEGORIES as readonly string[]).includes(c);
}

function pickKnownKeys(category: RuleCategory, body: Record<string, unknown>): Record<string, unknown> {
  const defaults = RULE_DEFAULTS[category] as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(defaults)) {
    if (k in body) out[k] = body[k];
  }
  return out;
}

/** Resolve the effective scope for a request: the explicit ?scopeId or
 *  the tenant root. Returns null if the scope doesn't belong to the tenant. */
async function resolveScopeId(tenantId: string, requested: string | null): Promise<string | null> {
  if (!requested) return await ensureRootScope(tenantId);
  const scope = await getScope(tenantId, requested);
  return scope?.id ?? null;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const { id, category } = await params;
  if (!isValidCategory(category)) {
    return NextResponse.json({ ok: false, error: `Unknown category "${category}"` }, { status: 400 });
  }
  if (!(await ownsType(auth.tenantId, id)).ok) {
    return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });
  }
  const scopeId = await resolveScopeId(auth.tenantId, req.nextUrl.searchParams.get('scopeId'));
  if (!scopeId) return NextResponse.json({ ok: false, error: 'Scope not found' }, { status: 404 });

  const chain = await loadScopeChain(auth.tenantId, scopeId);
  const chainIds = chain.map(s => s.id);
  const hit = await loadRulesForChain<Record<string, unknown>>(id, category, chainIds);
  const merged = {
    ...(RULE_DEFAULTS[category] as unknown as Record<string, unknown>),
    ...((hit?.rules ?? {}) as Record<string, unknown>),
  };

  return NextResponse.json({
    ok: true,
    rules: merged,
    configured: hit !== null,
    ownedScope: hit?.scopeId ?? null,
    activeScope: scopeId,
    scopeChain: chain.map(s => ({ id: s.id, name: s.name, level: s.level, isRoot: s.isRoot })),
  });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const adminCheck = requireAdmin(auth);
  if (!adminCheck.ok) return adminCheck.res;

  const { id, category } = await params;
  if (!isValidCategory(category)) {
    return NextResponse.json({ ok: false, error: `Unknown category "${category}"` }, { status: 400 });
  }
  const owner = await ownsType(auth.tenantId, id);
  if (!owner.ok) return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });
  const scopeId = await resolveScopeId(auth.tenantId, req.nextUrl.searchParams.get('scopeId'));
  if (!scopeId) return NextResponse.json({ ok: false, error: 'Scope not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Body must be a rules object.' }, { status: 400 });
  }

  const merged: Record<string, unknown> = {
    ...(RULE_DEFAULTS[category] as unknown as Record<string, unknown>),
    ...pickKnownKeys(category, body as Record<string, unknown>),
  };

  try {
    await saveRules(id, category, merged, auth.userId, scopeId);

    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
      entityType: 'ServiceRules', entityId: id, entityName: `${owner.key}:${category}`,
      action: 'UPDATE',
      details: `Updated ${category} rules for service type ${owner.key} at scope ${scopeId.slice(0, 8)}`,
    });

    return NextResponse.json({ ok: true, rules: merged, ownedScope: scopeId, activeScope: scopeId });
  } catch (err) {
    captureException(err, { context: 'service-config.rules.put', tags: { category } });
    return NextResponse.json({ ok: false, error: 'Save failed' }, { status: 500 });
  }
}
