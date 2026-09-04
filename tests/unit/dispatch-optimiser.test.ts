import { describe, it, expect } from 'vitest';
import { rankCandidates, scoreCandidate, DriverCandidate, JobRequirements } from '../../src/lib/agents/dispatch-optimiser/scoring';

describe('Smart Dispatch Optimiser — 15-Factor Scoring Model v2.0.0', () => {
  const baseJob: JobRequirements = {
    jobId: 'T-1047',
    serviceType: 'PASSENGER',
    priority: 'URGENT',
    pickupLat: 25.2048,
    pickupLng: 55.2708,
    dropoffLat: 25.2500,
    dropoffLng: 55.3000,
    requiredCapacity: 4,
    requiredVehicleTypes: ['BUS', 'VAN', 'SEDAN'],
    requiredLicenseClass: 'LIGHT',
    slaDeadline: new Date(Date.now() + 45 * 60000), // 45 mins from now
    estimatedDurationMin: 35,
    customerLanguage: 'en',
    zoneId: 'DXB-CENTRAL',
  };

  const validCandidate: DriverCandidate = {
    driverId: 'D-102',
    driverName: 'Ahmed Al-Mansoor',
    vehicleId: 'V-BUS-28',
    vehicleCode: 'BUS-28',
    vehicleType: 'BUS',
    capacity: 14,
    currentLat: 25.2100, // ~1 km away
    currentLng: 55.2750,
    avgSpeedKmh: 45,
    hoursRemainingToday: 6.5,
    ragScore: 92,
    fatigueScore: 0.15,
    currentJobCount: 0,
    languages: ['en', 'ar'],
    licenseClasses: ['LIGHT', 'BUS', 'HEAVY'],
    vehicleRiskScore: 0.12,
    zonesServed: ['DXB-CENTRAL', 'DXB-NORTH'],
    isVehicleRegistered: true,
    isVehicleInsured: true,
    isDriverLicensed: true,
    baseDepotLat: 25.2048,
    baseDepotLng: 55.2708,
  };

  it('scores an eligible candidate with a high composite score and clear rationale', () => {
    const result = scoreCandidate(validCandidate, baseJob);

    expect(result.isBlocked).toBe(false);
    expect(result.compositeScore).toBeGreaterThan(0.80);
    expect(result.rank).toBe(0);
    expect(result.distanceKm).toBeLessThan(3.0);
    expect(result.etaMinutes).toBeLessThan(10);
    expect(result.factors.complianceStatus).toBe(1.0);
    expect(result.factors.skillMatch).toBe(1.0);
    expect(result.factors.vehicleCapacity).toBe(1.0);
    expect(result.reason).toContain('BUS-28');
    expect(result.reason).toContain('Ahmed Al-Mansoor');
  });

  describe('Hard Disqualification Compliance Gates', () => {
    it('disqualifies candidate when vehicle registration / Mulkiya is expired', () => {
      const expiredRegCandidate = { ...validCandidate, isVehicleRegistered: false };
      const result = scoreCandidate(expiredRegCandidate, baseJob);

      expect(result.isBlocked).toBe(true);
      expect(result.compositeScore).toBe(0);
      expect(result.blockReason).toContain('registration');
      expect(result.reason).toContain('DISQUALIFIED');
    });

    it('disqualifies candidate when vehicle insurance is expired', () => {
      const expiredInsCandidate = { ...validCandidate, isVehicleInsured: false };
      const result = scoreCandidate(expiredInsCandidate, baseJob);

      expect(result.isBlocked).toBe(true);
      expect(result.compositeScore).toBe(0);
      expect(result.blockReason).toContain('insurance');
      expect(result.reason).toContain('DISQUALIFIED');
    });

    it('disqualifies candidate when driver commercial license is expired or invalid', () => {
      const expiredLicCandidate = { ...validCandidate, isDriverLicensed: false };
      const result = scoreCandidate(expiredLicCandidate, baseJob);

      expect(result.isBlocked).toBe(true);
      expect(result.compositeScore).toBe(0);
      expect(result.blockReason).toContain('license');
      expect(result.reason).toContain('DISQUALIFIED');
    });

    it('disqualifies candidate when vehicle predictive risk exceeds 75%', () => {
      const riskyVehicleCandidate = { ...validCandidate, vehicleRiskScore: 0.85 };
      const result = scoreCandidate(riskyVehicleCandidate, baseJob);

      expect(result.isBlocked).toBe(true);
      expect(result.compositeScore).toBe(0);
      expect(result.blockReason).toContain('Critical vehicle failure risk');
      expect(result.reason).toContain('DISQUALIFIED');
    });

    it('disqualifies candidate when driver fatigue exceeds safety threshold (>= 80%)', () => {
      const fatiguedDriverCandidate = { ...validCandidate, fatigueScore: 0.85 };
      const result = scoreCandidate(fatiguedDriverCandidate, baseJob);

      expect(result.isBlocked).toBe(true);
      expect(result.compositeScore).toBe(0);
      expect(result.blockReason).toContain('fatigue exceeds safety threshold');
      expect(result.reason).toContain('DISQUALIFIED');
    });
  });

  describe('Multi-Candidate Ranking & Deadhead Optimization', () => {
    it('ranks closer and lower deadhead vehicle above farther vehicle', () => {
      const farCandidate: DriverCandidate = {
        ...validCandidate,
        driverId: 'D-201',
        driverName: 'Suresh Kumar',
        vehicleId: 'V-BUS-55',
        vehicleCode: 'BUS-55',
        currentLat: 25.4000, // ~25 km away
        currentLng: 55.4500,
        baseDepotLat: 25.8000, // Very far base depot (large deadhead)
        baseDepotLng: 55.9000,
      };

      const ranked = rankCandidates([farCandidate, validCandidate], baseJob);

      expect(ranked.length).toBe(2);
      expect(ranked[0].driverId).toBe('D-102'); // Closer candidate ranked first
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].driverId).toBe('D-201');
      expect(ranked[1].rank).toBe(2);
      expect(ranked[0].compositeScore).toBeGreaterThan(ranked[1].compositeScore);
    });

    it('ranks compliant candidate above disqualified candidate', () => {
      const disqualifiedCandidate: DriverCandidate = {
        ...validCandidate,
        driverId: 'D-999',
        driverName: 'Disqualified Driver',
        vehicleId: 'V-BAD-01',
        vehicleCode: 'BAD-01',
        isVehicleRegistered: false,
      };

      const ranked = rankCandidates([disqualifiedCandidate, validCandidate], baseJob);

      expect(ranked[0].driverId).toBe('D-102');
      expect(ranked[0].isBlocked).toBe(false);
      expect(ranked[1].driverId).toBe('D-999');
      expect(ranked[1].isBlocked).toBe(true);
    });

    it('penalizes candidate with insufficient remaining HOS shift time', () => {
      const lowHOSCandidate: DriverCandidate = {
        ...validCandidate,
        driverId: 'D-303',
        driverName: 'Low HOS Driver',
        hoursRemainingToday: 0.2, // Only 12 mins remaining for a 35-min trip
      };

      const result = scoreCandidate(lowHOSCandidate, baseJob);
      const normalResult = scoreCandidate(validCandidate, baseJob);

      expect(result.factors.hosCompliance).toBe(0);
      expect(normalResult.factors.hosCompliance).toBe(1.0);
      expect(normalResult.compositeScore).toBeGreaterThan(result.compositeScore);
    });
  });
});
