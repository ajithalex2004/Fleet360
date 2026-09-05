import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  spatialShortlistCandidates,
  rankCandidatesWithRouting,
  scoreCandidate,
  rankCandidates,
  DriverCandidate,
  JobRequirements,
} from '../../src/lib/agents/dispatch-optimiser/scoring';
import { routingIntelligence } from '../../src/lib/routing/intelligence-service';
import {
  optimizeStaffTransportPlan,
  EmployeePickupRequirement,
  FleetVehicleSpec,
} from '../../src/lib/agents/staff-transport-planner/optimizer';
import {
  buildCase1Pairings,
  resolveMatrixPairings,
  pairingKey,
} from '../../src/lib/planning/route-consolidation-matrix';
import { RouteFacts } from '../../src/lib/planning/route-consolidation-facts';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

describe('Phase 3: Spatial Filtering & Pre-Routing Top-K Shortlisting', () => {

  const baseJob: JobRequirements = {
    jobId: 'JOB-DXB-9901',
    serviceType: 'PASSENGER',
    priority: 'URGENT',
    pickupLat: 25.2048, // Dubai Downtown
    pickupLng: 55.2708,
    dropoffLat: 25.2500,
    dropoffLng: 55.3000,
    requiredCapacity: 4,
    requiredVehicleTypes: ['BUS', 'VAN', 'SEDAN'],
    requiredLicenseClass: 'LIGHT',
    slaDeadline: new Date(Date.now() + 45 * 60000),
    estimatedDurationMin: 35,
    customerLanguage: 'en',
    zoneId: 'DXB-CENTRAL',
  };

  const createCandidate = (id: string, lat: number, lng: number, zone = 'DXB-CENTRAL'): DriverCandidate => ({
    driverId: `D-${id}`,
    driverName: `Driver ${id}`,
    vehicleId: `V-${id}`,
    vehicleCode: `VEH-${id}`,
    vehicleType: 'VAN',
    capacity: 6,
    currentLat: lat,
    currentLng: lng,
    avgSpeedKmh: 45,
    hoursRemainingToday: 7.0,
    ragScore: 90,
    fatigueScore: 0.1,
    currentJobCount: 0,
    languages: ['en', 'ar'],
    licenseClasses: ['LIGHT'],
    vehicleRiskScore: 0.1,
    zonesServed: [zone],
    isVehicleRegistered: true,
    isVehicleInsured: true,
    isDriverLicensed: true,
    baseDepotLat: 25.2048,
    baseDepotLng: 55.2708,
  });

  beforeEach(() => {
    routingIntelligence.clearL1Cache();
  });

  describe('1. Smart Dispatch Spatial Shortlisting & Candidate Ceiling', () => {
    it('prunes a large candidate pool of 50 drivers to Top-20 spatial candidates', () => {
      // Generate 50 drivers scattered from 1 km to 80 km away
      const candidates: DriverCandidate[] = [];
      for (let i = 1; i <= 50; i++) {
        // Offset latitude roughly ~1 km per 0.01 deg
        const latOffset = (i * 0.01);
        candidates.push(createCandidate(String(i), 25.2048 + latOffset, 55.2708));
      }

      const shortlisted = spatialShortlistCandidates(candidates, baseJob, {
        maxCandidates: 20,
        initialRadiusKm: 10,
        minCandidates: 3,
      });

      expect(shortlisted.length).toBeLessThanOrEqual(20);
      expect(shortlisted.length).toBeGreaterThanOrEqual(3);
      // Closest candidates should be prioritized
      expect(shortlisted[0].driverId).toBe('D-1');
    });

    it('adaptively expands radius when all candidates are beyond initial radius', () => {
      // 5 remote candidates located 35 km away in Jebel Ali / Sharjah border
      const remoteCandidates = [
        createCandidate('R1', 25.5000, 55.5000),
        createCandidate('R2', 25.5100, 55.5100),
        createCandidate('R3', 25.5200, 55.5200),
      ];

      const shortlisted = spatialShortlistCandidates(remoteCandidates, baseJob, {
        maxCandidates: 20,
        initialRadiusKm: 5, // Initially too small (5km)
        minCandidates: 2,
      });

      // Adaptive expansion guarantees candidates are still found
      expect(shortlisted.length).toBeGreaterThanOrEqual(2);
      expect(shortlisted[0].driverId).toBe('D-R1');
    });
  });

  describe('2. Road Matrix Refinement & Cost Avoidance Telemetry', () => {
    it('scores top policy candidates with road matrix refinement and tracks avoided costs', async () => {
      // Pre-seed L1 cache for D-1 to simulate a cache hit
      const d1Loc = { lat: 25.2100, lng: 25.2750 };
      await routingIntelligence.getTravelTime(
        { lat: 25.2100, lng: 55.2750 },
        { lat: baseJob.pickupLat, lng: baseJob.pickupLng },
        { tier: 'TRAFFIC_DYNAMIC' },
      );

      const candidates = [
        createCandidate('1', 25.2100, 55.2750), // ~1 km away
        createCandidate('2', 25.2300, 55.2850), // ~3 km away
        createCandidate('3', 25.2600, 55.3100), // ~7 km away
        createCandidate('4', 25.3000, 55.3500), // ~12 km away
        createCandidate('5', 25.3500, 55.4000), // ~18 km away
        createCandidate('6', 25.4000, 55.4500), // ~25 km away
      ];

      const result = await rankCandidatesWithRouting(candidates, baseJob, {
        maxCandidates: 20,
        topKRefineMatrix: 3,
      });

      expect(result.rawCount).toBe(6);
      expect(result.spatiallyFilteredCount).toBe(3); // Pre-filtered to 3 closest candidates within initial radius
      expect(result.ranked.length).toBe(3);
      expect(result.matrixElementsQueried).toBeGreaterThanOrEqual(1);
      expect(result.matrixElementsQueried).toBeLessThanOrEqual(3); // Capped at topKRefineMatrix
      
      const top = result.ranked[0];
      expect(top.isBlocked).toBe(false);
      expect(top.compositeScore).toBeGreaterThan(0.70);
      expect(top.isMatrixRefined).toBe(true);
      expect(top.reason).toContain('Road Matrix');
    });

    it('maintains strict compliance gating even with road matrix refinement', async () => {
      const candidates = [
        { ...createCandidate('EXPIRED_REG', 25.2050, 55.2710), isVehicleRegistered: false },
        { ...createCandidate('RISKY', 25.2060, 55.2720), vehicleRiskScore: 0.90 },
        createCandidate('VALID', 25.2100, 55.2750),
      ];

      const result = await rankCandidatesWithRouting(candidates, baseJob, {
        topKRefineMatrix: 3,
      });

      const disqualified = result.ranked.filter(c => c.isBlocked);
      const eligible = result.ranked.filter(c => !c.isBlocked);

      expect(disqualified.length).toBe(2);
      expect(eligible.length).toBe(1);
      expect(eligible[0].driverId).toBe('D-VALID');
      expect(result.ranked[0].driverId).toBe('D-VALID'); // Eligible must rank first
    });
  });

  describe('3. Staff Transport Planner Spatial Vehicle Reuse Chaining', () => {
    it('chains vehicle reuse across geographically proximate shift endpoints', () => {
      const requirements: EmployeePickupRequirement[] = [
        // Shift 1: Morning Inbound (06:00 -> 07:00 arrival at Dubai Airport DXB)
        {
          id: 'REQ-1',
          pickupName: 'Muhaisnah Staff Camp',
          pickupLat: 25.2750,
          pickupLng: 55.4050,
          zone: 'MUHAISNAH',
          destinationName: 'Dubai Airport DXB T3',
          destinationLat: 25.2530,
          destinationLng: 55.3650,
          shiftName: 'MORNING_0700',
          targetArrivalTime: '07:00',
          passengerCount: 25,
        },
        // Shift 2: Afternoon Inbound starting near Airport (Deira 4km away) (14:00 -> 15:00 arrival at JAFZA)
        {
          id: 'REQ-2',
          pickupName: 'Deira Accommodation',
          pickupLat: 25.2600,
          pickupLng: 55.3300, // ~4 km from Airport
          zone: 'DEIRA',
          destinationName: 'JAFZA South Hub',
          destinationLat: 24.9850,
          destinationLng: 55.0850,
          shiftName: 'AFTERNOON_1500',
          targetArrivalTime: '15:00',
          passengerCount: 22,
        },
      ];

      const vehicles: FleetVehicleSpec[] = [
        { id: 'V-01', vehicleCode: 'COASTER-01', type: 'MINIBUS', capacity: 30 },
      ];

      const plan = optimizeStaffTransportPlan(requirements, vehicles);

      expect(plan.shiftCoverage).toContain('MORNING_0700');
      expect(plan.shiftCoverage).toContain('AFTERNOON_1500');
      expect(plan.baselineVehiclesNeeded).toBe(2);
      expect(plan.optimizedVehiclesNeeded).toBe(1); // Successfully chained into 1 vehicle
      expect(plan.vehiclesSaved).toBe(1);
      expect(plan.monthlyCostSavedAed).toBe(7500);

      const chain = plan.vehicleReuseChains[0];
      expect(chain.chainedRoutes.length).toBe(2);
      expect(chain.chainedRoutes[0].shiftName).toBe('MORNING_0700');
      expect(chain.chainedRoutes[1].shiftName).toBe('AFTERNOON_1500');
      expect(chain.totalDeadheadKm).toBeLessThan(10); // Proximity shortlisting ensures low deadhead
    });
  });

  describe('4. Route Consolidation Matrix Batching via RoutingIntelligence', () => {
    it('resolves consolidation matrix pairings using RoutingIntelligenceService caching', async () => {
      const mockRouteA: RouteFacts = {
        id: 'R-101',
        name: 'Sonapur to DXB Cargo',
        code: 'R101',
        shift: 'MORNING',
        direction: 'INBOUND',
        plannedDeparture: '06:00',
        plannedArrival: '06:45',
        capacity: 30,
        passengerCount: 20,
        stops: [
          { name: 'Sonapur Camp', sequence: 1, lat: 25.2780, lng: 55.3950 },
          { name: 'DXB Cargo', sequence: 2, lat: 25.2500, lng: 55.3600 },
        ],
      };

      const mockRouteB: RouteFacts = {
        id: 'R-102',
        name: 'Muhaisnah to DXB Cargo',
        code: 'R102',
        shift: 'MORNING',
        direction: 'INBOUND',
        plannedDeparture: '06:10',
        plannedArrival: '06:50',
        capacity: 30,
        passengerCount: 15,
        stops: [
          { name: 'Muhaisnah Gate A', sequence: 1, lat: 25.2750, lng: 55.4050 },
          { name: 'DXB Cargo Gate 2', sequence: 2, lat: 25.2520, lng: 55.3620 },
        ],
      };

      const candidates = [{ routeIdA: 'R-101', routeIdB: 'R-102', a: mockRouteA, b: mockRouteB }];
      const pairings = buildCase1Pairings(candidates);

      expect(pairings.length).toBe(2); // PICKUP_TO_PICKUP and DROPOFF_TO_DROPOFF

      const resolved = await resolveMatrixPairings({} as any, 'tenant-test', pairings);

      const pickupKey = pairingKey('PICKUP_TO_PICKUP', 'R-101', 'R-102');
      const dropoffKey = pairingKey('DROPOFF_TO_DROPOFF', 'R-101', 'R-102');

      expect(resolved.has(pickupKey)).toBe(true);
      expect(resolved.has(dropoffKey)).toBe(true);

      const pickupRes = resolved.get(pickupKey)!;
      expect(pickupRes.distanceKm).toBeGreaterThan(0);
      expect(pickupRes.distanceKm).toBeLessThan(5); // ~1.5 km between Sonapur and Muhaisnah
    });
  });
});
