/**
 * GET  /api/admin/service-config/types/[id]/rules/[category]/history
 *   Returns every saved version for the (type, category) pair, newest
 *   first, including the currently-active one. Used by the History
 *   panel in the admin tabs.
 *
 * POST /api/admin/service-config/types/[id]/rules/[category]/history
 *   Body: { versionId }  — rolls back to that version. Creates a new
 *   active row whose payload clones the historical version's rules.
 *   The historical row itself is left untouched (immutable history).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import {
  loadRulesHistory, rollbackToVersion,
} from '@/lib/service-config/rules-schema';
import { RULE_CATEGORIES, type RuleCategory } from '@/types/service-rules';
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

  const versions = await loadRulesHistory(id, category, 50);
  return NextResponse.json({ ok: true, versions });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
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

  let body: { versionId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.versionId) return NextResponse.json({ ok: false, error: 'versionId is required' }, { status: 400 });

  try {
    const result = await rollbackToVersion(id, category, body.versionId, auth.userId);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
      entityType: 'ServiceRules', entityId: id, entityName: `${owner.key}:${category}`,
      action: 'UPDATE',
      details: `Rolled back ${category} rules for ${owner.key} to version ${body.versionId.slice(0, 8)}`,
    });

    return NextResponse.json({ ok: true, rules: result.rules });
  } catch (err) {
    captureException(err, { context: 'service-config.rules.rollback', tags: { category } });
    return NextResponse.json({ ok: false, error: 'Rollback failed' }, { status: 500 });
  }
}
