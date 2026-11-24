export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import type { CategoryStock, AvailabilityResponse } from '@/lib/fleet/availability-types';
import { STANDARD_DEPOTS, LEAD_TIME_RULES_HOURS, CATEGORY_SAMPLE_MODELS } from '@/lib/fleet/availability-types';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const serviceType = (sp.get('serviceType') || 'RENTAL').toUpperCase();
      const startDateStr = sp.get('startDate');
      const pickupTimeStr = sp.get('pickupTime') || '10:00';

      const minLeadHours = LEAD_TIME_RULES_HOURS[serviceType] || 2;
      let leadTimeViolated = false;
      let leadTimeWarning: string | undefined = undefined;

      // 1. Check Lead-Time & Blackout Gate
      if (startDateStr) {
        const [hours, mins] = pickupTimeStr.split(':').map(Number);
        const reqDate = new Date(startDateStr);
        reqDate.setHours(isNaN(hours) ? 10 : hours, isNaN(mins) ? 0 : mins, 0, 0);

        const now = new Date();
        const diffMs = reqDate.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours < minLeadHours) {
          leadTimeViolated = true;
          leadTimeWarning = `${serviceType.replace('_', ' ')} requires at least ${minLeadHours} hour(s) advance preparation before dispatch.`;
        }
      }

      // 2. Fetch active vehicles for this tenant (real DB state only)
      const vehicles = await tx.vehicle.findMany({
        where: {
          tenantId,
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          status: true,
          model: true,
          make: true,
          vehicleClass: true,
          vehicleGroup: true,
          vehicleUsage: true,
          homeDepotId: true,
        },
      });

      // 3. Define relevant categories for the requested service
      let serviceCategories: string[] = [];
      if (serviceType === 'EXECUTIVE') {
        serviceCategories = ['Business Sedan', 'Luxury Sedan', 'Luxury SUV', 'Executive Van (MPV)', 'Stretch Limousine', 'SUV Convoy'];
      } else if (serviceType === 'STAFF_TRANSPORT') {
        serviceCategories = ['14-Seat Minibus', '30-Seat Coaster', '50-Seat Luxury Coach'];
      } else if (serviceType === 'SCHOOL_BUS') {
        serviceCategories = ['22-Seat School Bus', '30-Seat School Bus', '50-Seat School Bus'];
      } else if (serviceType === 'LOGISTICS') {
        serviceCategories = ['1-Ton Courier Van', '3-Ton Box Truck', '3-Ton Reefer (Cold-Chain)', '7-Ton Curtain Sider', '40ft Flatbed Trailer'];
      } else if (serviceType === 'LEASING') {
        serviceCategories = ['Compact Sedan', 'Mid-Size Sedan', 'SUV', 'Van (7-seater)', 'Mini-Bus', 'Bus', 'Pickup Truck'];
      } else {
        // RENTAL
        serviceCategories = ['Economy', 'Compact', 'Mid-Size', 'Full-Size', 'SUV', '4x4', 'Van', 'Pickup Truck'];
      }

      // 4. Calculate live counts per category from database records only
      const categories: CategoryStock[] = serviceCategories.map((cat) => {
        const matchedVehicles = vehicles.filter(
          (v) =>
            v.vehicleClass?.toLowerCase() === cat.toLowerCase() ||
            v.vehicleGroup?.toLowerCase() === cat.toLowerCase() ||
            v.model?.toLowerCase().includes(cat.toLowerCase())
        );

        const availableVehicles = matchedVehicles.filter((v) => v.status === 'AVAILABLE');
        const availableCount = availableVehicles.length;
        const totalCount = matchedVehicles.length;

        const depots: Record<string, number> = {
          DXB_HUB: 0,
          DSO_CENTRAL: 0,
          JAFZA_LOGISTICS: 0,
          AUH_YAS: 0,
        };
        for (const v of availableVehicles) {
          const key = v.homeDepotId && v.homeDepotId in depots ? v.homeDepotId : 'DXB_HUB';
          depots[key] = (depots[key] ?? 0) + 1;
        }

        return {
          category: cat,
          availableCount,
          totalCount,
          lowStock: availableCount <= 2,
          isAvailable: availableCount > 0,
          sampleModels: CATEGORY_SAMPLE_MODELS[cat] || `${cat} Standard Fleet`,
          depots,
        };
      });

      const response: AvailabilityResponse = {
        serviceType,
        requestedDate: startDateStr || undefined,
        leadTimeHoursRequired: minLeadHours,
        leadTimeViolated,
        leadTimeWarning,
        categories,
        depotsList: STANDARD_DEPOTS,
      };

      return NextResponse.json(response);
    } catch (err) {
      console.error('[api/fleet/availability GET]', err);
      return NextResponse.json({ error: 'Failed to fetch fleet availability' }, { status: 500 });
    }
  });
}
