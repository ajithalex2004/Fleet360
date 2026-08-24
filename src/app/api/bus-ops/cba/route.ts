/**
 * /api/bus-ops/cba — CRUD for CBA / union rule sets.
 *
 * GET    /api/bus-ops/cba                   — list rule-sets (tenant-scoped)
 * GET    /api/bus-ops/cba?id=…              — get one rule-set
 * GET    /api/bus-ops/cba?default=true      — get the tenant's default
 * POST   /api/bus-ops/cba                   — create
 * PATCH  /api/bus-ops/cba?id=…              — update (name, description, rules, isDefault, jurisdiction)
 * DELETE /api/bus-ops/cba?id=…              — soft-delete (unless isSystem)
 *
 * When the user sets `isDefault: true`, the API atomically clears the
 * previous default (enforced by the unique partial index on
 * cba_rule_sets(tenantId) WHERE is_default).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import { CBA_SCHEMA_VERSION, freshCbaRules, type CbaRules } from '@/lib/cba/types';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const CACHE_TAG = 'bus-ops:cba';

/**
 * Every method is gated on bus-ops:admin:cba-rules. These rule-sets carry
 * pay rates and hours-of-service limits, and they feed Planning Core's
 * WorkRules (via cbaToWorkRules) plus every HeadwayRule that binds to one —
 * so both reads and writes are restricted, same as planning-constraints.
 *
 * Coupling note: the Planning Core page pre-fills WorkRules by calling
 * GET ?default=true. Today Tenant Admin / Transport Manager / Transport
 * Operator all hold both bus-ops:admin:planning-core and
 * bus-ops:admin:cba-rules, so that call succeeds for anyone who can reach
 * the page. If those two are ever granted separately, the pre-fill will
 * 403 silently — grant cba-rules alongside planning-core, or relax this
 * GET, rather than letting the plan fall back to DEFAULT_RULES unnoticed.
 *
 * The driver-facing read path is a different route (/api/driver-app/cba)
 * and is unaffected by this gate.
 */
const CBA_RESOURCE = 'cba-rules';

interface RuleSetRow {
  id: string;
  name: string;
  description: string | null;
  jurisdiction: string | null;
  isDefault: boolean;
  isSystem: boolean;
  // Prisma auto-renames `rules Json` to `rulesJson` on the client model —
  // the DB column is still `rules`. Read the field by its TS name.
  rulesJson: unknown;
  schemaVersion: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function shape(r: RuleSetRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    jurisdiction: r.jurisdiction,
    isDefault: r.isDefault,
    isSystem: r.isSystem,
    rules: r.rulesJson,
    schemaVersion: r.schemaVersion,
    createdAt: r.createdAt?.toISOString() ?? null,
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  const permError = requireBusOpsAdminAccess(req, CBA_RESOURCE);
  if (permError) return permError;
  const sp = new URL(req.url).searchParams;
  const id      = sp.get('id');
  const getDefault = sp.get('default') === 'true';
  try {
    if (id) {
      const r = await withTenantRls(prisma, tenantId, (tx) =>
        tx.cbaRuleSet.findUnique({ where: { id } })
      );
      if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(shape(r as unknown as RuleSetRow),
        { headers: { 'Cache-Control': 'private, max-age=60' } });
    }
    if (getDefault) {
      const r = await withTenantRls(prisma, tenantId, (tx) =>
        tx.cbaRuleSet.findFirst({
          where: { tenantId, isDefault: true, deletedAt: null },
        })
      );
      return NextResponse.json(r ? shape(r as unknown as RuleSetRow) : null,
        { headers: { 'Cache-Control': 'private, max-age=60' } });
    }
    const list = await withTenantRls(prisma, tenantId, (tx) =>
      tx.cbaRuleSet.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
      })
    );
    return NextResponse.json(list.map((r) => shape(r as unknown as RuleSetRow)),
      { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    console.error('[cba GET]', e);
    return NextResponse.json({ error: 'Failed to list' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  const permError = requireBusOpsAdminAccess(req, CBA_RESOURCE);
  if (permError) return permError;
  try {
    const body = await req.json() as {
      name: string;
      description?: string;
      jurisdiction?: string;
      isDefault?: boolean;
      rules?: CbaRules;
    };
    if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const rules = body.rules ?? freshCbaRules();
    const created = await withTenantRls(prisma, tenantId, (tx) =>
      tx.cbaRuleSet.create({
        data: {
          tenantId,
          name: body.name,
          description: body.description ?? null,
          jurisdiction: body.jurisdiction ?? null,
          isDefault: body.isDefault ?? false,
          isSystem: false,
          rulesJson: rules as unknown as object,
          schemaVersion: CBA_SCHEMA_VERSION,
        },
      })
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(shape(created as unknown as RuleSetRow), { status: 201 });
  } catch (e) {
    console.error('[cba POST]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  const permError = requireBusOpsAdminAccess(req, CBA_RESOURCE);
  if (permError) return permError;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    const body = await req.json() as {
      name?: string;
      description?: string;
      jurisdiction?: string;
      isDefault?: boolean;
      rules?: CbaRules;
    };
    const data: Record<string, unknown> = {};
    if (body.name !== undefined)        data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.jurisdiction !== undefined) data.jurisdiction = body.jurisdiction;
    if (body.rules !== undefined)        data.rulesJson = body.rules;
    if (body.isDefault !== undefined)   data.isDefault = body.isDefault;

    const updated = await withTenantRls(prisma, tenantId, async (tx) => {
      if (body.isDefault === true) {
        // Clear any other default first
        await tx.cbaRuleSet.updateMany({
          where: { tenantId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.cbaRuleSet.update({ where: { id }, data });
    });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(shape(updated as unknown as RuleSetRow));
  } catch (e) {
    console.error('[cba PATCH]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
  const permError = requireBusOpsAdminAccess(req, CBA_RESOURCE);
  if (permError) return permError;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    // Refuse to delete a system rule-set
    const existing = await withTenantRls(prisma, tenantId, (tx) =>
      tx.cbaRuleSet.findUnique({ where: { id }, select: { isSystem: true } })
    );
    if (existing?.isSystem) {
      return NextResponse.json({ error: 'Cannot delete a system rule-set' }, { status: 400 });
    }
    await withTenantRls(prisma, tenantId, (tx) =>
      tx.cbaRuleSet.update({ where: { id }, data: { deletedAt: new Date() } })
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[cba DELETE]', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
