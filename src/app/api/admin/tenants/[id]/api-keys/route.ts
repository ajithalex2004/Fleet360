/**
 * /api/admin/tenants/[id]/api-keys
 *
 * GET   — list keys for a tenant (no secrets, just prefix + name + scopes).
 * POST  — create a new key. Body: { name, scopes? }.
 *         Returns the plaintext key ONCE — never available again.
 *
 * Authorization:
 *  - SUPER_ADMIN: any tenant
 *  - TENANT_ADMIN: their own tenant only
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureApiKeyTable, generateApiKey } from '@/lib/api-keys';
import { requirePlan } from '@/lib/plan-limits';
import { captureException } from '@/lib/sentry';
import { requireAdminPermission, requireDangerApproval, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = await requireAdminPermission(req, 'view', 'integrations');
  if (auth instanceof NextResponse) return auth;
  const scopedTenantId = resolveTenantBoundary(auth.ctx, tenantId);
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;

  await ensureApiKeyTable();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; name: string; prefix: string; scopes: string[];
    created_by_user_id: string | null; created_by_email: string | null;
    last_used_at: string | null; last_used_ip: string | null;
    revoked: boolean; revoked_at: string | null; created_at: string;
  }>>(
    `SELECT k.id::text, k.name, k.prefix, k.scopes,
            k.created_by_user_id, u.email AS created_by_email,
            k.last_used_at::text, k.last_used_ip,
            k.revoked, k.revoked_at::text, k.created_at::text
     FROM tenant_api_keys k
     LEFT JOIN "User" u ON u.id = k.created_by_user_id
     WHERE k.tenant_id = $1
     ORDER BY k.created_at DESC
     LIMIT 200`,
    tenantId,
  );

  return NextResponse.json({
    ok: true,
    keys: rows.map(r => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      createdBy: r.created_by_email ?? r.created_by_user_id,
      lastUsedAt: r.last_used_at,
      lastUsedIp: r.last_used_ip,
      revoked: r.revoked,
      revokedAt: r.revoked_at,
      createdAt: r.created_at,
    })),
  });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = await requireAdminPermission(req, 'create', 'integrations');
  if (auth instanceof NextResponse) return auth;
  const scopedTenantId = resolveTenantBoundary(auth.ctx, tenantId);
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;
  const approval = await requireDangerApproval(req, auth.ctx, 'api-key.create', {
    tenantId,
    targetType: 'ApiKey',
    summary: `Create API key for tenant ${tenantId}.`,
  });
  if (approval) return approval;
  // API keys require a paid plan (any tier above TRIAL).
  const gate = requirePlan(req, 'STANDARD');
  if (gate) return gate;

  let body: { name?: string; scopes?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const name   = String(body.name ?? '').trim();
  const scopes = Array.isArray(body.scopes)
    ? Array.from(new Set(body.scopes.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64)))
    : [];

  if (!name || name.length > 80) {
    return NextResponse.json({ ok: false, error: 'Name is required (max 80 chars).' }, { status: 400 });
  }
  if (scopes.length > 32) {
    return NextResponse.json({ ok: false, error: 'Too many scopes (max 32).' }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, isActive: true },
  });
  if (!tenant || !tenant.isActive) {
    return NextResponse.json({ ok: false, error: 'Tenant not found or inactive.' }, { status: 400 });
  }

  try {
    await ensureApiKeyTable();
    const { plaintext, prefix, hash } = generateApiKey();

    const inserted = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO tenant_api_keys (tenant_id, name, prefix, key_hash, scopes, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id::text`,
      tenantId, name, prefix, hash, JSON.stringify(scopes), auth.ctx.userId,
    );
    const id = inserted[0]?.id;

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'ApiKey',
      entityId: id,
      entityName: name,
      action: 'CREATE',
      after: { id, name, prefix, scopes },
      summary: `API key "${name}" created (prefix ${prefix}, scopes: ${scopes.join(',') || 'none'}).`,
    });

    return NextResponse.json({
      ok: true,
      key: {
        id,
        name,
        prefix,
        scopes,
        plaintext,  // ⚠ shown ONCE
      },
    });
  } catch (err) {
    captureException(err, { context: 'admin.api-keys.create' });
    return NextResponse.json({ ok: false, error: 'Failed to create API key' }, { status: 500 });
  }
}
