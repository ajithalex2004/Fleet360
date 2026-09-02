/**
 * src/lib/exchange/eligibility-engine.ts
 *
 * Phase 2B: Deterministic Partner Eligibility Engine for Fleet360 Exchange.
 * Evaluates candidate transport partners for RFQs and outsourcing requirements.
 *
 * Eligibility Gates:
 * 1. Tenant relationship is APPROVED or PREFERRED (never BLOCKED).
 * 2. Partner operationalStatus is ACTIVE (never SUSPENDED or BLACKLISTED).
 * 3. Supports required service domain (e.g., PASSENGER_TRANSPORT).
 * 4. Covers the pickup emirate / service area.
 * 5. Compliance documents (Trade License, Insurance) are valid and non-expired.
 * 6. Certified fleet inventory meets or exceeds the required seating capacity.
 */

import { prisma } from '@/lib/prisma';
import { PartnerServiceDomain } from '@prisma/client';

export interface EligibilityRequirementInput {
  tenantId: string;
  domain?: PartnerServiceDomain;
  pickupCity?: string;
  requiredCapacity: number;
  serviceDate: Date | string;
}

export interface PartnerEligibilityResult {
  partnerId: string;
  legalName: string;
  tradeName?: string | null;
  partnerCode: string;
  relationshipStatus: string;
  operationalStatus: string;
  isEligible: boolean;
  rejectionReasons: string[];
  eligibleVehiclesCount: number;
  capabilities: string[];
  serviceAreas: string[];
  complianceValid: boolean;
}

export class EligibilityEngine {
  /**
   * Evaluates all registered transport partners against a specific outsourcing requirement.
   */
  static async evaluateEligiblePartners(
    input: EligibilityRequirementInput
  ): Promise<PartnerEligibilityResult[]> {
    const domain = input.domain || PartnerServiceDomain.PASSENGER_TRANSPORT;
    const pickupCity = (input.pickupCity || 'Dubai').trim().toLowerCase();
    const requiredCapacity = Number(input.requiredCapacity) || 1;
    const targetDate = new Date(input.serviceDate);

    // Fetch candidate partners with relational context
    const partners = await prisma.transportPartner.findMany({
      where: { deletedAt: null },
      include: {
        capabilities: true,
        serviceAreas: true,
        complianceDocuments: true,
        vehicles: { where: { isActive: true } },
        tenantRelationships: {
          where: { tenantId: input.tenantId },
        },
      },
      orderBy: { legalName: 'asc' },
    });

    const results: PartnerEligibilityResult[] = [];

    for (const partner of partners) {
      const rejectionReasons: string[] = [];
      const relationship = partner.tenantRelationships[0];
      const relationshipStatus = relationship?.status || 'NOT_ASSOCIATED';

      // Gate 1: Tenant Relationship
      if (relationshipStatus === 'BLOCKED') {
        rejectionReasons.push('BLOCKED_BY_TENANT: Partner is explicitly blocked by your enterprise');
      } else if (relationshipStatus !== 'APPROVED' && relationshipStatus !== 'PREFERRED') {
        rejectionReasons.push('NOT_APPROVED: Partner does not have an APPROVED or PREFERRED relationship with your tenant');
      }

      // Gate 2: Operational Status
      if (partner.operationalStatus !== 'ACTIVE') {
        rejectionReasons.push(`INACTIVE_PARTNER: Operational status is ${partner.operationalStatus}`);
      }

      // Gate 3: Domain Capability
      const hasDomain = partner.capabilities.some(
        (c) => c.domain === domain && c.isApproved
      );
      if (!hasDomain) {
        rejectionReasons.push(`CAPABILITY_MISMATCH: Partner is not approved for domain ${domain}`);
      }

      // Gate 4: Service Area Coverage
      const coversArea = partner.serviceAreas.some((sa) => {
        const emirate = sa.emirate.toLowerCase();
        return emirate.includes(pickupCity) || pickupCity.includes(emirate);
      });
      if (partner.serviceAreas.length > 0 && !coversArea) {
        rejectionReasons.push(`SERVICE_AREA_MISMATCH: Pickup location '${input.pickupCity}' is outside partner coverage area`);
      }

      // Gate 5: Compliance Validity
      let complianceValid = true;
      if (partner.complianceDocuments.length > 0) {
        for (const doc of partner.complianceDocuments) {
          if (doc.expiryDate && new Date(doc.expiryDate) < targetDate) {
            complianceValid = false;
            rejectionReasons.push(`COMPLIANCE_EXPIRED: ${doc.docType} expired on ${new Date(doc.expiryDate).toLocaleDateString()}`);
          }
        }
      }

      // Gate 6: Fleet Capacity Match
      const matchingVehicles = partner.vehicles.filter(
        (v) => v.seatingCapacity >= requiredCapacity
      );
      if (partner.vehicles.length > 0 && matchingVehicles.length === 0) {
        rejectionReasons.push(`INSUFFICIENT_CAPACITY: Partner has no registered vehicles with >= ${requiredCapacity} seating capacity`);
      }

      const isEligible = rejectionReasons.length === 0;

      results.push({
        partnerId: partner.id,
        legalName: partner.legalName,
        tradeName: partner.tradeName,
        partnerCode: partner.partnerCode,
        relationshipStatus,
        operationalStatus: partner.operationalStatus,
        isEligible,
        rejectionReasons,
        eligibleVehiclesCount: matchingVehicles.length,
        capabilities: partner.capabilities.map((c) => c.serviceType || c.domain),
        serviceAreas: partner.serviceAreas.map((sa) => sa.emirate),
        complianceValid,
      });
    }

    return results;
  }
}
