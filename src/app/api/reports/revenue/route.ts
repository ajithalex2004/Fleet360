export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

type Period = 'monthly' | 'quarterly' | 'yearly';
type Bucket = { label: string; start: Date; end: Date };

function buildBuckets(period: Period, now: Date): Bucket[] {
  const buckets: Bucket[] = [];

  if (period === 'yearly') {
    for (let i = 2; i >= 0; i--) {
      const year = now.getUTCFullYear() - i;
      buckets.push({
        label: String(year),
        start: new Date(Date.UTC(year, 0, 1)),
        end: i === 0 ? now : new Date(Date.UTC(year + 1, 0, 1)),
      });
    }
  } else if (period === 'quarterly') {
    const currentQuarterIndex = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3);
    for (let i = 3; i >= 0; i--) {
      const qIndex = currentQuarterIndex - i;
      const year = Math.floor(qIndex / 4);
      const q = qIndex % 4;
      buckets.push({
        label: `Q${q + 1} ${year}`,
        start: new Date(Date.UTC(year, q * 3, 1)),
        end: i === 0 ? now : new Date(Date.UTC(year, q * 3 + 3, 1)),
      });
    }
  } else {
    const currentMonthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
    for (let i = 5; i >= 0; i--) {
      const mIndex = currentMonthIndex - i;
      const year = Math.floor(mIndex / 12);
      const month = mIndex % 12;
      buckets.push({
        label: new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        start: new Date(Date.UTC(year, month, 1)),
        end: i === 0 ? now : new Date(Date.UTC(year, month + 1, 1)),
      });
    }
  }

  return buckets;
}

function sumInBucket<T>(records: T[], getDate: (r: T) => Date | null, getAmount: (r: T) => number, bucket: Bucket): number {
  return records.reduce((sum, r) => {
    const d = getDate(r);
    if (!d || d.getTime() < bucket.start.getTime() || d.getTime() > bucket.end.getTime()) return sum;
    return sum + getAmount(r);
  }, 0);
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const period = (req.nextUrl.searchParams.get('period') as Period) || 'monthly';
      const now = new Date();
      const buckets = buildBuckets(period, now);
      const lookbackStart = buckets[0].start;

      const [rentalInvoices, leaseInvoices, financeInvoices, maintenanceRequests] = await Promise.all([
        tx.rentalInvoice.findMany({
          where: { tenantId, invoiceDate: { gte: lookbackStart, lte: now }, status: { notIn: ['VOID', 'DRAFT'] } },
          select: { invoiceDate: true, totalAmount: true },
        }),
        tx.leaseInvoice.findMany({
          where: { tenantId, issueDate: { gte: lookbackStart, lte: now }, status: { notIn: ['CANCELLED', 'DRAFT'] } },
          select: { issueDate: true, totalAmount: true },
        }),
        tx.financeInvoice.findMany({
          where: { tenantId, issueDate: { gte: lookbackStart, lte: now } },
          select: { issueDate: true, totalAmount: true, module: true },
        }),
        tx.maintenanceRequest.findMany({
          where: {
            tenantId,
            deletedAt: null,
            OR: [
              { completionDate: { gte: lookbackStart, lte: now } },
              { completionDate: null, requestDate: { gte: lookbackStart, lte: now } },
            ],
          },
          select: { completionDate: true, requestDate: true, actualCost: true, estimatedCost: true },
        }),
      ]);

      // FinanceInvoice is a general-purpose polymorphic ledger that can
      // mirror rental/leasing charges; excluding those modules here avoids
      // double-counting revenue already captured above.
      const otherInvoices = financeInvoices.filter(f => {
        const m = (f.module || '').toLowerCase();
        return !m.includes('rental') && !m.includes('leas');
      });

      const trendData = buckets.map(bucket => {
        const rentalRevenue = sumInBucket(rentalInvoices, r => r.invoiceDate, r => Number(r.totalAmount), bucket);
        const leasingRevenue = sumInBucket(leaseInvoices, r => r.issueDate, r => Number(r.totalAmount), bucket);
        const otherRevenue = sumInBucket(otherInvoices, r => r.issueDate, r => Number(r.totalAmount), bucket);
        const totalCosts = sumInBucket(
          maintenanceRequests,
          r => r.completionDate ?? r.requestDate,
          r => Number(r.actualCost ?? r.estimatedCost ?? 0),
          bucket,
        );
        const totalRevenue = rentalRevenue + leasingRevenue + otherRevenue;
        const netProfit = totalRevenue - totalCosts;
        const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        return { month: bucket.label, totalRevenue, rentalRevenue, leasingRevenue, otherRevenue, totalCosts, netProfit, margin };
      });

      const summary = trendData.reduce(
        (acc, row) => ({
          totalRevenue: acc.totalRevenue + row.totalRevenue,
          rentalRevenue: acc.rentalRevenue + row.rentalRevenue,
          leasingRevenue: acc.leasingRevenue + row.leasingRevenue,
          otherRevenue: acc.otherRevenue + row.otherRevenue,
          totalCosts: acc.totalCosts + row.totalCosts,
        }),
        { totalRevenue: 0, rentalRevenue: 0, leasingRevenue: 0, otherRevenue: 0, totalCosts: 0 },
      );
      const netProfit = summary.totalRevenue - summary.totalCosts;
      const marginPercent = summary.totalRevenue > 0 ? (netProfit / summary.totalRevenue) * 100 : 0;

      return NextResponse.json({
        summary: { ...summary, netProfit, marginPercent },
        trendData,
      });
    } catch (e) {
      console.error('Failed to build revenue report:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}
