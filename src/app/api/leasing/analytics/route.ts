import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const last6Months = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [contracts, payments, overages, fines, fuel, insurance, renewals, remarketing, lessees] = await Promise.all([
      prisma.leaseContract2.findMany({ where: { deletedAt: null }, select: { id: true, status: true, monthlyRate: true, totalContractValue: true, startDate: true, endDate: true, lesseeId: true } }),
      prisma.leasePayment2.findMany({ select: { id: true, amount: true, totalAmount: true, status: true, dueDate: true, paidDate: true, periodMonth: true, periodYear: true } }),
      prisma.leaseMileageOverage.findMany({ select: { id: true, overageAmount: true, status: true, createdAt: true } }),
      prisma.leaseTrafficFine.findMany({ select: { id: true, finalAmount: true, fineAmount: true, billingStatus: true, violationDate: true } }),
      prisma.leaseFuelLog.findMany({ select: { id: true, totalCost: true, billingStatus: true, fuelDate: true } }),
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
      },
      charts: {
        revenueByMonth,
        contractsByStatus,
        pendingBillingBreakdown: { fines: pendingFines, fuel: pendingFuel, mileageOverage: pendingOverage },
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
