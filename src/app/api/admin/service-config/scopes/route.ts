/**
 * GET  /api/admin/service-config/scopes
 *   Returns every scope for the current tenant (root + descendants),
 *   ordered for UI rendering.
 *
 * POST /api/admin/service-config/scopes
 *   Body: { parentScopeId, level, key, name, description?, sortOrder? }
 *   Adds a non-root scope under an existing parent. The root scope is
 *   auto-created on first read of the catalogue and cannot be created
 *   manually.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { ensureSeededForTenant } from '@/lib/service-config/schema';
import { listScopes, createScope } from '@/lib/service-config/scopes-schema';
import { SCOPE_LEVELS, type ScopeLevel } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;

  // ensureSeededForTenant creates the root scope on first call.
  await ensureSeededForTenant(auth.tenantId);

  try {
    const scopes = await listScopes(auth.tenantId);
    return NextResponse.json({ ok: true, scopes });
  } catch (err) {
    captureException(err, { context: 'service-config.scopes.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load scopes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const adminCheck = requireAdmin(auth);
  if (!adminCheck.ok) return adminCheck.res;

  let body: {
    parentScopeId?: string | null;
    level?: string;
    key?: string;
    name?: string;
    description?: string;
    sortOrder?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const parentScopeId = body.parentScopeId ?? null;
  if (!parentScopeId) {
    return NextResponse.json({ ok: false, error: 'parentScopeId is required (the tenant root cannot be re-created).' }, { status: 400 });
  }
  const level = body.level && (SCOPE_LEVELS as readonly string[]).includes(body.level)
    ? body.level as ScopeLevel : 'BRANCH';
  const key  = String(body.key  ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const name = String(body.name ?? '').trim();
  if (!key)  return NextResponse.json({ ok: false, error: 'Key is required.' }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 });

  await ensureSeededForTenant(auth.tenantId);

  try {
    const scope = await createScope(auth.tenantId, {
      parentScopeId, level, key, name,
      description: body.description ?? null,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 100,
    });

    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || 'TENANT_ADMIN',
      entityType: 'ServiceScope', entityId: scope.id, entityName: name,
      action: 'CREATE', details: `Created ${level.toLowerCase()} scope ${name} (${key})`,
    });

    return NextResponse.json({ ok: true, scope }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return NextResponse.json({ ok: false, error: `Key "${key}" already exists for this tenant.` }, { status: 409 });
    }
    captureException(err, { context: 'service-config.scopes.create' });
    return NextResponse.json({ ok: false, error: 'Failed to create scope' }, { status: 500 });
  }
}
