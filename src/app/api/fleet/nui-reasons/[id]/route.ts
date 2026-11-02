export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { deleteNuiReason, getNuiReason, updateNuiReason } from '@/lib/fleet/nui-reasons-store';

// Every handler acts only on the caller's own tenant's reasons; another
// tenant's id is answered as not found.
export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const reason = await getNuiReason(tx, authz.tenantId, params.id);
      if (!reason) return NextResponse.json({ error: 'NUI reason not found' }, { status: 404 });
      return NextResponse.json(reason);
    } catch (err) {
      console.error('[nui-reasons GET/:id error]:', err);
      return NextResponse.json({ error: 'Failed to fetch NUI reason' }, { status: 500 });
    }
  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const body = stripTenantOwnershipFields(await req.json());
      const result = await updateNuiReason(tx, authz.tenantId, params.id, body, { allowCodeChange: true });
      if (result.ok) return NextResponse.json(result.reason);
      if ('conflict' in result) {
        return NextResponse.json(
          { error: 'Conflict', message: `Reason code "${result.conflict}" is already registered` },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'NUI reason not found' }, { status: 404 });
    } catch (err) {
      console.error('[nui-reasons PUT/:id error]:', err);
      return NextResponse.json({ error: 'Failed to update NUI reason' }, { status: 500 });
    }
  });
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      if (!(await deleteNuiReason(tx, authz.tenantId, params.id))) {
        return NextResponse.json({ error: 'NUI reason not found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, message: 'NUI reason deleted successfully' });
    } catch (err) {
      console.error('[nui-reasons DELETE/:id error]:', err);
      return NextResponse.json({ error: 'Failed to delete NUI reason' }, { status: 500 });
    }
  });
}
