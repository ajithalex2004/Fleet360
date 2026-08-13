import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'leasing:analytics';

/**
 * Leasing analytics — multi-tenant dashboard KPIs.
 *
 * Multi-tenant: every model in the analytics Promise.all is filtered by
 * `tenantId` from x-tenant-id (set by middleware). This is the Layer 2.5
 * fix that closes TENANT-001 for the leasing analytics surface.
 *
 * Note: `leaseContractVehicle` and `leaseQuotationItem` do not have their
 * own tenantId column (intentional — they are scoped via the parent
 * LeaseContract2 / LeaseQuotation that IS in the where filter).
 *
 * Performance: the heavy work (9 Prisma queries + JS-side reduction across
 * thousands of rows) is wrapped in cacheRead so repeated page loads on the
 * leasing dashboard don't re-pay that cost. 60s server cache, 300s browser
 * stale-while-revalidate. Per-tenant key keeps responses isolated (we
 * cannot use public CDN cache because the URL doesn't carry the tenantId).
 */

// Heavy work extracted into a cacheable, self-contained function. No
// closures over request state — only the tenantId parameter.
const getLeasingAnalytics = cacheRead(
  async (tenantId: string) => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const last6Months = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const safe = async <T>(label: string, promise: Promise<T[]>): Promise<T[]> => {
      try {
        return await promise;
      } catch (error) {
        console.warn(`[leasing analytics] ${label} unavailable`, error);
        return [];
      }
    };

    const [contracts, contractVehicles, payments, overages, fines, fuel, insurance, renewals, lessees] = await Promise.all([
      safe('contracts', prisma.leaseContract2.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, contractNumber: true, status: true, monthlyRate: true, totalContractValue: true, startDate: true, endDate: true, lesseeId: true },
      })),
      safe('contract vehicles', prisma.leaseContractVehicle.findMany({
        where: { contract: { tenantId } },
        select: { id: true, contractId: true, status: true },
      })),
      safe('legacy leasing payments', prisma.leasePayment2.findMany({
        where: { tenantId },
        select: { id: true, contractId: true, amount: true, totalAmount: true, status: true, dueDate: true, paidDate: true, periodMonth: true, periodYear: true },
      })),
      safe('mileage overages', prisma.leaseMileageOverage.findMany({
        where: { tenantId },
        select: { id: true, contractId: true, overageAmount: true, status: true, createdAt: true },
      })),
      safe('traffic fines', prisma.leaseTrafficFine.findMany({
        where: { tenantId },
        select: { id: true, contractId: true, finalAmount: true, fineAmount: true, billingStatus: true, violationDate: true },
      })),
      safe('fuel logs', prisma.leaseFuelLog.findMany({
        where: { tenantId },
        select: { id: true, contractId: true, totalCost: true, billingStatus: true, fuelDate: true },
      })),
      safe('insurance policies', prisma.leaseInsurancePolicy.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, status: true, expiryDate: true, premium: true },
      })),
      safe('renewals', prisma.leaseRenewal.findMany({
        where: { tenantId },
        select: { id: true, status: true, createdAt: true },
      })),
      safe('lessees', prisma.lessee.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, type: true },
      })),
    ]);

    // Portfolio KPIs
    const activeContracts  = contracts.filter(c => c.status === 'ACTIVE');
    const monthlyRevenue   = activeContracts.reduce((s, c) => s + Number(c.monthlyRate), 0);
    const portfolioValue   = activeContracts.reduce((s, c) => s + Number(c.totalContractValue ?? 0), 0);
    const overduePayments  = payments.filter(p => p.status === 'OVERDUE');
    const overdueAmount    = overduePayments.reduce((s, p) => s + Number(p.totalAmount ?? p.amount), 0);
    const collectionRate   = payments.length > 0 ? (payments.filter(p => p.status === 'PAID').length / payments.length) * 100 : 0;

    // Revenue by month (last 6)
    const revenueByMonth: Record<string, number> = {};
    payments.filter(p => p.status === 'PAID' && p.paidDate && new Date(p.paidDate) >= last6Months).forEach(p => {
      const key = `${new Date(p.paidDate!).getFullYear()}-${String(new Date(p.paidDate!).getMonth() + 1).padStart(2, '0')}`;
      revenueByMonth[key] = (revenueByMonth[key] || 0) + Number(p.totalAmount ?? p.amount);
    });

    // Contract status breakdown
    const contractsByStatus = contracts.reduce((acc: Record<string, number>, c) => {
      acc[c.status ?? 'UNKNOWN'] = (acc[c.status ?? 'UNKNOWN'] || 0) + 1; return acc;
    }, {});

    // Operational billing totals
    const pendingFines   = fines.filter(f => f.billingStatus === 'PENDING').reduce((s, f) => s + Number(f.finalAmount ?? f.fineAmount), 0);
    const pendingFuel    = fuel.filter(f => f.billingStatus === 'PENDING').reduce((s, f) => s + Number(f.totalCost ?? 0), 0);
    const pendingOverage = overages.filter(o => o.status === 'PENDING').reduce((s, o) => s + Number(o.overageAmount), 0);
    const totalUnbilled  = pendingFines + pendingFuel + pendingOverage;

    // Insurance expiring soon
    const expiringPolicies = insurance.filter(p => {
      const days = (new Date(p.expiryDate).getTime() - now.getTime()) / 86400000;
      return days >= 0 && days <= 30;
    });

    // Utilisation rate (active / total fleet - rough)
    const totalLessees     = lessees.length;
    const corporateLessees = lessees.filter(l => l.type === 'corporate').length;

    // Real fleet utilisation: active vehicle-months / available vehicle-months
    const utilisationWindowStart = last6Months;
    const monthBuckets: string[] = [];
    {
      const cur = new Date(utilisationWindowStart);
      while (cur <= now) {
        monthBuckets.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    let activeVehicleMonths = 0;
    let totalVehicleMonths = 0;
    const contractById = new Map(contracts.map(c => [c.id, c]));
    for (const cv of contractVehicles) {
      const c = contractById.get(cv.contractId);
      if (!c) continue;
      for (const bucket of monthBuckets) {
        const [y, m] = bucket.split('-').map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0, 23, 59, 59);
        const overlapped = c.startDate <= monthEnd && c.endDate >= monthStart;
        if (!overlapped) continue;
        totalVehicleMonths += 1;
        if (cv.status === 'ACTIVE' && c.status === 'ACTIVE') {
          activeVehicleMonths += 1;
        }
      }
    }
    const utilisationPct = totalVehicleMonths > 0
      ? Math.round((activeVehicleMonths / totalVehicleMonths) * 1000) / 10
      : 0;

    // Top-5 contracts by net revenue contribution
    const revenueByContract = new Map<string, number>();
    for (const p of payments.filter(p => p.status === 'PAID' && p.paidDate && new Date(p.paidDate) >= startOfYear)) {
      revenueByContract.set(p.contractId, (revenueByContract.get(p.contractId) ?? 0) + Number(p.totalAmount ?? p.amount));
    }
    const exposureByContract = new Map<string, number>();
    const addExposure = (cid: string | null | undefined, amount: number) => {
      if (!cid) return;
      exposureByContract.set(cid, (exposureByContract.get(cid) ?? 0) + amount);
    };
    overages.filter(o => o.status === 'PENDING').forEach(o => addExposure(o.contractId, Number(o.overageAmount)));
    fines.filter(f => f.billingStatus === 'PENDING').forEach(f => addExposure(f.contractId, Number(f.finalAmount ?? f.fineAmount)));
    fuel.filter(f => f.billingStatus === 'PENDING').forEach(f => addExposure(f.contractId, Number(f.totalCost ?? 0)));

    const topContracts = contracts
      .filter(c => c.status === 'ACTIVE')
      .map(c => ({
        contractId: c.id,
        contractNumber: c.contractNumber,
        revenue: revenueByContract.get(c.id) ?? 0,
        exposure: exposureByContract.get(c.id) ?? 0,
        netContribution: (revenueByContract.get(c.id) ?? 0) - (exposureByContract.get(c.id) ?? 0),
      }))
      .sort((a, b) => b.netContribution - a.netContribution)
      .slice(0, 5);

    return {
      kpis: {
        activeContracts: activeContracts.length,
        totalContracts:  contracts.length,
        monthlyRevenue,
        portfolioValue,
        overdueAmount,
        collectionRate: Math.round(collectionRate),
        totalUnbilled,
        expiringPolicies: expiringPolicies.length,
        renewalsPending: renewals.filter(r => r.status === 'PROPOSED' || r.status === 'SENT_TO_CUSTOMER').length,
        totalLessees,
        corporateLessees,
        utilisationPct,
        activeVehicleMonths,
        totalVehicleMonths,
        fleetSize: contractVehicles.length,
      },
      charts: {
        revenueByMonth,
        contractsByStatus,
        pendingBillingBreakdown: { fines: pendingFines, fuel: pendingFuel, mileageOverage: pendingOverage },
      },
      topContracts,
    };
  },
  [CACHE_TAG],
  60,
);

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const data = await getLeasingAnalytics(tenantId);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(60, 300) },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
