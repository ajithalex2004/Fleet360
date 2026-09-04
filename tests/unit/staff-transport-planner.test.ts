import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  parseTime,
  formatTime,
  selectOptimalVehicleSize,
  sequenceStops,
  optimizeStaffTransportPlan,
  EmployeePickupRequirement,
  FleetVehicleSpec,
} from '../../src/lib/agents/staff-transport-planner/optimizer';

describe('Staff Transport Planning Agent — Algorithmic Core', () => {
  // Test data: Morning & Afternoon shifts across Dubai accommodation hubs
  const morningReqs: EmployeePickupRequirement[] = [
    {
      id: 'REQ-01',
      employeeName: 'Zayd Al-Nuaimi',
      pickupName: 'Muhaisnah 4 Staff Accommodations',
      pickupLat: 25.2750,
      pickupLng: 55.4050,
      zone: 'Muhaisnah',
      destinationName: 'Dubai International Airport Terminal 3',
      destinationLat: 25.2532,
      destinationLng: 55.3657,
      shiftName: 'MORNING_0700',
      targetArrivalTime: '07:00',
      passengerCount: 6,
    },
    {
      id: 'REQ-02',
      employeeName: 'Rashid Khan',
      pickupName: 'Al Qusais Industrial 2',
      pickupLat: 25.2890,
      pickupLng: 55.3850,
      zone: 'Al Qusais',
      destinationName: 'Dubai International Airport Terminal 3',
      destinationLat: 25.2532,
      destinationLng: 55.3657,
      shiftName: 'MORNING_0700',
      targetArrivalTime: '07:00',
      passengerCount: 18,
    },
  ];

  const afternoonReqs: EmployeePickupRequirement[] = [
    {
      id: 'REQ-03',
      employeeName: 'Farhan Ali',
      pickupName: 'Al Quoz Industrial 3',
      pickupLat: 25.1250,
      pickupLng: 55.2350,
      zone: 'Al Quoz',
      destinationName: 'Dubai South Logistics District',
      destinationLat: 24.8988,
      destinationLng: 55.1568,
      shiftName: 'AFTERNOON_1530',
      targetArrivalTime: '15:30',
      passengerCount: 12,
    },
  ];

  const fleetVehicles: FleetVehicleSpec[] = [
    { id: 'V-01', vehicleCode: 'COASTER-01', type: 'MINIBUS', capacity: 30 },
    { id: 'V-02', vehicleCode: 'VAN-02', type: 'VAN', capacity: 14 },
    { id: 'V-03', vehicleCode: 'COACH-03', type: 'COACH', capacity: 50 },
  ];

  describe('1. Spatial & Time Utilities', () => {
    it('calculates geographic distance with Haversine formula', () => {
      const distKm = haversineKm(25.2750, 55.4050, 25.2532, 55.3657);
      expect(distKm).toBeGreaterThan(4.0);
      expect(distKm).toBeLessThan(8.0);
    });

    it('converts time strings to minutes and back accurately', () => {
      expect(parseTime('07:00')).toBe(420);
      expect(parseTime('15:30')).toBe(930);
      expect(formatTime(420)).toBe('07:00');
      expect(formatTime(930)).toBe('15:30');
      // Buffer before midnight check
      expect(formatTime(-30)).toBe('23:30');
    });
  });

  describe('2. Optimal Vehicle Sizing (Bin Packing)', () => {
    it('selects VAN_14 for passenger counts <= 14', () => {
      const res = selectOptimalVehicleSize(10);
      expect(res.vehicleSize).toBe('VAN_14');
      expect(res.capacity).toBe(14);
      expect(res.seatUtilizationPct).toBe(71.4);
    });

    it('selects COASTER_30 for passenger counts between 15 and 30', () => {
      const res = selectOptimalVehicleSize(25);
      expect(res.vehicleSize).toBe('COASTER_30');
      expect(res.capacity).toBe(30);
      expect(res.seatUtilizationPct).toBe(83.3);
    });

    it('selects COACH_50 for passenger counts > 30', () => {
      const res = selectOptimalVehicleSize(48);
      expect(res.vehicleSize).toBe('COACH_50');
      expect(res.capacity).toBe(50);
      expect(res.seatUtilizationPct).toBe(96.0);
    });
  });

  describe('3. TSP Waypoint Sequencing & Departure Scheduling', () => {
    it('sequences stops and calculates departure time with dwell & buffer', () => {
      const stops = [
        {
          stopId: 'ST-01',
          stopName: 'Muhaisnah Zone 4 Gate A',
          lat: 25.2750,
          lng: 55.4050,
          passengerCount: 4,
          zone: 'Muhaisnah',
        },
        {
          stopId: 'ST-02',
          stopName: 'Muhaisnah Zone 4 Gate B',
          lat: 25.2780,
          lng: 55.4080,
          passengerCount: 6,
          zone: 'Muhaisnah',
        },
      ];

      const destLat = 25.2532;
      const destLng = 55.3657;
      const targetArrival = '07:00';

      const res = sequenceStops(stops, destLat, destLng, targetArrival);

      expect(res.orderedStops).toHaveLength(2);
      expect(res.totalDistanceKm).toBeGreaterThan(0);
      expect(res.totalDurationMin).toBeGreaterThan(0);
      // Departure must be before 07:00
      expect(parseTime(res.departureTimeStr)).toBeLessThan(parseTime('07:00'));
      expect(res.orderedStops[0].estimatedPickupTime).toBeDefined();
    });
  });

  describe('4. Multi-Shift Plan Optimizer & Cross-Shift Vehicle Reuse', () => {
    it('generates an end-to-end multi-shift staff transport plan recommendation with reuse chaining', () => {
      const allReqs = [...morningReqs, ...afternoonReqs];
      const plan = optimizeStaffTransportPlan(allReqs, fleetVehicles, 'tenant-dubai-ops');

      expect(plan.tenantId).toBe('tenant-dubai-ops');
      expect(plan.totalEmployeesCovered).toBe(36); // 6 + 18 + 12
      expect(plan.shiftCoverage).toContain('MORNING_0700');
      expect(plan.shiftCoverage).toContain('AFTERNOON_1530');
      expect(plan.routes.length).toBeGreaterThanOrEqual(3);

      // Verify baseline vs optimized fleet sizing
      expect(plan.baselineVehiclesNeeded).toBe(plan.routes.length);
      expect(plan.optimizedVehiclesNeeded).toBeLessThanOrEqual(plan.baselineVehiclesNeeded);
      expect(plan.vehiclesSaved).toBe(plan.baselineVehiclesNeeded - plan.optimizedVehiclesNeeded);

      // Verify savings calculation
      expect(plan.dailyDistanceSavedKm).toBe(parseFloat((plan.vehiclesSaved * 65.0).toFixed(1)));
      expect(plan.monthlyCostSavedAed).toBe(plan.vehiclesSaved * 7500);
      expect(plan.annualCostSavedAed).toBe(plan.monthlyCostSavedAed * 12);

      // Verify cross-shift reuse chains
      expect(plan.vehicleReuseChains.length).toBeGreaterThan(0);
      for (const chain of plan.vehicleReuseChains) {
        expect(chain.vehicleCode).toBeDefined();
        expect(chain.chainedRoutes.length).toBeGreaterThan(0);
        expect(chain.totalDutyHours).toBeGreaterThan(0);
      }
    });

    it('returns empty plan safely when no requirements are provided', () => {
      const plan = optimizeStaffTransportPlan([], [], 'empty-tenant');
      expect(plan.totalEmployeesCovered).toBe(0);
      expect(plan.routes).toHaveLength(0);
      expect(plan.vehicleReuseChains).toHaveLength(0);
      expect(plan.vehiclesSaved).toBe(0);
    });
  });
});
