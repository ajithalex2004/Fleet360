import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/platform/kpis
 * Aggregates live KPIs from ALL modules.
 *
 * Table mapping (verified against actual DB schema):
 * - Logistics:        bookings (service_type = 'LOGISTICS')
 * - RAC:              rental_agreements (no deleted_at col; end_date not return_date)
 * - Damage claims:    damage_claims (no deleted_at col)
 * - School Bus:       school_bus_schedules (separate from trip_schedules)
 * - Ambulance:        ambulance_calls (lazy-created; use to_regclass guard)
 * - Finance invoices: finance_invoices (payment_status, not status)
 * - Staff transport:  trip_schedules (Prisma; has deleted_at, no trip_type)
 */

const zero = () => Promise.resolve([{ count: BigInt(0) }]);

export async function GET() {
  try {
    const [
      // ── Fleet ────────────────────────────────────────────────────────
      totalVehicles,
      availableVehicles,
      vehiclesInMaintenance,
      vehiclesDispatched,

      // ── Drivers ──────────────────────────────────────────────────────
      totalDrivers,
      activeDrivers,

      // ── Logistics (table: bookings, service_type='LOGISTICS') ─────────
      logisticsActiveTrips,
      logisticsTodayTrips,
      logisticsDeliveredToday,
      logisticsPendingBookings,

      // ── RAC ──────────────────────────────────────────────────────────
      // rental_agreements has NO deleted_at; use end_date (not return_date)
      racActiveAgreements,
      racPendingReturns,
      racAvailableRentalFleet,
      racOpenDamageClaims,           // damage_claims has NO deleted_at

      // ── Staff Transport (trip_schedules — has deleted_at, no trip_type) ──
      staffTodayTrips,
      staffInTransit,
      staffActiveRoutes,
      staffTotalPassengersThisMonth,

      // ── School Bus (school_bus_schedules — separate table) ────────────
      schoolBusTodaySchedules,
      schoolBusStudents,
      schoolBusRoutes,

      // ── Incidents ────────────────────────────────────────────────────
      openIncidents,
      escalatedIncidents,
      criticalIncidents,

      // ── Ambulance ────────────────────────────────────────────────────
      ambulanceAvailable,
      ambulanceActiveCalls,          // guarded with to_regclass

      // ── Finance (finance_invoices — payment_status, not status) ───────
      unpaidInvoices,
      overdueInvoices,
    ] = await Promise.all([

      // ── Fleet ────────────────────────────────────────────────────────
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND status = 'AVAILABLE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND status = 'MAINTENANCE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM vehicles WHERE deleted_at IS NULL AND status = 'DISPATCHED'`,
      ).catch(zero),

      // ── Drivers ──────────────────────────────────────────────────────
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM drivers WHERE deleted_at IS NULL`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM drivers WHERE deleted_at IS NULL AND status = 'ACTIVE'`,
      ).catch(zero),

      // ── Logistics: table = bookings, service_type = 'LOGISTICS' ──────
      // Status values: PENDING|APPROVED|CONFIRMED|ACTIVE|COMPLETED|CANCELLED
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM bookings
         WHERE service_type = 'LOGISTICS' AND status IN ('CONFIRMED','ACTIVE')`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM bookings
         WHERE service_type = 'LOGISTICS' AND DATE(created_at) = CURRENT_DATE`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM bookings
         WHERE service_type = 'LOGISTICS' AND status = 'COMPLETED' AND DATE(updated_at) = CURRENT_DATE`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM bookings
         WHERE service_type = 'LOGISTICS' AND status = 'PENDING'`,
      ).catch(zero),

      // ── RAC: rental_agreements has NO deleted_at column ──────────────
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM rental_agreements WHERE status = 'ACTIVE'`,
      ).catch(zero),

      // end_date (not return_date) is the correct column
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM rental_agreements
         WHERE status = 'ACTIVE' AND end_date <= NOW() + INTERVAL '2 days'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM vehicles
         WHERE deleted_at IS NULL AND vehicle_usage = 'RENTAL' AND status = 'AVAILABLE'`,
      ).catch(zero),

      // damage_claims has NO deleted_at column
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM damage_claims WHERE status = 'OPEN'`,
      ).catch(zero),

      // ── Staff Transport (trip_schedules HAS deleted_at; NO trip_type) ─
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM trip_schedules
         WHERE deleted_at IS NULL AND DATE(departure_time) = CURRENT_DATE`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM trip_schedules
         WHERE deleted_at IS NULL AND status IN ('DEPARTED','IN_TRANSIT')`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM bus_routes
         WHERE deleted_at IS NULL AND is_active = true AND route_type != 'SCHOOL'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COALESCE(SUM(confirmed_count),0) as count FROM trip_schedules
         WHERE deleted_at IS NULL AND status = 'COMPLETED'
           AND departure_time >= NOW() - INTERVAL '30 days'`,
      ).catch(zero),

      // ── School Bus: school_bus_schedules (departure_time is TIME, status=ACTIVE) ──
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM school_bus_schedules WHERE status = 'ACTIVE'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM school_bus_students
         WHERE deleted_at IS NULL AND is_active = true`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM bus_routes
         WHERE deleted_at IS NULL AND is_active = true AND route_type = 'SCHOOL'`,
      ).catch(zero),

      // ── Incidents ────────────────────────────────────────────────────
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM trip_incidents
         WHERE status IN ('OPEN','REPORTED','UNDER_INVESTIGATION','IN_PROGRESS','ESCALATED')`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM trip_incidents WHERE status = 'ESCALATED'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM trip_incidents
         WHERE severity = 'CRITICAL' AND status NOT IN ('RESOLVED','CLOSED')`,
      ).catch(zero),

      // ── Ambulance (lazy-created table; use pg_tables guard, not to_regclass) ──
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM vehicles
         WHERE deleted_at IS NULL AND vehicle_usage = 'AMBULANCE' AND status = 'AVAILABLE'`,
      ).catch(zero),

      // ambulance_calls is lazy-created; safe existence check via pg_tables avoids 42P01
      prisma.$queryRawUnsafe<[{exists: boolean}]>(
        `SELECT EXISTS(SELECT 1 FROM pg_tables WHERE tablename='ambulance_calls' AND schemaname='public') AS exists`,
      ).then(([{exists}]) =>
        exists
          ? prisma.$queryRawUnsafe<[{count:bigint}]>(
              `SELECT COUNT(*) as count FROM ambulance_calls
               WHERE status IN ('CALL_RECEIVED','DISPATCHED','ON_SCENE','TRANSPORTING','AT_HOSPITAL')`,
            ).catch(zero)
          : zero()
      ).catch(zero),

      // ── Finance: finance_invoices uses payment_status (not status) ────
      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM finance_invoices
         WHERE deleted_at IS NULL AND payment_status = 'UNPAID'`,
      ).catch(zero),

      prisma.$queryRawUnsafe<[{count:bigint}]>(
        `SELECT COUNT(*) as count FROM finance_invoices
         WHERE deleted_at IS NULL AND payment_status = 'UNPAID'
           AND due_date < CURRENT_DATE`,
      ).catch(zero),
    ]);

    // Fleet utilisation %
    const total   = Number(totalVehicles[0]?.count  ?? 0);
    const avail   = Number(availableVehicles[0]?.count ?? 0);
    const utilRate = total > 0 ? Math.round(((total - avail) / total) * 100) : 0;

    // Revenue last 30d — from finance_invoices (authoritative source)
    type RevRow = { total: number | null };
    const revenue30d = await prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) AS total
       FROM finance_invoices
       WHERE deleted_at IS NULL
         AND payment_status IN ('PAID','PARTIALLY_PAID')
         AND created_at >= NOW() - INTERVAL '30 days'`,
    ).catch(() => [{ total: 0 }]);

    // RAC agreement revenue (rental_agreements has total_amount, no deleted_at)
    const racRevenue = await prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) AS total
       FROM rental_agreements
       WHERE status IN ('ACTIVE','COMPLETED')
         AND created_at >= NOW() - INTERVAL '30 days'`,
    ).catch(() => [{ total: 0 }]);

    const totalRevenue30d = Number(revenue30d[0]?.total ?? 0) + Number(racRevenue[0]?.total ?? 0);

    return NextResponse.json({
      ts: new Date().toISOString(),
      fleet: {
        total,
        available:       Number(availableVehicles[0]?.count     ?? 0),
        inMaintenance:   Number(vehiclesInMaintenance[0]?.count ?? 0),
        dispatched:      Number(vehiclesDispatched[0]?.count    ?? 0),
        utilisationRate: utilRate,
      },
      drivers: {
        total:  Number(totalDrivers[0]?.count  ?? 0),
        active: Number(activeDrivers[0]?.count ?? 0),
      },
      logistics: {
        activeTrips:     Number(logisticsActiveTrips[0]?.count    ?? 0),
        todayBookings:   Number(logisticsTodayTrips[0]?.count     ?? 0),
        deliveredToday:  Number(logisticsDeliveredToday[0]?.count ?? 0),
        pendingBookings: Number(logisticsPendingBookings[0]?.count ?? 0),
      },
      rac: {
        activeAgreements: Number(racActiveAgreements[0]?.count  ?? 0),
        pendingReturns:   Number(racPendingReturns[0]?.count    ?? 0),
        availableFleet:   Number(racAvailableRentalFleet[0]?.count ?? 0),
        openDamageClaims: Number(racOpenDamageClaims[0]?.count  ?? 0),
      },
      staffTransport: {
        todayTrips:          Number(staffTodayTrips[0]?.count              ?? 0),
        inTransit:           Number(staffInTransit[0]?.count               ?? 0),
        activeRoutes:        Number(staffActiveRoutes[0]?.count            ?? 0),
        passengersThisMonth: Number(staffTotalPassengersThisMonth[0]?.count ?? 0),
      },
      schoolBus: {
        todayTrips:   Number(schoolBusTodaySchedules[0]?.count ?? 0),
        students:     Number(schoolBusStudents[0]?.count       ?? 0),
        activeRoutes: Number(schoolBusRoutes[0]?.count         ?? 0),
      },
      incidents: {
        open:      Number(openIncidents[0]?.count     ?? 0),
        escalated: Number(escalatedIncidents[0]?.count ?? 0),
        critical:  Number(criticalIncidents[0]?.count  ?? 0),
      },
      ambulance: {
        available:   Number(ambulanceAvailable[0]?.count  ?? 0),
        activeCalls: Number(ambulanceActiveCalls[0]?.count ?? 0),
      },
      finance: {
        unpaidInvoices:  Number(unpaidInvoices[0]?.count  ?? 0),
        overdueInvoices: Number(overdueInvoices[0]?.count ?? 0),
        revenue30d:      Math.round(totalRevenue30d),
      },
    });
  } catch (err) {
    console.error('[platform/kpis]', err);
    return NextResponse.json({ error: 'Failed to load platform KPIs' }, { status: 500 });
  }
}
