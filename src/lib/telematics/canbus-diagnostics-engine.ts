/**
 * src/lib/telematics/canbus-diagnostics-engine.ts
 *
 * CAN-bus Telematics & DTC Fault Ingestion Engine.
 * Enables predictive breakdown prevention before catastrophic engine or transmission failure.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { raiseAlert } from '@/lib/alerts/raise';

export type DtcSubsystem =
  | 'POWERTRAIN'      // Pxxxx (Engine, Transmission, Fuel)
  | 'CHASSIS'         // Cxxxx (Brakes, ABS, Steering, Suspension)
  | 'BODY'            // Bxxxx (Airbags, Climate, Lighting)
  | 'NETWORK'         // Uxxxx (CAN-bus, ECU Communication)
  | 'EMISSIONS_DPF';  // Diesel Exhaust Fluid / DPF Aftertreatment

export type DtcSeverity = 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR';

export interface DtcFaultCodeDefinition {
  code: string;
  subsystem: DtcSubsystem;
  severity: DtcSeverity;
  title: string;
  description: string;
  recommendedAction: string;
  breakdownRiskPenalty: number; // 0 - 50 points deducted from VHI
}

export interface CanbusSensorReadings {
  coolantTempC?: number;
  engineRpm?: number;
  oilPressureKpa?: number;
  batteryVoltage?: number;
  fuelRailPressureKpa?: number;
  defLevelPercent?: number;
  dpfSootLoadPercent?: number;
  transmissionTempC?: number;
}

export interface SensorAnomalyEvaluation {
  coolantStatus: 'NORMAL' | 'WARNING' | 'CRITICAL_OVERHEAT';
  oilPressureStatus: 'NORMAL' | 'LOW_WARNING' | 'CRITICAL_LOSS';
  electricalStatus: 'NORMAL' | 'LOW_VOLTAGE' | 'ALTERNATOR_OVERVOLTAGE';
  emissionsStatus: 'NORMAL' | 'DEF_LOW' | 'DPF_CLOGGED_DERATE_RISK';
  anomaliesDetected: string[];
  requiresImmediateStop: boolean;
  totalSensorPenalty: number;
}

export interface VehicleHealthIndexResult {
  vhiScore: number; // 0 - 100%
  healthGrade: 'OPTIMAL' | 'GOOD' | 'ELEVATED_RISK' | 'CRITICAL_BREAKDOWN_IMMINENT';
  activeDtcFaults: DtcFaultCodeDefinition[];
  sensorAnomalies: SensorAnomalyEvaluation;
  breakdownRiskDescription: string;
  recommendedWorkshopAction?: string;
}

// Comprehensive SAE J2012 / J1939 Knowledgebase
export const EXTENDED_DTC_DICTIONARY: Record<string, Omit<DtcFaultCodeDefinition, 'code'>> = {
  // Powertrain - Ignition & Misfire
  P0300: {
    subsystem: 'POWERTRAIN',
    severity: 'MAJOR',
    title: 'Random/Multiple Cylinder Misfire Detected',
    description: 'Engine cylinders misfiring erratically; risk of unburned fuel damaging catalytic converter.',
    recommendedAction: 'Inspect ignition coils, spark plugs, and fuel injectors immediately.',
    breakdownRiskPenalty: 25,
  },
  P0301: {
    subsystem: 'POWERTRAIN',
    severity: 'MAJOR',
    title: 'Cylinder 1 Misfire Detected',
    description: 'Specific cylinder 1 ignition failure.',
    recommendedAction: 'Check Cylinder 1 ignition coil and compression.',
    breakdownRiskPenalty: 20,
  },

  // Powertrain - Thermal & Cooling
  P0217: {
    subsystem: 'POWERTRAIN',
    severity: 'CRITICAL',
    title: 'Engine Coolant Overtemperature Condition',
    description: 'Engine coolant has exceeded safe thermal operating limits (> 115°C). Severe head gasket warpage risk.',
    recommendedAction: 'Immediate safe pullover and shutdown. Inspect radiator, water pump, and coolant level.',
    breakdownRiskPenalty: 45,
  },
  P0128: {
    subsystem: 'POWERTRAIN',
    severity: 'MODERATE',
    title: 'Coolant Thermostat Malfunction (Below Regulating Temp)',
    description: 'Engine operating below optimal thermal efficiency.',
    recommendedAction: 'Replace stuck-open thermostat.',
    breakdownRiskPenalty: 10,
  },

  // Powertrain - Lubrication & Oil
  P0524: {
    subsystem: 'POWERTRAIN',
    severity: 'CRITICAL',
    title: 'Engine Oil Pressure Too Low',
    description: 'Critical drop in hydrodynamic oil lubrication pressure (< 150 kPa). Risk of catastrophic engine seizure.',
    recommendedAction: 'Immediate engine shutdown. Do not crank engine. Tow vehicle to workshop.',
    breakdownRiskPenalty: 50,
  },
  P0521: {
    subsystem: 'POWERTRAIN',
    severity: 'MAJOR',
    title: 'Engine Oil Pressure Sensor/Switch Range/Performance',
    description: 'Oil pressure sensor transmitting out-of-range erratic signals.',
    recommendedAction: 'Diagnose oil pressure sending unit and verify manual gauge pressure.',
    breakdownRiskPenalty: 20,
  },

  // Powertrain - Fuel & Air Metering
  P0087: {
    subsystem: 'POWERTRAIN',
    severity: 'CRITICAL',
    title: 'Fuel Rail/System Pressure - Too Low',
    description: 'High-pressure common-rail fuel pump unable to maintain target rail pressure.',
    recommendedAction: 'Inspect high-pressure fuel pump (HPFP), fuel filter, and rail pressure regulator.',
    breakdownRiskPenalty: 35,
  },
  P0171: {
    subsystem: 'POWERTRAIN',
    severity: 'MODERATE',
    title: 'System Too Lean (Bank 1)',
    description: 'Excess air or insufficient fuel delivery.',
    recommendedAction: 'Check for vacuum leaks and clean Mass Air Flow (MAF) sensor.',
    breakdownRiskPenalty: 12,
  },

  // Transmission
  P0700: {
    subsystem: 'POWERTRAIN',
    severity: 'MAJOR',
    title: 'Transmission Control System (MIL Request)',
    description: 'TCM has requested check engine lamp illumination due to internal gearbox fault.',
    recommendedAction: 'Scan transmission controller for clutch slip or solenoid codes.',
    breakdownRiskPenalty: 25,
  },
  P0730: {
    subsystem: 'POWERTRAIN',
    severity: 'CRITICAL',
    title: 'Incorrect Gear Ratio / Transmission Slipping',
    description: 'Automatic transmission gear slipping detected under torque load.',
    recommendedAction: 'Check transmission fluid level and inspect torque converter/valve body.',
    breakdownRiskPenalty: 40,
  },

  // Chassis - Brakes & ABS
  C0035: {
    subsystem: 'CHASSIS',
    severity: 'MAJOR',
    title: 'Left Front Wheel Speed Sensor Circuit Fault',
    description: 'ABS wheel speed sensor circuit open or shorted. Anti-lock braking impaired.',
    recommendedAction: 'Inspect ABS wheel speed sensor harness and tone ring.',
    breakdownRiskPenalty: 20,
  },
  C0561: {
    subsystem: 'CHASSIS',
    severity: 'MAJOR',
    title: 'System Disabled Information Stored (Electronic Stability)',
    description: 'ESP/Traction control system disabled due to underlying chassis sensor fault.',
    recommendedAction: 'Diagnose stability sensor cluster and yaw rate sensor.',
    breakdownRiskPenalty: 15,
  },

  // Body & Safety Systems
  B0001: {
    subsystem: 'BODY',
    severity: 'CRITICAL',
    title: 'Driver Frontal Airbag Stage 1 Deployment Circuit',
    description: 'SRS Airbag module reporting open circuit or short in driver steering wheel squib.',
    recommendedAction: 'Immediate SRS clockspring and airbag harness inspection.',
    breakdownRiskPenalty: 30,
  },

  // CAN-bus Network & ECU Communications
  U0100: {
    subsystem: 'NETWORK',
    severity: 'CRITICAL',
    title: 'Lost Communication With Engine Control Module (ECM/PCM)',
    description: 'CAN-bus backbone lost heartbeat packets with primary engine controller.',
    recommendedAction: 'Inspect high-speed CAN-bus termination resistors (120 Ohm) and ECM power relay.',
    breakdownRiskPenalty: 45,
  },
  U0101: {
    subsystem: 'NETWORK',
    severity: 'MAJOR',
    title: 'Lost Communication with Transmission Control Module (TCM)',
    description: 'CAN communication loss with transmission module.',
    recommendedAction: 'Check TCM connector pins and vehicle harness ground.',
    breakdownRiskPenalty: 30,
  },

  // Emissions & DPF/DEF (Diesel Heavy Vehicles)
  P20EE: {
    subsystem: 'EMISSIONS_DPF',
    severity: 'MAJOR',
    title: 'SCR NOx Catalyst Efficiency Below Threshold',
    description: 'Selective Catalytic Reduction efficiency degraded; AdBlue/DEF dosing failure.',
    recommendedAction: 'Inspect DEF injector nozzle and refill quality DEF fluid.',
    breakdownRiskPenalty: 20,
  },
  P2463: {
    subsystem: 'EMISSIONS_DPF',
    severity: 'CRITICAL',
    title: 'Diesel Particulate Filter (DPF) - Soot Accumulation Excessive',
    description: 'DPF soot loading > 90%. Imminent ECM engine power derate / limp home mode.',
    recommendedAction: 'Perform manual DPF forced regeneration or workshop chemical cleaning.',
    breakdownRiskPenalty: 40,
  },
};

/**
 * Pure function: Resolves any raw DTC code against knowledgebase or SAE standard prefix.
 */
export function resolveDtcCode(rawCode: string): DtcFaultCodeDefinition {
  const code = rawCode.trim().toUpperCase();
  if (EXTENDED_DTC_DICTIONARY[code]) {
    return {
      code,
      ...EXTENDED_DTC_DICTIONARY[code],
    };
  }

  // Heuristic SAE fallback
  const prefix = code.charAt(0);
  let subsystem: DtcSubsystem = 'POWERTRAIN';
  if (prefix === 'C') subsystem = 'CHASSIS';
  else if (prefix === 'B') subsystem = 'BODY';
  else if (prefix === 'U') subsystem = 'NETWORK';

  return {
    code,
    subsystem,
    severity: 'MAJOR',
    title: `Diagnostic Trouble Code ${code}`,
    description: `CAN-bus fault code ${code} reported by vehicle electronic control unit.`,
    recommendedAction: 'Connect OBD-II diagnostic scanner to read live freeze-frame data.',
    breakdownRiskPenalty: 15,
  };
}

/**
 * Pure function: Evaluates live CAN-bus sensor PIDs against mechanical & thermal thresholds.
 */
export function evaluateCanbusPidsSync(sensors: CanbusSensorReadings): SensorAnomalyEvaluation {
  const anomalies: string[] = [];
  let totalPenalty = 0;
  let requiresImmediateStop = false;

  // 1. Coolant Temperature Check
  let coolantStatus: SensorAnomalyEvaluation['coolantStatus'] = 'NORMAL';
  if (sensors.coolantTempC !== undefined) {
    if (sensors.coolantTempC >= 115) {
      coolantStatus = 'CRITICAL_OVERHEAT';
      anomalies.push(`Critical Engine Overheating: Coolant at ${sensors.coolantTempC}°C (Threshold: 115°C)`);
      totalPenalty += 40;
      requiresImmediateStop = true;
    } else if (sensors.coolantTempC >= 105) {
      coolantStatus = 'WARNING';
      anomalies.push(`Elevated Engine Temperature: Coolant at ${sensors.coolantTempC}°C (Warning: 105°C)`);
      totalPenalty += 15;
    }
  }

  // 2. Oil Pressure Check (Under operating load, e.g. RPM > 1000)
  let oilPressureStatus: SensorAnomalyEvaluation['oilPressureStatus'] = 'NORMAL';
  if (sensors.oilPressureKpa !== undefined) {
    const isRunning = sensors.engineRpm !== undefined ? sensors.engineRpm > 800 : true;
    if (isRunning && sensors.oilPressureKpa < 130) {
      oilPressureStatus = 'CRITICAL_LOSS';
      anomalies.push(`Critical Oil Pressure Loss: ${sensors.oilPressureKpa} kPa (Min Safe: 150 kPa)`);
      totalPenalty += 45;
      requiresImmediateStop = true;
    } else if (isRunning && sensors.oilPressureKpa < 180) {
      oilPressureStatus = 'LOW_WARNING';
      anomalies.push(`Low Engine Oil Pressure: ${sensors.oilPressureKpa} kPa`);
      totalPenalty += 15;
    }
  }

  // 3. Electrical & Battery Voltage Check
  let electricalStatus: SensorAnomalyEvaluation['electricalStatus'] = 'NORMAL';
  if (sensors.batteryVoltage !== undefined) {
    if (sensors.batteryVoltage < 11.8) {
      electricalStatus = 'LOW_VOLTAGE';
      anomalies.push(`Low Battery Voltage: ${sensors.batteryVoltage.toFixed(1)}V (Alternator / Charging Fault)`);
      totalPenalty += 15;
    } else if (sensors.batteryVoltage > 15.2) {
      electricalStatus = 'ALTERNATOR_OVERVOLTAGE';
      anomalies.push(`Alternator Overvoltage: ${sensors.batteryVoltage.toFixed(1)}V (Regulator Malfunction)`);
      totalPenalty += 20;
    }
  }

  // 4. Heavy Commercial Emissions (DEF / DPF)
  let emissionsStatus: SensorAnomalyEvaluation['emissionsStatus'] = 'NORMAL';
  if (sensors.dpfSootLoadPercent !== undefined && sensors.dpfSootLoadPercent >= 88) {
    emissionsStatus = 'DPF_CLOGGED_DERATE_RISK';
    anomalies.push(`DPF Soot Loading Critical: ${sensors.dpfSootLoadPercent}% (Imminent Engine Derate)`);
    totalPenalty += 30;
  } else if (sensors.defLevelPercent !== undefined && sensors.defLevelPercent <= 5) {
    emissionsStatus = 'DEF_LOW';
    anomalies.push(`DEF / AdBlue Fluid Critically Low: ${sensors.defLevelPercent}%`);
    totalPenalty += 15;
  }

  return {
    coolantStatus,
    oilPressureStatus,
    electricalStatus,
    emissionsStatus,
    anomaliesDetected: anomalies,
    requiresImmediateStop,
    totalSensorPenalty: totalPenalty,
  };
}

/**
 * Pure function: Calculates Vehicle Health Index (VHI) and breakdown risk.
 */
export function calculateVehicleHealthIndex(
  dtcCodes: string[] = [],
  sensors: CanbusSensorReadings = {}
): VehicleHealthIndexResult {
  const activeDtcFaults = dtcCodes.map(resolveDtcCode);
  const sensorAnomalies = evaluateCanbusPidsSync(sensors);

  // Sum penalties
  const dtcPenalty = activeDtcFaults.reduce((sum, d) => sum + d.breakdownRiskPenalty, 0);
  const totalPenalty = dtcPenalty + sensorAnomalies.totalSensorPenalty;

  const vhiScore = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  let healthGrade: VehicleHealthIndexResult['healthGrade'] = 'OPTIMAL';
  let breakdownRiskDescription = 'All powertrain, thermal, and sensor diagnostics within normal parameters.';
  let recommendedWorkshopAction: string | undefined;

  if (vhiScore <= 40 || sensorAnomalies.requiresImmediateStop) {
    healthGrade = 'CRITICAL_BREAKDOWN_IMMINENT';
    breakdownRiskDescription = 'CRITICAL: Imminent mechanical breakdown hazard. Engine / transmission failure imminent.';
    recommendedWorkshopAction = 'Immediately ground asset and dispatch emergency mobile workshop technician.';
  } else if (vhiScore <= 70) {
    healthGrade = 'ELEVATED_RISK';
    breakdownRiskDescription = 'ELEVATED RISK: Active fault codes or sensor anomalies detected. Preventive inspection required.';
    recommendedWorkshopAction = 'Schedule priority workshop diagnostic service within 24 hours.';
  } else if (vhiScore <= 89) {
    healthGrade = 'GOOD';
    breakdownRiskDescription = 'GOOD: Minor sensor deviation or pending code detected.';
    recommendedWorkshopAction = 'Monitor during next routine preventative maintenance.';
  }

  return {
    vhiScore,
    healthGrade,
    activeDtcFaults,
    sensorAnomalies,
    breakdownRiskDescription,
    recommendedWorkshopAction,
  };
}

/**
 * Ingests live CAN-bus telemetry frame, creates alerts, updates vehicle state, and provisions service tickets.
 */
export async function processCanbusTelemetryIngest(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  vehicle: { id: string; vehicleCode?: string | null; licensePlate?: string | null },
  payload: {
    dtcCodes?: string[];
    sensors?: CanbusSensorReadings;
    occurredAt?: Date;
  }
): Promise<VehicleHealthIndexResult> {
  const dtcCodes = payload.dtcCodes || [];
  const sensors = payload.sensors || {};
  const occurredAt = payload.occurredAt || new Date();

  const health = calculateVehicleHealthIndex(dtcCodes, sensors);
  const vehicleLabel = vehicle.vehicleCode || vehicle.licensePlate || 'Vehicle';

  // 1. Raise Alerts for any Critical or Major DTC codes
  for (const dtc of health.activeDtcFaults) {
    await raiseAlert({
      tenantId,
      code: 'CANBUS_DTC_FAULT_DETECTED',
      sourceModule: 'fleet',
      subjectType: 'Vehicle',
      subjectId: vehicle.id,
      severity: dtc.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      title: `CAN-bus Fault [${dtc.code}] on ${vehicleLabel}`,
      description: `${dtc.title}: ${dtc.description}. Action: ${dtc.recommendedAction}`,
      dedupeKey: `DTC:${vehicle.id}:${dtc.code}`,
    }).catch((err) => console.warn('[canbus-engine] DTC alert failed:', err));
  }

  // 2. Raise Alerts for Sensor Thermal/Pressure Anomalies
  if (health.sensorAnomalies.requiresImmediateStop) {
    await raiseAlert({
      tenantId,
      code: 'CRITICAL_THERMAL_MECHANICAL_EMERGENCY',
      sourceModule: 'fleet',
      subjectType: 'Vehicle',
      subjectId: vehicle.id,
      severity: 'CRITICAL',
      title: `EMERGENCY: Immediate Engine Shutdown Advised on ${vehicleLabel}`,
      description: health.sensorAnomalies.anomaliesDetected.join(' | '),
      dedupeKey: `EMERGENCY_SHUTDOWN:${vehicle.id}:${Math.floor(occurredAt.getTime() / 600000)}`,
    }).catch((err) => console.warn('[canbus-engine] Emergency alert failed:', err));
  }

  // 3. Auto-Provision Workshop Service Request for Critical Breakdown Hazards
  if (health.healthGrade === 'CRITICAL_BREAKDOWN_IMMINENT') {
    try {
      const topFault = health.activeDtcFaults[0]?.code || 'CRITICAL_SENSOR_FAULT';
      const faultSummary = [
        ...health.activeDtcFaults.map((d) => `[${d.code}] ${d.title}`),
        ...health.sensorAnomalies.anomaliesDetected,
      ].join('; ');

      await tx.serviceRequest.create({
        data: {
          tenantId,
          vehicleId: vehicle.id,
          requestType: 'REPAIR',
          priority: 'URGENT',
          status: 'OPEN',
          description: `[AUTO-DISPATCHED CAN-BUS DIAGNOSTIC] Vehicle Health Index: ${health.vhiScore}%. Faults: ${faultSummary}. Recommended: ${health.recommendedWorkshopAction}`,
        },
      });
    } catch (err) {
      console.warn('[canbus-engine] Auto-ticket generation failed:', err);
    }
  }

  return health;
}
