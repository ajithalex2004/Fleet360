/**
 * RAC Analytics API — /api/rental/analytics
 * Branch P&L, revenue tracking, and operational KPIs
 * GET ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&branchName=X
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

function safe(val: unknown, fallback = 0): number {
  const n = parseFloat(String(val ?? '0'));
  return isNaN(n) ? fallback : n;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const startDate = sp.get('startDate') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const endDate   = sp.get('endDate')   || new Date().toISOString().slice(0, 10);
  const branchName = sp.get('branchName') || null;

  // ── 1. Bookings (Prisma model) ─────────────────────────────────────────────
  let totalRevenue   = 0;
  let totalBookings  = 0;
  let avgRentalDays  = 0;
  let byBranchMap: Record<string, { revenue: number; booking_count: number }> = {};
  let byMonth: Record<string, { revenue: number; bookings: number }> = {};
  let byVehicleType: Record<string, { count: number; revenue: number }> = {};

  try {
    const bookings = await prisma.rentalBooking.findMany({
      where: {
        deletedAt: null,
        pickupDate: { gte: new Date(startDate), lte: new Date(endDate + 'T23:59:59Z') },
      },
      select: {
        totalAmount: true,
        totalDays: true,
        vehicleCategory: true,
        pickupDate: true,
        pickupLocation: true,
      },
    });

    totalBookings = bookings.length;
    totalRevenue  = bookings.reduce((s, b) => s + safe(b.totalAmount), 0);
    avgRentalDays = totalBookings > 0
      ? bookings.reduce((s, b) => s + safe(b.totalDays), 0) / totalBookings
      : 0;

    for (const b of bookings) {
      // by-month
      const mo = b.pickupDate
        ? new Date(b.pickupDate).toISOString().slice(0, 7)
        : 'unknown';
      if (!byMonth[mo]) byMonth[mo] = { revenue: 0, bookings: 0 };
      byMonth[mo].revenue   += safe(b.totalAmount);
      byMonth[mo].bookings  += 1;

      // by vehicle type
      const vt = b.vehicleCategory || 'Other';
      if (!byVehicleType[vt]) byVehicleType[vt] = { count: 0, revenue: 0 };
      byVehicleType[vt].count   += 1;
      byVehicleType[vt].revenue += safe(b.totalAmount);

      // by branch (using pickupLocation as proxy if no branch_id)
      const br = b.pickupLocation || 'Head Office';
      if (!byBranchMap[br]) byBranchMap[br] = { revenue: 0, booking_count: 0 };
      byBranchMap[br].revenue       += safe(b.totalAmount);
      byBranchMap[br].booking_count += 1;
    }
  } catch (_) {
    // bookings table absent or schema mismatch — continue with zeros
  }

  // ── 2. Inquiries (raw table) ───────────────────────────────────────────────
  let totalInquiries = 0;
  let bySourceMap: Record<string, number> = {};
  let inquiryByBranchMap: Record<string, number> = {};

  try {
    const branchFilter = branchName
      ? `AND pickup_location ILIKE '%${branchName.replace(/'/g, "''")}%'`
      : '';
    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT source, pickup_location, COUNT(*)::int AS cnt
      FROM rental_inquiries
      WHERE deleted_at IS NULL
        AND created_at BETWEEN '${startDate}' AND '${endDate} 23:59:59'
        ${branchFilter}
      GROUP BY source, pickup_location
    `);
    for (const r of rows) {
      const src = String(r.source || 'WALK_IN');
      const cnt = safe(r.cnt);
      bySourceMap[src] = (bySourceMap[src] || 0) + cnt;
      totalInquiries += cnt;

      const loc = String(r.pickup_location || 'Head Office');
      inquiryByBranchMap[loc] = (inquiryByBranchMap[loc] || 0) + cnt;
    }
  } catch (_) {
    // table absent
  }

  // ── 3. Quotations (raw table) ──────────────────────────────────────────────
  let totalQuotes    = 0;
  let acceptedQuotes = 0;
  let quoteByBranchMap: Record<string, { count: number; accepted: number }> = {};
  let quoteByMonth: Record<string, number> = {};

  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        status,
        COUNT(*)::int AS cnt
      FROM rental_quotations
      WHERE deleted_at IS NULL
        AND created_at BETWEEN '${startDate}' AND '${endDate} 23:59:59'
      GROUP BY month, status
    `);
    for (const r of rows) {
      const cnt  = safe(r.cnt);
      const mo   = String(r.month || 'unknown');
      const stat = String(r.status || '');
      totalQuotes += cnt;
      quoteByMonth[mo] = (quoteByMonth[mo] || 0) + cnt;
      if (['ACCEPTED', 'CONVERTED', 'CONFIRMED'].includes(stat.toUpperCase())) {
        acceptedQuotes += cnt;
      }
    }
  } catch (_) {
    // table absent
  }

  // ── 4. Handovers (raw table) ───────────────────────────────────────────────
  let totalPickups      = 0;
  let totalReturns      = 0;
  let avgConditionScore = 0;
  let avgFuelAtReturn   = 0;

  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT
        handover_type,
        AVG(condition_score)::numeric(5,2) AS avg_condition,
        AVG(fuel_level)::numeric(5,2)      AS avg_fuel,
        COUNT(*)::int                       AS cnt
      FROM rental_handovers
      WHERE created_at BETWEEN '${startDate}' AND '${endDate} 23:59:59'
      GROUP BY handover_type
    `);
    let condSum = 0, condCount = 0, fuelSum = 0, fuelCount = 0;
    for (const r of rows) {
      const cnt  = safe(r.cnt);
      const type = String(r.handover_type || '').toUpperCase();
      if (type === 'PICKUP') totalPickups = cnt;
      if (type === 'RETURN') {
        totalReturns   = cnt;
        fuelSum       += safe(r.avg_fuel) * cnt;
        fuelCount     += cnt;
      }
      condSum   += safe(r.avg_condition) * cnt;
      condCount += cnt;
    }
    avgConditionScore = condCount > 0 ? condSum / condCount : 0;
    avgFuelAtReturn   = fuelCount > 0 ? fuelSum / fuelCount : 0;
  } catch (_) {
    // table absent
  }

  // ── Build by_branch array ──────────────────────────────────────────────────
  const allBranchKeys = new Set([
    ...Object.keys(byBranchMap),
    ...Object.keys(inquiryByBranchMap),
    ...Object.keys(quoteByBranchMap),
  ]);

  const emirateOf = (name: string): string => {
    const n = name.toUpperCase();
    if (n.includes('DUBAI'))     return 'DUBAI';
    if (n.includes('ABU DHABI') || n.includes('ABUDHABI')) return 'ABU DHABI';
    if (n.includes('SHARJAH'))   return 'SHARJAH';
    if (n.includes('AJMAN'))     return 'AJMAN';
    if (n.includes('RAK'))       return 'RAS AL KHAIMAH';
    if (n.includes('FUJAIRAH'))  return 'FUJAIRAH';
    if (n.includes('UMM'))       return 'UMM AL QUWAIN';
    return 'UAE';
  };

  const byBranch = Array.from(allBranchKeys).map((brName) => {
    const bk     = byBranchMap[brName]    || { revenue: 0, booking_count: 0 };
    const iq     = inquiryByBranchMap[brName] || 0;
    const qt     = quoteByBranchMap[brName]   || { count: 0, accepted: 0 };
    const cvRate = qt.count > 0 ? Math.round((qt.accepted / qt.count) * 100) : 0;
    return {
      branch_name:      brName,
      emirate:          emirateOf(brName),
      revenue:          Math.round(bk.revenue * 100) / 100,
      booking_count:    bk.booking_count,
      inquiry_count:    iq,
      quote_count:      qt.count,
      accepted_quotes:  qt.accepted,
      conversion_rate:  cvRate,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // ── Build by_month array ───────────────────────────────────────────────────
  const allMonths = new Set([...Object.keys(byMonth), ...Object.keys(quoteByMonth)]);
  const byMonthArr = Array.from(allMonths)
    .sort()
    .map((mo) => {
      const bm = byMonth[mo]     || { revenue: 0, bookings: 0 };
      return {
        month:     mo,
        revenue:   Math.round(bm.revenue * 100) / 100,
        bookings:  bm.bookings,
        inquiries: 0, // inquiries don't have reliable month grouping without date
      };
    });

  // ── Build by_vehicle_type array ────────────────────────────────────────────
  const totalVehicleCount = Object.values(byVehicleType).reduce((s, v) => s + v.count, 0);
  const byVehicleTypeArr = Object.entries(byVehicleType)
    .map(([vt, stats]) => ({
      vehicle_type: vt,
      count:        stats.count,
      revenue:      Math.round(stats.revenue * 100) / 100,
      share_pct:    totalVehicleCount > 0 ? Math.round((stats.count / totalVehicleCount) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Build by_source array ──────────────────────────────────────────────────
  const bySourceArr = Object.entries(bySourceMap)
    .map(([source, count]) => ({
      source,
      count,
      pct: totalInquiries > 0 ? Math.round((count / totalInquiries) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Quote conversion rate ──────────────────────────────────────────────────
  const quoteConversionRate = totalQuotes > 0
    ? Math.round((acceptedQuotes / totalQuotes) * 100)
    : 0;

  return NextResponse.json({
    period: { start: startDate, end: endDate },
    overview: {
      total_revenue:         Math.round(totalRevenue * 100) / 100,
      total_bookings:        totalBookings,
      avg_rental_days:       Math.round(avgRentalDays * 10) / 10,
      total_inquiries:       totalInquiries,
      total_quotes:          totalQuotes,
      accepted_quotes:       acceptedQuotes,
      quote_conversion_rate: quoteConversionRate,
    },
    by_branch:       byBranch,
    by_month:        byMonthArr,
    by_vehicle_type: byVehicleTypeArr,
    by_source:       bySourceArr,
    handover_stats: {
      total_pickups:      totalPickups,
      total_returns:      totalReturns,
      avg_condition_score: Math.round(avgConditionScore * 10) / 10,
      avg_fuel_at_return:  Math.round(avgFuelAtReturn * 10) / 10,
    },
    quotations_pipeline: {
      inquiries:   totalInquiries,
      quotations:  totalQuotes,
      accepted:    acceptedQuotes,
      bookings:    totalBookings,
    },
  });
}
