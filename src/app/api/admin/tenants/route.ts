export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { cacheRead, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { withAuditedAction } from '@/lib/audited-action';
import { normalizeTenantModules } from '@/lib/modules';
import { defaultFeatureFlags, parseFeatureFlags } from '@/lib/module-features';
import { writeTenantFeatureFlags } from '@/lib/tenant-features';
import { randomUUID } from 'node:crypto';
import type { StoredFile } from '@/lib/storage';
import {
  AttachmentsNotMigratedError, attachmentUploadProblem, insertTenantAttachments,
  listAttachmentTypes, removeStoredFiles, storeAttachmentFiles, uploadsFromFormData,
  type AttachmentUpload,
} from '@/lib/tenant-attachments';

/**
 * Modules a tenant created here gets when the request names none. Pinned:
 * the permission module list (MODULES in @/lib/permissions) grew with the
 * authorization policy, and that must not change what new tenants get.
 * normalizeTenantModules adds the always-on modules and the system keys.
 */
const DEFAULT_TENANT_MODULES = [
  'leasing', 'rental', 'bus-ops', 'fleet', 'maintenance', 'finance',
  'driver-mgmt', 'compliance', 'reports',
];
const CACHE_TAG = 'tenants:list';

const getTenants = cacheRead(
  async (search: string, limit: number) => withPlatformAdmin(prisma, async (tx) => {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { code: { contains: search, mode: 'insensitive' as const } },
            { id:   { contains: search, mode: 'insensitive' as const } },
            { contactEmail: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    return tx.tenant.findMany({
      where,
      include: {
        modules: true,
        _count: { select: { userTenants: true, roles: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }),
  [CACHE_TAG],
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const limit  = Math.min(parseInt(searchParams.get('limit') ?? '200'), 200);

    // Non-super-admins (e.g. finance branch P&L, tenant pickers) only see
    // their own tenant.
    const tenants = isSuperAdmin(req.headers)
      ? await getTenants(search, limit)
      : await withPlatformAdmin(prisma, (tx) => tx.tenant.findMany({
          where: { id: tenantId },
          include: { modules: true, _count: { select: { userTenants: true, roles: true } } },
        }));
    return NextResponse.json(tenants, {
      // private: the list depends on the caller, so shared caches must not reuse it.
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  let stored: StoredFile[] = [];
  try {
    // JSON, or multipart/form-data from the Create Tenant modal: a `payload`
    // JSON field plus the attachment files (see uploadsFromFormData).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fields are checked below, as with req.json()
    let raw: any;
    let uploads: AttachmentUpload[] = [];
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      const payload = form.get('payload');
      if (typeof payload !== 'string') {
        return NextResponse.json({ error: 'Missing payload field' }, { status: 400 });
      }
      raw = JSON.parse(payload);
      uploads = uploadsFromFormData(form);
    } else {
      raw = await req.json();
    }
    const body = stripTenantOwnershipFields(raw);
    const {
      enabledModules = DEFAULT_TENANT_MODULES,
      featureFlags,
      localizedName, localizedDesc, bookingTypes,
      supportedLanguages, defaultLanguage,
      domain, address, contactName, contactEmail, contactPhone,
      plan, industry, code, name,
    } = body;

    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Tenant name is required' }, { status: 400 });
    }
    if (!Array.isArray(enabledModules)) {
      return NextResponse.json({ error: 'enabledModules must be an array' }, { status: 400 });
    }
    const modules = normalizeTenantModules(enabledModules);
    if (!modules.ok) return NextResponse.json({ error: modules.error }, { status: 400 });
    const flags = parseFeatureFlags(featureFlags);
    if (!flags.ok) return NextResponse.json({ error: flags.error }, { status: 400 });

    // Attachments: every mandatory type (e.g. Trade License) must be uploaded.
    const types = await withPlatformAdmin(prisma, (tx) => listAttachmentTypes(tx, { activeOnly: true }));
    const attachmentProblem = await attachmentUploadProblem(uploads, types, { requireMandatory: true });
    if (attachmentProblem) return NextResponse.json({ error: attachmentProblem }, { status: 400 });

    // The id is chosen here so the files can be stored under the tenant's
    // folder before the transaction; they are removed again if it fails.
    const newTenantId = randomUUID();
    stored = await storeAttachmentFiles(newTenantId, uploads);

    const created = await withPlatformAdmin(prisma, async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id:                newTenantId,
          name:              name.trim(),
          code:              code   || undefined,
          plan:              plan   || 'STANDARD',
          industry:          industry || undefined,
          domain:            domain   || undefined,
          address:           address  || undefined,
          contactName:       contactName  || undefined,
          contactEmail:      contactEmail || undefined,
          contactPhone:      contactPhone || undefined,
          defaultLanguage:   defaultLanguage  || 'en',
          supportedLanguages: supportedLanguages || 'en',
          localizedName:     localizedName  || undefined,
          localizedDesc:     localizedDesc  || undefined,
          bookingTypes:      bookingTypes   || undefined,
          modules: {
            create: modules.modules.map((m) => ({ module: m, isEnabled: true })),
          },
        },
        include: { modules: true },
      });
      // Every catalog flag gets an explicit value: the requested ones, the
      // defaults for the rest.
      await writeTenantFeatureFlags(tx, tenant.id, { ...defaultFeatureFlags(), ...flags.flags });
      await insertTenantAttachments(tx, tenant.id, uploads, stored, authz.userId ?? null);
      return tenant;
    });
    // New tenant means the cached tenant list is now stale.
    await revalidateCache(CACHE_TAG);
    return NextResponse.json(created, { status: 201 });
    } catch (e) {
    await removeStoredFiles(stored);
    if (e instanceof AttachmentsNotMigratedError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'A tenant with this code already exists' }, { status: 409 });
    }
    console.error('[CREATE TENANT]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
