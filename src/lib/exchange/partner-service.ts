/**
 * src/lib/exchange/partner-service.ts
 *
 * Core Domain Service for Fleet360 Exchange Transport Partners.
 * Handles Partner Onboarding, Fleet, Drivers, Compliance Documents, and Tenant Relationships.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import {
  PartnerOnboardingStatus,
  PartnerOperationalStatus,
  PartnerServiceDomain,
} from '@prisma/client';

export interface CreatePartnerInput {
  legalName: string;
  tradeName?: string;
  partnerCode: string;
  country?: string;
  city?: string;
  address?: string;
  tradeLicenseNumber?: string;
  taxRegistrationNumber?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  capabilities?: Array<{ domain: PartnerServiceDomain; serviceType: string }>;
  serviceAreas?: Array<{ emirate: string; zones?: string[] }>;
}

export interface RegisterVehicleInput {
  partnerId: string;
  licensePlate: string;
  plateEmirate?: string;
  vehicleType: string;
  seatingCapacity: number;
  make?: string;
  model?: string;
  year?: number;
  mulkiyaExpiry?: Date | string;
}

export interface RegisterDriverInput {
  partnerId: string;
  fullName: string;
  mobileNumber: string;
  licenseNumber?: string;
  licenseExpiry?: Date | string;
  permitType?: string;
  permitExpiry?: Date | string;
}

export interface UploadComplianceDocInput {
  partnerId: string;
  docType: string;
  docNumber?: string;
  fileUrl: string;
  expiryDate?: Date | string;
}

export class PartnerService {
  /**
   * Register a new TransportPartner in DRAFT status
   */
  static async createPartner(input: CreatePartnerInput, actorUserId?: string) {
    const partner = await prisma.transportPartner.create({
      data: {
        legalName: input.legalName,
        tradeName: input.tradeName,
        partnerCode: input.partnerCode.toUpperCase().trim(),
        country: input.country || 'AE',
        city: input.city,
        address: input.address,
        tradeLicenseNumber: input.tradeLicenseNumber,
        taxRegistrationNumber: input.taxRegistrationNumber,
        primaryContactName: input.primaryContactName,
        primaryContactEmail: input.primaryContactEmail,
        primaryContactPhone: input.primaryContactPhone,
        onboardingStatus: PartnerOnboardingStatus.DRAFT,
        operationalStatus: PartnerOperationalStatus.ACTIVE,
        capabilities: input.capabilities
          ? {
              create: input.capabilities.map((c) => ({
                domain: c.domain,
                serviceType: c.serviceType,
                isApproved: true,
              })),
            }
          : undefined,
        serviceAreas: input.serviceAreas
          ? {
              create: input.serviceAreas.map((sa) => ({
                emirate: sa.emirate,
                zones: sa.zones || [],
              })),
            }
          : undefined,
      },
      include: {
        capabilities: true,
        serviceAreas: true,
      },
    });

    if (actorUserId) {
      await logAudit(
        prisma,
        'PLATFORM',
        'TransportPartner',
        partner.id,
        'CREATE',
        { legalName: partner.legalName, partnerCode: partner.partnerCode },
        actorUserId
      );
    }

    return partner;
  }

  /**
   * Fetch a partner profile with capabilities, fleet, drivers, and compliance
   */
  static async getPartnerProfile(partnerId: string) {
    return prisma.transportPartner.findUnique({
      where: { id: partnerId, deletedAt: null },
      include: {
        capabilities: true,
        serviceAreas: true,
        vehicles: { where: { isActive: true } },
        drivers: { where: { isActive: true } },
        complianceDocuments: true,
        platformLink: true,
      },
    });
  }

  /**
   * Submit partner onboarding application for review
   */
  static async submitApplication(partnerId: string, actorUserId?: string) {
    const partner = await prisma.transportPartner.update({
      where: { id: partnerId },
      data: {
        onboardingStatus: PartnerOnboardingStatus.APPLICATION_SUBMITTED,
        updatedAt: new Date(),
      },
    });

    await raiseAlert({
      tenantId: 'PLATFORM',
      code: 'PARTNER_APPLICATION_SUBMITTED',
      sourceModule: 'exchange',
      subjectType: 'TransportPartner' as any,
      subjectId: partnerId,
      title: `📋 New Transport Partner Application: ${partner.legalName}`,
      description: `Partner ${partner.legalName} (${partner.partnerCode}) submitted onboarding application for review.`,
      severity: 'LOW',
      actor: actorUserId || 'SYSTEM',
    });

    return partner;
  }

  /**
   * Approve a transport partner
   */
  static async approvePartner(partnerId: string, approvedByUserId: string) {
    const partner = await prisma.transportPartner.update({
      where: { id: partnerId },
      data: {
        onboardingStatus: PartnerOnboardingStatus.APPROVED,
        operationalStatus: PartnerOperationalStatus.ACTIVE,
        approvedAt: new Date(),
        approvedBy: approvedByUserId,
      },
    });

    await raiseAlert({
      tenantId: 'PLATFORM',
      code: 'PARTNER_APPROVED',
      sourceModule: 'exchange',
      subjectType: 'TransportPartner' as any,
      subjectId: partnerId,
      title: `✅ Transport Partner Approved: ${partner.legalName}`,
      description: `Partner ${partner.legalName} was approved for operational outsourcing.`,
      severity: 'LOW',
      actor: approvedByUserId,
    });

    return partner;
  }

  /**
   * Register a partner vehicle
   */
  static async registerVehicle(input: RegisterVehicleInput) {
    return prisma.partnerVehicle.upsert({
      where: {
        partnerId_licensePlate: {
          partnerId: input.partnerId,
          licensePlate: input.licensePlate.trim().toUpperCase(),
        },
      },
      update: {
        plateEmirate: input.plateEmirate || 'Dubai',
        vehicleType: input.vehicleType,
        seatingCapacity: input.seatingCapacity,
        make: input.make,
        model: input.model,
        year: input.year,
        mulkiyaExpiry: input.mulkiyaExpiry ? new Date(input.mulkiyaExpiry) : null,
        isActive: true,
      },
      create: {
        partnerId: input.partnerId,
        licensePlate: input.licensePlate.trim().toUpperCase(),
        plateEmirate: input.plateEmirate || 'Dubai',
        vehicleType: input.vehicleType,
        seatingCapacity: input.seatingCapacity,
        make: input.make,
        model: input.model,
        year: input.year,
        mulkiyaExpiry: input.mulkiyaExpiry ? new Date(input.mulkiyaExpiry) : null,
        isActive: true,
      },
    });
  }

  /**
   * Register a partner driver
   */
  static async registerDriver(input: RegisterDriverInput) {
    return prisma.partnerDriver.create({
      data: {
        partnerId: input.partnerId,
        fullName: input.fullName.trim(),
        mobileNumber: input.mobileNumber.trim(),
        licenseNumber: input.licenseNumber,
        licenseExpiry: input.licenseExpiry ? new Date(input.licenseExpiry) : null,
        permitType: input.permitType || 'RTA Bus Driver Permit',
        permitExpiry: input.permitExpiry ? new Date(input.permitExpiry) : null,
        isActive: true,
      },
    });
  }

  /**
   * Upload or update a compliance document
   */
  static async uploadComplianceDoc(input: UploadComplianceDocInput) {
    return prisma.partnerComplianceDoc.create({
      data: {
        partnerId: input.partnerId,
        docType: input.docType,
        docNumber: input.docNumber,
        fileUrl: input.fileUrl,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
        status: 'VALID',
      },
    });
  }

  /**
   * Check if a partner is approved and contracted by a specific tenant
   */
  static async checkTenantPartnerStatus(tenantId: string, partnerId: string) {
    const relationship = await prisma.tenantPartnerRelationship.findUnique({
      where: {
        tenantId_partnerId: { tenantId, partnerId },
      },
    });

    const partner = await prisma.transportPartner.findUnique({
      where: { id: partnerId, deletedAt: null },
      select: { onboardingStatus: true, operationalStatus: true },
    });

    if (!partner || partner.operationalStatus !== PartnerOperationalStatus.ACTIVE) {
      return { allowed: false, reason: 'Partner is not active' };
    }

    if (relationship && relationship.status === 'BLOCKED') {
      return { allowed: false, reason: 'Partner is blocked by tenant' };
    }

    return {
      allowed: true,
      relationshipStatus: relationship?.status || 'APPROVED',
      paymentTerms: relationship?.paymentTerms || 'Net 30',
    };
  }
}
