export const dynamic = 'force-dynamic';

/**
 * GET /api/bus-ops/drivers
 *
 * Lists drivers eligible to drive staff-transport trips (used by the Plan
 * page for roster selection). Reads from the central Driver Hub — the
 * Driver row is the single source of truth, we do not maintain a separate
 * bus-ops driver copy — and shapes the response down to just what the plan
 * roster needs: id, display name, licence type.
 *
 * Filters:
 *   - Non-deleted only
 *   - `status = ACTIVE` (INACTIVE / SUSPENDED drivers can't be rostered)
 *   - Tenant-scoped via the x-tenant-id header set by middleware
 *
 * Auth: tenant operator session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const drivers = await tx.driver.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            licenseType: true,
          },
          orderBy: { name: 'asc' },
        });

        // Prefer the pre-composed `name`; fall back to "First Last" if the record
        // was written by a code path that populated only the split fields.
        const shaped = drivers.map(d => ({
          id: d.id,
          name: d.name ?? ([d.firstName, d.lastName].filter(Boolean).join(' ') || '(unnamed)'),
          licenseType: d.licenseType,
        }));

        return NextResponse.json(shaped, {
          headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
        });
        } catch (e) {
        console.error('[bus-ops/drivers GET]', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load drivers' }, { status: 500 });
      }
  });
}

