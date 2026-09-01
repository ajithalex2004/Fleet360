import { describe, it, expect } from 'vitest';
import { evaluateDriverFatigue } from '@/lib/bus-ops/driver-fatigue-guard';

describe('Driver Fatigue & Continuous Rest Enforcement Guard', () => {
  it('passes a fully rested driver with >8 hours rest', () => {
    const targetDeparture = '2026-09-02T08:00:00.000Z';
    const recentTrips = [
      {
        id: 'trip-1',
        departureTime: '2026-09-01T16:00:00.000Z',
        arrivalTime: '2026-09-01T18:00:00.000Z',
        durationMinutes: 120,
        status: 'COMPLETED',
      },
    ];

    const result = evaluateDriverFatigue({
      driverId: 'drv-1',
      driverName: 'Rashid Ali',
      targetDepartureTime: targetDeparture,
      targetDurationMinutes: 60,
      recentTrips,
    });

    expect(result.isCompliant).toBe(true);
    expect(result.severity).toBe('PASS');
    expect(result.violations).toHaveLength(0);
    expect(result.metrics.restTimeSinceLastShiftHours).toBe(14); // 18:00 to 08:00 next day = 14h
  });

  it('HARD LOCKOUT (BLOCK) when rest time between split shifts is < 8 hours', () => {
    const targetDeparture = '2026-09-01T22:00:00.000Z';
    const recentTrips = [
      {
        id: 'trip-prev',
        departureTime: '2026-09-01T15:00:00.000Z',
        arrivalTime: '2026-09-01T17:00:00.000Z', // Trip ended at 17:00, next is 22:00 -> only 5 hours rest
        durationMinutes: 120,
        status: 'COMPLETED',
      },
    ];

    const result = evaluateDriverFatigue({
      driverId: 'drv-2',
      driverName: 'Suresh Kumar',
      targetDepartureTime: targetDeparture,
      targetDurationMinutes: 60,
      recentTrips,
      rules: { minInterShiftRestHours: 8.0 },
    });

    expect(result.isCompliant).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'INTER_SHIFT_REST',
          level: 'BLOCK',
          actualValue: 5,
          thresholdValue: 8,
        }),
      ])
    );
    expect(result.metrics.hoursUntilCompliant).toBe(3);
    expect(result.recommendation).toContain('HARD LOCKOUT');
  });

  it('HARD LOCKOUT (BLOCK) when continuous driving exceeds 4.5 hours without 45m break', () => {
    const targetDeparture = '2026-09-01T14:30:00.000Z'; // target is 60m drive
    // Previous trips chained with only 15m gap
    const recentTrips = [
      {
        id: 'trip-2',
        departureTime: '2026-09-01T12:00:00.000Z',
        arrivalTime: '2026-09-01T14:15:00.000Z', // 2h 15m drive, ended at 14:15 (only 15m before target)
        durationMinutes: 135,
        status: 'COMPLETED',
      },
      {
        id: 'trip-1',
        departureTime: '2026-09-01T09:30:00.000Z',
        arrivalTime: '2026-09-01T11:45:00.000Z', // 2h 15m drive, ended 15m before trip-2
        durationMinutes: 135,
        status: 'COMPLETED',
      },
    ];

    const result = evaluateDriverFatigue({
      driverId: 'drv-3',
      driverName: 'Tariq Mansoor',
      targetDepartureTime: targetDeparture,
      targetDurationMinutes: 60, // 135 + 135 + 60 = 330m = 5.5 hours
      recentTrips,
      rules: { maxContinuousDriveHours: 4.5, minBreakMinutesForReset: 45 },
    });

    expect(result.isCompliant).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'MAX_CONTINUOUS_DRIVE',
          level: 'BLOCK',
          actualValue: 5.5,
          thresholdValue: 4.5,
        }),
      ])
    );
  });

  it('HARD LOCKOUT (BLOCK) when daily driving exceeds 10 hours in rolling 24h window', () => {
    const targetDeparture = '2026-09-01T20:00:00.000Z';
    const recentTrips = [
      {
        id: 'trip-1',
        departureTime: '2026-09-01T06:00:00.000Z',
        arrivalTime: '2026-09-01T11:00:00.000Z',
        durationMinutes: 300, // 5 hours
        status: 'COMPLETED',
      },
      {
        id: 'trip-2',
        departureTime: '2026-09-01T12:00:00.000Z',
        arrivalTime: '2026-09-01T16:30:00.000Z',
        durationMinutes: 270, // 4.5 hours
        status: 'COMPLETED',
      },
    ];

    const result = evaluateDriverFatigue({
      driverId: 'drv-4',
      driverName: 'Hassan Raza',
      targetDepartureTime: targetDeparture,
      targetDurationMinutes: 120, // 2 hours -> Total 5 + 4.5 + 2 = 11.5 hours in 24h
      recentTrips,
      rules: { maxDailyDriveHours: 10.0 },
    });

    expect(result.isCompliant).toBe(false);
    expect(result.severity).toBe('BLOCK');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'MAX_DAILY_DRIVE',
          level: 'BLOCK',
          actualValue: 11.5,
          thresholdValue: 10.0,
        }),
      ])
    );
  });

  it('warns on nocturnal circadian night shift (00:00 - 06:00)', () => {
    const targetDeparture = '2026-09-02T03:30:00.000Z'; // 3:30 AM night shift

    const result = evaluateDriverFatigue({
      driverId: 'drv-5',
      driverName: 'Vikram Singh',
      targetDepartureTime: targetDeparture,
      targetDurationMinutes: 60,
      recentTrips: [],
    });

    expect(result.isCompliant).toBe(true);
    expect(result.severity).toBe('WARN');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'NIGHT_SHIFT_CIRCADIAN',
          level: 'WARN',
        }),
      ])
    );
    expect(result.metrics.isNightShift).toBe(true);
  });
});
