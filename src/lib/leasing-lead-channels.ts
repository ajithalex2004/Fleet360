/**
 * Leasing Lead Channel Manager — multi-source inbound lead capture.
 *
 * Mirrors the RAC channel manager pattern (rental-channels.ts). Each external
 * lead source posts its native payload to a per-channel webhook. We verify
 * the HMAC-SHA256 signature, normalize via the channel adapter, and create
 * a LeaseInquiry with `assignedTo` empty and a contact-channel marker in
 * notes so the sales rep knows where the lead came from.
 *
 * Pure functions — no DB calls.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export type LeadChannelKey =
  | 'WEB_FORM'
  | 'WHATSAPP_INBOUND'
  | 'AGENT_REFERRAL'
  | 'EMAIL_INQUIRY'
  | 'CARTRADE'
  | 'DUBIZZLE'
  | 'PROPERTY_FINDER'
  | 'CALL_CENTRE';

export interface LeadChannelDescriptor {
  key: LeadChannelKey;
  label: string;
  category: 'website' | 'social' | 'agent' | 'classified' | 'phone';
  supportsInboundWebhook: boolean;
  /** Env var holding HMAC shared secret. */
  secretEnvVar: string | null;
  description: string;
}

export const LEAD_CHANNELS: LeadChannelDescriptor[] = [
  { key: 'WEB_FORM',         label: 'Website Lead Form',  category: 'website',    supportsInboundWebhook: true,  secretEnvVar: 'LEAD_WEB_FORM_SECRET',         description: 'Inbound enquiry form on the brand website.' },
  { key: 'WHATSAPP_INBOUND', label: 'WhatsApp Business',  category: 'social',     supportsInboundWebhook: true,  secretEnvVar: 'LEAD_WHATSAPP_SECRET',         description: 'WhatsApp Business API inbound message webhook.' },
  { key: 'AGENT_REFERRAL',   label: 'Agent Referral',     category: 'agent',      supportsInboundWebhook: true,  secretEnvVar: 'LEAD_AGENT_SECRET',            description: 'Manual agent / broker submissions via partner portal.' },
  { key: 'EMAIL_INQUIRY',    label: 'Email Inbox',        category: 'website',    supportsInboundWebhook: true,  secretEnvVar: 'LEAD_EMAIL_SECRET',            description: 'Inbound enquiries forwarded by an email parser.' },
  { key: 'CARTRADE',         label: 'CarTrade',           category: 'classified', supportsInboundWebhook: true,  secretEnvVar: 'LEAD_CARTRADE_SECRET',         description: 'CarTrade UAE classified ad enquiries.' },
  { key: 'DUBIZZLE',         label: 'Dubizzle',           category: 'classified', supportsInboundWebhook: true,  secretEnvVar: 'LEAD_DUBIZZLE_SECRET',         description: 'Dubizzle Motors classified leads.' },
  { key: 'PROPERTY_FINDER',  label: 'Property Finder',    category: 'classified', supportsInboundWebhook: true,  secretEnvVar: 'LEAD_PROPERTY_FINDER_SECRET',  description: 'Property Finder Cars vertical leads.' },
  { key: 'CALL_CENTRE',      label: 'Call Centre',        category: 'phone',      supportsInboundWebhook: false, secretEnvVar: null,                            description: 'Manually entered by the call-centre agent (no webhook).' },
];

const BY_KEY = new Map(LEAD_CHANNELS.map(c => [c.key, c]));

export function getLeadChannel(key: string): LeadChannelDescriptor | undefined {
  return BY_KEY.get(key.toUpperCase() as LeadChannelKey);
}

/** Constant-time HMAC-SHA256 verification. Same pattern as RAC channels. */
export function verifyLeadSignature(
  secret: string,
  rawBody: string,
  signatureHex: string | null,
): boolean {
  if (!signatureHex) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (expected.length !== signatureHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/* ── Normalized lead shape we ingest into LeaseInquiry ─────────────── */

export interface NormalizedLead {
  /** External ref for dedup. */
  externalRef: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  companyName: string | null;
  vehicleType: string | null;          // SEDAN|SUV|VAN|BUS|TRUCK|LUXURY
  vehicleCount: number;
  leaseType: string | null;            // LONG_TERM|SHORT_TERM|DAILY|MONTHLY
  durationMonths: number | null;
  notes: string | null;
  /** Tags useful for tracking (channel name, ad source, agent name, etc.) */
  sourceTag: string;
}

/* ── Per-channel adapters ──────────────────────────────────────────────── */

export interface WebFormPayload {
  submissionId: string;
  fullName: string;
  email?: string;
  phone?: string;
  company?: string;
  vehicleType?: string;
  vehicleCount?: number;
  leaseTermMonths?: number;
  message?: string;
}

export function normalizeWebForm(p: WebFormPayload): NormalizedLead {
  return {
    externalRef: `WEB-${p.submissionId}`,
    customerName: p.fullName,
    customerEmail: p.email ?? null,
    customerPhone: p.phone ?? null,
    companyName: p.company ?? null,
    vehicleType: p.vehicleType ?? null,
    vehicleCount: p.vehicleCount ?? 1,
    leaseType: 'LONG_TERM',
    durationMonths: p.leaseTermMonths ?? null,
    notes: p.message ?? null,
    sourceTag: 'Website lead form',
  };
}

/** WhatsApp Business inbound message payload (Meta-style). */
export interface WhatsAppLeadPayload {
  messageId: string;
  from: string;        // phone in E.164
  profileName?: string;
  text?: string;
}

export function normalizeWhatsApp(p: WhatsAppLeadPayload): NormalizedLead {
  return {
    externalRef: `WA-${p.messageId}`,
    customerName: p.profileName ?? p.from,
    customerEmail: null,
    customerPhone: p.from,
    companyName: null,
    vehicleType: null,
    vehicleCount: 1,
    leaseType: null,
    durationMonths: null,
    notes: p.text ?? '(No message text)',
    sourceTag: 'WhatsApp inbound',
  };
}

export interface AgentReferralPayload {
  agentId: string;
  agentName: string;
  referralId: string;
  customer: { name: string; email?: string; phone?: string; company?: string };
  vehicle?: { type?: string; count?: number };
  termMonths?: number;
  notes?: string;
}

export function normalizeAgentReferral(p: AgentReferralPayload): NormalizedLead {
  return {
    externalRef: `AGT-${p.agentId}-${p.referralId}`,
    customerName: p.customer.name,
    customerEmail: p.customer.email ?? null,
    customerPhone: p.customer.phone ?? null,
    companyName: p.customer.company ?? null,
    vehicleType: p.vehicle?.type ?? null,
    vehicleCount: p.vehicle?.count ?? 1,
    leaseType: null,
    durationMonths: p.termMonths ?? null,
    notes: p.notes ?? null,
    sourceTag: `Agent referral: ${p.agentName}`,
  };
}

export interface EmailInquiryPayload {
  messageId: string;
  fromName?: string;
  fromEmail: string;
  subject?: string;
  body: string;
  parsedPhone?: string;
}

export function normalizeEmailInquiry(p: EmailInquiryPayload): NormalizedLead {
  return {
    externalRef: `EMAIL-${p.messageId}`,
    customerName: p.fromName ?? p.fromEmail.split('@')[0],
    customerEmail: p.fromEmail,
    customerPhone: p.parsedPhone ?? null,
    companyName: null,
    vehicleType: null,
    vehicleCount: 1,
    leaseType: null,
    durationMonths: null,
    notes: [p.subject, p.body].filter(Boolean).join('\n\n'),
    sourceTag: 'Email inquiry',
  };
}

/** Generic classified-portal lead (CarTrade / Dubizzle / PF). */
export interface ClassifiedPayload {
  leadId: string;
  buyer: { name: string; email?: string; phone?: string };
  listing?: { title?: string; vehicleCategory?: string };
  message?: string;
}

export function normalizeClassified(prefix: string, p: ClassifiedPayload): NormalizedLead {
  return {
    externalRef: `${prefix}-${p.leadId}`,
    customerName: p.buyer.name,
    customerEmail: p.buyer.email ?? null,
    customerPhone: p.buyer.phone ?? null,
    companyName: null,
    vehicleType: p.listing?.vehicleCategory ?? null,
    vehicleCount: 1,
    leaseType: null,
    durationMonths: null,
    notes: [p.listing?.title ? `Listing: ${p.listing.title}` : null, p.message].filter(Boolean).join('\n'),
    sourceTag: prefix === 'CTRD' ? 'CarTrade' : prefix === 'DBZL' ? 'Dubizzle' : 'Property Finder',
  };
}

export function normalizeLeadPayload(channel: LeadChannelKey, raw: unknown): NormalizedLead {
  switch (channel) {
    case 'WEB_FORM':         return normalizeWebForm(raw as WebFormPayload);
    case 'WHATSAPP_INBOUND': return normalizeWhatsApp(raw as WhatsAppLeadPayload);
    case 'AGENT_REFERRAL':   return normalizeAgentReferral(raw as AgentReferralPayload);
    case 'EMAIL_INQUIRY':    return normalizeEmailInquiry(raw as EmailInquiryPayload);
    case 'CARTRADE':         return normalizeClassified('CTRD', raw as ClassifiedPayload);
    case 'DUBIZZLE':         return normalizeClassified('DBZL', raw as ClassifiedPayload);
    case 'PROPERTY_FINDER':  return normalizeClassified('PF',   raw as ClassifiedPayload);
    default:
      throw new Error(`Channel ${channel} does not support inbound webhooks`);
  }
}
