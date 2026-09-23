export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        // SECURITY FOLLOW-UP: salik_accounts has no tenant_id column in the
        // DB (never added in any migration, unlike every other business
        // table) — filtering on tenantId here would throw a Prisma
        // validation error at runtime. Until that's fixed with a real
        // migration + backfill, this table is global/shared across every
        // tenant on the platform: any tenant can read any other tenant's
        // Salik toll accounts. Flagged to the user; not fixed in Phase 2.
        const salikAccounts = await tx.salikAccount.findMany({
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(salikAccounts);
      } catch (e) {
        console.error('Error fetching Salik accounts:', e);
        return NextResponse.json({ error: 'Failed to fetch Salik accounts' }, { status: 500 });
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
    try {
        const bodyRaw = await req.json();
      // tenantId is stripped because salik_accounts has no tenant_id column
      // to store it in (see the GET handler's note above) — every account
      // created here is visible to every tenant.
      const body = stripTenantOwnershipFields(bodyRaw);
        const salikAccount = await tx.salikAccount.create({
          data: body as Prisma.SalikAccountCreateInput,
        });
        return NextResponse.json(salikAccount, { status: 201 });
        } catch (e) {
        console.error('Error creating Salik account:', e);
        return NextResponse.json({ error: 'Failed to create Salik account' }, { status: 500 });
      }
  });
}

