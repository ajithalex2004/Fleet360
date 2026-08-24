/**
 * GET /api/leasing/drivers
 *
 * List drivers in the leasing context. By default returns only drivers who
 * currently have an ACTIVE LeaseDriverAllocation. Pass ?all=1 to include all
 * non-deleted Drivers (so the per-contract picker can pick from the wider
 * pool, not only those already allocated).
 *
 * Each driver is annotated with allocation stats (active/total) and a
 * licence-expiry status flag for the dashboard.
 *
 * Tenant scoping: requires x-tenant-id. Allocations are scoped per tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const all = req.nextUrl.searchParams.get('all') === '1';
      const now = new Date();

      // Active leasing allocations in the caller's tenant.
      const activeAllocations = await tx.leaseDriverAllocation.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          driverId: true,
          contractId: true,
          contractVehicleId: true,
          allocatedAt: true,
        },
      });
      const activeByDriver = new Map<string, typeof activeAllocations>();
      for (const a of activeAllocations) {
        const arr = activeByDriver.get(a.driverId) ?? [];
        arr.push(a);
        activeByDriver.set(a.driverId, arr);
      }

      const driverIds = all ? undefined : [...new Set(activeAllocations.map(a => a.driverId))];
      if (!all && (!driverIds || driverIds.length === 0)) {
        return NextResponse.json([]);
      }

      // Driver is tenant-scoped (see schema: tenant_id column + idx_drivers_tenant_id).
      // Always filter by tenantId — "?all=1" means "the wider pool inside this tenant",
      // NOT the whole platform. Without this filter, a tenant admin could see every
      // other tenant's drivers (name, licence, EID, visa) via the All Drivers toggle.
      const drivers = await tx.driver.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(driverIds ? { id: { in: driverIds } } : {}),
        },
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          contactNumber: true,
          nationality: true,
          licenseNumber: true,
          licenseExpiry: true,
          licenseType: true,
          emiratesId: true,
          emiratesIdExpiry: true,
          visaExpiry: true,
          status: true,
          driverType: true,
        },
        orderBy: { name: 'asc' },
      });

      const totalGroups = await tx.leaseDriverAllocation.groupBy({
        by: ['driverId'],
        where: { tenantId, driverId: { in: drivers.map(d => d.id) } },
        _count: { _all: true },
      });
      const totalByDriver = new Map(totalGroups.map(g => [g.driverId, g._count._all]));

      const flagExpiry = (d: Date | null | undefined) => {
        if (!d) return null;
        const days = Math.ceil((new Date(d).getTime() - now.getTime()) / 86400000);
        if (days < 0) return 'EXPIRED';
        if (days <= 30) return 'EXPIRING_SOON';
        return 'OK';
      };

      const out = drivers.map(d => ({
        ...d,
        activeAllocations: activeByDriver.get(d.id)?.length ?? 0,
        totalAllocations: totalByDriver.get(d.id) ?? 0,
        licenseExpiryStatus: flagExpiry(d.licenseExpiry),
        emiratesIdExpiryStatus: flagExpiry(d.emiratesIdExpiry),
        visaExpiryStatus: flagExpiry(d.visaExpiry),
      }));

      return NextResponse.json(out);
  });
}

