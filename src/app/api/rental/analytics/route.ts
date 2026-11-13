export const dynamic = 'force-dynamic';

/**
 * RAC Analytics API — /api/rental/analytics
 * Branch P&L, revenue tracking, and operational KPIs
 * GET ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&branchName=X
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { escapeIlikePattern } from '@/lib/rental/security-guards';

type Row = Record<string, unknown>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function safe(val: unknown, fallback = 0): number {
  const n = parseFloat(String(val ?? '0'));
  return Number.isNaN(n) ? fallback : n;
}

function normalizeIsoDate(raw: string | null, fallbackDate: Date): string {
  const trimmed = (raw ?? '').trim();
  if (!ISO_DATE_RE.test(trimmed)) {
    return fallbackDate.toISOString().slice(0, 10);
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    return fallbackDate.toISOString().slice(0, 10);
  }
  return trimmed;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'analytics',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 90 * 86_400_000);
    const startDate = normalizeIsoDate(sp.get('startDate'), defaultStart);
    const endDate = normalizeIsoDate(sp.get('endDate'), now);
    const startTs = `${startDate}T00:00:00.000Z`;
    const endTs = `${endDate}T23:59:59.999Z`;
    const rawBranch = sp.get('branchName')?.trim() ?? '';
    const branchName = rawBranch ? rawBranch.slice(0, 120) : null;
    const branchLike = branchName ? `%${escapeIlikePattern(branchName)}%` : null;

    // ── 1. Bookings (Prisma model) ─────────────────────────────────────────────
    let totalRevenue = 0;
    let totalBookings = 0;
    let avgRentalDays = 0;
    const byBranchMap: Record<string, { revenue: number; booking_count: number }> = {};
    const byMonth: Record<string, { revenue: number; bookings: number }> = {};
    const byVehicleType: Record<string, { count: number; revenue: number }> = {};

    const bookings = await withSavepoint(
      tx,
      'analytics_bookings',
      () =>
        tx.rentalBooking.findMany({
          where: {
            tenantId,
            deletedAt: null,
            pickupDate: { gte: new Date(startTs), lte: new Date(endTs) },
            ...(branchName
              ? { pickupLocation: { contains: branchName, mode: 'insensitive' as const } }
              : {}),
          },
          select: {
            totalAmount: true,
            totalDays: true,
            vehicleCategory: true,
            pickupDate: true,
            pickupLocation: true,
          },
        }),
      [],
    );

    totalBookings = bookings.length;
    totalRevenue = bookings.reduce((s, b) => s + safe(b.totalAmount), 0);
    avgRentalDays =
      totalBookings > 0
        ? bookings.reduce((s, b) => s + safe(b.totalDays), 0) / totalBookings
        : 0;

    for (const b of bookings) {
      const mo = b.pickupDate ? new Date(b.pickupDate).toISOString().slice(0, 7) : 'unknown';
      if (!byMonth[mo]) byMonth[mo] = { revenue: 0, bookings: 0 };
      byMonth[mo].revenue += safe(b.totalAmount);
      byMonth[mo].bookings += 1;

      const vt = b.vehicleCategory || 'Other';
      if (!byVehicleType[vt]) byVehicleType[vt] = { count: 0, revenue: 0 };
      byVehicleType[vt].count += 1;
      byVehicleType[vt].revenue += safe(b.totalAmount);

      const br = b.pickupLocation || 'Head Office';
      if (!byBranchMap[br]) byBranchMap[br] = { revenue: 0, booking_count: 0 };
      byBranchMap[br].revenue += safe(b.totalAmount);
      byBranchMap[br].booking_count += 1;
    }

    // ── 2. Inquiries (raw table, parameterized + savepoint) ────────────────────
    let totalInquiries = 0;
    const bySourceMap: Record<string, number> = {};
    const inquiryByBranchMap: Record<string, number> = {};
    const inquiryByMonth: Record<string, number> = {};

    const inquiryRows = await withSavepoint<Row[]>(
      tx,
      'analytics_inquiries',
      () =>
        branchLike
          ? tx.$queryRawUnsafe<Row[]>(
              `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, source, pickup_location, COUNT(*)::int AS cnt
                 FROM rental_inquiries
                WHERE deleted_at IS NULL
                  AND tenant_id = $1
                  AND created_at BETWEEN $2::timestamptz AND $3::timestamptz
                  AND pickup_location ILIKE $4 ESCAPE '\\'
                GROUP BY TO_CHAR(created_at, 'YYYY-MM'), source, pickup_location`,
              tenantId,
              startTs,
              endTs,
              branchLike,
            )
          : tx.$queryRawUnsafe<Row[]>(
              `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, source, pickup_location, COUNT(*)::int AS cnt
                 FROM rental_inquiries
                WHERE deleted_at IS NULL
                  AND tenant_id = $1
                  AND created_at BETWEEN $2::timestamptz AND $3::timestamptz
                GROUP BY TO_CHAR(created_at, 'YYYY-MM'), source, pickup_location`,
              tenantId,
              startTs,
              endTs,
            ),
      [],
    );

    for (const r of inquiryRows) {
      const src = String(r.source || 'WALK_IN');
      const cnt = safe(r.cnt);
      bySourceMap[src] = (bySourceMap[src] || 0) + cnt;
      totalInquiries += cnt;

      const loc = String(r.pickup_location || 'Head Office');
      inquiryByBranchMap[loc] = (inquiryByBranchMap[loc] || 0) + cnt;

      if (typeof r.month === 'string' && r.month.trim()) {
        const mo = r.month.trim();
        inquiryByMonth[mo] = (inquiryByMonth[mo] || 0) + cnt;
      }
    }

    // ── 3. Quotations (raw table, parameterized + savepoint) ───────────────────
    let totalQuotes = 0;
    let acceptedQuotes = 0;
    const quoteByBranchMap: Record<string, { count: number; accepted: number }> = {};
    const quoteByMonth: Record<string, number> = {};

    const quoteRows = await withSavepoint<Row[]>(
      tx,
      'analytics_quotations',
      () =>
        branchLike
          ? tx.$queryRawUnsafe<Row[]>(
              `SELECT
                 TO_CHAR(rq.created_at, 'YYYY-MM') AS month,
                 rq.status,
                 COALESCE(
                   NULLIF(to_jsonb(rq)->>'pickup_location', ''),
                   NULLIF(to_jsonb(rq)->>'branch_name', ''),
                   ri.pickup_location,
                   'Head Office'
                 ) AS pickup_location,
                 COUNT(*)::int AS cnt
               FROM rental_quotations rq
               LEFT JOIN rental_inquiries ri
                 ON ri.id::text = (to_jsonb(rq)->>'inquiry_id')
                AND ri.tenant_id = rq.tenant_id
               WHERE rq.deleted_at IS NULL
                 AND rq.tenant_id = $1
                 AND rq.created_at BETWEEN $2::timestamptz AND $3::timestamptz
                 AND COALESCE(
                   NULLIF(to_jsonb(rq)->>'pickup_location', ''),
                   NULLIF(to_jsonb(rq)->>'branch_name', ''),
                   ri.pickup_location,
                   'Head Office'
                 ) ILIKE $4 ESCAPE '\\'
               GROUP BY month, rq.status, 3`,
              tenantId,
              startTs,
              endTs,
              branchLike,
            )
          : tx.$queryRawUnsafe<Row[]>(
              `SELECT
                 TO_CHAR(rq.created_at, 'YYYY-MM') AS month,
                 rq.status,
                 COALESCE(
                   NULLIF(to_jsonb(rq)->>'pickup_location', ''),
                   NULLIF(to_jsonb(rq)->>'branch_name', ''),
                   ri.pickup_location,
                   'Head Office'
                 ) AS pickup_location,
                 COUNT(*)::int AS cnt
               FROM rental_quotations rq
               LEFT JOIN rental_inquiries ri
                 ON ri.id::text = (to_jsonb(rq)->>'inquiry_id')
                AND ri.tenant_id = rq.tenant_id
               WHERE rq.deleted_at IS NULL
                 AND rq.tenant_id = $1
                 AND rq.created_at BETWEEN $2::timestamptz AND $3::timestamptz
               GROUP BY month, rq.status, 3`,
              tenantId,
              startTs,
              endTs,
            ),
      [],
    );

    for (const r of quoteRows) {
      const cnt = safe(r.cnt);
      const mo = String(r.month || 'unknown');
      const stat = String(r.status || '');
      const isAccepted = ['ACCEPTED', 'CONVERTED', 'CONFIRMED'].includes(stat.toUpperCase());
      totalQuotes += cnt;
      quoteByMonth[mo] = (quoteByMonth[mo] || 0) + cnt;
      if (isAccepted) {
        acceptedQuotes += cnt;
      }

      if (r.pickup_location !== undefined || r.branch_name !== undefined) {
        const brLoc = String(r.pickup_location ?? r.branch_name ?? 'Head Office') || 'Head Office';
        if (!quoteByBranchMap[brLoc]) quoteByBranchMap[brLoc] = { count: 0, accepted: 0 };
        quoteByBranchMap[brLoc].count += cnt;
        if (isAccepted) {
          quoteByBranchMap[brLoc].accepted += cnt;
        }
      }
    }

    // ── 4. Inspections / Handovers (vehicle_inspections, parameterized + savepoint) ──
    let totalPickups = 0;
    let totalReturns = 0;
    const avgConditionScore = 0;
    let avgFuelAtReturn = 0;

    const inspectionRows = await withSavepoint<Row[]>(
      tx,
      'analytics_inspections',
      () =>
        tx.$queryRawUnsafe<Row[]>(
          `SELECT
             LOWER(COALESCE(type, '')) AS insp_type,
             AVG(fuel_level)::numeric(5,2) AS avg_fuel,
             COUNT(fuel_level)::int AS fuel_cnt,
             COUNT(*)::int AS cnt
           FROM vehicle_inspections
           WHERE tenant_id = $1
             AND created_at BETWEEN $2::timestamptz AND $3::timestamptz
           GROUP BY LOWER(COALESCE(type, ''))`,
          tenantId,
          startTs,
          endTs,
        ),
      [],
    );

    let fuelSum = 0;
    let fuelCount = 0;
    for (const r of inspectionRows) {
      const cnt = safe(r.cnt);
      const inspType = String(r.insp_type ?? r.type ?? '').toLowerCase();
      if (['checkin', 'pickup', 'pre_rental', 'pre-rental'].includes(inspType)) {
        totalPickups += cnt;
      } else if (['checkout', 'return', 'post_rental', 'post-rental'].includes(inspType)) {
        totalReturns += cnt;
        const fCnt = r.fuel_cnt !== undefined ? safe(r.fuel_cnt) : r.avg_fuel != null ? cnt : 0;
        if (fCnt > 0 && r.avg_fuel != null) {
          fuelSum += safe(r.avg_fuel) * fCnt;
          fuelCount += fCnt;
        }
      }
    }
    avgFuelAtReturn = fuelCount > 0 ? fuelSum / fuelCount : 0;

    // ── Build by_branch array ──────────────────────────────────────────────────
    const allBranchKeys = new Set([
      ...Object.keys(byBranchMap),
      ...Object.keys(inquiryByBranchMap),
      ...Object.keys(quoteByBranchMap),
    ]);

    const emirateOf = (name: string): string => {
      const n = name.toUpperCase();
      if (n.includes('DUBAI')) return 'DUBAI';
      if (n.includes('ABU DHABI') || n.includes('ABUDHABI')) return 'ABU DHABI';
      if (n.includes('SHARJAH')) return 'SHARJAH';
      if (n.includes('AJMAN')) return 'AJMAN';
      if (n.includes('RAK')) return 'RAS AL KHAIMAH';
      if (n.includes('FUJAIRAH')) return 'FUJAIRAH';
      if (n.includes('UMM')) return 'UMM AL QUWAIN';
      return 'UAE';
    };

    const byBranch = Array.from(allBranchKeys)
      .map((brName) => {
        const bk = byBranchMap[brName] || { revenue: 0, booking_count: 0 };
        const iq = inquiryByBranchMap[brName] || 0;
        const qt = quoteByBranchMap[brName] || { count: 0, accepted: 0 };
        const cvRate = qt.count > 0 ? Math.round((qt.accepted / qt.count) * 100) : 0;
        return {
          branch_name: brName,
          emirate: emirateOf(brName),
          revenue: Math.round(bk.revenue * 100) / 100,
          booking_count: bk.booking_count,
          inquiry_count: iq,
          quote_count: qt.count,
          accepted_quotes: qt.accepted,
          conversion_rate: cvRate,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // ── Build by_month array ───────────────────────────────────────────────────
    const allMonths = new Set([
      ...Object.keys(byMonth),
      ...Object.keys(quoteByMonth),
      ...Object.keys(inquiryByMonth),
    ]);
    const byMonthArr = Array.from(allMonths)
      .sort()
      .map((mo) => {
        const bm = byMonth[mo] || { revenue: 0, bookings: 0 };
        return {
          month: mo,
          revenue: Math.round(bm.revenue * 100) / 100,
          bookings: bm.bookings,
          inquiries: inquiryByMonth[mo] || 0,
        };
      });

    // ── Build by_vehicle_type array ────────────────────────────────────────────
    const totalVehicleCount = Object.values(byVehicleType).reduce((s, v) => s + v.count, 0);
    const byVehicleTypeArr = Object.entries(byVehicleType)
      .map(([vt, stats]) => ({
        vehicle_type: vt,
        count: stats.count,
        revenue: Math.round(stats.revenue * 100) / 100,
        share_pct: totalVehicleCount > 0 ? Math.round((stats.count / totalVehicleCount) * 100) : 0,
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
    const quoteConversionRate =
      totalQuotes > 0 ? Math.round((acceptedQuotes / totalQuotes) * 100) : 0;

    return NextResponse.json({
      period: { start: startDate, end: endDate },
      overview: {
        total_revenue: Math.round(totalRevenue * 100) / 100,
        total_bookings: totalBookings,
        avg_rental_days: Math.round(avgRentalDays * 10) / 10,
        total_inquiries: totalInquiries,
        total_quotes: totalQuotes,
        accepted_quotes: acceptedQuotes,
        quote_conversion_rate: quoteConversionRate,
      },
      by_branch: byBranch,
      by_month: byMonthArr,
      by_vehicle_type: byVehicleTypeArr,
      by_source: bySourceArr,
      handover_stats: {
        total_pickups: totalPickups,
        total_returns: totalReturns,
        avg_condition_score: Math.round(avgConditionScore * 10) / 10,
        avg_fuel_at_return: Math.round(avgFuelAtReturn * 10) / 10,
      },
      quotations_pipeline: {
        inquiries: totalInquiries,
        quotations: totalQuotes,
        accepted: acceptedQuotes,
        bookings: totalBookings,
      },
    });
  });
}
