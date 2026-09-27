/**
 * Partner activation: a transport partner onboarded by a tenant starts
 * Pending Activation and cannot use the marketplace until that tenant's
 * administrators have reviewed its compliance documents and activated it.
 *
 *   created ──► DRAFT (Pending Activation) ── partner uploads the documents
 *           ──► UNDER_REVIEW (partner admin submits) ── tenant admins review
 *           ──► APPROVED (activated)  |  MORE_INFO_REQUIRED  |  REJECTED
 *
 * transport_partners.onboarding_status carries the stage. Until it is
 * APPROVED the partner portal is limited to onboarding (company profile,
 * compliance documents, fleet and drivers): requirePartnerContext refuses
 * everything else unless a route opts in with `allowPending`.
 *
 * Which documents are mandatory depends on the partner's service areas
 * (partner_capabilities.domain) and the emirate it operates from
 * (COMPLIANCE_CATALOG, requiredDocuments).
 */
import { effectiveStatus, latestDoc, type ComplianceDoc } from '@/lib/exchange/compliance-requirement';

/**
 * Whether activated partners see opportunities that buyers publish to the
 * whole exchange (EXCHANGE_NETWORK). For now a partner reaches only the
 * network of tenants it has a relationship with, starting with the tenant
 * that onboarded it; invitations still reach it as before.
 */
export const EXCHANGE_OPEN_MARKET = false;

export const EMIRATES = ['DUBAI', 'ABU_DHABI', 'SHARJAH', 'AJMAN', 'RAS_AL_KHAIMAH', 'FUJAIRAH', 'UMM_AL_QUWAIN'] as const;
export type Emirate = (typeof EMIRATES)[number];

export const EMIRATE_LABELS: Record<Emirate, string> = {
  DUBAI: 'Dubai',
  ABU_DHABI: 'Abu Dhabi',
  SHARJAH: 'Sharjah',
  AJMAN: 'Ajman',
  RAS_AL_KHAIMAH: 'Ras Al Khaimah',
  FUJAIRAH: 'Fujairah',
  UMM_AL_QUWAIN: 'Umm Al Quwain',
};

export function isEmirate(v: unknown): v is Emirate {
  return typeof v === 'string' && (EMIRATES as readonly string[]).includes(v);
}

const CITY_EMIRATE: Array<[RegExp, Emirate]> = [
  [/dubai|jebel ali|dxb/i, 'DUBAI'],
  [/abu ?dhabi|al ain|mussafah|ruwais|auh/i, 'ABU_DHABI'],
  [/sharjah|khor ?fakkan|kalba/i, 'SHARJAH'],
  [/ajman/i, 'AJMAN'],
  [/ras ?al ?khaimah|\brak\b/i, 'RAS_AL_KHAIMAH'],
  [/fujairah/i, 'FUJAIRAH'],
  [/umm ?al ?quwain|\buaq\b/i, 'UMM_AL_QUWAIN'],
];

/** The partner's emirate: the recorded one, else guessed from its city. */
export function emirateOf(partner: { emirate?: string | null; city?: string | null }): Emirate | null {
  if (isEmirate(partner.emirate)) return partner.emirate;
  const city = partner.city?.trim();
  if (!city) return null;
  return CITY_EMIRATE.find(([re]) => re.test(city))?.[1] ?? null;
}

export const SERVICE_DOMAINS = ['PASSENGER_TRANSPORT', 'LIMOUSINE', 'SCHOOL_TRANSPORT', 'FREIGHT', 'RECOVERY'] as const;
export type ServiceDomain = (typeof SERVICE_DOMAINS)[number];

export interface ComplianceDocType {
  docType: string;
  label: string;
  hint: string;
  /** The document has an expiry date the partner must enter. */
  expires: boolean;
  /** The document has a number the partner must enter. */
  numbered: boolean;
}

export const COMPLIANCE_CATALOG: Record<string, ComplianceDocType> = {
  TRADE_LICENSE: {
    docType: 'TRADE_LICENSE', label: 'Trade licence', expires: true, numbered: true,
    hint: 'Commercial trade licence from the Department of Economy / free-zone authority, listing transport activities.',
  },
  TAX_CERTIFICATE: {
    docType: 'TAX_CERTIFICATE', label: 'VAT registration certificate', expires: false, numbered: true,
    hint: 'FTA VAT registration certificate showing the TRN.',
  },
  COMMERCIAL_INSURANCE: {
    docType: 'COMMERCIAL_INSURANCE', label: 'Commercial fleet insurance', expires: true, numbered: true,
    hint: 'Fleet motor insurance covering commercial use of the vehicles offered.',
  },
  LIABILITY_INSURANCE: {
    docType: 'LIABILITY_INSURANCE', label: 'Third-party liability insurance', expires: true, numbered: true,
    hint: 'Public / third-party liability policy for the company.',
  },
  BANK_LETTER: {
    docType: 'BANK_LETTER', label: 'Bank account letter (IBAN)', expires: false, numbered: false,
    hint: 'Bank letter on letterhead confirming the account name and IBAN used for payouts.',
  },
  PARTNER_AGREEMENT: {
    docType: 'PARTNER_AGREEMENT', label: 'Signed partner agreement', expires: false, numbered: false,
    hint: 'The partner agreement with the onboarding company, signed and stamped.',
  },
  RTA_PERMIT: {
    docType: 'RTA_PERMIT', label: 'RTA passenger transport permit', expires: true, numbered: true,
    hint: 'Dubai Roads and Transport Authority permit for passenger transport / limousine activity.',
  },
  ITC_PERMIT: {
    docType: 'ITC_PERMIT', label: 'ITC passenger transport permit', expires: true, numbered: true,
    hint: 'Abu Dhabi Integrated Transport Centre permit for passenger transport activity.',
  },
  TRANSPORT_AUTHORITY_PERMIT: {
    docType: 'TRANSPORT_AUTHORITY_PERMIT', label: 'Transport authority permit', expires: true, numbered: true,
    hint: 'Passenger transport permit from your emirate\'s transport authority (e.g. SRTA Sharjah).',
  },
  SCHOOL_TRANSPORT_PERMIT: {
    docType: 'SCHOOL_TRANSPORT_PERMIT', label: 'School transport permit', expires: true, numbered: true,
    hint: 'Approval to operate school transport (RTA / ITC / emirate authority).',
  },
  GOODS_TRANSPORT_PERMIT: {
    docType: 'GOODS_TRANSPORT_PERMIT', label: 'Goods transport permit', expires: true, numbered: true,
    hint: 'Permit for commercial goods transport activity.',
  },
  RECOVERY_PERMIT: {
    docType: 'RECOVERY_PERMIT', label: 'Vehicle recovery permit', expires: true, numbered: true,
    hint: 'Permit for vehicle recovery and towing activity.',
  },
};

/** Every partner needs these, whatever it offers. */
const BASE_DOCUMENTS = ['TRADE_LICENSE', 'TAX_CERTIFICATE', 'COMMERCIAL_INSURANCE', 'LIABILITY_INSURANCE', 'BANK_LETTER', 'PARTNER_AGREEMENT'];

/** The passenger transport permit of the emirate the partner operates from. */
function passengerPermit(emirate: Emirate | null): string {
  if (emirate === 'DUBAI') return 'RTA_PERMIT';
  if (emirate === 'ABU_DHABI') return 'ITC_PERMIT';
  return 'TRANSPORT_AUTHORITY_PERMIT';
}

export interface RequiredDocument extends ComplianceDocType {
  /** Why it is required: 'All partners' or the service areas that need it. */
  reason: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  PASSENGER_TRANSPORT: 'Passenger transport',
  LIMOUSINE: 'Limousine',
  SCHOOL_TRANSPORT: 'School transport',
  FREIGHT: 'Freight',
  RECOVERY: 'Recovery',
};

/** The mandatory documents for a partner offering `domains` from `emirate`. */
export function requiredDocuments(input: { domains: readonly string[]; emirate: Emirate | null }): RequiredDocument[] {
  const reasons = new Map<string, string[]>();
  const add = (docType: string, reason: string) => {
    const list = reasons.get(docType) ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons.set(docType, list);
  };
  for (const d of BASE_DOCUMENTS) add(d, 'All partners');
  for (const domain of input.domains) {
    const label = DOMAIN_LABELS[domain] ?? domain;
    if (domain === 'PASSENGER_TRANSPORT' || domain === 'LIMOUSINE' || domain === 'SCHOOL_TRANSPORT') {
      add(passengerPermit(input.emirate), label);
    }
    if (domain === 'SCHOOL_TRANSPORT') add('SCHOOL_TRANSPORT_PERMIT', label);
    if (domain === 'FREIGHT') add('GOODS_TRANSPORT_PERMIT', label);
    if (domain === 'RECOVERY') add('RECOVERY_PERMIT', label);
  }
  return [...reasons].map(([docType, why]) => ({ ...COMPLIANCE_CATALOG[docType], reason: why.join(', ') }));
}

/** MISSING when nothing was uploaded, else the latest document's effective status. */
export type ChecklistStatus = 'MISSING' | 'PENDING' | 'VALID' | 'EXPIRING' | 'EXPIRED' | 'REJECTED';

export interface ChecklistItem extends RequiredDocument {
  status: ChecklistStatus;
  document: (ComplianceDoc & { id?: string }) | null;
}

export interface OnboardingChecklist {
  items: ChecklistItem[];
  /** Every required document has been uploaded (whatever its review state), none rejected or expired. */
  complete: boolean;
  /** Every required document is approved and in date: the partner can be activated. */
  allApproved: boolean;
  missing: string[];
}

export function onboardingChecklist(
  input: { domains: readonly string[]; emirate: Emirate | null },
  docs: ReadonlyArray<ComplianceDoc & { id?: string }>,
  now: number = Date.now(),
): OnboardingChecklist {
  const items = requiredDocuments(input).map((req): ChecklistItem => {
    const doc = latestDoc(docs, req.docType, now) ?? null;
    const status = (doc ? effectiveStatus(doc, now) : 'MISSING') as ChecklistStatus;
    return { ...req, status, document: doc };
  });
  const ok = (s: ChecklistStatus) => s === 'VALID' || s === 'EXPIRING';
  return {
    items,
    complete: items.every((i) => ok(i.status) || i.status === 'PENDING'),
    allApproved: items.every((i) => ok(i.status)),
    missing: items.filter((i) => !ok(i.status) && i.status !== 'PENDING').map((i) => i.label),
  };
}

/** Activated: the onboarding tenant approved the partner. */
export function isActivated(p: { onboardingStatus: string }): boolean {
  return p.onboardingStatus === 'APPROVED';
}

export const ONBOARDING_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Pending activation',
  APPLICATION_SUBMITTED: 'Submitted for review',
  UNDER_REVIEW: 'Under review',
  MORE_INFO_REQUIRED: 'More information required',
  APPROVED: 'Active',
  REJECTED: 'Rejected',
};

export function onboardingStatusLabel(status: string): string {
  return ONBOARDING_STATUS_LABELS[status] ?? status;
}

/** Stages from which the partner may submit its documents for review. */
export const SUBMITTABLE_STATUSES = ['DRAFT', 'MORE_INFO_REQUIRED'];
