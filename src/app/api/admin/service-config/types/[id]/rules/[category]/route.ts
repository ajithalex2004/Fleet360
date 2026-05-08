/**
 * GET /api/admin/service-config/types/[id]/rules/[category]
 *   Returns the saved rules for one category, or null if unconfigured.
 *   The UI merges null into the per-category default.
 *
 * PUT /api/admin/service-config/types/[id]/rules/[category]
 *   Body: full rules object for that category (validated against the
 *   category's interface — keys outside the schema are dropped).
 *
 * One route handles all 8 categories. Adding a 9th category is a code-only
 * change (extend RULE_CATEGORIES + add a tab).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { loadRules, saveRules } from '@/lib/service-config/rules-schema';
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

/**
 * Strip body to known keys for the given category. Defends against
 * accidental schema drift — e.g. an old client posting fields we removed.
 */
function pickKnownKeys(category: RuleCategory, body: Record<string, unknown>): Record<string, unknown> {
  const defaults = RULE_DEFAULTS[category] as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(defaults)) {
    if (k in body) out[k] = body[k];
  }
  return out;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const { id, category } = await params;
  if (!isValidCategory(category)) {
    return NextResponse.json({ ok: false, error: `Unknown category "${category}"` }, { status: 400 });
  }
  const owner = await ownsType(auth.tenantId, id);
  if (!owner.ok) return NextResponse.json({ ok: false, error: 'Service type not found' }, { status: 404 });

  const rules = await loadRules<Record<string, unknown>>(id, category);
  // Merge defaults so missing keys (newly added in code) are filled in.
  const merged = { ...(RULE_DEFAULTS[category] as unknown as Record<string, unknown>), ...(rules ?? {}) };
  return NextResponse.json({ ok: true, rules: merged, configured: rules !== null });
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

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Body must be a rules object.' }, { status: 400 });
  }

  // Merge defaults so partial PUTs are safe; pickKnownKeys drops unknown keys.
  const merged: Record<string, unknown> = {
    ...(RULE_DEFAULTS[category] as unknown as Record<string, unknown>),
    ...pickKnownKeys(category, body as Record<string, unknown>),
  };

  try {
    await saveRules(id, category, merged, auth.userId);

    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
      entityType: 'ServiceRules', entityId: id, entityName: `${owner.key}:${category}`,
      action: 'UPDATE',
      details: `Updated ${category} rules for service type ${owner.key}`,
    });

    return NextResponse.json({ ok: true, rules: merged });
  } catch (err) {
    captureException(err, { context: 'service-config.rules.put', tags: { category } });
    return NextResponse.json({ ok: false, error: 'Save failed' }, { status: 500 });
  }
}
