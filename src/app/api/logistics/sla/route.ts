import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notifyTripStatusChange } from '@/lib/logistics-notifications';

/**
 * GET /api/logistics/sla
 * Scans all active logistics trips for SLA breaches and returns alerts.
 *
 * Breach tiers:
 *  - WARNING:  within 2h of deadline
 *  - BREACHED: past deadline but < 4h late
 *  - CRITICAL: > 4h past deadline
 */

const WARN_HOURS     = 2;
const BREACH_HOURS   = 4;

interface SlaAlert {
  id:           string;
  bookingRef:   string | null;
  status:       string | null;
  customerName: string | null;
  origin:       string | null;
  destination:  string | null;
  deadline:     string;
  hoursLate:    number;
  tier:         'WARNING' | 'BREACHED' | 'CRITICAL';
  driverName:   string | null;
  vehiclePlate: string | null;
}

export async function GET() {
  try {
    const now = new Date();

    // Active trips that have an end_date set
    const trips = await prisma.$queryRawUnsafe<Array<{
      id: string; booking_ref: string | null; status: string | null;
      requestor_name: string | null; end_date: Date | null; notes: string | null;
    }>>(
      `SELECT id, booking_ref, status, requestor_name, end_date, notes
       FROM bookings
       WHERE deleted_at IS NULL
         AND service_type = 'LOGISTICS'
         AND status IN ('DISPATCHED','ENROUTE_PICKUP','LOADED','ENROUTE_DELIVERY','ACTIVE','ASSIGNED')
         AND end_date IS NOT NULL
       ORDER BY end_date ASC`
    ).catch(() => [] as Array<{ id: string; booking_ref: string | null; status: string | null; requestor_name: string | null; end_date: Date | null; notes: string | null; }>);

    const alerts: SlaAlert[] = [];

    for (const trip of trips) {
      if (!trip.end_date) continue;

      const deadline = trip.end_date instanceof Date ? trip.end_date : new Date(trip.end_date);
      const diffMs   = now.getTime() - deadline.getTime();
      const hoursLate = diffMs / (1000 * 60 * 60);
      const hoursUntil = -hoursLate; // positive = time remaining

      let tier: SlaAlert['tier'] | null = null;

      if (hoursLate > BREACH_HOURS) {
        tier = 'CRITICAL';
      } else if (hoursLate > 0) {
        tier = 'BREACHED';
      } else if (hoursUntil <= WARN_HOURS) {
        tier = 'WARNING';
      }

      if (!tier) continue;

      let parsedNotes: Record<string, unknown> = {};
      try { parsedNotes = JSON.parse(trip.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }

      alerts.push({
        id:           trip.id,
        bookingRef:   trip.booking_ref,
        status:       trip.status,
        customerName: trip.requestor_name,
        origin:       parsedNotes.origin      as string | undefined ?? null,
        destination:  parsedNotes.destination as string | undefined ?? null,
        deadline:     deadline.toISOString(),
        hoursLate:    Math.round(hoursLate * 10) / 10,
        tier,
        driverName:   parsedNotes.driverName   as string | undefined ?? null,
        vehiclePlate: parsedNotes.vehiclePlate as string | undefined ?? null,
      });

      // Fire notification for CRITICAL alerts (operations)
      if (tier === 'CRITICAL' && process.env.OPERATIONS_PHONE) {
        notifyTripStatusChange({
          bookingRef:      trip.booking_ref ?? trip.id.slice(0, 8),
          toStatus:        'CRITICAL_SLA',
          operationsPhone: process.env.OPERATIONS_PHONE,
          operationsEmail: process.env.OPERATIONS_EMAIL,
        });
      }
    }

    // Summary counts
    const summary = {
      total:    alerts.length,
      warning:  alerts.filter(a => a.tier === 'WARNING').length,
      breached: alerts.filter(a => a.tier === 'BREACHED').length,
      critical: alerts.filter(a => a.tier === 'CRITICAL').length,
    };

    return NextResponse.json({ alerts, summary });
  } catch (err) {
    console.error('[sla GET]', err);
    return NextResponse.json({ alerts: [], summary: { total: 0, warning: 0, breached: 0, critical: 0 } });
  }
}
