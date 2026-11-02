export const dynamic = 'force-dynamic';

import { normalizeTenantModules, resolveModuleKey, SYSTEM_MODULE_KEYS } from '@/lib/modules';
import { parseFeatureFlags } from '@/lib/module-features';
import { writeTenantFeatureFlags } from '@/lib/tenant-features';
import { revalidateCache } from '@/lib/server-cache';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant, requireSuperAdminForTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';

function normalizeExplicitModules(
  requested: readonly unknown[],
): { ok: true; modules: string[] } | { ok: false; error: string } {
  const out = new Set<string>(SYSTEM_MODULE_KEYS);
  for (const raw of requested) {
    if (typeof raw !== 'string') return { ok: false, error: 'Module keys must be strings' };
    if ((SYSTEM_MODULE_KEYS as readonly string[]).includes(raw)) continue;
    const key = resolveModuleKey(raw);
    if (!key) return { ok: false, error: `Unknown module: ${raw}` };
    out.add(key);
  }
  return { ok: true, modules: [...out] };
}

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

  return withTenantRls(prisma, params.id, async (tx) => {
    const modules = await tx.tenantModule.findMany({ where: { tenantId: params.id } });
    return NextResponse.json(modules);
  });
}

// PUT: replace all module assignments, and store any feature flags sent with them
async function handlePUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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
    const body = stripTenantOwnershipFields(await req.json()) as {
      enabledModules?: unknown;
      featureFlags?: unknown;
      allowOverrideAll?: boolean;
    };
    if (!Array.isArray(body.enabledModules)) {
      return NextResponse.json({ error: 'Invalid enabledModules' }, { status: 400 });
    }
    const modules = body.allowOverrideAll
      ? normalizeExplicitModules(body.enabledModules)
      : normalizeTenantModules(body.enabledModules);
    if (!modules.ok) return NextResponse.json({ error: modules.error }, { status: 400 });
    const flags = parseFeatureFlags(body.featureFlags);
    if (!flags.ok) return NextResponse.json({ error: flags.error }, { status: 400 });

    const saved = await withTenantRls(prisma, params.id, async (tx) => {
      await tx.tenantModule.deleteMany({ where: { tenantId: params.id } });
      await tx.tenantModule.createMany({
        data: modules.modules.map((module) => ({ tenantId: params.id, module, isEnabled: true })),
      });
      await writeTenantFeatureFlags(tx, params.id, flags.flags);
      return tx.tenantModule.findMany({ where: { tenantId: params.id } });
    });
    // The tenants list shows each tenant's modules.
    await revalidateCache('tenants:list');
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
