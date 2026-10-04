import { describe, expect, it } from 'vitest';
import { evaluateConsolidationEvidence, type HistoricalTrip } from '@/lib/planning/consolidation-evidence';

const rates = { fuelPerLitre: 3, driverPerHour: 30, vehiclePerKm: 0.5 };
const sample = (routeId: string, patch: Partial<HistoricalTrip> = {}): HistoricalTrip => ({
  routeId, serviceDay: '2026-09-01', shift: 'MORNING', direction: 'INBOUND',
  departureTime: new Date('2026-09-01T05:00:00Z'),
  capacity: 30, reserved: 12, boarded: 10, attendanceRows: 12,
  fuelLitres: 5, distanceKm: 20, durationMinutes: 60, ...patch,
});

describe('historical consolidation evidence', () => {
  it('checks paired observed demand without claiming realized savings', () => {
    const result = evaluateConsolidationEvidence([sample('a'), sample('b')], ['a', 'b'], 30, rates);
    expect(result).toMatchObject({ assessment: 'HISTORICALLY_PLAUSIBLE', pairedServices: 1,
      peakReserved: 24, peakBoarded: 20, completeCostTrips: 2, observedCostAED: 110,
      realizedSavingsAED: null });
  });

  it('flags reserved demand over the assumed bus capacity', () => {
    const result = evaluateConsolidationEvidence([sample('a', { reserved: 20 }), sample('b', { reserved: 16 })], ['a', 'b'], 30, rates);
    expect(result.assessment).toBe('CAPACITY_CONFLICT');
    expect(result.overCapacityServices).toBe(1);
  });

  it('does not certify absent attendance or ambiguous headway service', () => {
    const missing = evaluateConsolidationEvidence([sample('a', { attendanceRows: 0 }), sample('b')], ['a', 'b'], 30, rates);
    expect(missing.assessment).toBe('INSUFFICIENT_DATA');
    const ambiguous = evaluateConsolidationEvidence([sample('a'), sample('a'), sample('b')], ['a', 'b'], 30, rates);
    expect(ambiguous).toMatchObject({ pairedServices: 0, ambiguousServices: 1, assessment: 'INSUFFICIENT_DATA' });
  });

  it('only totals costs from complete logs and does not convert unknown to zero', () => {
    const result = evaluateConsolidationEvidence([sample('a', { fuelLitres: null }), sample('b')], ['a', 'b'], 30, rates);
    expect(result).toMatchObject({ completeCostTrips: 1, observedCostAED: 55, realizedSavingsAED: null });
  });

  it('does not pair trips that departed hours apart despite the same shift label', () => {
    const result = evaluateConsolidationEvidence([sample('a'), sample('b', { departureTime: new Date('2026-09-01T09:00:00Z') })], ['a', 'b'], 30, rates);
    expect(result).toMatchObject({ pairedServices: 0, incompatibleTimingServices: 1, assessment: 'INSUFFICIENT_DATA' });
  });
});
