/**
 * src/lib/fleet/expiry-grounding-engine.ts
 *
 * Automated Expiry Sweep & Vehicle Auto-Grounding Engine.
 * Eliminates regulatory fines, police impoundments, and legal liability from expired
 * registrations (Mulkiya), commercial insurance, testing certificates, and driver licenses.
 */

import { Prisma, PrismaClient } from '@prisma/client';

export type DocumentComplianceStatus =
  | 'COMPLIANT'
  | 'EXPIRING_WARNING'   // 8 - 30 days remaining
  | 'EXPIRING_CRITICAL'  // 0 - 7 days remaining
  | 'EXPIRED';           // < 0 days remaining (past expiry)

export interface DocumentEvaluation {
  id: string;
  docType: string;
  docNumber?: string | null;
  expiryDate: Date | null;
  daysRemaining: number;
  status: DocumentComplianceStatus;
  isMandatory: boolean;
  gracePeriodDays: number;
  isPastGracePeriod: boolean;
  groundingRequired: boolean;
  reason?: string;
}

export interface VehicleComplianceRecord {
  vehicleId: string;
  vehicleCode: string;
  licensePlate: string;
  makeModel: string;
  currentStatus: string;
  isActive: boolean;
  documents: DocumentEvaluation[];
  hasExpiredInsurance: boolean;
  hasExpiredRegistration: boolean;
  hasExpiredTesting: boolean;
  complianceHealth: 'COMPLIANT' | 'WARNING' | 'CRITICAL' | 'NON_COMPLIANT';
  actionTaken: 'GROUNDED' | 'UNGROUNDED' | 'MAINTAINED' | 'NO_ACTION';
  actionReason?: string;
}

export interface DriverComplianceRecord {
  driverId: string;
  driverName?: string;
  documents: DocumentEvaluation[];
  complianceHealth: 'COMPLIANT' | 'WARNING' | 'CRITICAL' | 'NON_COMPLIANT';
  isSuspended: boolean;
}

export interface ExpirySweepSummary {
  sweepTimestamp: string;
  totalVehiclesEvaluated: number;
  totalDocumentsEvaluated: number;
  compliantVehiclesCount: number;
  warningVehiclesCount: number;
  criticalVehiclesCount: number;
  groundedVehiclesCount: number;
  newlyGroundedCount: number;
  newlyRestoredCount: number;
  vehicleRecords: VehicleComplianceRecord[];
  driverRecords?: DriverComplianceRecord[];
}

export interface ExpirySweepOptions {
  referenceDate?: Date;
  mulkiyaGracePeriodDays?: number; // Default 30 days per UAE regulation
  autoUpdateDb?: boolean;          // Defaults to true
  dryRun?: boolean;                // If true, calculates actions without writing
}

const MANDATORY_VEHICLE_DOCS = new Set([
  'INSURANCE',
  'MULKIYA',
  'REGISTRATION',
  'TESTING',
  'PERMIT',
  'CIVIL_DEFENSE',
]);

/**
 * Pure function: Evaluates compliance status of a single document.
 */
export function evaluateDocumentCompliance(
  doc: {
    id: string;
    docType: string;
    docNumber?: string | null;
    expiryDate: Date | string | null;
  },
  referenceDate: Date = new Date(),
  mulkiyaGracePeriodDays: number = 30
): DocumentEvaluation {
  const normType = (doc.docType || '').toUpperCase().trim();
  const isMandatory = MANDATORY_VEHICLE_DOCS.has(normType);

  if (!doc.expiryDate) {
    return {
      id: doc.id,
      docType: normType,
      docNumber: doc.docNumber,
      expiryDate: null,
      daysRemaining: -9999,
      status: 'EXPIRED',
      isMandatory,
      gracePeriodDays: 0,
      isPastGracePeriod: true,
      groundingRequired: isMandatory,
      reason: 'Missing expiry date on mandatory document',
    };
  }

  const exp = new Date(doc.expiryDate);
  const diffMs = exp.getTime() - referenceDate.getTime();
  const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Grace periods: Insurance has 0 grace period. Mulkiya/Registration has 30 days.
  const gracePeriodDays =
    normType === 'INSURANCE' ? 0 : normType === 'MULKIYA' || normType === 'REGISTRATION' ? mulkiyaGracePeriodDays : 0;

  let status: DocumentComplianceStatus = 'COMPLIANT';
  let groundingRequired = false;
  let isPastGracePeriod = false;
  let reason: string | undefined;

  if (daysRemaining < 0) {
    status = 'EXPIRED';
    const daysOverdue = Math.abs(daysRemaining);
    if (daysOverdue > gracePeriodDays) {
      isPastGracePeriod = true;
      if (isMandatory) {
        groundingRequired = true;
        reason = `${normType} expired ${daysOverdue} days ago (exceeded ${gracePeriodDays}-day grace period)`;
      }
    } else {
      reason = `${normType} expired but within ${gracePeriodDays}-day legal renewal grace period (${daysOverdue}d ago)`;
    }
  } else if (daysRemaining <= 7) {
    status = 'EXPIRING_CRITICAL';
    reason = `${normType} expires in ${daysRemaining} days (Immediate renewal required)`;
  } else if (daysRemaining <= 30) {
    status = 'EXPIRING_WARNING';
    reason = `${normType} expires in ${daysRemaining} days`;
  }

  return {
    id: doc.id,
    docType: normType,
    docNumber: doc.docNumber,
    expiryDate: exp,
    daysRemaining,
    status,
    isMandatory,
    gracePeriodDays,
    isPastGracePeriod,
    groundingRequired,
    reason,
  };
}

/**
 * Pure function: Evaluates fleet compliance for a vehicle given its documents.
 */
export function evaluateVehicleCompliance(
  vehicle: {
    id: string;
    vehicleCode?: string | null;
    licensePlate?: string | null;
    make?: string | null;
    model?: string | null;
    status?: string | null;
    isActive?: boolean | null;
  },
  docs: Array<{
    id: string;
    docType: string;
    docNumber?: string | null;
    expiryDate: Date | string | null;
  }>,
  referenceDate: Date = new Date(),
  mulkiyaGracePeriodDays: number = 30
): VehicleComplianceRecord {
  const evaluatedDocs = docs.map((d) =>
    evaluateDocumentCompliance(d, referenceDate, mulkiyaGracePeriodDays)
  );

  const hasExpiredInsurance = evaluatedDocs.some(
    (d) => d.docType === 'INSURANCE' && d.status === 'EXPIRED'
  );
  const hasExpiredRegistration = evaluatedDocs.some(
    (d) =>
      (d.docType === 'MULKIYA' || d.docType === 'REGISTRATION') &&
      d.isPastGracePeriod
  );
  const hasExpiredTesting = evaluatedDocs.some(
    (d) => d.docType === 'TESTING' && d.status === 'EXPIRED'
  );

  const requiresGrounding = evaluatedDocs.some((d) => d.groundingRequired);
  const hasCritical = evaluatedDocs.some((d) => d.status === 'EXPIRING_CRITICAL');
  const hasWarning = evaluatedDocs.some((d) => d.status === 'EXPIRING_WARNING');

  let complianceHealth: VehicleComplianceRecord['complianceHealth'] = 'COMPLIANT';
  if (requiresGrounding || hasExpiredInsurance || hasExpiredRegistration) {
    complianceHealth = 'NON_COMPLIANT';
  } else if (hasCritical) {
    complianceHealth = 'CRITICAL';
  } else if (hasWarning) {
    complianceHealth = 'WARNING';
  }

  const currentStatus = (vehicle.status || 'AVAILABLE').toUpperCase();
  const currentActive = vehicle.isActive ?? true;

  let actionTaken: VehicleComplianceRecord['actionTaken'] = 'NO_ACTION';
  let actionReason: string | undefined;

  if (requiresGrounding) {
    if (currentStatus !== 'GROUNDED' || currentActive) {
      actionTaken = 'GROUNDED';
      const failingDocs = evaluatedDocs
        .filter((d) => d.groundingRequired)
        .map((d) => d.docType)
        .join(', ');
      actionReason = `Vehicle auto-grounded due to expired mandatory document(s): ${failingDocs}`;
    } else {
      actionTaken = 'MAINTAINED';
      actionReason = 'Vehicle remains grounded due to non-compliant documents';
    }
  } else {
    // If it was grounded due to documents, and now all mandatory docs are compliant, restore to AVAILABLE
    if (currentStatus === 'GROUNDED') {
      actionTaken = 'UNGROUNDED';
      actionReason = 'All mandatory documents are valid; vehicle restored to AVAILABLE';
    }
  }

  return {
    vehicleId: vehicle.id,
    vehicleCode: vehicle.vehicleCode || vehicle.licensePlate || 'VEH',
    licensePlate: vehicle.licensePlate || 'N/A',
    makeModel: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle',
    currentStatus,
    isActive: currentActive,
    documents: evaluatedDocs,
    hasExpiredInsurance,
    hasExpiredRegistration,
    hasExpiredTesting,
    complianceHealth,
    actionTaken,
    actionReason,
  };
}

/**
 * Executes the complete automated document expiry sweep across the tenant's fleet.
 */
export async function executeFleetExpirySweep(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  options: ExpirySweepOptions = {}
): Promise<ExpirySweepSummary> {
  const refDate = options.referenceDate || new Date();
  const gracePeriod = options.mulkiyaGracePeriodDays ?? 30;
  const isDryRun = options.dryRun ?? false;

  // 1. Fetch all active vehicles for this tenant
  const vehicles = await tx.vehicle.findMany({
    where: {
      tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      vehicleCode: true,
      licensePlate: true,
      make: true,
      model: true,
      status: true,
      isActive: true,
    },
  });

  // 2. Fetch all vehicle documents for this tenant
  const documents = await tx.vehicleDocument.findMany({
    where: {
      tenantId,
    },
    select: {
      id: true,
      vehicleId: true,
      docType: true,
      docNumber: true,
      expiryDate: true,
      status: true,
    },
  });

  // Group documents by vehicleId
  const docsByVehicle = new Map<string, typeof documents>();
  for (const doc of documents) {
    if (!docsByVehicle.has(doc.vehicleId)) {
      docsByVehicle.set(doc.vehicleId, []);
    }
    docsByVehicle.get(doc.vehicleId)!.push(doc);
  }

  const vehicleRecords: VehicleComplianceRecord[] = [];
  let newlyGroundedCount = 0;
  let newlyRestoredCount = 0;

  // 3. Evaluate each vehicle
  for (const veh of vehicles) {
    const vehDocs = docsByVehicle.get(veh.id) || [];
    const evaluation = evaluateVehicleCompliance(veh, vehDocs, refDate, gracePeriod);
    vehicleRecords.push(evaluation);

    if (evaluation.actionTaken === 'GROUNDED') {
      newlyGroundedCount++;
      if (!isDryRun) {
        await tx.vehicle.update({
          where: { id: veh.id },
          data: {
            status: 'GROUNDED',
            isActive: false,
          },
        });
      }
    } else if (evaluation.actionTaken === 'UNGROUNDED') {
      newlyRestoredCount++;
      if (!isDryRun) {
        await tx.vehicle.update({
          where: { id: veh.id },
          data: {
            status: 'AVAILABLE',
            isActive: true,
          },
        });
      }
    }

    // Update document status fields in DB if changed
    if (!isDryRun) {
      for (const d of evaluation.documents) {
        const dbStatus = d.status === 'COMPLIANT' ? 'ACTIVE' : d.status;
        await tx.vehicleDocument.update({
          where: { id: d.id },
          data: {
            status: dbStatus,
            notes: d.reason || undefined,
          },
        });
      }
    }
  }

  const compliantCount = vehicleRecords.filter((v) => v.complianceHealth === 'COMPLIANT').length;
  const warningCount = vehicleRecords.filter((v) => v.complianceHealth === 'WARNING').length;
  const criticalCount = vehicleRecords.filter((v) => v.complianceHealth === 'CRITICAL').length;
  const groundedCount = vehicleRecords.filter(
    (v) => v.complianceHealth === 'NON_COMPLIANT' || v.actionTaken === 'GROUNDED' || v.currentStatus === 'GROUNDED'
  ).length;

  return {
    sweepTimestamp: refDate.toISOString(),
    totalVehiclesEvaluated: vehicles.length,
    totalDocumentsEvaluated: documents.length,
    compliantVehiclesCount: compliantCount,
    warningVehiclesCount: warningCount,
    criticalVehiclesCount: criticalCount,
    groundedVehiclesCount: groundedCount,
    newlyGroundedCount,
    newlyRestoredCount,
    vehicleRecords,
  };
}
