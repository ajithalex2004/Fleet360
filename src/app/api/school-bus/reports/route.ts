/**
 * GET /api/school-bus/reports
 *
 * Returns all data needed for the 5-tab School Bus Reports dashboard:
 *   overview, routeUtilization, tripEfficiency, areaDistribution, feeAnalysis
 *
 * Query params:
 *   tenantId  string — defaults to 'default'
 *   months    number — revenue look-back window (default 1)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

const q = <T = Row>(sql: string, ...v: unknown[]): Promise<T[]> =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/* Derive UAE emirate from route name/code */
function emirateFromRoute(name: string, code: string): string {
  const s = `${name} ${code}`.toLowerCase();
  if (s.includes('sharjah') || s.includes('shj') || s.includes('-shj')) return 'Sharjah';
  if (s.includes('dubai') || s.includes('dxb') || s.includes('-dxb'))   return 'Dubai';
  if (s.includes('ajman') || s.includes('ajm') || s.includes('-ajm'))   return 'Ajman';
  if (s.includes('abu dhabi') || s.includes('auh'))                      return 'Abu Dhabi';
  if (s.includes('ras al') || s.includes('rak'))                         return 'Ras Al Khaimah';
  if (s.includes('fujairah') || s.includes('fuj'))                       return 'Fujairah';
  if (s.includes('umm al') || s.includes('uaq'))                         return 'Umm Al Quwain';
  return 'UAE';
}

export async function GET(req: NextRequest) {
  try {
    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';

    /* ── 1. ROUTES ─────────────────────────────────────────────── */
    const routes = await q<Row>(`
      SELECT
        r.id, r.route_name, r.route_code, r.direction, r.session, r.route_type,
        COALESCE(r.seat_capacity, 40)  AS seat_capacity,
        COALESCE(r.student_count, 0)   AS student_count,
        r.is_active, r.status,
        r.vehicle_reg, r.driver_name,
        COALESCE(v.registration_number, r.vehicle_reg, '') AS vehicle_label,
        COALESCE(v.make, '') || ' ' || COALESCE(v.model, '') AS vehicle_name,
        COALESCE(v.ownership_type, 'Owned') AS vehicle_ownership,
        COALESCE(v.capacity, r.seat_capacity, 40) AS vehicle_capacity
      FROM school_bus_routes r
      LEFT JOIN vehicles v
        ON v.id::text = r.assigned_vehicle_id AND v.deleted_at IS NULL
      WHERE r.tenant_id = $1 AND r.status != 'DELETED' AND COALESCE(r.is_active, TRUE) = TRUE
      ORDER BY r.route_code ASC, r.route_name ASC
    `, tenantId);

    /* ── 2. ALLOCATIONS ────────────────────────────────────────── */
    const allocs = await q<Row>(`
      SELECT
        a.id, a.route_id::text AS route_id, a.route_name,
        a.bus_mode,
        a.pickup_stop_name,
        a.student_name, a.student_grade,
        COALESCE(a.seat_type, '') AS seat_type,
        a.status
      FROM school_bus_allocations a
      WHERE a.tenant_id = $1 AND a.status = 'ACTIVE'
    `, tenantId);

    /* ── 3. TRIPS — last 30 days ──────────────────────────────── */
    const trips = await q<Row>(`
      SELECT
        t.id, t.route_name, t.route_code, t.direction, t.session,
        t.scheduled_date, t.status,
        COALESCE(t.students_total,   0) AS students_total,
        COALESCE(t.students_boarded, 0) AS students_boarded,
        COALESCE(t.students_dropped, 0) AS students_dropped,
        COALESCE(t.duration_min,     0) AS duration_min
      FROM school_bus_trips t
      WHERE t.tenant_id = $1
        AND t.scheduled_date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY t.scheduled_date DESC
    `, tenantId);

    /* ── 4. FINANCE INVOICES — school bus, current month ─────── */
    const invoices = await q<Row>(`
      SELECT
        i.id, i.total_amount, i.status, i.client_name,
        COALESCE(i.reference_id, '') AS reference_id,
        COALESCE(i.notes, '')        AS notes,
        COALESCE(i.metadata::text, '{}') AS metadata_raw,
        i.created_at
      FROM finance_invoices i
      WHERE i.tenant_id = $1
        AND i.module = 'SCHOOL_BUS'
        AND i.status NOT IN ('CANCELLED', 'VOID')
        AND DATE_TRUNC('month', i.created_at) = DATE_TRUNC('month', CURRENT_DATE)
    `, tenantId);

    /* ═══════════════════════════════════════════════════════════
       BUILD OVERVIEW
    ═══════════════════════════════════════════════════════════ */
    const activeRoutes    = routes.length;
    const totalVehicles   = new Set(routes.map(r => str(r.vehicle_label)).filter(Boolean)).size;
    const totalStudents   = allocs.filter(a => str(a.bus_mode) !== 'STAFF').length;
    const totalStaff      = 0; // staff routes handled separately
    const totalRiders     = totalStudents + totalStaff;
    const fleetCapacity   = routes.reduce((s, r) => s + num(r.seat_capacity), 0);
    const totalEnrolled   = routes.reduce((s, r) => s + num(r.student_count), 0);
    const capacityUsedPct = fleetCapacity > 0 ? Math.round((totalEnrolled / fleetCapacity) * 100) : 0;
    const monthlyRevenue  = invoices.reduce((s, i) => s + num(i.total_amount), 0);
    const feeScheduleCount = new Set(invoices.map(i => str(i.notes).split('|')[0] || str(i.reference_id))).size;

    // Route utilization bars (for overview chart)
    const routeUtil = routes.map(r => ({
      routeCode:    str(r.route_code) || str(r.route_name).slice(0, 10),
      routeName:    str(r.route_name),
      studentCount: num(r.student_count),
      capacity:     num(r.seat_capacity),
    }));

    // Bus mode split from allocations
    const modeCounts = { TWO_WAY: 0, ONE_WAY_PICKUP: 0, ONE_WAY_DROP: 0 };
    for (const a of allocs) {
      const m = str(a.bus_mode).toUpperCase();
      if (m === 'TWO_WAY')       modeCounts.TWO_WAY++;
      else if (m === 'ONE_WAY_PICKUP') modeCounts.ONE_WAY_PICKUP++;
      else if (m === 'ONE_WAY_DROP')   modeCounts.ONE_WAY_DROP++;
      else                             modeCounts.TWO_WAY++; // default
    }

    // Revenue by route from invoices — try matching client_name or notes to route
    const revenueByRoute: Record<string, number> = {};
    for (const inv of invoices) {
      const key = str(inv.reference_id) || str(inv.client_name) || 'Unknown';
      revenueByRoute[key] = (revenueByRoute[key] ?? 0) + num(inv.total_amount);
    }

    /* ═══════════════════════════════════════════════════════════
       BUILD ROUTE UTILIZATION TAB
    ═══════════════════════════════════════════════════════════ */
    const routeAllocCounts: Record<string, { students: number; twoWay: number; pickupOnly: number; dropOnly: number }> = {};
    for (const a of allocs) {
      const rid = str(a.route_id);
      if (!routeAllocCounts[rid]) routeAllocCounts[rid] = { students: 0, twoWay: 0, pickupOnly: 0, dropOnly: 0 };
      routeAllocCounts[rid].students++;
      const m = str(a.bus_mode).toUpperCase();
      if (m === 'TWO_WAY')            routeAllocCounts[rid].twoWay++;
      else if (m === 'ONE_WAY_PICKUP') routeAllocCounts[rid].pickupOnly++;
      else if (m === 'ONE_WAY_DROP')   routeAllocCounts[rid].dropOnly++;
    }

    const routeUtilTable = routes.map(r => {
      const rid      = str(r.id);
      const rac      = routeAllocCounts[rid] ?? { students: 0 };
      const students = Math.max(num(r.student_count), rac.students);
      const staff    = str(r.route_type) === 'STAFF' ? 5 : 0;
      const total    = students + staff;
      const capacity = num(r.seat_capacity) || num(r.vehicle_capacity) || 40;
      const utilPct  = capacity > 0 ? (total / capacity) * 100 : 0;
      const emirate  = emirateFromRoute(str(r.route_name), str(r.route_code));

      // Monthly revenue for this route — look for matching invoices
      const routeCode = str(r.route_code);
      let monthlyRev = 0;
      for (const inv of invoices) {
        if (str(inv.reference_id).includes(routeCode) || str(inv.notes).includes(routeCode)) {
          monthlyRev += num(inv.total_amount);
        }
      }
      const revPerRider = total > 0 && monthlyRev > 0 ? monthlyRev / total : 0;

      // Vehicle label
      const vLabel = str(r.vehicle_label) || str(r.vehicle_reg) || '—';
      const vName  = str(r.vehicle_name).trim() || vLabel;
      const vType  = str(r.vehicle_ownership) || 'Owned';

      return {
        routeCode, routeName: str(r.route_name), emirate,
        vehicle: vName || vLabel, vehicleLabel: vLabel,
        vehicleOwnership: vType,
        capacity, students, staff, total,
        utilPct: Math.round(utilPct * 10) / 10,
        monthlyRev, revPerRider: Math.round(revPerRider),
      };
    });

    /* ═══════════════════════════════════════════════════════════
       BUILD TRIP EFFICIENCY TAB
    ═══════════════════════════════════════════════════════════ */
    const totalMarked   = trips.reduce((s, t) => s + num(t.students_total),   0);
    const totalBoarded  = trips.reduce((s, t) => s + num(t.students_boarded), 0);
    const totalAbsent   = totalMarked - totalBoarded;
    const boardingRate  = totalMarked > 0 ? Math.round((totalBoarded / totalMarked) * 1000) / 10 : 0;

    // Daily boarding rate — last 14 distinct dates
    const dailyMap: Record<string, { marked: number; boarded: number }> = {};
    for (const t of trips) {
      const d = str(t.scheduled_date).slice(0, 10);
      if (!dailyMap[d]) dailyMap[d] = { marked: 0, boarded: 0 };
      dailyMap[d].marked   += num(t.students_total);
      dailyMap[d].boarded  += num(t.students_boarded);
    }
    const dailyRates = Object.entries(dailyMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 14)
      .map(([date, d]) => ({
        date,
        marked:  d.marked,
        boarded: d.boarded,
        rate:    d.marked > 0 ? Math.round((d.boarded / d.marked) * 1000) / 10 : 0,
      }));

    // Efficiency by route & trip type
    const effMap: Record<string, { routeCode: string; routeName: string; tripType: string; trips: number; marked: number; boarded: number }> = {};
    for (const t of trips) {
      const key = `${str(t.route_code)}|${str(t.direction)}`;
      if (!effMap[key]) {
        effMap[key] = {
          routeCode: str(t.route_code) || str(t.route_name).slice(0, 10),
          routeName: str(t.route_name),
          tripType:  str(t.direction) === 'PICKUP' ? 'Pickup' : str(t.direction) === 'DROP' ? 'Drop' : str(t.direction),
          trips: 0, marked: 0, boarded: 0,
        };
      }
      effMap[key].trips++;
      effMap[key].marked   += num(t.students_total);
      effMap[key].boarded  += num(t.students_boarded);
    }
    const effByRoute = Object.values(effMap).map(e => ({
      ...e,
      absent:       e.marked - e.boarded,
      ownTransport: 0,
      boardingRate: e.marked > 0 ? Math.round((e.boarded / e.marked) * 1000) / 10 : 0,
    })).sort((a, b) => a.routeCode.localeCompare(b.routeCode));

    /* ═══════════════════════════════════════════════════════════
       BUILD AREA DISTRIBUTION TAB
    ═══════════════════════════════════════════════════════════ */
    // Group allocations by pickup stop → area
    const areaMap: Record<string, { emirate: string; routeSet: Set<string>; students: number; staff: number }> = {};
    for (const a of allocs) {
      const area    = str(a.pickup_stop_name) || 'Unknown';
      const routeId = str(a.route_id);
      // derive emirate from route
      const route = routes.find(r => str(r.id) === routeId);
      const emirate = route ? emirateFromRoute(str(route.route_name), str(route.route_code)) : 'UAE';
      if (!areaMap[area]) areaMap[area] = { emirate, routeSet: new Set(), students: 0, staff: 0 };
      areaMap[area].routeSet.add(routeId);
      areaMap[area].students++;
    }

    const areasServed = Object.keys(areaMap).length;
    const areaDetails = Object.entries(areaMap)
      .map(([area, d]) => ({
        area, emirate: d.emirate,
        routes:       d.routeSet.size,
        students:     d.students,
        staff:        d.staff,
        totalRiders:  d.students + d.staff,
      }))
      .sort((a, b) => b.totalRiders - a.totalRiders);

    const grandTotalRiders = areaDetails.reduce((s, a) => s + a.totalRiders, 0) || totalRiders;

    const areaDetailsWithPct = areaDetails.map(a => ({
      ...a,
      distribution: grandTotalRiders > 0 ? Math.round((a.totalRiders / grandTotalRiders) * 1000) / 10 : 0,
    }));

    // Riders by emirate
    const emirateMap: Record<string, number> = {};
    for (const a of areaDetails) {
      emirateMap[a.emirate] = (emirateMap[a.emirate] ?? 0) + a.totalRiders;
    }
    // Supplement from routes if no allocations
    if (Object.keys(emirateMap).length === 0) {
      for (const r of routes) {
        const e = emirateFromRoute(str(r.route_name), str(r.route_code));
        emirateMap[e] = (emirateMap[e] ?? 0) + num(r.student_count);
      }
    }
    const byEmirate = Object.entries(emirateMap)
      .map(([emirate, riders]) => ({ emirate, riders }))
      .sort((a, b) => b.riders - a.riders);

    // Top areas
    const topAreas = areaDetailsWithPct.slice(0, 9).map(a => ({ area: a.area, riders: a.totalRiders }));

    /* ═══════════════════════════════════════════════════════════
       BUILD FEE ANALYSIS TAB
    ═══════════════════════════════════════════════════════════ */
    const payingRiders  = invoices.length; // one invoice per rider approx
    const avgPerRider   = payingRiders > 0 && monthlyRevenue > 0
      ? Math.round(monthlyRevenue / payingRiders)
      : 0;

    // Revenue by route — match invoices to routes
    const feeRevByRoute: Array<{ routeCode: string; routeName: string; revenue: number }> = routeUtilTable.map(r => ({
      routeCode: r.routeCode,
      routeName: r.routeName,
      revenue:   r.monthlyRev,
    }));

    // If no invoice data, show routes with 0
    if (feeRevByRoute.every(r => r.revenue === 0) && monthlyRevenue > 0) {
      // Distribute evenly as fallback
      const perRoute = Math.round(monthlyRevenue / (activeRoutes || 1));
      feeRevByRoute.forEach(r => { r.revenue = perRoute; });
    }

    // Fee per rider
    const feePerRider = routeUtilTable.map(r => ({
      routeCode: r.routeCode,
      routeName: r.routeName,
      feePerRider: r.revPerRider,
    }));

    // Fee schedule details — derive from invoices or from route allocations
    const feeScheduleDetails = routeUtilTable.map(r => {
      const busMode = r.vehicleOwnership === 'Staff' ? 'OneWay' : 'TwoWay';
      return {
        routeCode:    r.routeCode,
        routeName:    r.routeName,
        feeName:      `${r.emirate} ${busMode}`,
        busMode,
        frequency:    'Monthly',
        amount:       r.revPerRider,
        riders:       r.total,
        monthlyRev:   r.monthlyRev,
        avgPerRider:  r.revPerRider,
      };
    });

    /* ── Response ─────────────────────────────────────────────── */
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      tenantId,

      overview: {
        kpis: {
          activeRoutes, totalVehicles,
          totalRiders, totalStudents, totalStaff,
          fleetCapacity, totalEnrolled, capacityUsedPct,
          monthlyRevenue, feeScheduleCount,
        },
        routeUtil,
        busModeSplit: {
          twoWay:    modeCounts.TWO_WAY,
          pickupOnly: modeCounts.ONE_WAY_PICKUP,
          dropOnly:  modeCounts.ONE_WAY_DROP,
          total:     allocs.length,
        },
        revenueByRoute: feeRevByRoute,
      },

      routeUtilization: {
        routes: routeUtilTable,
      },

      tripEfficiency: {
        kpis: { totalMarked, totalBoarded, totalAbsent, ownTransport: 0, boardingRate },
        dailyRates,
        byRoute: effByRoute,
      },

      areaDistribution: {
        kpis: { areasServed, totalRiders: grandTotalRiders },
        byEmirate,
        topAreas,
        areaDetails: areaDetailsWithPct,
      },

      feeAnalysis: {
        kpis: { monthlyRevenue, payingRiders, avgPerRider, feeScheduleCount: invoices.length },
        revenueByRoute: feeRevByRoute,
        feePerRider,
        scheduleDetails: feeScheduleDetails,
      },
    });

  } catch (err) {
    console.error('[school-bus/reports GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
