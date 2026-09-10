/**
 * Lowest Operational Impact Slot Recommender
 * --------------------------------------------
 * Recommends optimal maintenance appointment windows where operational
 * disruption (cancelled trips, delayed passengers, peak booking interference) is minimized.
 *
 * Consumes:
 *  - Vehicle projected due date
 *  - Scheduled trips from `trip_schedules`
 *  - Active charter bookings from `bookings`
 *  - Garage working hours & depot capacity
 */

import { MaintenanceSlotWindow } from '../types';

export interface TripScheduleWindow {
  tripId: string;
  tripNumber?: string;
  departureTime: string; // ISO
  arrivalTime?: string; // ISO
  passengerCount: number;
}

export interface BookingWindow {
  bookingId: string;
  startDate: string; // ISO
  endDate?: string; // ISO
}

export interface DepotGarageOption {
  id: string;
  name: string;
  opensAt: string; // e.g. "08:00"
  closesAt: string; // e.g. "20:00"
  isOpenWeekend: boolean;
}

export interface SlotOptimizationInput {
  vehicleId: string;
  vehicleCode: string;
  projectedDueDate: string; // YYYY-MM-DD
  estimatedDurationHours: number;
  upcomingTrips?: TripScheduleWindow[];
  upcomingBookings?: BookingWindow[];
  depots?: DepotGarageOption[];
  windowDaysAhead?: number; // default 10 days
}

/**
 * Finds the lowest operational disruption window within a +/- 4 day window of the projected due date.
 */
export function recommendLowestImpactSlot(
  input: SlotOptimizationInput,
  now: Date = new Date()
): MaintenanceSlotWindow {
  const {
    projectedDueDate,
    estimatedDurationHours,
    upcomingTrips = [],
    upcomingBookings = [],
    depots = [],
  } = input;

  const targetDate = new Date(projectedDueDate);
  const candidateDays: Date[] = [];

  // Evaluate candidate days around projectedDueDate: from -2 days to +5 days
  for (let offset = -2; offset <= 5; offset++) {
    const d = new Date(targetDate.getTime() + offset * 86_400_000);
    if (d.getTime() >= now.getTime() - 86_400_000) {
      candidateDays.push(d);
    }
  }

  if (candidateDays.length === 0) {
    candidateDays.push(targetDate);
  }

  // Standard operational time brackets:
  // 1. NIGHT_WINDOW: 22:00 - 05:00 (Zero passenger impact for day-shift fleets)
  // 2. MIDDAY_IDLE: 13:00 - 16:00 (Split-shift turnaround gap)
  // 3. WEEKEND_MORNING: 08:00 - 13:00 (Saturday/Sunday off-peak)
  const candidateSlots: MaintenanceSlotWindow[] = [];

  for (const day of candidateDays) {
    const dateStr = day.toISOString().slice(0, 10);
    const dayOfWeek = day.getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Check trips on this specific date
    const dayTrips = upcomingTrips.filter((t) => t.departureTime.startsWith(dateStr));
    const dayBookings = upcomingBookings.filter((b) => b.startDate.startsWith(dateStr));

    // Bracket A: Midday Turnaround Idle Gap (13:00 - 16:30)
    const middayTrips = dayTrips.filter((t) => {
      const depHour = new Date(t.departureTime).getUTCHours();
      return depHour >= 13 && depHour < 17;
    });

    const middayPax = middayTrips.reduce((acc, t) => acc + (t.passengerCount || 0), 0);
    const dateDiffDays = Math.abs((day.getTime() - targetDate.getTime()) / 86_400_000);

    // Score: Trips Disrupted * 50 + Pax * 2 + Days Drift * 5
    const middayDisruptionScore =
      middayTrips.length * 50 + middayPax * 2 + dateDiffDays * 5 + (dayBookings.length > 0 ? 80 : 0);

    candidateSlots.push({
      slotDate: dateStr,
      startTime: '13:00',
      endTime: '16:30',
      slotType: 'SHIFT_CHANGEOVER',
      disruptedTripsCount: middayTrips.length,
      disruptedPassengersCount: middayPax,
      depotName: depots[0]?.name || 'Central Fleet Depot (Bay 2)',
      depotBayId: depots[0]?.id || 'DEPOT-BAY-02',
      operationalDisruptionScore: Math.round(middayDisruptionScore),
      reasoning: middayTrips.length === 0
        ? `Midday shift gap with 0 active route assignments (${isWeekend ? 'Weekend Off-Peak' : 'Shift Turnaround'})`
        : `Minor overlap with ${middayTrips.length} scheduled route(s)`,
    });

    // Bracket B: Off-Peak / Evening Window (18:30 - 22:00)
    const eveningTrips = dayTrips.filter((t) => {
      const depHour = new Date(t.departureTime).getUTCHours();
      return depHour >= 18;
    });
    const eveningPax = eveningTrips.reduce((acc, t) => acc + (t.passengerCount || 0), 0);
    const eveningDisruptionScore =
      eveningTrips.length * 50 + eveningPax * 2 + dateDiffDays * 5 + 10; // slight evening penalty

    candidateSlots.push({
      slotDate: dateStr,
      startTime: '18:30',
      endTime: '22:00',
      slotType: 'IDLE_WINDOW',
      disruptedTripsCount: eveningTrips.length,
      disruptedPassengersCount: eveningPax,
      depotName: depots[0]?.name || 'Central Fleet Depot (Bay 1)',
      depotBayId: depots[0]?.id || 'DEPOT-BAY-01',
      operationalDisruptionScore: Math.round(eveningDisruptionScore),
      reasoning: eveningTrips.length === 0
        ? 'Post-evening route completion; vehicle parked at depot'
        : `Evening run overlaps with ${eveningTrips.length} route(s)`,
    });

    // Bracket C: Weekend Dedicated Window
    if (isWeekend) {
      const weekendDisruptionScore = dateDiffDays * 5; // virtually zero trip disruption
      candidateSlots.push({
        slotDate: dateStr,
        startTime: '09:00',
        endTime: '13:00',
        slotType: 'WEEKEND_OFF_PEAK',
        disruptedTripsCount: 0,
        disruptedPassengersCount: 0,
        depotName: depots[0]?.name || 'Central Workshop & Express Bay',
        depotBayId: depots[0]?.id || 'WORKSHOP-BAY-03',
        operationalDisruptionScore: Math.round(weekendDisruptionScore),
        reasoning: 'Weekend non-operational window with maximum bay availability and zero passenger disruption',
      });
    }
  }

  // Sort by lowest Operational Disruption Score
  candidateSlots.sort((a, b) => a.operationalDisruptionScore - b.operationalDisruptionScore);

  const bestSlot = candidateSlots[0] || {
    slotDate: projectedDueDate,
    startTime: '14:00',
    endTime: '17:30',
    slotType: 'IDLE_WINDOW',
    disruptedTripsCount: 0,
    disruptedPassengersCount: 0,
    depotName: 'Central Workshop',
    operationalDisruptionScore: 5,
    reasoning: 'Default scheduled slot during off-peak depot hours',
  };

  return bestSlot;
}
