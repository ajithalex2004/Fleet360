/**
 * src/app/(app)/outsourcing/partners/page.tsx
 *
 * Phase 4: Enterprise Partner Network, Rate-Card & Governance Console for Fleet360 Operations.
 * - Tab 1: Partner Directory, Compliance Eligibility Gate & Performance Trust Scorecards
 * - Tab 2: Versioned Rate Cards, Ancillary Allowance Rules & SHA-256 Commercial Snapshots
 * - Tab 3: Private Network Access Policy (CLOSED | PREFERRED | EXTENDED & Exclusive Lead Window)
 */

'use client';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  ShieldCheck,
  Truck,
  Users,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MapPin,
  Plus,
  Lock,
  Award,
  FileSpreadsheet,
  RefreshCw,
  Sliders,
  Hash,
  Clock,
  Star,
  X,
} from 'lucide-react';

interface PartnerRow {
  id: string;
  legalName: string;
  tradeName?: string | null;
  partnerCode: string;
  city?: string | null;
  emirate?: string | null;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  onboardingStatus: string;
  operationalStatus: string;
  relationshipStatus: string;
  paymentTerms?: string | null;
  commercialNotes?: string | null;
  isPreferred: boolean;
  complianceEligible: boolean;
  validDocsCount: number;
  expiredDocsCount: number;
  capabilities?: { domain: string; isApproved: boolean }[];
  vehicles?: { id: string; licensePlate: string; vehicleType: string; seatingCapacity?: number | null }[];
  drivers?: { id: string; fullName: string; mobileNumber: string }[];
  complianceDocuments?: { id: string; docType: string; status: string; expiryDate?: string | null }[];
  latestScorecard?: {
    overallScore?: number | string | null;
    tier?: string | null;
    onTimeRate?: number | string | null;
    quoteResponseRate?: number | string | null;
    cancellationRate?: number | string | null;
    complianceRate?: number | string | null;
  } | null;
}

interface RateCardRow {
  id: string;
  partnerId: string;
  title: string;
  domain: string;
  vehicleType: string;
  originZone?: string | null;
  destinationZone?: string | null;
  rateAmount: number;
  currency: string;
  unitType: string;
  snapshotHash: string;
  ancillaryCharges?: {
    freeWaitingMinutes: number;
    waitingFeePerHour: number;
    cancellationFeePct?: number;
    tollTreatment: string;
    fuelSurchargePct?: number;
  };
  partner?: {
    id: string;
    legalName: string;
    partnerCode: string;
  };
}

interface NetworkPolicyState {
  tenantId: string;
  networkMode: 'CLOSED' | 'PREFERRED' | 'EXTENDED';
  preferredExclusiveWindowMinutes: number;
  allowExtendedPartnerInvites: boolean;
  requireConsortiumSharingConsent: boolean;
}

export default function EnterprisePartnerDirectoryPage() {
  const [mainSection, setMainSection] = useState<
    'DIRECTORY' | 'RATE_CARDS' | 'NETWORK_POLICY' | 'SCORECARDS_EXCEPTIONS' | 'EXECUTIVE_ANALYTICS'
  >('DIRECTORY');
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [rateCards, setRateCards] = useState<RateCardRow[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [executiveAnalytics, setExecutiveAnalytics] = useState<{
    verticalBreakdown: Array<{
      domain: string;
      requestCount: number;
      awardCount: number;
      awardedSpendAed: number;
      shareOfSpendPct: number;
    }>;
    commercialLedger: {
      agencyAwardCount: number;
      principalAwardCount: number;
      totalAwardedGrossAed: number;
      agencyPlatformFeeEarnedAed: number;
      principalGrossMarginAed: number;
      netPartnerPayoutAed: number;
    };
    threeWayMatchStats: {
      totalInvoices: number;
      autoMatchedCount: number;
      varianceHoldCount: number;
      autoMatchRatePct: number;
      totalInvoicedAed: number;
      totalApprovedAed: number;
      varianceSavingsAed: number;
    };
  } | null>(null);
  const [networkPolicy, setNetworkPolicy] = useState<NetworkPolicyState>({
    tenantId: '',
    networkMode: 'PREFERRED',
    preferredExclusiveWindowMinutes: 30,
    allowExtendedPartnerInvites: false,
    requireConsortiumSharingConsent: true,
  });

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ALL' | 'PREFERRED' | 'APPROVED' | 'BLOCKED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<PartnerRow | null>(null);
  const [showRateCardModal, setShowRateCardModal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [runningSweeper, setRunningSweeper] = useState(false);
  const [autoTriggerFailover, setAutoTriggerFailover] = useState(true);
  const [sweeperSummary, setSweeperSummary] = useState<{
    expiredCount: number;
    zeroQuoteCount: number;
    noShowCount: number;
    failoverCount: number;
    sweptAt: string;
  } | null>(null);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/exchange/partner/profile?mode=directory');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error ?? 'Could not load transport partners.');
        return;
      }
      if (Array.isArray(json.partners)) {
        setPartners(json.partners);
      } else if (json.partner) {
        setPartners([json.partner]);
      }
      if (Array.isArray(json.rateCards)) {
        setRateCards(json.rateCards);
      }
      if (Array.isArray(json.exceptions)) {
        setExceptions(json.exceptions);
      }
      if (json.networkPolicy) {
        setNetworkPolicy(json.networkPolicy);
      }
      if (json.executiveAnalytics) {
        setExecutiveAnalytics(json.executiveAnalytics);
      }
    } catch {
      setLoadError('Failed to connect to partner governance service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const handleUpdateRelationship = async (partnerId: string, status: 'PREFERRED' | 'APPROVED' | 'BLOCKED') => {
    try {
      const res = await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_RELATIONSHIP',
          partnerId,
          status,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update partner relationship');
      }
      showToast(`✓ Partner relationship updated to ${status}`);
      await loadDirectory();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to update relationship');
    }
  };

  const handleEvaluateScorecard = async (partnerId: string) => {
    try {
      const res = await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to recalculate scorecard');
      }
      showToast('✓ Partner performance scorecard recalculated.');
      await loadDirectory();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to recalculate scorecard');
    }
  };

  const handleRunSlaSweeper = async () => {
    setRunningSweeper(true);
    try {
      const res = await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RUN_SLA_SWEEPER',
          graceMinutes: 30,
          autoTriggerFailover,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to run SLA & RFQ expiry sweeper');
      }
      const sw = json.sweeper || {};
      const expiredCount = Number(sw.expiredOpportunities?.sweptCount ?? 0);
      const zeroQuoteCount = Array.isArray(sw.expiredOpportunities?.zeroQuoteOpportunityIds)
        ? sw.expiredOpportunities.zeroQuoteOpportunityIds.length
        : 0;
      const noShowCount = Number(sw.overdueNoShows?.overdueNoShowCount ?? 0);
      const failoverCount = Array.isArray(sw.overdueNoShows?.failoverOutcomes)
        ? sw.overdueNoShows.failoverOutcomes.length
        : 0;
      setSweeperSummary({
        expiredCount,
        zeroQuoteCount,
        noShowCount,
        failoverCount,
        sweptAt: sw.sweptAt || new Date().toISOString(),
      });
      showToast(
        `✓ SLA Sweeper completed: ${expiredCount} expired RFQs swept, ${noShowCount} overdue no-shows flagged.`
      );
      await loadDirectory();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to run SLA sweeper');
    } finally {
      setRunningSweeper(false);
    }
  };

  const handleSaveNetworkPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      const res = await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_NETWORK_POLICY',
          networkMode: networkPolicy.networkMode,
          preferredExclusiveWindowMinutes: networkPolicy.preferredExclusiveWindowMinutes,
          allowExtendedPartnerInvites: networkPolicy.allowExtendedPartnerInvites,
          requireConsortiumSharingConsent: networkPolicy.requireConsortiumSharingConsent,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save network policy');
      }
      const json = await res.json();
      if (json.networkPolicy) setNetworkPolicy(json.networkPolicy);
      showToast(`✓ Private Exchange Network policy saved (${networkPolicy.networkMode})`);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to save network policy');
    } finally {
      setSavingPolicy(false);
    }
  };

  const filteredPartners = partners.filter((p) => {
    if (activeTab === 'PREFERRED' && p.relationshipStatus !== 'PREFERRED') return false;
    if (activeTab === 'APPROVED' && p.relationshipStatus !== 'APPROVED' && p.onboardingStatus !== 'APPROVED') return false;
    if (activeTab === 'BLOCKED' && p.relationshipStatus !== 'BLOCKED' && p.operationalStatus !== 'BLOCKED') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.legalName.toLowerCase().includes(q) ||
        p.partnerCode.toLowerCase().includes(q) ||
        (p.city && p.city.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 font-sans">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-cyan-600 uppercase tracking-wider">
            Private Partner Exchange Network
          </span>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">
            Enterprise Partner Governance & Commercials
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Govern private network access ({networkPolicy.networkMode}), 3-stage compliance eligibility, versioned rate cards with SHA-256 snapshots, and partner performance scorecards.
          </p>
        </div>

        {/* Top-Level Section Switcher */}
        <div className="flex p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs">
          <button
            onClick={() => setMainSection('DIRECTORY')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
              mainSection === 'DIRECTORY'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Partner Directory ({partners.length})</span>
          </button>
          <button
            onClick={() => setMainSection('RATE_CARDS')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
              mainSection === 'RATE_CARDS'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Rate Cards & SHA-256 ({rateCards.length})</span>
          </button>
          <button
            onClick={() => setMainSection('NETWORK_POLICY')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
              mainSection === 'NETWORK_POLICY'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Network Access ({networkPolicy.networkMode})</span>
          </button>
          <button
            onClick={() => setMainSection('SCORECARDS_EXCEPTIONS')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
              mainSection === 'SCORECARDS_EXCEPTIONS'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>SLA Scorecards & Exceptions ({exceptions.length})</span>
          </button>
          <button
            onClick={() => setMainSection('EXECUTIVE_ANALYTICS')}
            className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition ${
              mainSection === 'EXECUTIVE_ANALYTICS'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            <span>Spend & 3-Way Analytics</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{feedback}</span>
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)} className="text-amber-600 hover:underline font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 1: PARTNER DIRECTORY, COMPLIANCE GATE & PERFORMANCE SCORECARDS
          ════════════════════════════════════════════════════════════════════════ */}
      {mainSection === 'DIRECTORY' && (
        <div className="space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search partners by legal name, code, or city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Relationship Filter */}
            <div className="flex p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs">
              {(['ALL', 'PREFERRED', 'APPROVED', 'BLOCKED'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3.5 py-1.5 rounded-xl font-bold transition ${
                    activeTab === tab
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab === 'ALL' ? 'All Partners' : tab}
                </button>
              ))}
            </div>
          </div>

          {/* Partners Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPartners.length > 0 ? (
              filteredPartners.map((p) => {
                const sc = p.latestScorecard;
                const scoreNum = sc?.overallScore != null ? Number(sc.overallScore) : null;
                return (
                  <div
                    key={p.id}
                    className="p-5 rounded-3xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 transition shadow-sm flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-600 dark:text-cyan-400 font-black">
                            {p.legalName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-900 dark:text-white text-sm">{p.legalName}</h3>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                              <span>{p.partnerCode}</span>
                              {p.city && (
                                <span className="flex items-center gap-0.5 font-sans">
                                  <MapPin className="w-3 h-3" /> {p.city}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            p.relationshipStatus === 'PREFERRED'
                              ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                              : p.relationshipStatus === 'BLOCKED' || p.operationalStatus === 'BLOCKED'
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                          }`}
                        >
                          {p.relationshipStatus || p.onboardingStatus}
                        </span>
                      </div>

                      {/* Strict Separation: Compliance Eligibility Gate vs Performance Scorecard */}
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div
                          className={`p-2.5 rounded-2xl border ${
                            p.complianceEligible
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          <div className="font-bold flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>{p.complianceEligible ? 'Gate: Eligible' : 'Gate: Blocked'}</span>
                          </div>
                          <div className="text-[10px] opacity-80 mt-0.5">
                            {p.validDocsCount} valid · {p.expiredDocsCount} expired
                          </div>
                        </div>

                        <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                          <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Award className="w-3.5 h-3.5 text-amber-400" />
                              <span>Scorecard</span>
                            </span>
                            <span className="font-mono text-cyan-500">
                              {scoreNum != null ? `${scoreNum.toFixed(0)}/100` : 'N/A'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Tier: <strong className="text-slate-600 dark:text-slate-300">{sc?.tier || 'UNRATED'}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Capabilities Pills */}
                      <div className="flex flex-wrap gap-1.5">
                        {p.capabilities?.map((c, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold"
                          >
                            {c.domain.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Footer Stats & Governance Actions */}
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="flex items-center gap-1">
                          <Truck className="w-3.5 h-3.5 text-cyan-500" /> {p.vehicles?.length || 0} Vehicles
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-indigo-500" /> {p.drivers?.length || 0} Drivers
                        </span>
                        <button
                          onClick={() => setSelectedPartner(p)}
                          className="text-cyan-600 dark:text-cyan-400 font-bold hover:underline"
                        >
                          360° Profile →
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          onClick={() => handleUpdateRelationship(p.id, 'PREFERRED')}
                          className="flex-1 py-1.5 px-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 font-bold text-[10px] flex items-center justify-center gap-1 transition"
                          title="Grant Tier-1 Preferred Partner exclusivity window"
                        >
                          <Star className="w-3 h-3" />
                          <span>Set Preferred</span>
                        </button>
                        <button
                          onClick={() =>
                            handleUpdateRelationship(
                              p.id,
                              p.relationshipStatus === 'BLOCKED' ? 'APPROVED' : 'BLOCKED',
                            )
                          }
                          className="py-1.5 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-500/20 text-slate-600 dark:text-slate-300 hover:text-rose-400 font-bold text-[10px] transition"
                        >
                          {p.relationshipStatus === 'BLOCKED' ? 'Unblock' : 'Block'}
                        </button>
                        <button
                          onClick={() => handleEvaluateScorecard(p.id)}
                          className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-cyan-500/20 text-slate-500 hover:text-cyan-400 transition"
                          title="Recalculate Partner Performance Scorecard"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-3 p-12 text-center text-xs text-slate-400 rounded-3xl bg-slate-100/50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800">
                {loading
                  ? 'Loading governed partner network...'
                  : 'No transport partners found matching your filter criteria.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 2: VERSIONED RATE CARDS & SHA-256 COMMERCIAL SNAPSHOTS
          ════════════════════════════════════════════════════════════════════════ */}
      {mainSection === 'RATE_CARDS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-100/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-4 rounded-3xl">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-cyan-500" />
                <span>Contracted Partner Rate Cards & Ancillary Allowances</span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Every award freezes a cryptographic SHA-256 snapshot of the active rate card version so subsequent tariff updates never mutate historical awards or 3-way reconciliation.
              </p>
            </div>
            <button
              onClick={() => setShowRateCardModal(true)}
              className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/25 flex items-center gap-1.5 shrink-0 transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Rate Card Version</span>
            </button>
          </div>

          <div className="rounded-3xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4">Partner & Contract Title</th>
                  <th className="p-4">Domain / Vehicle</th>
                  <th className="p-4">Corridor</th>
                  <th className="p-4">Contract Rate</th>
                  <th className="p-4">Ancillary Rules (3-Way Match)</th>
                  <th className="p-4">SHA-256 Snapshot Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                {rateCards.length > 0 ? (
                  rateCards.map((rc) => (
                    <tr key={rc.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition">
                      <td className="p-4">
                        <div className="font-bold text-slate-900 dark:text-white">{rc.title}</div>
                        <div className="text-[11px] text-slate-400">
                          {rc.partner?.legalName || rc.partnerId} ({rc.partner?.partnerCode || 'PARTNER'})
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold text-[10px]">
                          {rc.domain}
                        </span>
                        <div className="text-[11px] text-slate-500 mt-1 font-semibold">{rc.vehicleType}</div>
                      </td>
                      <td className="p-4 text-slate-600 dark:text-slate-300">
                        {rc.originZone || 'Any Origin'} → {rc.destinationZone || 'Any Destination'}
                      </td>
                      <td className="p-4">
                        <div className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                          {rc.currency} {Number(rc.rateAmount).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-400">{rc.unitType}</div>
                      </td>
                      <td className="p-4 text-[11px] text-slate-500 space-y-0.5">
                        <div>
                          Free Wait: <strong className="text-slate-700 dark:text-slate-200">{rc.ancillaryCharges?.freeWaitingMinutes ?? 30}m</strong> · Detention:{' '}
                          <strong className="text-slate-700 dark:text-slate-200">AED {rc.ancillaryCharges?.waitingFeePerHour ?? 100}/hr</strong>
                        </div>
                        <div>
                          SLA Cancel Penalty: <strong className="text-amber-500">{rc.ancillaryCharges?.cancellationFeePct ?? 25}%</strong> · Tolls:{' '}
                          <strong>{rc.ancillaryCharges?.tollTreatment || 'ACTUAL'}</strong> · Fuel Index:{' '}
                          <strong className="text-cyan-500">{rc.ancillaryCharges?.fuelSurchargePct ?? 0}%</strong>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-[10px] text-cyan-600 dark:text-cyan-400">
                          <Hash className="w-3 h-3" />
                          {rc.snapshotHash ? `${rc.snapshotHash.slice(0, 14)}…` : 'VERIFIED'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No contracted rate cards configured yet. Click &ldquo;New Rate Card Version&rdquo; to establish baseline tariffs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 3: PRIVATE NETWORK ACCESS POLICY (CLOSED | PREFERRED | EXTENDED)
          ════════════════════════════════════════════════════════════════════════ */}
      {mainSection === 'NETWORK_POLICY' && (
        <form
          onSubmit={handleSaveNetworkPolicy}
          className="rounded-3xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-6 space-y-6"
        >
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-cyan-500" />
              <span>Private Partner Exchange Network Access Control</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Control which external carriers can discover, bid on, and accept your outsourced Freight, Bus, Limousine, and Recovery requirements.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(
              [
                {
                  mode: 'CLOSED',
                  title: 'Closed Consortium Network',
                  desc: 'Strict bilateral whitelist. Only explicitly invited and approved partners with an active TenantPartnerRelationship can view or quote.',
                },
                {
                  mode: 'PREFERRED',
                  title: 'Preferred-First Network',
                  desc: 'Tier-1 Preferred partners receive an exclusive lead window before open RFQs become visible to your broader approved partner pool.',
                },
                {
                  mode: 'EXTENDED',
                  title: 'Extended Verified Network',
                  desc: 'Approved consortium partners with verified compliance and sharing consent can discover sanitized opportunities when Tier-1 capacity is exhausted.',
                },
              ] as const
            ).map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => setNetworkPolicy((prev) => ({ ...prev, networkMode: option.mode }))}
                className={`p-4 rounded-2xl border text-left transition space-y-2 ${
                  networkPolicy.networkMode === option.mode
                    ? 'border-cyan-500 bg-cyan-500/10 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900 dark:text-white">{option.title}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      networkPolicy.networkMode === option.mode
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    {option.mode}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{option.desc}</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-500" />
                <span>Preferred-Tier Exclusive Lead Window (Mins)</span>
              </label>
              <input
                type="number"
                min={0}
                max={1440}
                value={networkPolicy.preferredExclusiveWindowMinutes}
                onChange={(e) =>
                  setNetworkPolicy((prev) => ({
                    ...prev,
                    preferredExclusiveWindowMinutes: Number(e.target.value) || 0,
                  }))
                }
                className="w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white"
              />
              <p className="text-[10px] text-slate-400">
                During this window after RFQ publication, non-preferred partners are held back from viewing or quoting.
              </p>
            </div>

            <label className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={networkPolicy.requireConsortiumSharingConsent}
                onChange={(e) =>
                  setNetworkPolicy((prev) => ({
                    ...prev,
                    requireConsortiumSharingConsent: e.target.checked,
                  }))
                }
                className="mt-1 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
              />
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Enforce Explicit Consortium Sharing Consent
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  A partner onboarded by another Fleet360 tenant is never visible unless both the partner and onboarding tenant grant sharing consent.
                </p>
              </div>
            </label>

            <label className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={networkPolicy.allowExtendedPartnerInvites}
                onChange={(e) =>
                  setNetworkPolicy((prev) => ({
                    ...prev,
                    allowExtendedPartnerInvites: e.target.checked,
                  }))
                }
                className="mt-1 rounded border-slate-400 text-cyan-600 focus:ring-cyan-500"
              />
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Allow Sponsored Extended Partner Invitations
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Permits approved Tier-1 members to nominate vetted secondary operators subject to KYB & 3-stage compliance gating.
                </p>
              </div>
            </label>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={savingPolicy}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {savingPolicy ? 'Saving Governance Policy...' : 'Save Network Access Policy'}
            </button>
          </div>
        </form>
      )}

      {/* ── SECTION 4: PARTNER SLA SCORECARDS & EXCEPTION ANALYTICS ── */}
      {mainSection === 'SCORECARDS_EXCEPTIONS' && (
        <div className="space-y-6">
          {/* Automated SLA & RFQ Expiry Sweeper Banner */}
          <div className="p-5 rounded-3xl bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-indigo-950/30 border border-cyan-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-black text-white uppercase tracking-wider">
                  Automated Expired RFQ & SLA No-Show Sweeper
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Sweeps expired <code className="text-cyan-300">OPEN</code> marketplace opportunities past <code className="text-cyan-300">closesAt</code> to <code className="text-amber-300">EXPIRED</code>, detects active assignments past pickup + 30m grace window with <code className="text-cyan-300">reachedAt == null</code>, raises <code className="text-rose-300">DRIVER_NO_SHOW</code> exceptions, and triggers the Standby Runner-Up Failover Waterfall.
              </p>
              {sweeperSummary && (
                <div className="flex flex-wrap items-center gap-3 pt-1.5 text-[11px] font-mono">
                  <span className="px-2.5 py-0.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    Expired RFQs Swept: <strong>{sweeperSummary.expiredCount}</strong>
                  </span>
                  <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Zero-Quote Alerts: <strong>{sweeperSummary.zeroQuoteCount}</strong>
                  </span>
                  <span className="px-2.5 py-0.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    Overdue No-Shows Flagged: <strong>{sweeperSummary.noShowCount}</strong>
                  </span>
                  <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Standby Failovers Promoted: <strong>{sweeperSummary.failoverCount}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTriggerFailover}
                  onChange={(e) => setAutoTriggerFailover(e.target.checked)}
                  className="rounded border-slate-600 text-cyan-500 focus:ring-cyan-500"
                />
                <span>Auto-Trigger Standby Failover</span>
              </label>
              <button
                type="button"
                disabled={runningSweeper}
                onClick={() => void handleRunSlaSweeper()}
                className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/25 flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runningSweeper ? 'animate-spin' : ''}`} />
                <span>{runningSweeper ? 'Sweeping Network...' : 'Run SLA & Expiry Sweeper'}</span>
              </button>
            </div>
          </div>

          {/* Partner Scorecard Leaderboard */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Award className="w-5 h-5 text-cyan-500" />
                  <span>Partner Trust Scorecards & SLA Tier Leaderboard</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Composite score weighting: On-Time Performance (40%), Quote Response Rate (20%), ePOD Quality (20%), and SLA Exception / Dispute Discipline (20%).
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                  <tr>
                    <th className="py-2.5 px-3">Partner</th>
                    <th className="py-2.5 px-3">Tier</th>
                    <th className="py-2.5 px-3">Composite Score</th>
                    <th className="py-2.5 px-3">On-Time Rate</th>
                    <th className="py-2.5 px-3">Quote Response</th>
                    <th className="py-2.5 px-3">Exception Rate</th>
                    <th className="py-2.5 px-3">Compliance Gate</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {partners.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        No partners in your network yet.
                      </td>
                    </tr>
                  ) : (
                    partners.map((p) => {
                      const sc = p.latestScorecard;
                      const tier = sc?.tier || 'STANDARD';
                      const score = Number(sc?.overallScore ?? 100);
                      const otp = Number(sc?.onTimeRate ?? 100);
                      const qrr = Number(sc?.quoteResponseRate ?? 100);
                      const exc = Number(sc?.cancellationRate ?? 0);
                      return (
                        <tr key={p.id}>
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900 dark:text-white">{p.legalName}</div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {p.partnerCode} · {p.relationshipStatus}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                tier === 'GOLD' || tier === 'PLATINUM'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : tier === 'SILVER'
                                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                    : tier === 'PROBATION'
                                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                      : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                              }`}
                            >
                              {tier}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono font-black text-cyan-500">{score.toFixed(1)} pts</td>
                          <td className="py-3 px-3 font-mono text-emerald-500 font-semibold">{otp.toFixed(0)}%</td>
                          <td className="py-3 px-3 font-mono text-indigo-400">{qrr.toFixed(0)}%</td>
                          <td className="py-3 px-3 font-mono text-amber-500">{exc.toFixed(1)}%</td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                p.complianceEligible
                                  ? 'bg-emerald-500/15 text-emerald-500'
                                  : 'bg-rose-500/15 text-rose-400'
                              }`}
                            >
                              {p.complianceEligible ? 'ELIGIBLE' : 'GATED'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => void handleEvaluateScorecard(p.id)}
                              className="inline-flex items-center gap-1 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-500 hover:bg-cyan-500/20"
                            >
                              <RefreshCw className="w-3 h-3" /> Recalculate
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* SLA Exception & Governed Failover Audit Log */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>SLA Exception & Governed Failover History ({exceptions.length})</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit log of partner SLA breaches, no-shows, vehicle breakdowns, and governed failover re-sourcing events.
              </p>
            </div>

            {exceptions.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No partner SLA exceptions or failover events recorded for this tenant.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Partner</th>
                      <th className="py-2.5 px-3">Exception Type</th>
                      <th className="py-2.5 px-3">Severity</th>
                      <th className="py-2.5 px-3">RFQ / Corridor</th>
                      <th className="py-2.5 px-3">Description & Resolution</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {exceptions.map((ex: any) => (
                      <tr key={ex.id}>
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                          {ex.createdAt ? new Date(ex.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                          {ex.partner?.legalName || ex.partnerId}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-amber-400">{ex.type}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              ex.severity === 'CRITICAL' || ex.severity === 'HIGH'
                                ? 'bg-rose-500/20 text-rose-400'
                                : 'bg-amber-500/20 text-amber-400'
                            }`}
                          >
                            {ex.severity}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {ex.award?.request?.requestNumber || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-md">
                          <div>{ex.description}</div>
                          {ex.resolutionNotes && (
                            <div className="text-[11px] text-emerald-400 mt-0.5">
                              Resolution: {ex.resolutionNotes}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/20 text-slate-300">
                            {ex.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SECTION 5: EXECUTIVE OUTSOURCE SPEND, COMMISSION & 3-WAY MATCH ANALYTICS
          ════════════════════════════════════════════════════════════════════════ */}
      {mainSection === 'EXECUTIVE_ANALYTICS' && (
        <div className="space-y-6">
          {/* Executive Summary KPI Cards */}
          <StatGrid cols={4}>
            <KpiCard
              label="Total Outsourced Spend"
              value={`AED ${Number(executiveAnalytics?.commercialLedger?.totalAwardedGrossAed ?? 0).toLocaleString('en-AE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`}
              sub={`${(executiveAnalytics?.commercialLedger?.agencyAwardCount ?? 0) + (executiveAnalytics?.commercialLedger?.principalAwardCount ?? 0)} governed awards across 4 verticals`}
              accent="slate"
            />
            <KpiCard
              label="Platform Commissions & Margin"
              value={`AED ${Number(
                (executiveAnalytics?.commercialLedger?.agencyPlatformFeeEarnedAed ?? 0) +
                  (executiveAnalytics?.commercialLedger?.principalGrossMarginAed ?? 0),
              ).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              sub={`Agency Fees: AED ${Number(executiveAnalytics?.commercialLedger?.agencyPlatformFeeEarnedAed ?? 0).toFixed(2)} · Principal Margin: AED ${Number(executiveAnalytics?.commercialLedger?.principalGrossMarginAed ?? 0).toFixed(2)}`}
              accent="cyan"
            />
            <KpiCard
              label="3-Way Match Auto-Approval"
              value={`${Number(executiveAnalytics?.threeWayMatchStats?.autoMatchRatePct ?? 100).toFixed(1)}%`}
              sub={`${executiveAnalytics?.threeWayMatchStats?.autoMatchedCount ?? 0} matched · ${executiveAnalytics?.threeWayMatchStats?.varianceHoldCount ?? 0} held on variance review`}
              accent="emerald"
            />
            <KpiCard
              label="3-Way Audit & SLA Savings"
              value={`AED ${Number(executiveAnalytics?.threeWayMatchStats?.varianceSavingsAed ?? 0).toLocaleString('en-AE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`}
              sub="Prevented overcharges & SLA penalty deductions"
              accent="amber"
            />
          </StatGrid>

          {/* Cross-Vertical Outsource Spend & Volume Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Cross-Vertical Outsource Spend & Volume Breakdown
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Distribution of RFQs, awards, and gross outsourced spend across Passenger Bus, Freight, VIP Limousine, and Roadside Recovery.
                </p>
              </div>

              <div className="space-y-3">
                {(
                  executiveAnalytics?.verticalBreakdown || [
                    { domain: 'PASSENGER_TRANSPORT', requestCount: 0, awardCount: 0, awardedSpendAed: 0, shareOfSpendPct: 0 },
                    { domain: 'FREIGHT', requestCount: 0, awardCount: 0, awardedSpendAed: 0, shareOfSpendPct: 0 },
                    { domain: 'LIMOUSINE', requestCount: 0, awardCount: 0, awardedSpendAed: 0, shareOfSpendPct: 0 },
                    { domain: 'RECOVERY', requestCount: 0, awardCount: 0, awardedSpendAed: 0, shareOfSpendPct: 0 },
                  ]
                ).map((vb) => (
                  <div
                    key={vb.domain}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {vb.domain.replace(/_/g, ' ')}
                      </span>
                      <span className="font-mono font-bold text-cyan-500">
                        AED {Number(vb.awardedSpendAed).toLocaleString('en-AE', { minimumFractionDigits: 2 })} (
                        {vb.shareOfSpendPct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full transition-all"
                        style={{ width: `${Math.max(4, Math.min(100, vb.shareOfSpendPct))}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{vb.requestCount} RFQs Published</span>
                      <span>{vb.awardCount} Trips Awarded</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* IFRS 15 Commercial Ledger & 3-Way Reconciliation Summary */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  IFRS 15 Commercial Ledger & 3-Way Match Audit
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Reconciliation of Agency vs. Principal awards, Net Partner Payouts, and frozen SHA-256 rate-card invoice verification.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-indigo-400">Agency Mode (Net-Remit)</span>
                  <div className="text-lg font-black font-mono text-slate-900 dark:text-white">
                    {executiveAnalytics?.commercialLedger?.agencyAwardCount ?? 0} Awards
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Commission Earned: AED{' '}
                    {Number(executiveAnalytics?.commercialLedger?.agencyPlatformFeeEarnedAed ?? 0).toFixed(2)}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-emerald-400">Principal Mode (IFRS 15)</span>
                  <div className="text-lg font-black font-mono text-slate-900 dark:text-white">
                    {executiveAnalytics?.commercialLedger?.principalAwardCount ?? 0} Awards
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Gross Spread: AED{' '}
                    {Number(executiveAnalytics?.commercialLedger?.principalGrossMarginAed ?? 0).toFixed(2)}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-cyan-400">Total Partner Invoices</span>
                  <div className="text-lg font-black font-mono text-slate-900 dark:text-white">
                    {executiveAnalytics?.threeWayMatchStats?.totalInvoices ?? 0} Invoices
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Claimed: AED {Number(executiveAnalytics?.threeWayMatchStats?.totalInvoicedAed ?? 0).toFixed(2)}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-amber-400">Net Partner Remittance</span>
                  <div className="text-lg font-black font-mono text-emerald-500">
                    AED {Number(executiveAnalytics?.commercialLedger?.netPartnerPayoutAed ?? 0).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Approved AP: AED {Number(executiveAnalytics?.threeWayMatchStats?.totalApprovedAed ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: PARTNER 360 PROFILE ── */}
      {selectedPartner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-2xl w-full space-y-5 shadow-2xl max-h-[85vh] overflow-y-auto text-xs">
            <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-wider">
                  Partner 360° Governance & Compliance Profile
                </span>
                <h2 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                  {selectedPartner.legalName}
                </h2>
                <p className="text-slate-400 font-mono text-[11px]">
                  Code: {selectedPartner.partnerCode} · Relationship: {selectedPartner.relationshipStatus}
                </p>
              </div>
              <button
                onClick={() => setSelectedPartner(null)}
                className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scorecard Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-400">Composite Score</div>
                <div className="text-base font-black text-cyan-500 mt-0.5">
                  {selectedPartner.latestScorecard?.overallScore != null
                    ? `${Number(selectedPartner.latestScorecard.overallScore).toFixed(0)}%`
                    : 'N/A'}
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-400">On-Time Performance</div>
                <div className="text-base font-black text-emerald-500 mt-0.5">
                  {selectedPartner.latestScorecard?.onTimeRate != null
                    ? `${Number(selectedPartner.latestScorecard.onTimeRate).toFixed(0)}%`
                    : 'N/A'}
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-400">Quote Response</div>
                <div className="text-base font-black text-indigo-400 mt-0.5">
                  {selectedPartner.latestScorecard?.quoteResponseRate != null
                    ? `${Number(selectedPartner.latestScorecard.quoteResponseRate).toFixed(0)}%`
                    : 'N/A'}
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] text-slate-400">Cancellation Rate</div>
                <div className="text-base font-black text-amber-500 mt-0.5">
                  {selectedPartner.latestScorecard?.cancellationRate != null
                    ? `${Number(selectedPartner.latestScorecard.cancellationRate).toFixed(1)}%`
                    : '0.0%'}
                </div>
              </div>
            </div>

            {/* Compliance Documents */}
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>3-Stage Synchronous Compliance Vault ({selectedPartner.complianceDocuments?.length || 0})</span>
              </h4>
              <div className="space-y-2">
                {selectedPartner.complianceDocuments?.length ? (
                  selectedPartner.complianceDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {doc.docType.replace(/_/g, ' ')}
                      </span>
                      <div className="flex items-center gap-3">
                        {doc.expiryDate && (
                          <span className="text-slate-400 text-[11px]">
                            Expires: {new Date(doc.expiryDate).toLocaleDateString()}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                            doc.status === 'VALID' || doc.status === 'APPROVED'
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : doc.status === 'EXPIRED'
                              ? 'bg-rose-500/15 text-rose-500'
                              : 'bg-amber-500/15 text-amber-500'
                          }`}
                        >
                          {doc.status === 'VALID' || doc.status === 'APPROVED' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : doc.status === 'EXPIRED' ? (
                            <XCircle className="w-3 h-3" />
                          ) : (
                            <AlertTriangle className="w-3 h-3" />
                          )}
                          {doc.status}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-400">No compliance documents uploaded.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE NEW VERSIONED RATE CARD ── */}
      {showRateCardModal && (
        <CreateRateCardModal
          partners={partners}
          onClose={() => setShowRateCardModal(false)}
          onCreated={async () => {
            setShowRateCardModal(false);
            showToast('✓ New versioned rate card created with immutable SHA-256 snapshot.');
            await loadDirectory();
          }}
        />
      )}
    </div>
  );
}

function CreateRateCardModal({
  partners,
  onClose,
  onCreated,
}: {
  partners: PartnerRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || '');
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState('PASSENGER_TRANSPORT');
  const [vehicleType, setVehicleType] = useState('50-Seater Luxury Coach');
  const [originZone, setOriginZone] = useState('Dubai');
  const [destinationZone, setDestinationZone] = useState('Abu Dhabi');
  const [rateAmount, setRateAmount] = useState('1800');
  const [currency, setCurrency] = useState('AED');
  const [unitType, setUnitType] = useState('PER_TRIP');
  const [freeWaitingMinutes, setFreeWaitingMinutes] = useState('30');
  const [waitingFeePerHour, setWaitingFeePerHour] = useState('100');
  const [cancellationFeePct, setCancellationFeePct] = useState('25');
  const [fuelSurchargePct, setFuelSurchargePct] = useState('5');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerId || !title || !Number(rateAmount)) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_RATE_CARD',
          partnerId,
          title,
          domain,
          vehicleType,
          originZone,
          destinationZone,
          rateAmount: Number(rateAmount),
          currency,
          unitType,
          freeWaitingMinutes: Number(freeWaitingMinutes),
          waitingFeePerHour: Number(waitingFeePerHour),
          cancellationFeePct: Number(cancellationFeePct),
          fuelSurchargePct: Number(fuelSurchargePct),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create rate card');
      }
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating rate card');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Create Versioned Contract Rate Card
            </h3>
            <p className="text-[11px] text-slate-400">
              Generates a cryptographic SHA-256 commercial snapshot for 3-way reconciliation
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Transport Partner *</label>
            <select
              required
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 text-slate-900 dark:text-white"
            >
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.legalName} ({p.partnerCode})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Agreement Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q4 Staff Shuttle Tariff v2"
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Service Domain *</label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 text-slate-900 dark:text-white"
              >
                <option value="PASSENGER_TRANSPORT">Passenger Transport (Bus)</option>
                <option value="LIMOUSINE">Executive Limousine</option>
                <option value="FREIGHT">Freight & Logistics</option>
                <option value="RECOVERY">Vehicle Recovery</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Vehicle Category</label>
              <input
                type="text"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Origin Zone</label>
              <input
                type="text"
                value={originZone}
                onChange={(e) => setOriginZone(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Destination Zone</label>
              <input
                type="text"
                value={destinationZone}
                onChange={(e) => setDestinationZone(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Base Rate *</label>
              <input
                type="number"
                step="0.01"
                required
                value={rateAmount}
                onChange={(e) => setRateAmount(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 font-mono font-bold text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 font-mono text-slate-900 dark:text-white"
              >
                <option value="AED">AED (UAE Dirham)</option>
                <option value="USD">USD (US Dollar)</option>
                <option value="SAR">SAR (Saudi Riyal)</option>
                <option value="OMR">OMR (Omani Rial)</option>
                <option value="QAR">QAR (Qatari Riyal)</option>
                <option value="EUR">EUR (Euro)</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Pricing Unit</label>
              <select
                value={unitType}
                onChange={(e) => setUnitType(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 text-slate-900 dark:text-white"
              >
                <option value="PER_TRIP">PER_TRIP</option>
                <option value="PER_HOUR">PER_HOUR</option>
                <option value="PER_KM">PER_KM</option>
                <option value="PER_DAY">PER_DAY</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Free Wait (Mins)</label>
              <input
                type="number"
                value={freeWaitingMinutes}
                onChange={(e) => setFreeWaitingMinutes(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 font-mono text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Wait Fee (AED/hr)</label>
              <input
                type="number"
                value={waitingFeePerHour}
                onChange={(e) => setWaitingFeePerHour(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 font-mono text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Cancel Penalty (%)</label>
              <input
                type="number"
                value={cancellationFeePct}
                onChange={(e) => setCancellationFeePct(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 font-mono text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Fuel Index (%)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="50"
                value={fuelSurchargePct}
                onChange={(e) => setFuelSurchargePct(e.target.value)}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 font-mono text-cyan-600 dark:text-cyan-400 font-bold"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create & Freeze Snapshot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
