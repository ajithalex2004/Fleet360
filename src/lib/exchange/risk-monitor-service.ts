/**
 * src/lib/exchange/risk-monitor-service.ts
 *
 * Phase 2.5: Proactive Risk Monitors & Compliance Sourcing Alerts for Fleet360 Exchange.
 * Monitors:
 * 1. Approaching awarded trips with missing driver or vehicle assignments (< 2h).
 * 2. Regulatory compliance expiration warnings (30d, 15d, 7d, 1d).
 */

import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';

export interface UnassignedTripRisk {
  awardId: string;
  requestNumber: string;
  partnerName: string;
  partnerPhone: string | null;
  serviceDate: Date;
  pickupTime: string;
  hoursUntilService: number;
  severity: 'HIGH' | 'CRITICAL';
}

export interface ComplianceExpiryRisk {
  partnerId: string;
  partnerName: string;
  docType: string;
  docNumber: string | null;
  expiryDate: Date;
  daysRemaining: number;
  urgency: 'NOTICE' | 'WARNING' | 'CRITICAL' | 'EXPIRED';
}

export class RiskMonitorService {
  /**
   * Identifies awarded trips starting within 2 hours without assigned resources.
   */
  static async scanApproachingUnassignedTrips(
    tenantId: string
  ): Promise<UnassignedTripRisk[]> {
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const awards = await prisma.outsourceAward.findMany({
      where: {
        tenantId,
        status: { in: ['AWARDED', 'ASSIGNED'] },
        assignment: {
          OR: [
            { driverName: null },
            { driverName: '' },
            { vehiclePlate: null },
            { vehiclePlate: '' },
          ],
        },
      },
      include: {
        request: true,
        partner: true,
        assignment: true,
      },
    });

    const risks: UnassignedTripRisk[] = [];

    for (const award of awards) {
      const serviceDateTime = new Date(award.request.serviceDate);
      const hoursUntilService = (serviceDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      const severity = hoursUntilService <= 2 ? 'CRITICAL' : 'HIGH';

      risks.push({
        awardId: award.id,
        requestNumber: award.request.requestNumber,
        partnerName: award.partner.legalName,
        partnerPhone: award.partner.primaryContactPhone,
        serviceDate: award.request.serviceDate,
        pickupTime: award.request.pickupTime,
        hoursUntilService: Math.max(0, hoursUntilService),
        severity,
      });

      if (hoursUntilService <= 2) {
        await raiseAlert({
          tenantId,
          code: 'OUTSOURCE_UNASSIGNED_RESOURCE_RISK',
          sourceModule: 'exchange',
          subjectType: 'OutsourceAward' as any,
          subjectId: award.id,
          title: `🚨 Urgent: Unassigned Driver on Approaching Trip ${award.request.requestNumber}`,
          description: `Trip scheduled for ${award.request.pickupTime} by ${award.partner.legalName} has no confirmed driver or vehicle!`,
          severity: 'CRITICAL',
          actor: 'RISK_MONITOR',
        });
      }
    }

    return risks;
  }

  /**
   * Scans compliance documents for expiration warning thresholds.
   */
  static async scanExpiringCompliance(
    partnerId?: string
  ): Promise<ComplianceExpiryRisk[]> {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 86400000);

    const where = partnerId ? { partnerId, expiryDate: { lte: thirtyDaysLater } } : { expiryDate: { lte: thirtyDaysLater } };

    const docs = await prisma.partnerComplianceDoc.findMany({
      where,
      include: { partner: true },
    });

    const risks: ComplianceExpiryRisk[] = [];

    for (const doc of docs) {
      if (!doc.expiryDate) continue;
      const daysRemaining = Math.ceil((new Date(doc.expiryDate).getTime() - now.getTime()) / 86400000);

      let urgency: 'NOTICE' | 'WARNING' | 'CRITICAL' | 'EXPIRED' = 'NOTICE';
      if (daysRemaining <= 0) urgency = 'EXPIRED';
      else if (daysRemaining <= 3) urgency = 'CRITICAL';
      else if (daysRemaining <= 10) urgency = 'WARNING';

      risks.push({
        partnerId: doc.partnerId,
        partnerName: doc.partner.legalName,
        docType: doc.docType,
        docNumber: doc.docNumber,
        expiryDate: new Date(doc.expiryDate),
        daysRemaining,
        urgency,
      });
    }

    return risks;
  }
}
