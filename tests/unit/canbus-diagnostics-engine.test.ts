/**
 * tests/unit/canbus-diagnostics-engine.test.ts
 *
 * Unit tests for CAN-bus Telematics & DTC Diagnostics Predictive Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDtcCode,
  evaluateCanbusPidsSync,
  calculateVehicleHealthIndex,
} from '@/lib/telematics/canbus-diagnostics-engine';

describe('CAN-bus Telematics & DTC Diagnostics Engine', () => {
  describe('resolveDtcCode', () => {
    it('accurately decodes known SAE J2012 critical trouble codes', () => {
      const p0217 = resolveDtcCode('P0217');
      expect(p0217.subsystem).toBe('POWERTRAIN');
      expect(p0217.severity).toBe('CRITICAL');
      expect(p0217.title).toContain('Coolant Overtemperature');
      expect(p0217.breakdownRiskPenalty).toBeGreaterThanOrEqual(40);

      const p0524 = resolveDtcCode('P0524');
      expect(p0524.subsystem).toBe('POWERTRAIN');
      expect(p0524.severity).toBe('CRITICAL');
      expect(p0524.title).toContain('Oil Pressure Too Low');

      const u0100 = resolveDtcCode('U0100');
      expect(u0100.subsystem).toBe('NETWORK');
      expect(u0100.severity).toBe('CRITICAL');
    });

    it('heuristically classifies unknown DTC codes based on SAE prefix', () => {
      const cCode = resolveDtcCode('C0999');
      expect(cCode.subsystem).toBe('CHASSIS');

      const bCode = resolveDtcCode('B0888');
      expect(bCode.subsystem).toBe('BODY');

      const uCode = resolveDtcCode('U0777');
      expect(uCode.subsystem).toBe('NETWORK');
    });
  });

  describe('evaluateCanbusPidsSync', () => {
    it('detects critical coolant overheat (>= 115°C) and requires immediate stop', () => {
      const result = evaluateCanbusPidsSync({
        coolantTempC: 118,
        engineRpm: 1800,
        oilPressureKpa: 300,
        batteryVoltage: 13.8,
      });

      expect(result.coolantStatus).toBe('CRITICAL_OVERHEAT');
      expect(result.requiresImmediateStop).toBe(true);
      expect(result.totalSensorPenalty).toBeGreaterThanOrEqual(40);
    });

    it('detects critical oil pressure loss (< 130 kPa) under running RPM', () => {
      const result = evaluateCanbusPidsSync({
        coolantTempC: 90,
        engineRpm: 1500,
        oilPressureKpa: 110, // Dangerous
        batteryVoltage: 13.8,
      });

      expect(result.oilPressureStatus).toBe('CRITICAL_LOSS');
      expect(result.requiresImmediateStop).toBe(true);
      expect(result.totalSensorPenalty).toBeGreaterThanOrEqual(45);
    });

    it('detects low battery / alternator faults', () => {
      const result = evaluateCanbusPidsSync({
        coolantTempC: 88,
        engineRpm: 1200,
        oilPressureKpa: 320,
        batteryVoltage: 11.2, // Alternator charging failure
      });

      expect(result.electricalStatus).toBe('LOW_VOLTAGE');
      expect(result.requiresImmediateStop).toBe(false);
    });

    it('detects DPF soot loading derate risk on heavy diesel assets', () => {
      const result = evaluateCanbusPidsSync({
        dpfSootLoadPercent: 94,
      });

      expect(result.emissionsStatus).toBe('DPF_CLOGGED_DERATE_RISK');
      expect(result.totalSensorPenalty).toBeGreaterThanOrEqual(30);
    });
  });

  describe('calculateVehicleHealthIndex', () => {
    it('returns OPTIMAL 100% when no DTCs or sensor anomalies exist', () => {
      const health = calculateVehicleHealthIndex([], {
        coolantTempC: 90,
        engineRpm: 1400,
        oilPressureKpa: 350,
        batteryVoltage: 13.8,
      });

      expect(health.vhiScore).toBe(100);
      expect(health.healthGrade).toBe('OPTIMAL');
      expect(health.activeDtcFaults).toHaveLength(0);
    });

    it('grades vehicle as ELEVATED_RISK when non-critical DTCs are present', () => {
      const health = calculateVehicleHealthIndex(['P0300'], {
        coolantTempC: 92,
        engineRpm: 1400,
        oilPressureKpa: 320,
      });

      expect(health.vhiScore).toBe(75);
      expect(health.healthGrade).toBe('GOOD'); // 75 is GOOD (71-89)

      const multipleFaults = calculateVehicleHealthIndex(['P0300', 'P0700'], {
        coolantTempC: 95,
      });
      expect(multipleFaults.vhiScore).toBe(50);
      expect(multipleFaults.healthGrade).toBe('ELEVATED_RISK'); // <= 70
    });

    it('grades vehicle as CRITICAL_BREAKDOWN_IMMINENT when critical overheat or oil loss occurs', () => {
      const health = calculateVehicleHealthIndex(['P0217'], {
        coolantTempC: 119,
        engineRpm: 2000,
        oilPressureKpa: 120,
      });

      expect(health.healthGrade).toBe('CRITICAL_BREAKDOWN_IMMINENT');
      expect(health.recommendedWorkshopAction).toContain('emergency mobile workshop');
    });
  });
});
