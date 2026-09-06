/**
 * Fleet Compliance Risk Engine
 * ----------------------------
 * Aggregates all vehicle, driver, permit, and contract documents into
 * a unified compliance health score, horizon buckets, and prescriptive actions.
 */

import {
  DocumentRecord,
  FleetComplianceRiskView,
  ComplianceCriticalItem,
  ComplianceRecommendedAction,
} from '../types';

export const COMPLIANCE_PENALTY_WEIGHTS = {
  CRITICAL: 15.0, // Expired document / missing mandatory permit
  URGENT: 5.0,    // Expiring in <= 7 days
  UPCOMING: 1.0,  // Expiring in 8–30 days
};

export const ESTIMATED_FINES_AED = {
  MULKIYA_EXPIRED: 1000.0,
  INSURANCE_EXPIRED: 1500.0,
  FAHAS_EXPIRED: 500.0,
  RTA_PERMIT_EXPIRED: 5000.0,
  DRIVER_LICENSE_EXPIRED: 2000.0,
  RTA_CARD_EXPIRED: 2000.0,
  CIVIL_DEFENCE_EXPIRED: 10000.0,
  COLD_CHAIN_CALIBRATION_EXPIRED: 3000.0,
  DEFAULT: 1000.0,
};

export function evaluateFleetComplianceRisk(
  documents: DocumentRecord[],
  referenceDate: Date = new Date(),
): FleetComplianceRiskView {
  const refMs = referenceDate.getTime();

  const criticalItems: ComplianceCriticalItem[] = [];
  const urgentItems: ComplianceCriticalItem[] = [];
  let upcomingCount = 0;
  let fullyCompliantCount = 0;

  const uniqueEntities = new Set<string>();

  for (const doc of documents) {
    uniqueEntities.add(`${doc.entityType}_${doc.entityId}`);
    const expiryMs = new Date(doc.expiryDate).getTime();
    const daysRemaining = Math.floor((expiryMs - refMs) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= 0 || doc.status === 'EXPIRED') {
      const fine = getEstimatedFine(doc.documentType);
      criticalItems.push({
        entityId: doc.entityId,
        entityType: doc.entityType as any,
        code: doc.entityCode,
        item: formatDocumentName(doc.documentType),
        status: 'EXPIRED',
        daysOverdue: Math.abs(daysRemaining),
        riskDescription: `Expired ${Math.abs(daysRemaining)} days ago. Mandatory regulatory requirement breached.`,
        potentialFineAed: fine,
      });
    } else if (daysRemaining <= 7) {
      const fine = getEstimatedFine(doc.documentType);
      urgentItems.push({
        entityId: doc.entityId,
        entityType: doc.entityType as any,
        code: doc.entityCode,
        item: formatDocumentName(doc.documentType),
        status: 'IMMINENT_EXPIRY',
        daysOverdue: 0,
        riskDescription: `Expires in ${daysRemaining} day(s). Immediate renewal or inspection booking required.`,
        potentialFineAed: fine,
      });
    } else if (daysRemaining <= 30) {
      upcomingCount++;
    } else {
      fullyCompliantCount++;
    }
  }

  const totalDocuments = documents.length || 1;
  const criticalCount = criticalItems.length;
  const urgentCount = urgentItems.length;
  const dueIn30DaysCount = criticalCount + urgentCount + upcomingCount;

  // Calculate Weighted Health Score (0 - 100%)
  const penaltyPoints =
    criticalCount * COMPLIANCE_PENALTY_WEIGHTS.CRITICAL +
    urgentCount * COMPLIANCE_PENALTY_WEIGHTS.URGENT +
    upcomingCount * COMPLIANCE_PENALTY_WEIGHTS.UPCOMING;

  const baseScore = Math.max(0, 100 - (penaltyPoints / totalDocuments) * 10);
  const fleetComplianceScore = parseFloat(baseScore.toFixed(1));

  let overallStatus: FleetComplianceRiskView['overallStatus'] = 'COMPLIANT';
  if (criticalCount > 0) {
    overallStatus = criticalCount > 5 ? 'NON_COMPLIANT' : 'CRITICAL_RISK';
  } else if (urgentCount > 0 || upcomingCount > 5) {
    overallStatus = 'HEALTHY_WITH_WARNINGS';
  }

  // Prescriptive Next Actions
  const recommendedActions = generateRecommendedActions(criticalItems, urgentItems);

  return {
    fleetComplianceScore,
    overallStatus,
    totalAssetsMonitored: uniqueEntities.size || documents.length,
    totalDocumentsTracked: documents.length,
    criticalCount,
    urgentCount,
    upcomingCount,
    fullyCompliantCount,
    criticalItems,
    urgentItems,
    dueIn30DaysCount,
    recommendedActions,
    calculatedAt: referenceDate.toISOString(),
  };
}

function getEstimatedFine(docType: string): number {
  return ESTIMATED_FINES_AED[docType as keyof typeof ESTIMATED_FINES_AED] ?? ESTIMATED_FINES_AED.DEFAULT;
}

function formatDocumentName(docType: string): string {
  return docType
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function generateRecommendedActions(
  critical: ComplianceCriticalItem[],
  urgent: ComplianceCriticalItem[],
): ComplianceRecommendedAction[] {
  const actions: ComplianceRecommendedAction[] = [];

  // P1: Ground Expired Critical Assets
  const expiredVehicles = critical.filter((c) => c.entityType === 'VEHICLE');
  if (expiredVehicles.length > 0) {
    const codes = expiredVehicles.map((v) => v.code).join(', ');
    const fineSum = expiredVehicles.reduce((s, v) => s + v.potentialFineAed, 0);
    actions.push({
      id: 'act-ground-expired',
      priority: 'P1',
      actionType: 'GROUND_VEHICLE',
      title: `Ground ${expiredVehicles.length} vehicle(s) with expired registrations/permits`,
      description: `Immediately place ${codes} on COMPLIANCE_HOLD to prevent impoundment and fines.`,
      targetEntityId: expiredVehicles[0].entityId,
      targetEntityCode: codes,
      estimatedFineSavedAed: fineSum,
    });
  }

  // P1: Suspend Unlicensed or Expired Drivers
  const expiredDrivers = critical.filter((c) => c.entityType === 'DRIVER');
  if (expiredDrivers.length > 0) {
    const driverCodes = expiredDrivers.map((d) => d.code).join(', ');
    const fineSum = expiredDrivers.reduce((s, d) => s + d.potentialFineAed, 0);
    actions.push({
      id: 'act-suspend-drivers',
      priority: 'P1',
      actionType: 'SUSPEND_DRIVER',
      title: `Block dispatch for ${expiredDrivers.length} driver(s) with expired credentials`,
      description: `Disallow job assignment for ${driverCodes} until license/permit renewal is verified.`,
      targetEntityId: expiredDrivers[0].entityId,
      targetEntityCode: driverCodes,
      estimatedFineSavedAed: fineSum,
    });
  }

  // P2: Schedule Upcoming Technical Inspections (Fahas)
  const urgentFahas = urgent.filter((u) => u.item.toLowerCase().includes('inspection') || u.item.toLowerCase().includes('fahas'));
  if (urgentFahas.length > 0) {
    const codes = urgentFahas.map((u) => u.code).join(', ');
    actions.push({
      id: 'act-book-fahas',
      priority: 'P2',
      actionType: 'BOOK_INSPECTION',
      title: `Book technical inspection slots for ${urgentFahas.length} vehicle(s)`,
      description: `Schedule Tasjeel / Shamil inspection appointments for ${codes} expiring within 7 days.`,
      targetEntityId: urgentFahas[0].entityId,
      targetEntityCode: codes,
      estimatedFineSavedAed: urgentFahas.length * 500,
    });
  }

  // P2: Batch Insurance Renewals
  const urgentInsurance = urgent.filter((u) => u.item.toLowerCase().includes('insurance'));
  if (urgentInsurance.length > 0) {
    const codes = urgentInsurance.map((u) => u.code).join(', ');
    actions.push({
      id: 'act-renew-insurance',
      priority: 'P2',
      actionType: 'RENEW_INSURANCE',
      title: `Initiate batch motor insurance renewal for ${urgentInsurance.length} vehicle(s)`,
      description: `Submit renewal endorsement files for ${codes} to prevent coverage lapse.`,
      targetEntityId: urgentInsurance[0].entityId,
      targetEntityCode: codes,
      estimatedFineSavedAed: urgentInsurance.length * 1500,
    });
  }

  return actions;
}
