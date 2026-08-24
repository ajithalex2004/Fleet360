/**
 * /api/bus-ops/planning-constraints/[id] — single-rule CRUD.
 *
 * PATCH: partial update (name/action/params/reason/isEnabled/effective window).
 * DELETE: soft-delete via deletedAt so historical evaluations remain
 *         explainable. Hard-delete is intentionally not exposed.
 * `kind` is deliberately immutable — changing it silently repurposes an
 *         existing rule with the same id and confuses audit trails.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const ACTIONS = new Set(['BLOCK', 'WARN', 'PENALTY']);

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const permError = requireBusOpsAdminAccess(req, 'planning-constraints');
  if (permError) return permError;
  const { id } = await ctx.params;

  const row = await prisma.planningConstraint.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const permError = requireBusOpsAdminAccess(req, 'planning-constraints');
  if (permError) return permError;
  const updatedBy = req.headers.get('x-user-id') ?? null;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (b.kind !== undefined) return NextResponse.json({ error: 'kind is immutable' }, { status: 400 });
  if (b.action !== undefined) {
    if (typeof b.action !== 'string' || !ACTIONS.has(b.action)) {
      return NextResponse.json({ error: `action must be one of ${[...ACTIONS].join('|')}` }, { status: 400 });
    }
  }
  if (b.params !== undefined && (typeof b.params !== 'object' || Array.isArray(b.params))) {
    return NextResponse.json({ error: 'params must be an object' }, { status: 400 });
  }

  const existing = await prisma.planningConstraint.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data: Record<string, unknown> = { updatedBy };
  if (typeof b.name === 'string') data.name = b.name.trim();
  if (typeof b.action === 'string') data.action = b.action;
  if (b.penaltyScore !== undefined) data.penaltyScore = typeof b.penaltyScore === 'number' ? b.penaltyScore : null;
  if (b.params !== undefined) data.params = b.params as object;
  if (b.effectiveFrom !== undefined) data.effectiveFrom = b.effectiveFrom ? new Date(b.effectiveFrom as string) : null;
  if (b.effectiveTo !== undefined) data.effectiveTo = b.effectiveTo ? new Date(b.effectiveTo as string) : null;
  if (b.reason !== undefined) data.reason = typeof b.reason === 'string' ? b.reason.trim() || null : null;
  if (typeof b.isEnabled === 'boolean') data.isEnabled = b.isEnabled;

  try {
    const row = await prisma.planningConstraint.update({ where: { id }, data });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[planning-constraints.PATCH]', e);
    return NextResponse.json({ error: 'Failed to update constraint' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const permError = requireBusOpsAdminAccess(req, 'planning-constraints');
  if (permError) return permError;
  const { id } = await ctx.params;

  const existing = await prisma.planningConstraint.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await prisma.planningConstraint.update({
      where: { id },
      data: { deletedAt: new Date(), isEnabled: false },
    });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    console.error('[planning-constraints.DELETE]', e);
    return NextResponse.json({ error: 'Failed to delete constraint' }, { status: 500 });
  }
}
