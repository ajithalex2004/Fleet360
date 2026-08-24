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
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import crypto from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const role     = request.headers.get('x-user-role') ?? 'TENANT_ADMIN';
  const myTenant = request.headers.get('x-tenant-id') ?? '';

  // Super admin can query any tenant via ?tenantId=xxx
  const url      = new URL(request.url);
  const targetId = (role === 'SUPER_ADMIN' && url.searchParams.get('tenantId'))
    ? url.searchParams.get('tenantId')!
    : myTenant;

  if (!targetId) {
    return NextResponse.json({ error: 'tenant not resolved' }, { status: 400 });
  }

  await ensureTable();

  type Row = { nav_key: string; enabled: boolean };
  // tenant_admin_nav_permissions has tenant_id with RLS. Wrap with
  // withTenantRls(targetId) so the SELECT is constrained to that tenant.
  const rows = await withTenantRls(prisma, targetId, (tx) =>
    tx.$queryRawUnsafe<Row[]>(
      `SELECT nav_key, enabled FROM tenant_admin_nav_permissions WHERE tenant_id = $1`,
      targetId,
    )
  );

  // Build a full map — keys not in DB default to false
  const map: Record<string, boolean> = {};
  for (const key of TOGGLEABLE_NAV_KEYS) map[key] = false;
  for (const row of rows) map[row.nav_key] = row.enabled;

  return NextResponse.json({ tenantId: targetId, permissions: map });
}

// ── PUT — super admin updates permissions for a tenant ─────────────────────────

export async function PUT(request: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const role = request.headers.get('x-user-role') ?? '';
  if (role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden — Super Admin only' }, { status: 403 });
  }

  // Super admin may target any tenant — the body's tenantId, not the
  // caller's own authz-derived one, is the write target here.
  const body = await request.json() as { tenantId: string; permissions: Record<string, boolean> };
  const { tenantId: targetTenantId, permissions } = body;

  if (!targetTenantId || typeof permissions !== 'object') {
    return NextResponse.json({ error: 'tenantId and permissions required' }, { status: 400 });
  }

  await ensureTable();

  // Upsert each toggleable key
  await withTenantRls(prisma, targetTenantId, async (tx) => {
    for (const key of TOGGLEABLE_NAV_KEYS) {
      const enabled = permissions[key] === true;
      await tx.$executeRawUnsafe(
        `INSERT INTO tenant_admin_nav_permissions (id, tenant_id, nav_key, enabled, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_id, nav_key) DO UPDATE SET enabled = $4, updated_at = NOW()`,
        crypto.randomUUID(),
        targetTenantId,
        key,
        enabled,
      );
    }
  });

  return NextResponse.json({ ok: true, tenantId: targetTenantId });
}
