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
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

function authorize(req: NextRequest, tenantId: string): { ok: true; userId: string } | { ok: false; res: NextResponse } {
  const role     = req.headers.get('x-user-role')   ?? '';
  const userId   = req.headers.get('x-user-id')     ?? '';
  const ctxTenant = req.headers.get('x-tenant-id')  ?? '';
  if (!userId) return { ok: false, res: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) };
  if (role !== 'SUPER_ADMIN' && ctxTenant !== tenantId) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId };
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;

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
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;
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
      tenantId, name, prefix, hash, JSON.stringify(scopes), auth.userId,
    );
    const id = inserted[0]?.id;

    void logAudit({
      tenantId, tenantName: tenant.name,
      userId: auth.userId,
      userRole: 'TENANT_ADMIN',
      entityType: 'ApiKey',
      entityId: id,
      entityName: name,
      action: 'CREATE',
      details: `API key "${name}" created (prefix ${prefix}, scopes: ${scopes.join(',') || 'none'}).`,
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
