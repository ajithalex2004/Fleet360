export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const now = new Date();
      const in30Days = new Date(Date.now() + 30 * 86400000);

      // 1. Vehicle Mulkiya / Registration Expirations
      const expiredVehicles = await tx.vehicle.count({
        where: {
          tenantId,
          deletedAt: null,
          registrationExpiry: { lt: now },
        },
      }).catch(() => 0);

      const expiringVehicles = await tx.vehicle.count({
        where: {
          tenantId,
          deletedAt: null,
          registrationExpiry: { gte: now, lte: in30Days },
        },
      }).catch(() => 0);

      // 2. Driver Licenses / Permits
      const expiredDrivers = await tx.driver.count({
        where: {
          tenantId,
          deletedAt: null,
          licenseExpiry: { lt: now },
        },
      }).catch(() => 0);

      const expiringDrivers = await tx.driver.count({
        where: {
          tenantId,
          deletedAt: null,
          licenseExpiry: { gte: now, lte: in30Days },
        },
      }).catch(() => 0);

      // 3. Compliance Documents
      const expiredDocs = await tx.complianceDocument.count({
        where: {
          tenantId,
          expiryDate: { lt: now },
        },
      }).catch(() => 0);

      const expiringDocs = await tx.complianceDocument.count({
        where: {
          tenantId,
          expiryDate: { gte: now, lte: in30Days },
        },
      }).catch(() => 0);

      const totalExpired = expiredVehicles + expiredDrivers + expiredDocs;
      const totalExpiring = expiringVehicles + expiringDrivers + expiringDocs;

      return NextResponse.json({
        expiredDocs: totalExpired,
        expiringSoon: totalExpiring,
        expiredVehicles,
        expiringVehicles,
        expiredDrivers,
        expiringDrivers,
      });
    } catch (err) {
      console.error('[api/compliance/stats GET]', err);
      return NextResponse.json({ expiredDocs: 0, expiringSoon: 0 });
    }
  });
}
