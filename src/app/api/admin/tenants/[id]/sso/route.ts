/**
 * /api/admin/tenants/[id]/sso
 *
 * GET    — current config (public-safe view; secret never returned).
 * PUT    — upsert config. Body: {
 *           issuer, clientId, clientSecret?, allowedEmailDomains, defaultRoleId?, jitEnabled?, isActive?
 *         }. clientSecret is optional on update — when empty the existing
 *         encrypted secret is kept.
 * DELETE — remove the config entirely.
 *
 * Authorization: SUPER_ADMIN, or that tenant's TENANT_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ensureSsoTable, encryptSecret, getSsoConfigPublic, validateSsoConfigReadiness,
} from '@/lib/sso';
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

  const config = await getSsoConfigPublic(tenantId);
  const readiness = config ? {
    status: config.isActive
      ? (config.issuer.startsWith('https://') && config.clientId && config.clientSecretSet && config.allowedEmailDomains.length ? 'ready' : 'incomplete')
      : 'inactive',
    issues: [
      ...(!config.isActive ? ['SSO configuration is inactive.'] : []),
      ...(!config.issuer.startsWith('https://') ? ['Issuer must be an HTTPS URL.'] : []),
      ...(!config.clientId ? ['Client ID is required.'] : []),
      ...(!config.clientSecretSet ? ['Client secret is required.'] : []),
      ...(!config.allowedEmailDomains.length ? ['At least one allowed email domain is required.'] : []),
    ],
    redirectUri: `${(process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, '')}/api/auth/sso/callback`,
  } : null;
  return NextResponse.json({ ok: true, config, readiness });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = await requireAdminPermission(req, 'edit', 'integrations');
  if (auth instanceof NextResponse) return auth;
  const scopedTenantId = resolveTenantBoundary(auth.ctx, tenantId);
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;

  let body: {
    issuer?: string; clientId?: string; clientSecret?: string;
    allowedEmailDomains?: unknown;
    defaultRoleId?: string | null;
    jitEnabled?: boolean; isActive?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const issuer   = String(body.issuer ?? '').trim();
  const clientId = String(body.clientId ?? '').trim();
  if (!issuer || !/^https:\/\//.test(issuer)) {
    return NextResponse.json({ ok: false, error: 'Issuer must be a full HTTPS URL.' }, { status: 400 });
  }
  if (!clientId) return NextResponse.json({ ok: false, error: 'clientId is required.' }, { status: 400 });

  const domains = Array.isArray(body.allowedEmailDomains)
    ? Array.from(new Set(body.allowedEmailDomains
        .filter((d): d is string => typeof d === 'string')
        .map(d => d.trim().toLowerCase())
        .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))))
    : [];
  if (domains.length === 0) {
    return NextResponse.json({ ok: false, error: 'At least one email domain is required (e.g. acme.com).' }, { status: 400 });
  }

  const defaultRoleId = body.defaultRoleId ? String(body.defaultRoleId) : null;
  const jitEnabled    = body.jitEnabled !== false; // default true
  const isActive      = body.isActive   !== false; // default true
  const beforeApproval = await getSsoConfigPublic(tenantId);
  const approval = await requireDangerApproval(req, auth.ctx, 'sso.update', {
    tenantId,
    targetType: 'SsoConfig',
    targetId: tenantId,
    summary: `Update SSO configuration for tenant ${tenantId}.`,
    payload: {
      before: beforeApproval,
      after: {
        issuer,
        clientId,
        clientSecretSet: Boolean(body.clientSecret?.trim()) || Boolean(beforeApproval?.clientSecretSet),
        allowedEmailDomains: domains,
        defaultRoleId,
        jitEnabled,
        isActive,
      },
    },
  });
  if (approval) return approval;
  // SSO is a Professional-tier feature.
  const gate = requirePlan(req, 'PROFESSIONAL');
  if (gate) return gate;

  // Validate role belongs to tenant or is global.
  if (defaultRoleId) {
    const role = await prisma.role.findFirst({
      where: { id: defaultRoleId, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true },
    });
    if (!role) return NextResponse.json({ ok: false, error: 'defaultRoleId not found for this tenant.' }, { status: 400 });
  }

  // Block another tenant from claiming a domain we don't own.
  await ensureSsoTable();
  const conflicts = await prisma.$queryRawUnsafe<{ tenant_id: string }[]>(
    `SELECT tenant_id FROM tenant_sso_configs
     WHERE tenant_id != $1
       AND allowed_email_domains ?| $2::text[]`,
    tenantId, domains,
  ).catch(() => []);
  if (conflicts.length > 0) {
    return NextResponse.json({
      ok: false,
      error: `One or more domains are already configured under another tenant.`,
    }, { status: 409 });
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }, select: { id: true, name: true, isActive: true },
    });
    if (!tenant) return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });

    const existing = await prisma.$queryRawUnsafe<{ id: string; client_secret_encrypted: string }[]>(
      `SELECT id::text, client_secret_encrypted FROM tenant_sso_configs WHERE tenant_id = $1 LIMIT 1`,
      tenantId,
    );
    const beforePublic = await getSsoConfigPublic(tenantId);
    const wasUpdate = existing.length > 0;

    let encrypted: string;
    if (typeof body.clientSecret === 'string' && body.clientSecret.trim().length > 0) {
      encrypted = encryptSecret(body.clientSecret.trim());
    } else if (wasUpdate) {
      encrypted = existing[0].client_secret_encrypted; // keep prior
    } else {
      return NextResponse.json({ ok: false, error: 'clientSecret is required for the first save.' }, { status: 400 });
    }

    if (wasUpdate) {
      await prisma.$executeRawUnsafe(
        `UPDATE tenant_sso_configs
            SET issuer = $1, client_id = $2, client_secret_encrypted = $3,
                allowed_email_domains = $4::jsonb, default_role_id = $5,
                jit_enabled = $6, is_active = $7, updated_at = NOW()
          WHERE tenant_id = $8`,
        issuer, clientId, encrypted, JSON.stringify(domains), defaultRoleId,
        jitEnabled, isActive, tenantId,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenant_sso_configs
           (tenant_id, provider, issuer, client_id, client_secret_encrypted,
            allowed_email_domains, default_role_id, jit_enabled, is_active, created_by_user_id)
         VALUES ($1, 'oidc', $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
        tenantId, issuer, clientId, encrypted, JSON.stringify(domains),
        defaultRoleId, jitEnabled, isActive, auth.ctx.userId,
      );
    }

    const fresh = await getSsoConfigPublic(tenantId);
    const readiness = fresh ? {
      ...validateSsoConfigReadiness({
        issuer,
        clientId,
        clientSecret: 'set',
        allowedEmailDomains: domains,
        isActive,
      }, process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin),
    } : null;
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'SsoConfig', entityName: clientId,
      action: wasUpdate ? 'UPDATE' : 'CREATE',
      before: beforePublic,
      after: fresh,
      summary: `OIDC SSO ${wasUpdate ? 'updated' : 'configured'} for issuer ${issuer}; domains: ${domains.join(',')}.`,
    });

    return NextResponse.json({ ok: true, config: fresh, readiness });
  } catch (err) {
    captureException(err, { context: 'admin.sso.put' });
    return NextResponse.json({ ok: false, error: 'Failed to save SSO config' }, { status: 500 });
  }
}


export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = await requireAdminPermission(req, 'delete', 'integrations');
  if (auth instanceof NextResponse) return auth;
  const scopedTenantId = resolveTenantBoundary(auth.ctx, tenantId);
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;
  const approval = await requireDangerApproval(req, auth.ctx, 'sso.delete', {
    tenantId,
    targetType: 'SsoConfig',
    targetId: tenantId,
    summary: `Delete SSO configuration for tenant ${tenantId}.`,
  });
  if (approval) return approval;

  await ensureSsoTable();
  const before = await getSsoConfigPublic(tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM tenant_sso_configs WHERE tenant_id = $1`, tenantId);
  await recordAdminChange({
    req,
    ctx: auth.ctx,
    tenantId,
    entityType: 'SsoConfig',
    action: 'DELETE',
    before,
    summary: 'SSO configuration removed.',
  });
  return NextResponse.json({ ok: true });
}
