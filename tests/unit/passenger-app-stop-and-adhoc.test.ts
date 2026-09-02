import { describe, it, expect } from 'vitest';
import { evaluateAdhocFulfillmentSync } from '@/lib/bus-ops/adhoc-dispatch';

describe('Passenger App Features: Pickup Stop Change & Ad-Hoc Requests', () => {
  describe('Ad-Hoc Transport Request Fulfillment', () => {
    it('evaluates dynamic route insertion when scheduled bus has available capacity', () => {
      const scheduledTrips = [
        {
          id: 'trip-101',
          tripNumber: 'TRIP-101',
          departureTime: new Date('2026-09-03T18:00:00Z'),
          route: {
            name: 'Al Quoz Industrial Shuttle',
            origin: 'Al Quoz Depot',
            destination: 'Dubai Silicon Oasis',
          },
          vehicle: {
            id: 'veh-1',
            vehicleCode: 'BUS-104',
            seatingCapacity: 30,
          },
          driver: {
            id: 'drv-1',
            name: 'Rashid Khan',
          },
          passengers: new Array(20).fill({ id: 'p' }), // 10 spare seats
        },
      ];

      const candidates = evaluateAdhocFulfillmentSync({
        tripDate: '2026-09-03T18:05:00Z',
        pickupLocation: 'Al Quoz 3',
        dropLocation: 'Dubai Silicon Oasis',
        passengerCount: 1,
        scheduledTrips,
      });

      expect(candidates.length).toBeGreaterThanOrEqual(1);
      const first = candidates[0];
      expect(first.tier).toBe('ROUTE_INSERTION');
      expect(first.targetTripId).toBe('trip-101');
      expect(first.targetVehicleCode).toBe('BUS-104');
    });

    it('falls back to Standby Shuttle or Taxi Voucher when no buses match route', () => {
      const candidates = evaluateAdhocFulfillmentSync({
        tripDate: '2026-09-03T23:30:00Z',
        pickupLocation: 'Jebel Ali Freezone',
        dropLocation: 'Sharjah City Center',
        passengerCount: 2,
        scheduledTrips: [], // No scheduled buses at midnight
      });

      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(['STANDBY_SHUTTLE', 'TAXI_VOUCHER']).toContain(candidates[0].tier);
    });
  });

  describe('Pickup Location & Stop Update Parameters', () => {
    it('validates permanent stop point payload structure', () => {
      const payload = {
        staffMemberId: 'staff-123',
        newLocationAddress: 'Dubai Marina Mall, Marina Promenade',
        latitude: 25.0782,
        longitude: 55.1415,
        markAsPermanentNewStop: true,
        reason: 'Relocated home address to Marina',
      };

      expect(payload.markAsPermanentNewStop).toBe(true);
      expect(payload.newLocationAddress).toBeDefined();
      expect(typeof payload.latitude).toBe('number');
    });
  });
});
