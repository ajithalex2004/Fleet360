export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { deleteNuiReason, getNuiReason, updateNuiReason } from '@/lib/fleet/nui-reasons-store';
import { withAuditedAction } from '@/lib/audited-action';

// Every handler acts only on the current tenant's reasons; another tenant's
// id is answered as not found.
export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: _.headers, nextUrl: _.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const reason = await getNuiReason(tx, authz.tenantId, params.id);
      if (!reason) return NextResponse.json({ error: 'NUI Reason not found' }, { status: 404 });
      return NextResponse.json(reason);
    } catch (err) {
      console.error('[admin/nui-reasons/:id GET error]:', err);
      return NextResponse.json({ error: 'Failed to fetch NUI reason' }, { status: 500 });
    }
  });
}

async function handlePUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const body = stripTenantOwnershipFields(await req.json());
      // The master screen keeps a reason's code fixed once created.
      const result = await updateNuiReason(tx, authz.tenantId, params.id, body, { allowCodeChange: false });
      if (!result.ok) return NextResponse.json({ error: 'NUI Reason not found' }, { status: 404 });
      return NextResponse.json(result.reason);
    } catch (err) {
      console.error('[admin/nui-reasons/:id PUT error]:', err);
      return NextResponse.json({ error: 'Failed to update NUI reason' }, { status: 500 });
    }
  });
}

async function handleDELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: _.headers, nextUrl: _.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      if (!(await deleteNuiReason(tx, authz.tenantId, params.id))) {
        return NextResponse.json({ error: 'NUI Reason not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error('[admin/nui-reasons/:id DELETE error]:', err);
      return NextResponse.json({ error: 'Failed to delete NUI reason' }, { status: 500 });
    }
  });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);

// Privileged writes are always audited (src/lib/audited-action.ts).
export const DELETE = withAuditedAction(handleDELETE);
