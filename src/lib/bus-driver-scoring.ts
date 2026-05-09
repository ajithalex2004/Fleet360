/**
 * Driver performance scoring for staff bus operations.
 *
 * Pure function — given a driver's trip-level metrics for a period, compute
 * a 0-100 weighted score and the components. Caller persists into the
 * DriverPerformance table.
 *
 * Scoring philosophy (configurable via env in future):
 *   - On-time departure ≤ +5 min  (50%)  ── operational reliability
 *   - Incident-free rate          (30%)  ── safety
 *   - Completion rate             (20%)  ── reliability of completing assigned trips
 *
 * Each component is clamped 0-100. Total is rounded to 1 decimal. Drivers
 * with too few trips (<5 in the period) get score=null instead of a noisy
 * one — we don't punish or reward someone with insufficient signal.
 */

export interface DriverPeriodMetrics {
  driverId: string;
  totalTrips: number;
  completedTrips: number;
  onTimeDepartures: number;
  totalKm: number;
  totalFuelL: number;
  incidents: number;
  passengersBoarded: number;
}

export interface ScoreComponents {
  onTimePct: number;          // 0-100
  incidentFreeRate: number;   // 0-100
  completionRate: number;     // 0-100
  fuelEfficiency: number;     // km / L (raw, not normalised)
}

export interface DriverScore {
  driverId: string;
  totalTrips: number;
  totalKm: number;
  components: ScoreComponents;
  score: number | null;        // null if insufficient signal
  insufficientSignal: boolean;
}

const MIN_TRIPS_FOR_SCORE = 5;
const INCIDENT_DENOM_KM = 1000; // incidents per 1000 km

const W_ON_TIME = 0.50;
const W_INCIDENT_FREE = 0.30;
const W_COMPLETION = 0.20;

export function scoreDriverPeriod(m: DriverPeriodMetrics): DriverScore {
  const onTimePct = m.totalTrips > 0 ? (m.onTimeDepartures / m.totalTrips) * 100 : 0;
  const completionRate = m.totalTrips > 0 ? (m.completedTrips / m.totalTrips) * 100 : 0;

  // incidents per 1000 km → rate-free = max(0, 100 - rate * 50)
  // (1 incident / 1000 km lands at 50; 2/1000 lands at 0)
  const incidentRatePer1000 = m.totalKm > 0 ? (m.incidents / m.totalKm) * INCIDENT_DENOM_KM : (m.incidents > 0 ? 4 : 0);
  const incidentFreeRate = Math.max(0, Math.min(100, 100 - incidentRatePer1000 * 50));

  const fuelEfficiency = m.totalFuelL > 0 ? m.totalKm / m.totalFuelL : 0;

  const insufficientSignal = m.totalTrips < MIN_TRIPS_FOR_SCORE;
  const score = insufficientSignal
    ? null
    : Math.round(
        (onTimePct * W_ON_TIME + incidentFreeRate * W_INCIDENT_FREE + completionRate * W_COMPLETION) * 10,
      ) / 10;

  return {
    driverId: m.driverId,
    totalTrips: m.totalTrips,
    totalKm: Math.round(m.totalKm * 10) / 10,
    components: {
      onTimePct: Math.round(onTimePct * 10) / 10,
      incidentFreeRate: Math.round(incidentFreeRate * 10) / 10,
      completionRate: Math.round(completionRate * 10) / 10,
      fuelEfficiency: Math.round(fuelEfficiency * 100) / 100,
    },
    score,
    insufficientSignal,
  };
}

/** Letter grade for display purposes — keeps the UI honest about ranking. */
export function gradeFromScore(score: number | null): string {
  if (score == null) return '—';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'E';
}
