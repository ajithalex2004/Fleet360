/**
 * tests/unit/telematics-geofence-automation.test.ts
 *
 * Unit tests for Telematics Phase 2: Geofencing, Stop Visits & PM Sync.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistanceM,
  evaluateStopVisitsSync,
  type RouteStopContext,
} from '@/lib/telematics/geofence-evaluator';
import { evaluatePmOdometerThresholdSync } from '@/lib/telematics/pm-odometer-sync';

describe('Telematics Geofence & Stop Visit Evaluator (Phase 2)', () => {
  const sampleStops: RouteStopContext[] = [
    {
      id: 'stop-1',
      stopName: 'DIP Staff Camp',
      sequence: 1,
      gpsLat: 24.9985,
      gpsLng: 55.1520,
      geofenceRadiusM: 100,
    },
    {
      id: 'stop-2',
      stopName: 'JAFZA South Gate 4',
      sequence: 2,
      gpsLat: 25.0150,
      gpsLng: 55.1220,
      geofenceRadiusM: 120,
    },
    {
      id: 'stop-3',
      stopName: 'Plant Gate 2 (Terminal)',
      sequence: 3,
      gpsLat: 25.0420,
      gpsLng: 55.0980,
      geofenceRadiusM: 150,
    },
  ];

  it('calculates accurate Haversine distance between two coordinates in meters', () => {
    // Distance between DIP Camp and JAFZA South Gate 4 (~3.5 km)
    const dist = calculateHaversineDistanceM(
      { lat: 24.9985, lng: 55.1520 },
      { lat: 25.0150, lng: 55.1220 },
    );

    expect(dist).toBeGreaterThan(3400);
    expect(dist).toBeLessThan(3700);
  });

  it('detects AT_STOP state when vehicle coordinates are inside arrival radius (< 100m)', () => {
    // Current position right inside Stop 1 (< 30m away)
    const currentPos = { lat: 24.9986, lng: 55.1521 };

    const evaluated = evaluateStopVisitsSync(currentPos, sampleStops, [], new Date('2026-09-01T06:00:00Z'));

    expect(evaluated.length).toBe(3);
    const stop1 = evaluated[0];
    expect(stop1.state).toBe('AT_STOP');
    expect(stop1.enteredAt).toBeDefined();
    expect(stop1.approachedAt).toBeDefined();
    expect(stop1.leftAt).toBeNull();
  });

  it('detects APPROACHING state when vehicle is within 800m of a stop', () => {
    // Position ~450m away from Stop 2
    const currentPos = { lat: 25.0120, lng: 55.1240 };

    const evaluated = evaluateStopVisitsSync(currentPos, sampleStops, [], new Date('2026-09-01T06:15:00Z'));

    const stop2 = evaluated[1];
    expect(stop2.state).toBe('APPROACHING');
    expect(stop2.approachedAt).toBeDefined();
    expect(stop2.enteredAt).toBeNull();
  });

  it('marks stop as DEPARTED once vehicle exits arrival geofence after entering', () => {
    // Stop 1 was entered at 06:00, vehicle now at 06:10 is 1.5 km away
    const currentPos = { lat: 25.0120, lng: 55.1240 };
    const existingVisits = [
      {
        stopId: 'stop-1',
        approachedAt: new Date('2026-09-01T05:58:00Z'),
        enteredAt: new Date('2026-09-01T06:00:00Z'),
      },
    ];

    const evaluated = evaluateStopVisitsSync(
      currentPos,
      sampleStops,
      existingVisits,
      new Date('2026-09-01T06:10:00Z'),
    );

    const stop1 = evaluated[0];
    expect(stop1.state).toBe('DEPARTED');
    expect(stop1.leftAt).toBeDefined();
  });
});

describe('Preventive Maintenance (PM) Odometer Synchronizer (Phase 2)', () => {
  it('correctly reports OK status when vehicle is far from 10k km service threshold', () => {
    // 14,200 km (next due at 20,000 km -> 5,800 km remaining)
    const res = evaluatePmOdometerThresholdSync(14200, 10000);
    expect(res.nextDueKm).toBe(20000);
    expect(res.kmRemaining).toBe(5800);
    expect(res.status).toBe('OK');
  });

  it('triggers DUE_SOON status when vehicle is within 500 km of service target', () => {
    // 19,650 km (next due at 20,000 km -> 350 km remaining)
    const res = evaluatePmOdometerThresholdSync(19650, 10000);
    expect(res.nextDueKm).toBe(20000);
    expect(res.kmRemaining).toBe(350);
    expect(res.status).toBe('DUE_SOON');
  });

  it('triggers OVERDUE status when vehicle surpasses service target', () => {
    // 20,120 km (next due at 20,000 km -> -120 km overdue)
    const res = evaluatePmOdometerThresholdSync(20120, 10000);
    expect(res.nextDueKm).toBe(20000);
    expect(res.kmRemaining).toBe(-120);
    expect(res.status).toBe('OVERDUE');
  });
});
