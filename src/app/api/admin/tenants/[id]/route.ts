export const dynamic = 'force-dynamic';

import { revokeSessionsSafely } from '@/lib/auth/session-revocation';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, requireSuperAdminForTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { readTenantFeatureFlags } from '@/lib/tenant-features';
import { logAudit as logPlatformAudit } from '@/lib/platform-audit-log';
import { normalizeTrn, parseLocalizedRecord } from '@/lib/finance/uae';

const CACHE_TAG = 'tenants:list';

const ALLOWED_TENANT_FIELDS = new Set([
  'name',
  'code',
  'plan',
  'industry',
  'domain',
  'allowedOrigins',
  'address',
  'contactName',
  'contactEmail',
  'contactPhone',
  'trn',
  'defaultLanguage',
  'supportedLanguages',
  'localizedName',
  'localizedDesc',
  'bookingTypes',
  'isActive',
  'dataResidency',
]);

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: params.id },
        include: {
          modules: true,
          roles: { include: { _count: { select: { permissions: true, userTenants: true } } } },
          userTenants: { include: { role: true } },
        },
      });
      if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      // Stored value of every catalog flag (see @/lib/module-features).
      const featureFlags = await readTenantFeatureFlags(tx, params.id);
      return NextResponse.json({ ...tenant, featureFlags }, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

async function handlePATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);

    const tenant = await withTenantRls(prisma, params.id, async (tx) => {
      const existing = await tx.tenant.findUnique({
        where: { id: params.id },
        select: { localizedName: true },
      });
      if (!existing) throw new Error('Not found');

      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (!ALLOWED_TENANT_FIELDS.has(k)) continue;
        if (k === 'supportedLanguages' && Array.isArray(v)) {
          data.supportedLanguages = v.join(',');
        } else if (k === 'trn' && typeof v === 'string') {
          data.trn = normalizeTrn(v) || null;
        } else {
          data[k] = v;
        }
      }

      // Persist extra locale/tax metadata (country, currency, taxRate, corporateTaxTrn, tradeLicenseNo) inside localizedName JSON
      const localized = parseLocalizedRecord(existing.localizedName);
      let locChanged = false;
      for (const extraKey of ['country', 'currency', 'taxRate', 'corporateTaxTrn', 'tradeLicenseNo', 'tradeLicenseAuthority', 'emirate', 'emirateCode'] as const) {
        if (body[extraKey] !== undefined) {
          if (body[extraKey] === null || body[extraKey] === '') {
            delete localized[extraKey];
          } else {
            localized[extraKey] = String(body[extraKey]);
          }
          locChanged = true;
        }
      }
      if (locChanged && data.localizedName === undefined) {
        data.localizedName = Object.keys(localized).length ? JSON.stringify(localized) : null;
      }

      return tx.tenant.update({
        where: { id: params.id },
        data: { ...data, updatedAt: new Date() },
      });
    });

    // Deactivated, or the plan (signed into sessions) changed: every session
    // in the tenant ends within 60 s.
    if (body.isActive === false || body.plan !== undefined) {
      await revokeSessionsSafely({
        tenantId: params.id,
        reason: body.isActive === false ? 'tenant-deactivated' : 'tenant-plan-changed',
        revokedBy: authz.userId,
      });
    }
    if (typeof body.isActive === 'boolean') {
      await logPlatformAudit({
        action: body.isActive ? 'tenant.reactivate' : 'tenant.suspend',
        targetType: 'tenant',
        targetId: params.id,
        targetName: tenant.name,
        performedBy: {
          userId: authz.userId ?? undefined,
          email: req.headers.get('x-user-email') ?? undefined,
        },
        dryRun: false,
        metadata: { isActive: body.isActive, plan: tenant.plan },
      });
    }
    // Bust the list cache so the tenants page and the platform
    // dashboard's stat card see the change on the next render.
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(tenant);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

async function handleDELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    await withTenantRls(prisma, params.id, (tx) =>
      tx.tenant.update({ where: { id: params.id }, data: { isActive: false } }),
    );
    await revokeSessionsSafely({ tenantId: params.id, reason: 'tenant-deactivated', revokedBy: authz.userId });
    await logPlatformAudit({
      action: 'tenant.suspend',
      targetType: 'tenant',
      targetId: params.id,
      performedBy: {
        userId: authz.userId ?? undefined,
        email: req.headers.get('x-user-email') ?? undefined,
      },
      dryRun: false,
      metadata: { source: 'DELETE /api/admin/tenants/[id]' },
    });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ success: true });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
