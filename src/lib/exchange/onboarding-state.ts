/**
 * A transport partner's onboarding state: its stage, its service areas and
 * emirate, its compliance documents and the checklist of mandatory ones
 * (src/lib/exchange/partner-activation.ts). Shared by the partner portal
 * (/api/exchange/partner/onboarding) and the onboarding tenant's review
 * (/api/admin/exchange/onboarding). Run inside withPlatformAdmin: partners
 * are platform records.
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
      capabilities: { select: { domain: true } },
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

  const { capabilities, complianceDocuments, ...rest } = partner;
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

  return {
    partner: { ...rest, emirate, domains, onboardingLabel: onboardingStatusLabel(partner.onboardingStatus) },
    documents,
    checklist,
  };
}

export type OnboardingState = NonNullable<Awaited<ReturnType<typeof loadOnboardingState>>>;
