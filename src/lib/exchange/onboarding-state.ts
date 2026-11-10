/**
 * A transport partner's onboarding state: its stage, its service areas and
 * emirate, its compliance documents and the checklist of mandatory ones
 * (src/lib/exchange/partner-activation.ts), plus Phase 11 6-Category Vertical
 * Qualification Matrix and Pre-Dispatch Fleet/Driver Readiness summary.
 * Shared by the partner portal (/api/exchange/partner/onboarding) and the
 * onboarding tenant's review (/api/admin/exchange/onboarding).
 * Run inside withPlatformAdmin: partners are platform records.
 */
import type { Prisma } from '@prisma/client';
import { emirateOf, onboardingChecklist, onboardingStatusLabel } from '@/lib/exchange/partner-activation';

type Tx = Prisma.TransactionClient;

export async function loadOnboardingState(tx: Tx, partnerId: string) {
  const partner = await tx.transportPartner.findFirst({
    where: { id: partnerId, deletedAt: null },
    select: {
      id: true, legalName: true, tradeName: true, partnerCode: true, city: true, emirate: true,
      tradeLicenseNumber: true, taxRegistrationNumber: true,
      primaryContactName: true, primaryContactEmail: true, primaryContactPhone: true,
      onboardingStatus: true, marketplaceStatus: true, operationalStatus: true,
      approvedAt: true, rejectionReason: true, onboardedByTenantId: true, createdAt: true,
      capabilities: { select: { domain: true, serviceType: true, isApproved: true } },
      serviceAreas: { select: { emirate: true, zones: true } },
      vehicles: {
        where: { isActive: true },
        select: {
          id: true,
          licensePlate: true,
          plateEmirate: true,
          vehicleType: true,
          seatingCapacity: true,
          mulkiyaExpiry: true,
        },
      },
      drivers: {
        where: { isActive: true },
        select: {
          id: true,
          fullName: true,
          mobileNumber: true,
          licenseNumber: true,
          licenseExpiry: true,
          permitType: true,
          permitExpiry: true,
        },
      },
      scorecard: {
        select: {
          tier: true,
          compositeScore: true,
          onTimePerformance: true,
          quoteResponseRate: true,
          exceptionRate: true,
          totalAwardedTrips: true,
          completedTrips: true,
        },
      },
      complianceDocuments: {
        // Not reviewed_by: the reviewing administrator's user id stays internal.
        select: {
          id: true, docType: true, docNumber: true, fileUrl: true, expiryDate: true,
          status: true, reviewNote: true, reviewedAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!partner) return null;

  const {
    capabilities = [],
    complianceDocuments = [],
    serviceAreas = [],
    vehicles = [],
    drivers = [],
    scorecard = null,
    ...rest
  } = partner;
  const domains = [...new Set(capabilities.map((c) => c.domain as string))];
  const emirate = emirateOf(partner);
  const documents = complianceDocuments.map(({ fileUrl, ...d }) => ({
    ...d,
    expiryDate: d.expiryDate ? d.expiryDate.toISOString().slice(0, 10) : null,
    // Only files stored by the upload route can be opened; older documents
    // recorded a placeholder URL.
    hasFile: fileUrl.startsWith('/uploads/exchange/partner-compliance/'),
  }));
  const checklist = onboardingChecklist({ domains, emirate }, documents);

  // Phase 11: Compute 6-Category Vertical Qualification Matrix & Pre-Dispatch Fleet/Driver Readiness
  const now = new Date();
  const hasApprovedDoc = (docTypes: string[]) =>
    documents.some(
      (d) =>
        docTypes.includes(d.docType) &&
        (d.status === 'VALID' || d.status === 'EXPIRING') &&
        (!d.expiryDate || new Date(d.expiryDate) > now),
    );
  const hasPendingDoc = (docTypes: string[]) =>
    documents.some((d) => docTypes.includes(d.docType) && d.status === 'PENDING');

  const dispatchReadyVehicles = vehicles.filter(
    (v) => !v.mulkiyaExpiry || new Date(v.mulkiyaExpiry) > now,
  ).length;
  const expiredVehicles = vehicles.length - dispatchReadyVehicles;

  const dispatchReadyDrivers = drivers.filter(
    (d) =>
      (!d.licenseExpiry || new Date(d.licenseExpiry) > now) &&
      (!d.permitExpiry || new Date(d.permitExpiry) > now),
  ).length;
  const expiredDrivers = drivers.length - dispatchReadyDrivers;

  const docCatStatus = (types: string[]) =>
    hasApprovedDoc(types) ? 'VERIFIED' : hasPendingDoc(types) ? 'PENDING_REVIEW' : 'MISSING';

  const qualificationCategories = [
    {
      category: 'LEGAL_IDENTITY',
      label: '1. Corporate & Trade License',
      status: docCatStatus(['TRADE_LICENSE', 'PARTNER_AGREEMENT']),
      detail: partner.tradeLicenseNumber ? `Trade Lic: ${partner.tradeLicenseNumber}` : 'Trade License & Partner Agreement',
    },
    {
      category: 'TAX_COMPLIANCE',
      label: '2. UAE FTA Tax & IBAN Verification',
      status: docCatStatus(['TAX_CERTIFICATE', 'BANK_LETTER']),
      detail: partner.taxRegistrationNumber ? `TRN: ${partner.taxRegistrationNumber}` : 'FTA TRN Certificate & Bank Letter',
    },
    {
      category: 'INSURANCE_LIABILITY',
      label: '3. Commercial Fleet & Liability Insurance',
      status: docCatStatus(['COMMERCIAL_INSURANCE', 'LIABILITY_INSURANCE']),
      detail: 'Commercial Motor & Third-Party Liability Policy',
    },
    {
      category: 'REGULATORY_PERMIT',
      label: '4. Sector & Emirate Operating Permits',
      status: docCatStatus([
        'RTA_PERMIT',
        'ITC_PERMIT',
        'TRANSPORT_AUTHORITY_PERMIT',
        'GOODS_TRANSPORT_PERMIT',
        'RECOVERY_PERMIT',
        'SCHOOL_TRANSPORT_PERMIT',
      ]),
      detail: domains.length > 0 ? `Domains: ${domains.join(', ')}` : 'RTA / ITC / Authority Permits',
    },
    {
      category: 'FLEET_SAFETY',
      label: '5. Fleet Mulkiya & Pre-Dispatch Gate',
      status:
        vehicles.length === 0
          ? 'MISSING'
          : expiredVehicles === 0
            ? 'VERIFIED'
            : dispatchReadyVehicles > 0
              ? 'PARTIAL'
              : 'EXPIRED',
      detail: `${dispatchReadyVehicles}/${vehicles.length} vehicles dispatch-ready (${expiredVehicles} expired Mulkiya)`,
    },
    {
      category: 'DRIVER_QUALIFICATION',
      label: '6. Driver License & RTA Permit Gate',
      status:
        drivers.length === 0
          ? 'MISSING'
          : expiredDrivers === 0
            ? 'VERIFIED'
            : dispatchReadyDrivers > 0
              ? 'PARTIAL'
              : 'EXPIRED',
      detail: `${dispatchReadyDrivers}/${drivers.length} drivers dispatch-ready (${expiredDrivers} expired permit/license)`,
    },
  ];

  const fleetReadiness = {
    totalVehicles: vehicles.length,
    dispatchReadyVehicles,
    expiredVehicles,
    totalDrivers: drivers.length,
    dispatchReadyDrivers,
    expiredDrivers,
    vehicles: vehicles.map((v) => ({
      ...v,
      mulkiyaExpiry: v.mulkiyaExpiry ? v.mulkiyaExpiry.toISOString().slice(0, 10) : null,
      dispatchReady: !v.mulkiyaExpiry || new Date(v.mulkiyaExpiry) > now,
    })),
    drivers: drivers.map((d) => ({
      ...d,
      licenseExpiry: d.licenseExpiry ? d.licenseExpiry.toISOString().slice(0, 10) : null,
      permitExpiry: d.permitExpiry ? d.permitExpiry.toISOString().slice(0, 10) : null,
      dispatchReady:
        (!d.licenseExpiry || new Date(d.licenseExpiry) > now) &&
        (!d.permitExpiry || new Date(d.permitExpiry) > now),
    })),
  };

  return {
    partner: {
      ...rest,
      emirate,
      domains,
      serviceAreas,
      scorecard,
      onboardingLabel: onboardingStatusLabel(partner.onboardingStatus),
    },
    documents,
    checklist,
    qualificationCategories,
    fleetReadiness,
  };
}

export type OnboardingState = NonNullable<Awaited<ReturnType<typeof loadOnboardingState>>>;
