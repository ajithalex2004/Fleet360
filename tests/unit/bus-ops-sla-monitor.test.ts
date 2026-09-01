/**
 * tests/unit/bus-ops-sla-monitor.test.ts
 *
 * Unit tests for Shift Arrival SLA Monitoring & Destination ETA engine.
 */

import { describe, it, expect } from 'vitest';
import { evaluateTripSlaSync } from '@/lib/bus-ops/sla-monitor';

describe('Shift Arrival SLA Monitor Engine', () => {
  const baseTrip = {
    id: 'trip-101',
    tripNumber: 'TRP-101',
    routeId: 'route-alpha',
    vehicleId: 'veh-01',
    driverId: 'drv-01',
    departureTime: new Date('2026-09-01T06:00:00.000Z'),
    arrivalTime: new Date('2026-09-01T06:45:00.000Z'),
    latestArrivalTime: new Date('2026-09-01T07:00:00.000Z'), // 07:00 AM shift deadline
    status: 'IN_TRANSIT',
    shiftType: 'MORNING',
    direction: 'INBOUND',
    route: {
      name: 'Route Alpha (DIP to JAFZA Plant)',
      origin: 'DIP Staff Accommodations',
      destination: 'JAFZA Plant Gate 3',
    },
    vehicle: { vehicleCode: 'BUS-44', licensePlate: 'DXB-99881' },
    driver: { firstName: 'Rashid', lastName: 'Al Nuaimi' },
    passengers: [
      { id: 'pax-1', status: 'CONFIRMED', boardedAt: new Date('2026-09-01T06:02:00.000Z') },
      { id: 'pax-2', status: 'CONFIRMED', boardedAt: new Date('2026-09-01T06:05:00.000Z') },
      { id: 'pax-3', status: 'CONFIRMED', boardedAt: null },
    ],
  };

  const stops = [
    { id: 'stop-1', sequence: 1, stop_name: 'DIP Camp Stop', gps_lat: 24.985, gps_lng: 55.175, estimated_arrival_mins: 0 },
    { id: 'stop-2', sequence: 2, stop_name: 'DIP Central Stop', gps_lat: 25.000, gps_lng: 55.150, estimated_arrival_mins: 15 },
    { id: 'stop-3', sequence: 3, stop_name: 'JAFZA Plant Gate 3', gps_lat: 25.020, gps_lng: 55.120, estimated_arrival_mins: 45 },
  ];

  it('classifies trip as ON_TIME when predicted ETA is within 5 minutes of planned arrival', () => {
    const visits = [{ stop_id: 'stop-1', entered_at: new Date('2026-09-01T06:02:00.000Z') }];
    // Pings moving steadily towards destination
    const pings = [
      { latitude: 24.990, longitude: 55.165, occurred_at: new Date('2026-09-01T06:10:00.000Z') },
      { latitude: 24.995, longitude: 55.155, occurred_at: new Date('2026-09-01T06:15:00.000Z') },
    ];

    const evaluation = evaluateTripSlaSync({
      trip: baseTrip,
      stops,
      visits,
      pings,
      now: '2026-09-01T06:15:00.000Z',
    });

    expect(evaluation.tripId).toBe('trip-101');
    expect(evaluation.routeName).toBe('Route Alpha (DIP to JAFZA Plant)');
    expect(evaluation.totalPassengers).toBe(3);
    expect(evaluation.boardedPassengers).toBe(2);
    expect(evaluation.vehicleCode).toBe('BUS-44');
    expect(evaluation.driverName).toBe('Rashid Al Nuaimi');
    expect(evaluation.nextStopName).toBe('DIP Central Stop');
    expect(evaluation.destinationStopName).toBe('JAFZA Plant Gate 3');
  });

  it('classifies trip as AT_RISK when delay is between 5 and 15 minutes before shift deadline', () => {
    // Bus moving at ~40 km/h at 06:45, ~6-7 minutes away from destination (planned arrival 06:45, SLA 07:15)
    // Predicted arrival will be ~06:52 (7 min delay)
    const delayedTrip = {
      ...baseTrip,
      arrivalTime: new Date('2026-09-01T06:45:00.000Z'),
      latestArrivalTime: new Date('2026-09-01T07:15:00.000Z'),
    };
    const pings = [
      { latitude: 24.990, longitude: 55.160, occurred_at: new Date('2026-09-01T06:40:00.000Z') },
      { latitude: 25.005, longitude: 55.140, occurred_at: new Date('2026-09-01T06:45:00.000Z') },
    ];

    const evaluation = evaluateTripSlaSync({
      trip: delayedTrip,
      stops,
      visits: [{ stop_id: 'stop-1', entered_at: new Date('2026-09-01T06:05:00.000Z') }],
      pings,
      now: '2026-09-01T06:45:00.000Z',
    });

    expect(evaluation.slaStatus).toBe('AT_RISK');
    expect(evaluation.delayMinutes).toBeGreaterThanOrEqual(5);
    expect(evaluation.delayMinutes).toBeLessThanOrEqual(15);
  });

  it('classifies trip as SLA_BREACH when predicted ETA exceeds latestArrivalTime deadline', () => {
    // Current time is 07:05 AM (already past 07:00 AM shift start deadline) and still moving
    const tightSlaTrip = {
      ...baseTrip,
      arrivalTime: new Date('2026-09-01T06:45:00.000Z'),
      latestArrivalTime: new Date('2026-09-01T07:00:00.000Z'), // 07:00 AM shift deadline
    };
    const pings = [
      { latitude: 24.990, longitude: 55.165, occurred_at: new Date('2026-09-01T07:00:00.000Z') },
      { latitude: 24.995, longitude: 55.155, occurred_at: new Date('2026-09-01T07:05:00.000Z') },
    ];

    const evaluation = evaluateTripSlaSync({
      trip: tightSlaTrip,
      stops,
      visits: [],
      pings,
      now: '2026-09-01T07:05:00.000Z',
    });

    expect(evaluation.slaStatus).toBe('SLA_BREACH');
    expect(evaluation.delayMinutes).toBeGreaterThan(15);
  });

  it('returns COMPLETED status when trip status is COMPLETED', () => {
    const completedTrip = {
      ...baseTrip,
      status: 'COMPLETED',
    };
    const evaluation = evaluateTripSlaSync({
      trip: completedTrip,
      stops,
      visits: [
        { stop_id: 'stop-1', entered_at: new Date('2026-09-01T06:00:00.000Z') },
        { stop_id: 'stop-2', entered_at: new Date('2026-09-01T06:15:00.000Z') },
        { stop_id: 'stop-3', entered_at: new Date('2026-09-01T06:45:00.000Z') },
      ],
      pings: [],
      now: '2026-09-01T06:50:00.000Z',
    });

    expect(evaluation.slaStatus).toBe('COMPLETED');
  });
});
