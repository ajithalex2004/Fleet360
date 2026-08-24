/**
 * /api/bus-ops/planning-constraints — CRUD for PCE rules.
 *
 * Ops author rows here; PCE reads them at evaluation time. `kind` is
 * free-text so a new evaluator can land without an enum bump; `params`
 * is JSON validated at evaluator level, not here (this endpoint stays
 * schema-lean so the surface doesn't need updates for every new rule).
 *
 * Basic sanity only:
 *   - name required, non-empty
 *   - kind required
 *   - action must be BLOCK|WARN|PENALTY
 *   - PENALTY requires a numeric penaltyScore
 *   - params must be an object
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const ACTIONS = new Set(['BLOCK', 'WARN', 'PENALTY']);

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const permError = requireBusOpsAdminAccess(req, 'planning-constraints');
      if (permError) return permError;

      const sp = req.nextUrl.searchParams;
      const kind = sp.get('kind');
      const enabled = sp.get('enabled'); // '1' | '0' | null

      try {
        const rows = await tx.planningConstraint.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...(kind ? { kind } : {}),
            ...(enabled === '1' ? { isEnabled: true } : enabled === '0' ? { isEnabled: false } : {}),
          },
          orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
        });
        return NextResponse.json(rows);
      } catch (e) {
        console.error('[planning-constraints.GET]', e);
        return NextResponse.json({ error: 'Failed to fetch constraints' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const permError = requireBusOpsAdminAccess(req, 'planning-constraints');
      if (permError) return permError;
      const createdBy = req.headers.get('x-user-id') ?? null;

      let body: unknown;
      try { const bodyRaw = await req.json(); body = stripTenantOwnershipFields(bodyRaw);
      } catch {
        return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
      }
      const err = validate(body);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      const b = body as Record<string, unknown>;

      try {
        const row = await tx.planningConstraint.create({
          data: {
            tenantId,
            name: (b.name as string).trim(),
            kind: (b.kind as string).trim(),
            action: (b.action as string) ?? 'BLOCK',
            penaltyScore: typeof b.penaltyScore === 'number' ? b.penaltyScore : null,
            params: (b.params as object) ?? {},
            effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom as string) : null,
            effectiveTo: b.effectiveTo ? new Date(b.effectiveTo as string) : null,
            reason: typeof b.reason === 'string' ? b.reason.trim() || null : null,
            isEnabled: b.isEnabled !== false,
            createdBy,
          },
        });
        return NextResponse.json(row, { status: 201 });
        } catch (e) {
        console.error('[planning-constraints.POST]', e);
        return NextResponse.json({ error: 'Failed to create constraint' }, { status: 500 });
      }
  });
}


function validate(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) return 'name is required';
  if (typeof b.kind !== 'string' || !b.kind.trim()) return 'kind is required';
  if (b.action !== undefined) {
    if (typeof b.action !== 'string' || !ACTIONS.has(b.action)) {
      return `action must be one of ${[...ACTIONS].join('|')}`;
    }
    if (b.action === 'PENALTY' && typeof b.penaltyScore !== 'number') {
      return 'penaltyScore (number) is required when action=PENALTY';
    }
  }
  if (b.params !== undefined && (typeof b.params !== 'object' || Array.isArray(b.params))) {
    return 'params must be an object';
  }
  if (b.effectiveFrom !== undefined && b.effectiveFrom !== null) {
    if (typeof b.effectiveFrom !== 'string' || Number.isNaN(new Date(b.effectiveFrom).getTime())) {
      return 'effectiveFrom must be an ISO date';
    }
  }
  if (b.effectiveTo !== undefined && b.effectiveTo !== null) {
    if (typeof b.effectiveTo !== 'string' || Number.isNaN(new Date(b.effectiveTo).getTime())) {
      return 'effectiveTo must be an ISO date';
    }
  }
  return null;
}
