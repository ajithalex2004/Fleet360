/**
 * GET  /api/admin/nav-permissions          — returns enabled nav keys for current tenant
 * GET  /api/admin/nav-permissions?tenantId — super admin fetches for a specific tenant
 * PUT  /api/admin/nav-permissions          — super admin updates nav permissions for a tenant
 *
 * Nav keys that can be toggled per-tenant for TENANT_ADMIN:
 *   branches | billing | workflows | esign | whatsapp | dispatch | audit-logs
 *
 * Always visible to TENANT_ADMIN (no toggle): overview | users | roles
 * Never visible to TENANT_ADMIN:              tenants | platform-info | notifications | integrations | settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

// Keys that the platform admin can enable/disable per tenant
export const TOGGLEABLE_NAV_KEYS = [
  'branches',
  'billing',
  'workflows',
  'esign',
  'whatsapp',
  'dispatch',
  'audit-logs',
] as const;

export type NavKey = typeof TOGGLEABLE_NAV_KEYS[number];

// ── Ensure the permissions table exists ────────────────────────────────────────

async function ensureTable(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tenant_admin_nav_permissions (
        id         TEXT PRIMARY KEY,
        tenant_id  TEXT NOT NULL,
        nav_key    TEXT NOT NULL,
        enabled    BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (tenant_id, nav_key)
      )
    `);
  } catch (e) {
    console.warn('[nav-permissions] ensureTable skipped:', e);
  }
}

// ── GET — fetch enabled nav keys ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAdminPermission(request, 'view', 'roles');
  if (auth instanceof NextResponse) return auth;

  // Super admin can query any tenant via ?tenantId=xxx
  const url      = new URL(request.url);
  const target = resolveTenantBoundary(auth.ctx, url.searchParams.get('tenantId'));
  if (target instanceof NextResponse) return target;
  const targetId = target;

  if (!targetId) {
    return NextResponse.json({ error: 'tenant not resolved' }, { status: 400 });
  }

  await ensureTable();

  type Row = { nav_key: string; enabled: boolean };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT nav_key, enabled FROM tenant_admin_nav_permissions WHERE tenant_id = $1`,
    targetId,
  );

  // Build a full map — keys not in DB default to false
  const map: Record<string, boolean> = {};
  for (const key of TOGGLEABLE_NAV_KEYS) map[key] = false;
  for (const row of rows) map[row.nav_key] = row.enabled;

  return NextResponse.json({ tenantId: targetId, permissions: map });
}

// ── PUT — super admin updates permissions for a tenant ─────────────────────────

export async function PUT(request: NextRequest) {
  const auth = await requireAdminPermission(request, 'edit', 'roles');
  if (auth instanceof NextResponse) return auth;
  if (!auth.ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json() as { tenantId: string; permissions: Record<string, boolean> };
  const { tenantId, permissions } = body;

  if (!tenantId || typeof permissions !== 'object') {
    return NextResponse.json({ error: 'tenantId and permissions required' }, { status: 400 });
  }

  await ensureTable();
  const before = await prisma.$queryRawUnsafe(
    `SELECT nav_key, enabled FROM tenant_admin_nav_permissions WHERE tenant_id = $1`,
    tenantId,
  );

  // Upsert each toggleable key
  for (const key of TOGGLEABLE_NAV_KEYS) {
    const enabled = permissions[key] === true;
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenant_admin_nav_permissions (id, tenant_id, nav_key, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_id, nav_key) DO UPDATE SET enabled = $4, updated_at = NOW()`,
      crypto.randomUUID(),
      tenantId,
      key,
      enabled,
    );
  }

  await recordAdminChange({
    req: request,
    ctx: auth.ctx,
    tenantId,
    entityType: 'AdminNavPolicy',
    entityId: tenantId,
    action: 'UPDATE',
    before,
    after: permissions,
    summary: 'Updated tenant admin navigation restrictions. RBAC remains the source of truth.',
  });
  return NextResponse.json({ ok: true, tenantId });
}
