/**
 * src/lib/telematics/safety-analytics.ts
 *
 * CAN-bus Diagnostics & Safety Analytics Engine (Phase 3).
 *
 * Capabilities:
 *   1. Fuel Siphoning & Theft Anomaly Detection
 *   2. Driver Safety & Eco-Driving Score Index (0–100, RAG classification)
 *   3. Diagnostic Trouble Codes (DTC) Fault Classification & Auto-Ticketing
 */

import type { Prisma } from '@prisma/client';
import { raiseAlert } from '@/lib/alerts/raise';

// ── 1. Fuel Siphoning & Refuel Anomaly Evaluator ──────────────────────────────

export type FuelAnomalyType =
  | 'NORMAL_CONSUMPTION'
  | 'NORMAL_FLUCTUATION'
  | 'THEFT_SIPHONING'
  | 'REFUEL';

export interface FuelAnomalyResult {
  type: FuelAnomalyType;
  deltaPercent: number;
  alertNeeded: boolean;
  message: string;
}

export function evaluateFuelAnomaliesSync(
  prevFuelPercent: number,
  currentFuelPercent: number,
  ignition: boolean = false,
  kmDelta: number = 0,
): FuelAnomalyResult {
  const delta = currentFuelPercent - prevFuelPercent;

  if (delta < 0) {
    const dropPercent = Math.abs(delta);
    // Sudden drop >= 15% when ignition is off or vehicle hasn't moved much (< 3 km)
    if (dropPercent >= 15 && (!ignition || kmDelta < 3)) {
      return {
        type: 'THEFT_SIPHONING',
        deltaPercent: dropPercent,
        alertNeeded: true,
        message: `Rapid fuel drop of ${dropPercent.toFixed(1)}% detected while ${
          !ignition ? 'ignition was OFF' : `vehicle traveled only ${kmDelta.toFixed(1)} km`
        }. Potential fuel siphoning theft.`,
      };
    }

    return {
      type: 'NORMAL_CONSUMPTION',
      deltaPercent: dropPercent,
      alertNeeded: false,
      message: `Normal fuel consumption (${dropPercent.toFixed(1)}% drop).`,
    };
  }

  if (delta > 0) {
    const increasePercent = delta;
    if (increasePercent >= 15) {
      return {
        type: 'REFUEL',
        deltaPercent: increasePercent,
        alertNeeded: false,
        message: `Fuel tank refuel detected (+${increasePercent.toFixed(1)}%).`,
      };
    }

    return {
      type: 'NORMAL_FLUCTUATION',
      deltaPercent: increasePercent,
      alertNeeded: false,
      message: `Sensor fluctuation (+${increasePercent.toFixed(1)}%).`,
    };
  }

  return {
    type: 'NORMAL_FLUCTUATION',
    deltaPercent: 0,
    alertNeeded: false,
    message: 'No fuel level change.',
  };
}

// ── 2. Driver Safety & Eco-Driving Scoring Index (0–100) ───────────────────────

export interface DriverSafetyInput {
  harshBrakes: number;
  harshAccels: number;
  harshCornerings?: number;
  overspeedEvents: number;
  excessiveIdlingMins?: number;
}

export interface DriverSafetyScoreResult {
  score: number;
  ragStatus: 'GREEN' | 'AMBER' | 'RED';
  deductions: {
    harshBraking: number;
    harshAcceleration: number;
    harshCornering: number;
    speeding: number;
    excessiveIdling: number;
  };
  totalDeductions: number;
  summary: string;
}

export function calculateDriverSafetyScoreSync(
  input: DriverSafetyInput,
): DriverSafetyScoreResult {
  const harshBrakingDeduction = input.harshBrakes * 3;
  const harshAccelDeduction = input.harshAccels * 2;
  const harshCorneringDeduction = (input.harshCornerings || 0) * 3;
  const speedingDeduction = input.overspeedEvents * 5;
  const idlingDeduction = Math.floor((input.excessiveIdlingMins || 0) / 10) * 2;

  const totalDeductions =
    harshBrakingDeduction +
    harshAccelDeduction +
    harshCorneringDeduction +
    speedingDeduction +
    idlingDeduction;

  const score = Math.max(0, Math.min(100, 100 - totalDeductions));

  let ragStatus: 'GREEN' | 'AMBER' | 'RED' = 'GREEN';
  if (score < 60) {
    ragStatus = 'RED';
  } else if (score < 80) {
    ragStatus = 'AMBER';
  }

  return {
    score,
    ragStatus,
    deductions: {
      harshBraking: harshBrakingDeduction,
      harshAcceleration: harshAccelDeduction,
      harshCornering: harshCorneringDeduction,
      speeding: speedingDeduction,
      excessiveIdling: idlingDeduction,
    },
    totalDeductions,
    summary:
      ragStatus === 'GREEN'
        ? 'Safe & Eco-friendly driving pattern.'
        : ragStatus === 'AMBER'
        ? 'Moderate risk: frequent harsh events detected.'
        : 'High risk: critical safety violations requiring coaching.',
  };
}

// ── 3. Diagnostic Trouble Codes (DTC) Ingestion & Classification ──────────────

export interface DtcFaultCodeInfo {
  code: string;
  subsystem: 'POWERTRAIN' | 'CHASSIS' | 'BODY' | 'NETWORK';
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  description: string;
  recommendedAction: string;
}

const KNOWN_DTC_MAP: Record<string, Omit<DtcFaultCodeInfo, 'code'>> = {
  P0300: {
    subsystem: 'POWERTRAIN',
    severity: 'CRITICAL',
    description: 'Random/Multiple Cylinder Misfire Detected',
    recommendedAction: 'Immediate ignition coil & spark plug inspection to prevent catalytic damage.',
  },
  P0117: {
    subsystem: 'POWERTRAIN',
    severity: 'CRITICAL',
    description: 'Engine Coolant Temperature Circuit Low / Overheating Warning',
    recommendedAction: 'Inspect coolant level and thermostat immediately; engine stop advised.',
  },
  P0420: {
    subsystem: 'POWERTRAIN',
    severity: 'MAJOR',
    description: 'Catalyst System Efficiency Below Threshold (Bank 1)',
    recommendedAction: 'Schedule exhaust & O2 sensor diagnostic at next service window.',
  },
  P0500: {
    subsystem: 'POWERTRAIN',
    severity: 'MAJOR',
    description: 'Vehicle Speed Sensor (VSS) Malfunction',
    recommendedAction: 'Check speed sensor wiring and CAN-bus telemetry link.',
  },
  C0035: {
    subsystem: 'CHASSIS',
    severity: 'MAJOR',
    description: 'Left Front Wheel Speed Sensor Circuit Fault (ABS)',
    recommendedAction: 'Inspect ABS wheel speed sensor wiring and brake hub.',
  },
  C0040: {
    subsystem: 'CHASSIS',
    severity: 'MAJOR',
    description: 'Right Front Wheel Speed Sensor Circuit Fault (ABS)',
    recommendedAction: 'Inspect ABS wheel speed sensor wiring and brake hub.',
  },
  U0100: {
    subsystem: 'NETWORK',
    severity: 'CRITICAL',
    description: 'Lost Communication With Engine Control Module (ECM/PCM)',
    recommendedAction: 'Diagnose CAN-bus wiring harness and ECM power supply harness.',
  },
  B0001: {
    subsystem: 'BODY',
    severity: 'CRITICAL',
    description: 'Driver Frontal Airbag Stage 1 Deployment Control Fault',
    recommendedAction: 'Immediate SRS airbag module inspection; vehicle safety hazard.',
  },
};

export function evaluateDtcFaultCodesSync(codes: string[]): DtcFaultCodeInfo[] {
  return codes.map((rawCode) => {
    const code = rawCode.trim().toUpperCase();
    if (KNOWN_DTC_MAP[code]) {
      return {
        code,
        ...KNOWN_DTC_MAP[code],
      };
    }

    // Heuristic classification from standard SAE J2012 prefix
    const prefix = code.charAt(0);
    let subsystem: DtcFaultCodeInfo['subsystem'] = 'POWERTRAIN';
    if (prefix === 'C') subsystem = 'CHASSIS';
    else if (prefix === 'B') subsystem = 'BODY';
    else if (prefix === 'U') subsystem = 'NETWORK';

    return {
      code,
      subsystem,
      severity: 'MAJOR',
      description: `CAN-bus Diagnostic Trouble Code ${code}`,
      recommendedAction: 'Connect OBD-II diagnostic scanner to diagnose subsystem.',
    };
  });
}

// ── 4. CAN-bus Diagnostics & Safety Database Pipeline ─────────────────────────

export async function processCanbusDiagnosticsAndSafety(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicle: { id: string; vehicleCode?: string | null; licensePlate?: string | null; fuelLevel?: number | null },
  ping: {
    fuelLevelPercent?: number;
    ignition?: boolean;
    odometerKm?: number;
    dtcCodes?: string[];
    harshBraking?: boolean;
    harshAcceleration?: boolean;
    speedKmh?: number;
    occurredAt: Date;
  },
) {
  const vehicleLabel = vehicle.vehicleCode || vehicle.licensePlate || 'Vehicle';

  // A. Fuel Anomaly Check
  if (
    ping.fuelLevelPercent !== undefined &&
    vehicle.fuelLevel !== null &&
    vehicle.fuelLevel !== undefined
  ) {
    const fuelEval = evaluateFuelAnomaliesSync(
      vehicle.fuelLevel,
      ping.fuelLevelPercent,
      ping.ignition ?? false,
      0,
    );

    if (fuelEval.type === 'THEFT_SIPHONING') {
      await raiseAlert({
        tenantId,
        code: 'FUEL_SIPHONING_THEFT_DETECTED',
        sourceModule: 'fleet',
        subjectType: 'Vehicle',
        subjectId: vehicle.id,
        severity: 'CRITICAL',
        title: `CRITICAL: Fuel Siphoning Theft Alert on ${vehicleLabel}`,
        description: `${fuelEval.message} (Previous: ${vehicle.fuelLevel}%, Current: ${ping.fuelLevelPercent}%)`,
        dedupeKey: `FUEL_THEFT:${vehicle.id}:${Math.floor(ping.occurredAt.getTime() / 1800000)}`,
      }).catch((err) => console.warn('[safety-analytics] Fuel theft alert failed:', err));
    }
  }

  // B. Diagnostic Trouble Codes (DTC) Auto-Ticketing
  if (ping.dtcCodes && ping.dtcCodes.length > 0) {
    const parsedCodes = evaluateDtcFaultCodesSync(ping.dtcCodes);
    const criticalCodes = parsedCodes.filter((c) => c.severity === 'CRITICAL');

    for (const dtc of parsedCodes) {
      await raiseAlert({
        tenantId,
        code: 'ENGINE_DTC_FAULT_DETECTED',
        sourceModule: 'fleet',
        subjectType: 'Vehicle',
        subjectId: vehicle.id,
        severity: dtc.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        title: `CAN-bus DTC [${dtc.code}] on ${vehicleLabel}`,
        description: `${dtc.description}. Subsystem: ${dtc.subsystem}. Action: ${dtc.recommendedAction}`,
        dedupeKey: `DTC:${vehicle.id}:${dtc.code}`,
      }).catch((err) => console.warn('[safety-analytics] DTC alert failed:', err));
    }

    // If critical DTC codes found, automatically create a diagnostic Service Request
    if (criticalCodes.length > 0) {
      try {
        const topCode = criticalCodes[0];
        await tx.serviceRequest.create({
          data: {
            tenantId,
            vehicleId: vehicle.id,
            requestType: 'REPAIR',
            priority: 'URGENT',
            status: 'OPEN',
            description: `[AUTO-GENERATED VIA CAN-BUS TELEMETRY] Critical Engine Fault Detected: ${topCode.code} - ${topCode.description}. ${topCode.recommendedAction}`,
          },
        });
      } catch {
        // Safe fallback if ServiceRequest schema constraints differ
      }
    }
  }
}
