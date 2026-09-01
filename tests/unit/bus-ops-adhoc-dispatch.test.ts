/**
 * tests/unit/bus-ops-adhoc-dispatch.test.ts
 *
 * Unit tests for On-Demand Overtime & Ad-Hoc Booking Workflow Engine.
 */

import { describe, it, expect } from 'vitest';
import { evaluateAdhocFulfillmentSync } from '@/lib/bus-ops/adhoc-dispatch';

describe('On-Demand Overtime & Ad-Hoc Dispatch Solver', () => {
  const scheduledTrips = [
    {
      id: 'trip-101',
      tripNumber: 'TRP-101',
      departureTime: '2026-09-01T21:00:00.000Z',
      capacity: 30,
      confirmedCount: 22, // 8 spare seats
      route: { name: 'DIP to JAFZA Route', origin: 'DIP Camp', destination: 'JAFZA Plant Gate 3' },
      vehicle: { id: 'veh-01', vehicleCode: 'BUS-44', licensePlate: 'DXB-99881' },
      driver: { id: 'drv-01', firstName: 'Rashid', lastName: 'Al Nuaimi' },
    },
    {
      id: 'trip-102',
      tripNumber: 'TRP-102',
      departureTime: '2026-09-01T23:30:00.000Z',
      capacity: 14,
      confirmedCount: 14, // 0 spare seats (FULL)
      route: { name: 'Al Quoz to DIP Night Shift', origin: 'Al Quoz', destination: 'DIP' },
      vehicle: { id: 'veh-02', vehicleCode: 'VAN-12', licensePlate: 'DXB-11223' },
      driver: { id: 'drv-02', firstName: 'Tariq', lastName: 'Mahmood' },
    },
  ];

  const standbyVehicles = [
    { id: 'veh-sb-1', vehicleCode: 'STANDBY-VAN-01', licensePlate: 'DXB-77112', capacity: 14 },
  ];

  const availableDrivers = [
    { id: 'drv-sb-1', firstName: 'Ahmed', lastName: 'Saeed' },
  ];

  it('selects Tier 1 Route Insertion when an existing trip has spare seats within 45 mins', () => {
    // Request at 21:15 (15 min difference from Trip-101 at 21:00)
    const candidates = evaluateAdhocFulfillmentSync({
      tripDate: '2026-09-01T21:15:00.000Z',
      pickupLocation: 'JAFZA Plant Gate 3',
      dropLocation: 'DIP Camp',
      passengerCount: 2,
      scheduledTrips,
      standbyVehicles,
      availableDrivers,
    });

    expect(candidates.length).toBeGreaterThanOrEqual(2);

    const tier1 = candidates.find(c => c.tier === 'ROUTE_INSERTION');
    expect(tier1).toBeDefined();
    expect(tier1?.targetTripId).toBe('trip-101');
    expect(tier1?.targetVehicleCode).toBe('BUS-44');
    expect(tier1?.targetDriverName).toBe('Rashid Al Nuaimi');
    expect(tier1?.estimatedCost).toBe(25.0);
    expect(tier1?.availableSeats).toBe(8);
  });

  it('provides Tier 2 Standby Shuttle option when internal vehicle & driver are available', () => {
    const candidates = evaluateAdhocFulfillmentSync({
      tripDate: '2026-09-01T23:30:00.000Z',
      pickupLocation: 'Plant Gate 4',
      dropLocation: 'Sharjah Housing',
      passengerCount: 4,
      scheduledTrips, // Trip-102 at 23:30 has 0 spare seats
      standbyVehicles,
      availableDrivers,
    });

    const tier2 = candidates.find(c => c.tier === 'STANDBY_SHUTTLE');
    expect(tier2).toBeDefined();
    expect(tier2?.targetVehicleCode).toBe('STANDBY-VAN-01');
    expect(tier2?.targetDriverName).toBe('Ahmed Saeed');
    expect(tier2?.estimatedCost).toBe(250.0);
  });

  it('always includes Tier 3 Corporate Taxi Voucher fallback with a voucher code', () => {
    const candidates = evaluateAdhocFulfillmentSync({
      tripDate: '2026-09-02T03:00:00.000Z',
      pickupLocation: 'Airport Cargo Terminal 2',
      dropLocation: 'DIP Accommodations',
      passengerCount: 1,
      scheduledTrips: [], // No scheduled trips at 3 AM
      standbyVehicles: [], // No standby vehicles free
      availableDrivers: [],
    });

    expect(candidates.length).toBe(1);
    const tier3 = candidates[0];
    expect(tier3.tier).toBe('TAXI_VOUCHER');
    expect(tier3.voucherCode).toMatch(/^TX-CR-/);
    expect(tier3.estimatedCost).toBe(65.0);
  });
});
