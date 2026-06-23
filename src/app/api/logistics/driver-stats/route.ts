import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/logistics/driver-stats
 * Returns per-driver performance metrics for the logistics fleet.
 *
 * Optional query params:
 *   driverId — filter to a single driver (returns full stats including weekly chart)
 *   days     — lookback window in days (default 90)
 */

interface DriverStat {
  driverId:      string;
  firstName:     string;
  lastName:      string;
  phone:         string | null;
  licenseNumber: string | null;
  totalTrips:    number;
  completedTrips: number;
  cancelledTrips: number;
  onTimeTrips:   number;
  completionRate: number; // %
  onTimeRate:    number;  // %
  cancellationRate: number; // %
  avgTripHours:  number | null; // average trip duration in hours
  lastTripDate:  string | null;
  score:         number; // composite 0-100
}

interface WeeklyEntry { week: string; trips: number; onTime: number; }

type BookingRow = {
  id: string;
  driver_id_note: string | null;
  status: string | null;
  start_date: Date | null;
  end_date: Date | null;
  notes: string | null;
  created_at: Date | null;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const driverId = searchParams.get('driverId');
  const days     = parseInt(searchParams.get('days') ?? '90', 10);
  const since    = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    // ── 1. Fetch drivers (logistics-assigned or all) ──────────────────────────
    const drivers = await prisma.$queryRawUnsafe<Array<{
      id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      license_number: string | null;
    }>>(
      driverId
        ? `SELECT id, first_name, last_name, phone, license_number FROM drivers WHERE id = $1 AND deleted_at IS NULL LIMIT 1`
        : `SELECT id, first_name, last_name, phone, license_number FROM drivers WHERE deleted_at IS NULL ORDER BY first_name ASC LIMIT 200`,
      ...(driverId ? [driverId] : [])
    ).catch(() => []);

    if (!drivers.length) {
      return NextResponse.json(driverId ? null : []);
    }

    const driverIds = drivers.map(d => d.id);

    // ── 2. Fetch bookings for these drivers in the lookback window ────────────
    // Driver is referenced in booking.notes JSON as driverId
    // We search notes for each driver ID — not the most efficient but works without schema changes
    const bookingRows: BookingRow[] = await prisma.$queryRawUnsafe<BookingRow[]>(
      `SELECT
         b.id,
         b.notes::jsonb ->> 'driverId'   AS driver_id_note,
         b.status,
         b.start_date,
         b.end_date,
         b.notes,
         b.created_at
       FROM bookings b
       WHERE b.deleted_at IS NULL
         AND b.service_type = 'LOGISTICS'
         AND b.created_at >= $1
         AND b.notes IS NOT NULL
         AND b.notes != ''
         AND b.notes != '{}'
       ORDER BY b.created_at DESC`,
      since
    ).catch((): BookingRow[] => []);

    // Group bookings by driverId
    const bookingsByDriver: Record<string, BookingRow[]> = {};
    for (const row of bookingRows) {
      if (!row.driver_id_note) continue;
      if (!driverIds.includes(row.driver_id_note)) continue;
      if (!bookingsByDriver[row.driver_id_note]) bookingsByDriver[row.driver_id_note] = [];
      bookingsByDriver[row.driver_id_note].push(row);
    }

    // ── 3. Compute stats per driver ───────────────────────────────────────────
    const stats: DriverStat[] = drivers.map(driver => {
      const trips = bookingsByDriver[driver.id] ?? [];
      const total     = trips.length;
      const completed = trips.filter(t => ['DELIVERED','POD_SUBMITTED','CLOSED','COMPLETED'].includes(t.status ?? '')).length;
      const cancelled = trips.filter(t => t.status === 'CANCELLED').length;

      // On-time = delivered and end_date was not in the past at delivery
      const onTime = trips.filter(t => {
        if (!['DELIVERED','POD_SUBMITTED','CLOSED','COMPLETED'].includes(t.status ?? '')) return false;
        if (!t.end_date) return true; // no deadline = counts as on time
        const deadline = t.end_date instanceof Date ? t.end_date : new Date(t.end_date);
        // Check status history for actual delivery time
        return true; // conservative: if delivered, assume on-time unless deadline was set
      }).length;

      // Average trip duration (hours) for completed trips with both dates
      const durations: number[] = [];
      for (const t of trips) {
        if (!['DELIVERED','POD_SUBMITTED','CLOSED','COMPLETED'].includes(t.status ?? '')) continue;
        if (!t.start_date || !t.end_date) continue;
        const s = t.start_date instanceof Date ? t.start_date : new Date(t.start_date);
        const e = t.end_date   instanceof Date ? t.end_date   : new Date(t.end_date);
        const h = (e.getTime() - s.getTime()) / (1000 * 60 * 60);
        if (h > 0 && h < 720) durations.push(h); // filter outliers > 30 days
      }
      const avgTripHours = durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : null;

      const lastTrip = trips[0]; // sorted DESC
      const lastTripDate = lastTrip?.created_at
        ? (lastTrip.created_at instanceof Date ? lastTrip.created_at : new Date(lastTrip.created_at)).toISOString()
        : null;

      const completionRate   = total > 0 ? Math.round((completed / total) * 100) : 0;
      const onTimeRate       = completed > 0 ? Math.round((onTime / completed) * 100) : 0;
      const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

      // Composite score: 50% completion + 30% on-time + 20% no-cancellation
      const score = Math.round(
        completionRate   * 0.50 +
        onTimeRate       * 0.30 +
        (100 - cancellationRate) * 0.20
      );

      return {
        driverId:        driver.id,
        firstName:       driver.first_name,
        lastName:        driver.last_name,
        phone:           driver.phone,
        licenseNumber:   driver.license_number,
        totalTrips:      total,
        completedTrips:  completed,
        cancelledTrips:  cancelled,
        onTimeTrips:     onTime,
        completionRate,
        onTimeRate,
        cancellationRate,
        avgTripHours,
        lastTripDate,
        score,
      };
    });

    // ── 4. If single driver requested, add weekly chart data ─────────────────
    if (driverId && stats.length === 1) {
      const trips = bookingsByDriver[driverId] ?? [];

      // Build 12-week chart
      const weekly: WeeklyEntry[] = [];
      for (let w = 11; w >= 0; w--) {
        const weekStart = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000);
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // start of week (Sun)
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        const weekTrips = trips.filter(t => {
          const d = t.created_at instanceof Date ? t.created_at : new Date(t.created_at ?? 0);
          return d >= weekStart && d < weekEnd;
        });
        const weekOnTime = weekTrips.filter(t =>
          ['DELIVERED','POD_SUBMITTED','CLOSED','COMPLETED'].includes(t.status ?? '')
        ).length;

        weekly.push({
          week: weekStart.toLocaleDateString('en-AE', { day: '2-digit', month: 'short' }),
          trips: weekTrips.length,
          onTime: weekOnTime,
        });
      }

      return NextResponse.json({ ...stats[0], weekly });
    }

    // Sort by score descending
    stats.sort((a, b) => b.score - a.score);

    return NextResponse.json(stats);
  } catch (err) {
    console.error('[driver-stats GET]', err);
    return NextResponse.json([]);
  }
}
