export const dynamic = 'force-dynamic';

/**
 * /api/leasing/dunning/suppressions — customer/invoice/contract dunning
 * suppression rows. GET lists; POST creates (canCreate on
 * leasing:dunning_suppressions); DELETE lifts an existing one (canDelete)
 * rather than hard-deleting, so the row stays as an audit trail.
 *
 * Scope/target consistency is validated here for a clear 400, in addition
 * to the DB-level CHECK constraint (chk_lease_dunning_suppressions_scope_target)
 * that rejects a mismatched combination regardless of this check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { hasPermission, buildPermissionKey, SYSTEM_ROLES } from '@/lib/permissions';

function permsFor(req: NextRequest): string[] {
  const roleCode = req.headers.get('x-user-role') ?? '';
  return (SYSTEM_ROLES.find(r => r.code === roleCode)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
}

function validateScopeTarget(scope: string, lesseeId?: string | null, invoiceId?: string | null, contractId?: string | null): string | null {
  if (scope === 'CUSTOMER') {
    if (!lesseeId) return 'scope CUSTOMER requires lesseeId';
    if (invoiceId || contractId) return 'scope CUSTOMER must not set invoiceId/contractId';
  } else if (scope === 'INVOICE') {
    if (!invoiceId) return 'scope INVOICE requires invoiceId';
  } else if (scope === 'CONTRACT') {
    if (!contractId) return 'scope CONTRACT requires contractId';
  } else {
    return `unknown scope '${scope}' — expected CUSTOMER|INVOICE|CONTRACT`;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const { searchParams } = new URL(req.url);
  const activeOnly = searchParams.get('active') !== 'false';
  const lesseeId = searchParams.get('lesseeId') ?? undefined;
  const invoiceId = searchParams.get('invoiceId') ?? undefined;
  const contractId = searchParams.get('contractId') ?? undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const rows = await tx.leaseDunningSuppression.findMany({
      where: {
        tenantId,
        ...(activeOnly ? { active: true } : {}),
        ...(lesseeId ? { lesseeId } : {}),
        ...(invoiceId ? { invoiceId } : {}),
        ...(contractId ? { contractId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(rows);
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  if (!hasPermission(permsFor(req), 'leasing', 'create', 'dunning_suppressions')) {
    return NextResponse.json({ error: 'You do not have permission to create dunning suppressions.' }, { status: 403 });
  }

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const scope = String(body.scope ?? '');
    const validationError = validateScopeTarget(scope, body.lesseeId, body.invoiceId, body.contractId);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const userId = req.headers.get('x-user-id') ?? 'system';
    const row = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseDunningSuppression.create({
        data: {
          tenantId,
          scope,
          lesseeId: scope === 'CUSTOMER' ? body.lesseeId : null,
          invoiceId: scope === 'INVOICE' ? body.invoiceId : null,
          contractId: scope === 'CONTRACT' ? body.contractId : null,
          reason: body.reason ?? null,
          active: true,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          createdBy: userId,
        },
      }),
    );
    return NextResponse.json(row, { status: 201 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  if (!hasPermission(permsFor(req), 'leasing', 'delete', 'dunning_suppressions')) {
    return NextResponse.json({ error: 'You do not have permission to lift dunning suppressions.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const userId = req.headers.get('x-user-id') ?? 'system';
  return withTenantRls(prisma, tenantId, async (tx) => {
    const existing = await tx.leaseDunningSuppression.findFirst({ where: { id, tenantId } });
    if (!existing) return NextResponse.json({ error: 'Suppression not found' }, { status: 404 });
    if (!existing.active) return NextResponse.json(existing);

    const updated = await tx.leaseDunningSuppression.update({
      where: { id },
      data: { active: false, liftedBy: userId, liftedAt: new Date() },
    });
    return NextResponse.json(updated);
  });
}
