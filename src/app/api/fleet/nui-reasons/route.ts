export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { NuiReasonSeed } from '@/lib/fleet/nui-reasons';
import { createNuiReason, listNuiReasons, seedDefaultsIfEmpty, type NuiReasonInput } from '@/lib/fleet/nui-reasons-store';

export type { NuiReasonSeed };

// Reason codes are per tenant: a tenant sees and adds only its own.
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      try {
        await seedDefaultsIfEmpty(tx, authz.tenantId);
      } catch (err) {
        console.warn('[nui-reasons seed warning]:', err);
      }

      const sp = req.nextUrl.searchParams;
      const type = sp.get('type')?.trim() || '';
      const items = await listNuiReasons(tx, authz.tenantId, {
        activeOnly: sp.get('activeOnly') !== 'false',
        type: type && type !== 'ALL' ? type : undefined,
        impact: sp.get('impact')?.trim() || undefined,
        search: sp.get('search')?.trim() || undefined,
      });
      return NextResponse.json({ success: true, count: items.length, data: items });
    } catch (err) {
      console.error('[nui-reasons GET error]:', err);
      return NextResponse.json({ error: 'Failed to fetch NUI reasons' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const body = stripTenantOwnershipFields(await req.json());

      if (!body.code || !body.name || !body.reasonType) {
        return NextResponse.json(
          { error: 'Bad Request', message: 'Reason code, name, and reasonType are required' },
          { status: 400 },
        );
      }

      const result = await createNuiReason(tx, authz.tenantId, body as NuiReasonInput);
      if (!result.ok) {
        return NextResponse.json(
          { error: 'Conflict', message: `Reason code "${'conflict' in result ? result.conflict : ''}" is already registered` },
          { status: 409 },
        );
      }
      return NextResponse.json(result.reason, { status: 201 });
    } catch (err) {
      console.error('[nui-reasons POST error]:', err);
      return NextResponse.json({ error: 'Failed to create NUI reason' }, { status: 500 });
    }
  });
}
