/**
 * src/lib/exchange/network-policy-service.ts
 *
 * Phase 1 (P0): Three-Mode Private Network Governance, Exclusive Preferred
 * Quotation Window, Consortium Discovery Consent & Platform Emergency Kill Switch.
 *
 * Network Access Modes:
 *   1. CLOSED    — Only partners with an explicit APPROVED or PREFERRED relationship
 *                  with the buyer tenant (or direct invitation) may see or quote.
 *   2. PREFERRED — Tier-1 PREFERRED partners receive an exclusive quotation window
 *                  (e.g. first 30 minutes after publishedAt) before cascading to
 *                  APPROVED partners of the tenant. Buyer retains award authority
 *                  unless allowAutoAwardPreferred is explicitly enabled.
 *   3. EXTENDED  — Consortium-level partner discovery: a buyer in Consortium X can
 *                  discover and invite a partner vetted by another member of
 *                  Consortium X IF the partner granted sharing consent, WITHOUT
 *                  exposing the other member's confidential rates, customer details,
 *                  RFQ history, or invoices.
 */

import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export type NetworkAccessMode = 'CLOSED' | 'PREFERRED' | 'EXTENDED';

export interface TenantNetworkPolicy {
  tenantId: string;
  accessMode: NetworkAccessMode;
  /** Exclusive window (in minutes) during which only PREFERRED partners can quote in PREFERRED mode. */
  preferredExclusiveWindowMinutes: number;
  /** Buyer retains award authority unless explicitly set to true. */
  allowAutoAwardPreferred: boolean;
  /** Optional consortium IDs this buyer participates in for EXTENDED partner discovery. */
  consortiumIds: string[];
  updatedAt: Date;
  updatedBy?: string;
}

export interface ConsortiumMembership {
  consortiumId: string;
  consortiumName: string;
  tenantId: string;
  role: 'OWNER' | 'MEMBER';
  joinedAt: Date;
}

export interface PartnerSharingConsent {
  partnerId: string;
  consortiumId: string;
  allowQualificationDiscovery: boolean;
  /** Strictly false by default: confidential rate cards & historical invoices never shared across tenants. */
  shareCommercialRates: false;
  grantedByUserId: string;
  grantedAt: Date;
}

export interface PlatformKillSwitchState {
  active: boolean;
  reason?: string;
  activatedBy?: string;
  activatedAt?: Date;
}

// In-memory runtime stores backed by PostgreSQL IntegrationConfig write-through + 15s TTL cache (ARCH-1)
const tenantPolicies = new Map<string, TenantNetworkPolicy>();
const consortiumMemberships = new Map<string, ConsortiumMembership[]>(); // consortiumId -> memberships
const partnerSharingConsents = new Map<string, PartnerSharingConsent[]>(); // partnerId -> consents
let platformKillSwitch: PlatformKillSwitchState = { active: false };
let lastCacheHydratedAt = 0;
const CACHE_TTL_MS = 15_000;

async function persistGovernanceRecord(key: string, payload: unknown, isEnabled = true): Promise<void> {
  try {
    const ic = (prisma as unknown as { integrationConfig?: { upsert?: (args: unknown) => Promise<unknown> } })
      ?.integrationConfig;
    if (!ic?.upsert) return;
    await ic.upsert({
      where: { type: key },
      update: {
        provider: 'FLEET360_EXCHANGE_GOVERNANCE',
        fromName: JSON.stringify(payload),
        isEnabled,
        updatedAt: new Date(),
      },
      create: {
        id: key,
        type: key,
        provider: 'FLEET360_EXCHANGE_GOVERNANCE',
        fromName: JSON.stringify(payload),
        isEnabled,
        updatedAt: new Date(),
      },
    });
  } catch {
    // Non-fatal in unit tests or read-only replicas
  }
}

export class NetworkPolicyService {
  /**
   * Platform-wide emergency kill switch for security incidents or regulatory holds.
   */
  static isPlatformKillSwitchActive(): boolean {
    if (process.env.EXCHANGE_KILL_SWITCH === '1' || process.env.EXCHANGE_KILL_SWITCH === 'true') {
      return true;
    }
    return platformKillSwitch.active;
  }

  static getPlatformKillSwitchState(): PlatformKillSwitchState {
    return { ...platformKillSwitch };
  }

  static async setPlatformKillSwitch(active: boolean, reason?: string, actorUserId = 'PLATFORM_ADMIN') {
    platformKillSwitch = {
      active,
      reason: active ? reason || 'Emergency platform hold' : undefined,
      activatedBy: active ? actorUserId : undefined,
      activatedAt: active ? new Date() : undefined,
    };

    await persistGovernanceRecord(
      'EXCHANGE_PLATFORM_KILL_SWITCH',
      platformKillSwitch,
      active
    );

    await logAudit({
      entityType: 'ExchangePlatformKillSwitch',
      entityId: 'GLOBAL',
      action: 'UPDATE',
      details: active
        ? `Platform Exchange Kill Switch ACTIVATED: ${platformKillSwitch.reason}`
        : 'Platform Exchange Kill Switch DEACTIVATED',
      userId: actorUserId,
    }).catch(() => {});

    return this.getPlatformKillSwitchState();
  }

  /**
   * Retrieve a tenant's network policy. Defaults to CLOSED with a 30-minute preferred window.
   */
  static getTenantPolicy(tenantId: string): TenantNetworkPolicy {
    const existing = tenantPolicies.get(tenantId);
    if (existing) return existing;
    return {
      tenantId,
      accessMode: 'CLOSED',
      preferredExclusiveWindowMinutes: 30,
      allowAutoAwardPreferred: false,
      consortiumIds: [],
      updatedAt: new Date(0),
    };
  }

  /**
   * Configure a tenant's network access policy.
   */
  static async setTenantPolicy(input: {
    tenantId: string;
    accessMode: NetworkAccessMode;
    preferredExclusiveWindowMinutes?: number;
    allowAutoAwardPreferred?: boolean;
    consortiumIds?: string[];
    actorUserId?: string;
  }): Promise<TenantNetworkPolicy> {
    const policy: TenantNetworkPolicy = {
      tenantId: input.tenantId,
      accessMode: input.accessMode,
      preferredExclusiveWindowMinutes:
        input.preferredExclusiveWindowMinutes != null
          ? Math.max(0, Number(input.preferredExclusiveWindowMinutes))
          : 30,
      allowAutoAwardPreferred: Boolean(input.allowAutoAwardPreferred),
      consortiumIds: Array.isArray(input.consortiumIds) ? [...new Set(input.consortiumIds)] : [],
      updatedAt: new Date(),
      updatedBy: input.actorUserId,
    };
    tenantPolicies.set(input.tenantId, policy);

    await persistGovernanceRecord(`EXCHANGE_POLICY_${input.tenantId}`, policy, true);

    await logAudit({
      tenantId: input.tenantId,
      entityType: 'ExchangeNetworkPolicy',
      entityId: input.tenantId,
      action: 'UPDATE',
      details: `Set network accessMode=${policy.accessMode}, preferredWindow=${policy.preferredExclusiveWindowMinutes}m, autoAward=${policy.allowAutoAwardPreferred}`,
      userId: input.actorUserId,
    }).catch(() => {});

    return policy;
  }

  /**
   * Register a tenant in an Exchange Consortium (for EXTENDED partner discovery).
   */
  static registerConsortiumMember(consortiumId: string, consortiumName: string, tenantId: string, role: 'OWNER' | 'MEMBER' = 'MEMBER') {
    const list = consortiumMemberships.get(consortiumId) ?? [];
    const filtered = list.filter((m) => m.tenantId !== tenantId);
    filtered.push({
      consortiumId,
      consortiumName,
      tenantId,
      role,
      joinedAt: new Date(),
    });
    consortiumMemberships.set(consortiumId, filtered);

    // Ensure tenant policy tracks consortiumId
    const policy = this.getTenantPolicy(tenantId);
    if (!policy.consortiumIds.includes(consortiumId)) {
      tenantPolicies.set(tenantId, {
        ...policy,
        consortiumIds: [...policy.consortiumIds, consortiumId],
      });
    }
  }

  /**
   * Partner grants or revokes consent for its qualification profile to be discovered
   * by members of a specific consortium. Commercial rates and invoices are NEVER shared.
   */
  static setPartnerSharingConsent(
    partnerId: string,
    consortiumId: string,
    allowQualificationDiscovery: boolean,
    grantedByUserId = 'PARTNER_ADMIN',
  ): PartnerSharingConsent {
    const list = partnerSharingConsents.get(partnerId) ?? [];
    const filtered = list.filter((c) => c.consortiumId !== consortiumId);
    const consent: PartnerSharingConsent = {
      partnerId,
      consortiumId,
      allowQualificationDiscovery,
      shareCommercialRates: false,
      grantedByUserId,
      grantedAt: new Date(),
    };
    filtered.push(consent);
    partnerSharingConsents.set(partnerId, filtered);
    void persistGovernanceRecord(`EXCHANGE_CONSENT_${partnerId}`, filtered, true);
    return consent;
  }

  /**
   * ARCH-1: Hydrate in-memory governance caches from PostgreSQL IntegrationConfig
   * when the 15-second TTL expires across multi-replica / serverless instances.
   */
  static async hydrateFromDatabaseIfStale(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - lastCacheHydratedAt < CACHE_TTL_MS) return;
    lastCacheHydratedAt = now;

    try {
      const ic = (
        prisma as unknown as {
          integrationConfig?: {
            findMany?: (args: unknown) => Promise<Array<{ type: string; fromName?: string | null; isEnabled?: boolean }>>;
          };
        }
      )?.integrationConfig;
      if (!ic?.findMany) return;

      const rows = await ic.findMany({
        where: { provider: 'FLEET360_EXCHANGE_GOVERNANCE' },
      });

      for (const row of rows) {
        if (!row.fromName) continue;
        try {
          const parsed = JSON.parse(row.fromName);
          if (row.type === 'EXCHANGE_PLATFORM_KILL_SWITCH' && parsed && typeof parsed === 'object') {
            platformKillSwitch = {
              active: Boolean(parsed.active),
              reason: parsed.reason,
              activatedBy: parsed.activatedBy,
              activatedAt: parsed.activatedAt ? new Date(parsed.activatedAt) : undefined,
            };
          } else if (row.type.startsWith('EXCHANGE_POLICY_') && parsed?.tenantId) {
            tenantPolicies.set(parsed.tenantId, {
              ...parsed,
              updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : new Date(),
            });
          } else if (row.type.startsWith('EXCHANGE_CONSENT_') && Array.isArray(parsed)) {
            const pid = row.type.replace('EXCHANGE_CONSENT_', '');
            partnerSharingConsents.set(pid, parsed);
          }
        } catch {
          // Ignore malformed row
        }
      }
    } catch {
      // Non-fatal in unit tests
    }
  }

  /**
   * Retrieve all consortium sharing consents for a partner.
   */
  static getPartnerSharingConsents(partnerId: string): PartnerSharingConsent[] {
    return partnerSharingConsents.get(partnerId) ?? [];
  }

  /**
   * Evaluate whether a partner is currently within the PREFERRED-only exclusive window
   * for a given opportunity.
   */
  static isHeldInPreferredExclusiveWindow(params: {
    buyerTenantId: string;
    publishedAt: Date | string;
    relationshipStatus?: string | null;
    isDirectlyInvited?: boolean;
    asOf?: Date;
  }): { blocked: boolean; reason?: string; windowEndsAt?: Date } {
    if (params.isDirectlyInvited) return { blocked: false };
    const policy = this.getTenantPolicy(params.buyerTenantId);
    if (policy.accessMode !== 'PREFERRED' || policy.preferredExclusiveWindowMinutes <= 0) {
      return { blocked: false };
    }

    const pub = params.publishedAt instanceof Date ? params.publishedAt : new Date(params.publishedAt);
    if (Number.isNaN(pub.getTime())) return { blocked: false };

    const now = params.asOf ?? new Date();
    const windowEndsAt = new Date(pub.getTime() + policy.preferredExclusiveWindowMinutes * 60 * 1000);

    if (now < windowEndsAt && params.relationshipStatus !== 'PREFERRED') {
      return {
        blocked: true,
        windowEndsAt,
        reason: `Opportunity is in the exclusive Preferred Partner quotation window until ${windowEndsAt.toISOString()}.`,
      };
    }

    return { blocked: false, windowEndsAt };
  }

  /**
   * Evaluate whether a partner can discover/quote on a buyer tenant's opportunity
   * under CLOSED, PREFERRED, or EXTENDED (consortium) access rules.
   */
  static canPartnerAccessBuyerNetwork(params: {
    buyerTenantId: string;
    partnerId: string;
    /** Partner's relationships across all tenants: Array<{ tenantId, status }> */
    partnerRelationships: Array<{ tenantId: string; status: string }>;
    isDirectlyInvited?: boolean;
    publishedAt?: Date | string;
    asOf?: Date;
  }): { allowed: boolean; mode: NetworkAccessMode; reason?: string } {
    if (this.isPlatformKillSwitchActive()) {
      return {
        allowed: false,
        mode: 'CLOSED',
        reason: 'Platform Exchange emergency kill switch is active; marketplace participation is suspended.',
      };
    }

    const directRel = params.partnerRelationships.find((r) => r.tenantId === params.buyerTenantId);
    if (directRel?.status === 'BLOCKED') {
      return {
        allowed: false,
        mode: 'CLOSED',
        reason: 'Partner is blocked by this buyer tenant.',
      };
    }

    if (params.isDirectlyInvited) {
      return { allowed: true, mode: this.getTenantPolicy(params.buyerTenantId).accessMode };
    }

    const policy = this.getTenantPolicy(params.buyerTenantId);

    // Check Preferred Exclusive Window first if applicable
    if (policy.accessMode === 'PREFERRED' && params.publishedAt) {
      const windowCheck = this.isHeldInPreferredExclusiveWindow({
        buyerTenantId: params.buyerTenantId,
        publishedAt: params.publishedAt,
        relationshipStatus: directRel?.status ?? null,
        isDirectlyInvited: params.isDirectlyInvited,
        asOf: params.asOf,
      });
      if (windowCheck.blocked) {
        return {
          allowed: false,
          mode: 'PREFERRED',
          reason: windowCheck.reason,
        };
      }
    }

    // Direct relationship (APPROVED or PREFERRED) with buyer tenant
    if (directRel && (directRel.status === 'APPROVED' || directRel.status === 'PREFERRED')) {
      return { allowed: true, mode: policy.accessMode };
    }

    // EXTENDED mode: check if buyer and another tenant that vetted this partner share a consortium
    // AND the partner granted sharing consent for that consortium.
    if (policy.accessMode === 'EXTENDED' && policy.consortiumIds.length > 0) {
      const consents = partnerSharingConsents.get(params.partnerId) ?? [];
      const approvedTenantIds = new Set(
        params.partnerRelationships
          .filter((r) => r.status === 'APPROVED' || r.status === 'PREFERRED')
          .map((r) => r.tenantId),
      );

      for (const consortiumId of policy.consortiumIds) {
        const hasConsent = consents.some(
          (c) => c.consortiumId === consortiumId && c.allowQualificationDiscovery,
        );
        if (!hasConsent) continue;

        const members = consortiumMemberships.get(consortiumId) ?? [];
        const buyerIsMember = members.some((m) => m.tenantId === params.buyerTenantId);
        const vettedByPeer = members.some(
          (m) => m.tenantId !== params.buyerTenantId && approvedTenantIds.has(m.tenantId),
        );

        if (buyerIsMember && vettedByPeer) {
          return { allowed: true, mode: 'EXTENDED' };
        }
      }
    }

    return {
      allowed: false,
      mode: policy.accessMode,
      reason: 'Partner is not in this buyer tenant network or authorized consortium.',
    };
  }

  /**
   * Filter partner data for EXTENDED consortium discovery so confidential commercial
   * information (rate cards, customer lists, RFQ history, invoices) is NEVER leaked
   * across tenants.
   */
  static sanitizePartnerForConsortiumDiscovery(partner: {
    id: string;
    legalName: string;
    partnerCode: string;
    city?: string | null;
    emirate?: string | null;
    operationalStatus: string;
    onboardingStatus?: string;
    capabilities?: Array<{ domain: string; serviceType?: string }>;
    serviceAreas?: Array<{ emirate: string }>;
    // Confidential fields that must be stripped if present:
    rateCards?: unknown;
    invoices?: unknown;
    quotes?: unknown;
    awards?: unknown;
    contracts?: unknown;
  }) {
    return {
      id: partner.id,
      legalName: partner.legalName,
      partnerCode: partner.partnerCode,
      city: partner.city ?? null,
      emirate: partner.emirate ?? null,
      operationalStatus: partner.operationalStatus,
      onboardingStatus: partner.onboardingStatus ?? 'APPROVED',
      capabilities: (partner.capabilities ?? []).map((c) => ({
        domain: c.domain,
        serviceType: c.serviceType,
      })),
      serviceAreas: (partner.serviceAreas ?? []).map((sa) => ({ emirate: sa.emirate })),
      // Explicitly omit rateCards, invoices, quotes, awards, contracts
    };
  }

  /** Reset in-memory policies (used by unit tests). */
  static _resetForTests() {
    tenantPolicies.clear();
    consortiumMemberships.clear();
    partnerSharingConsents.clear();
    platformKillSwitch = { active: false };
  }
}
