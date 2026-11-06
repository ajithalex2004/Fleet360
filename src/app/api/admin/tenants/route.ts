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

    const tenants = (isSuperAdmin(req.headers) || Boolean(req.headers.get('x-impersonated-by')?.trim()))
      ? await getTenants(search, limit)
      : await withPlatformAdmin(prisma, (tx) => tx.tenant.findMany({
          where: { id: tenantId },
          include: { modules: true, _count: { select: { userTenants: true, roles: true } } },
        }));
    return NextResponse.json(tenants, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  let stored: StoredFile[] = [];
  try {
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
      trn, tradeLicenseNo, tradeLicenseAuthority,
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

    const newTenantId = randomUUID();
    stored = await storeAttachmentFiles(newTenantId, uploads);

    const created = await withPlatformAdmin(prisma, async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id:                 newTenantId,
          name:               name.trim(),
          code:               code   || undefined,
          plan:               plan   || 'STANDARD',
          industry:           industry || undefined,
          domain:             domain   || undefined,
          address:            address  || undefined,
          contactName:        contactName  || undefined,
          contactEmail:       contactEmail || undefined,
          contactPhone:       contactPhone || undefined,
          defaultLanguage:    defaultLanguage  || 'en',
          supportedLanguages: supportedLanguages || 'en',
          localizedName:      localizedName  || undefined,
          localizedDesc:      localizedDesc  || undefined,
          bookingTypes:       bookingTypes   || undefined,
          modules: {
            create: modules.modules.map((m) => ({ module: m, isEnabled: true })),
          },
        },
        include: { modules: true },
      });
      await writeTenantFeatureFlags(tx, tenant.id, { ...defaultFeatureFlags(), ...flags.flags });
      await insertTenantAttachments(tx, tenant.id, uploads, stored, authz.userId ?? null);
      return tenant;
    });

    // Persist UAE VAT TRN & Trade License metadata if provided during tenant registration
    if (trn || tradeLicenseNo || tradeLicenseAuthority) {
      await withTenantRls(prisma, created.id, async (tx) => {
        if (trn) {
          await tx.$executeRawUnsafe(
            `UPDATE tenants SET trn = $2 WHERE id = $1`,
            created.id,
            String(trn).replace(/[\s-]/g, ''),
          ).catch(() => {});
        }
        await tx.$executeRawUnsafe(
          `UPDATE tenants
           SET trade_license_no = COALESCE($2, trade_license_no),
               trade_license_authority = COALESCE($3, trade_license_authority),
               peppol_endpoint_id = COALESCE($4, peppol_endpoint_id)
           WHERE id = $1`,
          created.id,
          tradeLicenseNo ? String(tradeLicenseNo).trim() : null,
          tradeLicenseAuthority ? String(tradeLicenseAuthority).trim() : null,
          trn ? String(trn).replace(/[\s-]/g, '') : null,
        ).catch(() => {});
      }).catch(() => {});
    }

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

export const POST = withAuditedAction(handlePOST);
