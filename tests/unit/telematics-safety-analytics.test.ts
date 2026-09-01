/**
 * tests/unit/telematics-safety-analytics.test.ts
 *
 * Unit tests for Telematics Phase 3: Fuel Siphoning, Driver Safety Scores & DTCs.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateFuelAnomaliesSync,
  calculateDriverSafetyScoreSync,
  evaluateDtcFaultCodesSync,
} from '@/lib/telematics/safety-analytics';

describe('Fuel Siphoning & Anomaly Detection Engine (Phase 3)', () => {
  it('detects fuel siphoning theft when fuel level drops >= 15% with ignition OFF', () => {
    // Tank dropped from 85% to 55% (-30%) while parked/ignition off
    const result = evaluateFuelAnomaliesSync(85, 55, false, 0);

    expect(result.type).toBe('THEFT_SIPHONING');
    expect(result.deltaPercent).toBe(30);
    expect(result.alertNeeded).toBe(true);
    expect(result.message).toContain('Rapid fuel drop');
  });

  it('classifies normal fuel consumption during driving without raising theft alert', () => {
    // Tank dropped from 85% to 80% (-5%) during driving
    const result = evaluateFuelAnomaliesSync(85, 80, true, 45);

    expect(result.type).toBe('NORMAL_CONSUMPTION');
    expect(result.deltaPercent).toBe(5);
    expect(result.alertNeeded).toBe(false);
  });

  it('identifies tank refuel when fuel increases by >= 15%', () => {
    // Tank filled from 25% to 90% (+65%)
    const result = evaluateFuelAnomaliesSync(25, 90, false, 0);

    expect(result.type).toBe('REFUEL');
    expect(result.deltaPercent).toBe(65);
    expect(result.alertNeeded).toBe(false);
  });
});

describe('Driver Safety & Eco-Driving Scoring Index (Phase 3)', () => {
  it('assigns 100 and GREEN status to a driver with 0 harsh events', () => {
    const scoreRes = calculateDriverSafetyScoreSync({
      harshBrakes: 0,
      harshAccels: 0,
      harshCornerings: 0,
      overspeedEvents: 0,
      excessiveIdlingMins: 0,
    });

    expect(scoreRes.score).toBe(100);
    expect(scoreRes.ragStatus).toBe('GREEN');
    expect(scoreRes.totalDeductions).toBe(0);
  });

  it('applies proportional deductions and classifies moderate risk as AMBER', () => {
    // 2 harsh brakes (-6), 2 harsh accels (-4), 1 overspeed (-5) -> -15 points = score 85 -> AMBER/GREEN
    const scoreRes = calculateDriverSafetyScoreSync({
      harshBrakes: 4, // -12
      harshAccels: 3, // -6
      harshCornerings: 2, // -6
      overspeedEvents: 1, // -5
      excessiveIdlingMins: 20, // -4
    }); // Total deductions = 33 -> Score = 67 -> AMBER

    expect(scoreRes.score).toBe(67);
    expect(scoreRes.ragStatus).toBe('AMBER');
    expect(scoreRes.totalDeductions).toBe(33);
  });

  it('classifies frequent safety violations (< 60 points) as RED', () => {
    const scoreRes = calculateDriverSafetyScoreSync({
      harshBrakes: 8, // -24
      harshAccels: 6, // -12
      harshCornerings: 4, // -12
      overspeedEvents: 3, // -15
      excessiveIdlingMins: 30, // -6
    }); // Total deductions = 69 -> Score = 31 -> RED

    expect(scoreRes.score).toBe(31);
    expect(scoreRes.ragStatus).toBe('RED');
  });
});

describe('CAN-bus Diagnostic Trouble Codes (DTC) Ingestion (Phase 3)', () => {
  it('correctly parses and classifies standard Powertrain misfire DTC (P0300)', () => {
    const dtcs = evaluateDtcFaultCodesSync(['P0300']);

    expect(dtcs.length).toBe(1);
    expect(dtcs[0].code).toBe('P0300');
    expect(dtcs[0].subsystem).toBe('POWERTRAIN');
    expect(dtcs[0].severity).toBe('CRITICAL');
    expect(dtcs[0].description).toContain('Cylinder Misfire');
  });

  it('correctly classifies Chassis ABS speed sensor faults (C0035)', () => {
    const dtcs = evaluateDtcFaultCodesSync(['C0035']);

    expect(dtcs.length).toBe(1);
    expect(dtcs[0].code).toBe('C0035');
    expect(dtcs[0].subsystem).toBe('CHASSIS');
    expect(dtcs[0].severity).toBe('MAJOR');
  });

  it('gracefully classifies unknown OEM vendor codes by prefix heuristic', () => {
    const dtcs = evaluateDtcFaultCodesSync(['U1234']);

    expect(dtcs.length).toBe(1);
    expect(dtcs[0].code).toBe('U1234');
    expect(dtcs[0].subsystem).toBe('NETWORK');
  });
});
