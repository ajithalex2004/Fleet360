import { describe, it, expect } from 'vitest';
import {
  scoreVehicleComprehensive,
  calcDtcFaultScore,
  calcSensorAnomalyScore,
  calcOperatingHoursScore,
  calcRepeatFailuresAndRUL,
  calcServiceOverdueScore,
  calcFuelAnomalyScore,
  calcOdometerScore,
  calcVehicleAgeScore,
  ComprehensiveVehicleInput,
} from '@/lib/agents/predictive-maintenance/scoring';

describe('Predictive Maintenance Agent — 9 Failure Signals', () => {
  it('1. Calculates Service Overdue accurately', () => {
    const res = calcServiceOverdueScore(180, 20_000); // 2x overdue
    expect(res.score).toBe(0.8);
    expect(res.daysSince).toBe(180);
    expect(res.kmSince).toBe(20_000);
  });

  it('2. Detects Fuel Consumption Anomalies against baseline', () => {
    const normal = calcFuelAnomalyScore(10.0, 10.2);
    expect(normal.score).toBe(0);

    const spike = calcFuelAnomalyScore(10.0, 15.0); // 50% spike
    expect(spike.score).toBe(1.0);
  });

  it('3. Evaluates Cumulative Mileage wear curve', () => {
    const lowKm = calcOdometerScore(30_000);
    expect(lowKm.score).toBe(0.05);

    const highKm = calcOdometerScore(250_000);
    expect(highKm.score).toBe(1.0);
  });

  it('4. Evaluates Vehicle Age factors', () => {
    const newCar = calcVehicleAgeScore(1);
    expect(newCar.score).toBe(0.05);

    const oldCar = calcVehicleAgeScore(11);
    expect(oldCar.score).toBe(1.0);
  });

  it('5. Ingests CAN-bus DTC Faults and assigns severity penalties', () => {
    const clean = calcDtcFaultScore([]);
    expect(clean.score).toBe(0);

    const misfire = calcDtcFaultScore(['P0300', 'P0128']);
    expect(misfire.score).toBeGreaterThan(0.3);
    expect(misfire.majorCount).toBeGreaterThan(0);

    const criticalOverheat = calcDtcFaultScore(['P0217']); // Critical Coolant Overtemp
    expect(criticalOverheat.score).toBeGreaterThanOrEqual(0.85);
    expect(criticalOverheat.criticalCount).toBe(1);
  });

  it('6. Evaluates Live Sensor Telemetry (Coolant, Oil Pressure, Battery Voltage)', () => {
    const nominal = calcSensorAnomalyScore({
      coolantTempC: 90,
      oilPressureKpa: 300,
      batteryVoltage: 13.8,
    });
    expect(nominal.score).toBe(0);
    expect(nominal.hasImmediateStopRisk).toBe(false);

    const criticalOverheat = calcSensorAnomalyScore({
      coolantTempC: 112,
      oilPressureKpa: 110,
    });
    expect(criticalOverheat.score).toBeGreaterThan(0.8);
    expect(criticalOverheat.hasImmediateStopRisk).toBe(true);
  });

  it('7. Evaluates Operating Hours & Duty Cycle (Idling Stress)', () => {
    const normal = calcOperatingHoursScore(1000, 40_000);
    expect(normal.score).toBe(0.05);

    // High idling in GCC city: 4,000 engine hours on 50,000 km
    const highIdle = calcOperatingHoursScore(4000, 50_000);
    expect(highIdle.stressRatio).toBeGreaterThan(2.0);
    expect(highIdle.score).toBe(0.80);
  });

  it('8 & 9. Evaluates Repeat Subsystem Failures and Computes Component RUL', () => {
    const repairs = [
      { subsystem: 'BRAKES' as const, completedAt: new Date().toISOString() },
      { subsystem: 'BRAKES' as const, completedAt: new Date().toISOString() },
    ];
    const repeatRes = calcRepeatFailuresAndRUL(repairs, 120_000, 45, 0, 0);
    expect(repeatRes.repeatCount).toBe(2);
    expect(repeatRes.repeatSubsystems).toContain('BRAKES');
    expect(repeatRes.subsystemRUL.brakeSystemPct).toBeLessThan(80);
  });

  it('Full Comprehensive Scorer: Correctly escalates critical hazard vehicle', () => {
    const criticalVehicle: ComprehensiveVehicleInput = {
      id: 'veh-999',
      vehicleCode: 'DXB-BUS-402',
      make: 'Mercedes-Benz',
      model: 'Sprinter',
      licensePlate: 'DXB-77291',
      purchaseDate: '2020-01-01',
      odometerReading: 165_000,
      daysSinceLastService: 110,
      kmSinceLastService: 14_000,
      baselineFuelLper100: 12.5,
      recentFuelLper100: 17.2,
      openWorkOrders: 1,
      workOrdersLast90Days: 3,
      historicalRepairs: [
        { subsystem: 'POWERTRAIN', completedAt: new Date().toISOString() },
        { subsystem: 'POWERTRAIN', completedAt: new Date().toISOString() },
      ],
      activeDtcCodes: ['P0217', 'P0300'],
      sensors: {
        coolantTempC: 111,
        oilPressureKpa: 115,
        batteryVoltage: 12.1,
      },
      engineOperatingHours: 4800,
    };

    const score = scoreVehicleComprehensive(criticalVehicle, 1.2);
    expect(score.riskLevel).toBe('CRITICAL');
    expect(score.recommendedAction).toBe('GROUND_VEHICLE');
    expect(score.predictedFailureWindow).toContain('0–48 hours');
    expect(score.primaryFailureReason).toContain('P0217');
    expect(score.factors.activeDtcCodes).toEqual(['P0217', 'P0300']);
  });
});
