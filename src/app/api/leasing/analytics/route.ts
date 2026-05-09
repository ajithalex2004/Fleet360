import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const last6Months = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [contracts, contractVehicles, payments, overages, fines, fuel, insurance, renewals, remarketing, lessees] = await Promise.all([
      prisma.leaseContract2.findMany({ where: { deletedAt: null }, select: { id: true, contractNumber: true, status: true, monthlyRate: true, totalContractValue: true, startDate: true, endDate: true, lesseeId: true } }),
      prisma.leaseContractVehicle.findMany({ select: { id: true, contractId: true, status: true } }),
      prisma.leasePayment2.findMany({ select: { id: true, contractId: true, amount: true, totalAmount: true, status: true, dueDate: true, paidDate: true, periodMonth: true, periodYear: true } }),
      prisma.leaseMileageOverage.findMany({ select: { id: true, contractId: true, overageAmount: true, status: true, createdAt: true } }),
      prisma.leaseTrafficFine.findMany({ select: { id: true, contractId: true, finalAmount: true, fineAmount: true, billingStatus: true, violationDate: true } }),
      prisma.leaseFuelLog.findMany({ select: { id: true, contractId: true, totalCost: true, billingStatus: true, fuelDate: true } }),
      prisma.leaseInsurancePolicy.findMany({ where: { deletedAt: null }, select: { id: true, status: true, expiryDate: true, premium: true } }),
      prisma.leaseRenewal.findMany({ select: { id: true, status: true, createdAt: true } }),
      prisma.leaseRemarketing.findMany({ select: { id: true, stage: true, saleProfit: true, saleDate: true } }),
      prisma.lessee.findMany({ where: { deletedAt: null }, select: { id: true, type: true } }),
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

    // Remarketing P&L
    const soldVehicles  = remarketing.filter(r => r.stage === 'SOLD');
    const remarketingPL = soldVehicles.reduce((s, r) => s + Number(r.saleProfit ?? 0), 0);

    // Utilisation rate (active / total fleet - rough)
    const totalLessees     = lessees.length;
    const corporateLessees = lessees.filter(l => l.type === 'corporate').length;

    // ── Real fleet utilisation: active vehicle-months / available vehicle-months
    //    over the trailing 6 months window. A LeaseContractVehicle counts as
    //    "active" for any month it spent inside that window with status=ACTIVE
    //    on a non-terminated contract.
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
        // Vehicle existed in this month if the contract overlapped it.
        const overlapped = c.startDate <= monthEnd && c.endDate >= monthStart;
        if (!overlapped) continue;
        totalVehicleMonths += 1;
        if (cv.status === 'ACTIVE' && c.status === 'ACTIVE') {
          activeVehicleMonths += 1;
        }
      }
    }
    const utilisationPct = totalVehicleMonths > 0
      ? Math.round((activeVehicleMonths / totalVehicleMonths) * 1000) / 10  // 1dp
      : 0;

    // ── Top-5 contracts by net revenue contribution (paid revenue this YTD
    //    minus unbilled exposure: fines + fuel + overage on the same contract).
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

    return NextResponse.json({
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
        remarketingPL,
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
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
