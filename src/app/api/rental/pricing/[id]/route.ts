export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { pricingRuleUpdateSet, rowToCamel } from '@/lib/pricing-rule-helpers';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM pricing_rules WHERE id::text = $1 AND tenant_id::text = $2',
        params.id,
        tenantId,
      );
      if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(rowToCamel(rows[0]));
    } catch (e) {
      console.error('Error fetching pricing rule:', e);
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'pricing',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!bodyRaw || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(bodyRaw as Record<string, unknown>);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id::text AS id FROM pricing_rules WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1',
        params.id,
        tenantId,
      );
      if (!existing.length) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      if (body.corporateAccountId) {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          corporateAccountId: String(body.corporateAccountId),
        });
      }

      const now = new Date().toISOString();
      const { setClauses, values, nextIdx } = pricingRuleUpdateSet(body, now);
      values.push(params.id, tenantId);
      await tx.$executeRawUnsafe(
        `UPDATE pricing_rules SET ${setClauses} WHERE id::text = $${nextIdx} AND tenant_id::text = $${nextIdx + 1}`,
        ...values,
      );
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM pricing_rules WHERE id::text = $1 AND tenant_id::text = $2',
        params.id,
        tenantId,
      );
      if (!rows.length) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(rowToCamel(rows[0]));
    } catch (e: unknown) {
      if (isRentalSecurityError(e)) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      }
      console.error('Error updating pricing rule:', e);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }
  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  return PATCH(req, props);
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'pricing',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const deleted = await tx.$queryRawUnsafe<{ id: string }[]>(
        'DELETE FROM pricing_rules WHERE id::text = $1 AND tenant_id::text = $2 RETURNING id::text AS id',
        params.id,
        tenantId,
      );
      if (!deleted.length) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (e) {
      console.error('Error deleting pricing rule:', e);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
  });
}
