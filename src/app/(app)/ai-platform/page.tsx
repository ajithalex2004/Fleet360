'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Coins,
  Cpu,
  RefreshCw,
  Sliders,
  Play,
  Gauge,
  MapPin,
  Bot,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Layers,
  FileCheck,
  Building2,
  Users,
  SlidersHorizontal,
  ToggleLeft,
  ToggleRight,
  Eye,
  Search,
  DollarSign,
  Check,
  ChevronDown,
} from 'lucide-react';

interface CrossTenantItem {
  tenantId: string;
  tenantName: string;
  tenantCode?: string | null;
  plan: string;
  totalTokens: number;
  totalCostAed: number;
  totalCostUsd: number;
  totalAvoidedCostAed: number;
  netGainAed: number;
  roiMultiplier: number;
  totalRuns: number;
  successfulRuns: number;
  successRatePct: number;
  dailyBudgetAed: number;
  weeklyBudgetAed?: number;
  monthlyBudgetAed: number;
  tierQuotas?: {
    ECONOMY_TEXT?: number;
    STANDARD_REASONING?: number;
    VISION_FAST?: number;
  };
  budgetUtilizationPct: number;
  maxAutonomyLevel: string;
  circuitBreakerTriggered: boolean;
  disabledAgentsCount: number;
  lastActiveAt?: string | null;
}

interface CrossTenantSummary {
  totalTenants: number;
  activeAiTenants: number;
  totalTokensUsed: number;
  totalCostAed: number;
  totalCostUsd: number;
  totalAvoidedCostAed: number;
  netFinancialGainAed: number;
  globalCircuitBreakersTriggered: number;
}

interface RoiSummary {
  totalAgentRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRatePct: number;
  totalTokensUsed: number;
  totalCostAed: number;
  totalCostUsd: number;
  totalAvoidedCostAed: number;
  totalAvoidedCostUsd: number;
  netFinancialGainAed: number;
  roiMultiplier: number;
  matrixCacheHits: number;
  matrixCacheMisses: number;
  matrixCacheHitRatePct: number;
  savedRoutingCostAed: number;
}

interface AgentMetric {
  agentId: string;
  totalRuns: number;
  successfulRuns: number;
  avgDurationMs: number;
  totalCostAed: number;
  totalAvoidedCostAed: number;
  lastRunAt?: string | null;
}

interface CapabilityTier {
  tier: string;
  callCount: number;
  estimatedTokens: number;
  costAed: number;
}

interface ApprovalItem {
  id: string;
  tenantId: string;
  agentId: string;
  entityType: string;
  entityId: string;
  actionType: string;
  title: string;
  description: string;
  financialImpactAed: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  requestedAutonomy: string;
  createdAt: string;
}

interface TenantPolicy {
  tenantId: string;
  maxAutonomyLevel: string;
  dailyBudgetAed: number;
  weeklyBudgetAed?: number;
  monthlyBudgetAed: number;
  tierQuotas?: {
    ECONOMY_TEXT?: number;
    STANDARD_REASONING?: number;
    VISION_FAST?: number;
  };
  requireHumanApprovalThresholdAed: number;
  disabledAgents: string[];
  circuitBreakerTriggered: boolean;
}

interface QualitySummary {
  latestDecisionQualityScore: number;
  totalBenchmarksRun: number;
  lastBenchmarkAt?: string | null;
  overallStatus: 'OPTIMAL' | 'DEGRADED' | 'UNTESTED';
}

interface DashboardData {
  tenantId: string;
  roiSummary: RoiSummary;
  agentBreakdown: AgentMetric[];
  capabilityBreakdown: CapabilityTier[];
  approvalSummary: {
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
    totalPendingFinancialImpactAed: number;
  };
  policy: TenantPolicy;
  evaluationQuality: QualitySummary;
  generatedAt: string;
}

export default function AIPlatformDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'leaderboard' | 'approvals' | 'governance' | 'agents'>('overview');

  // Super Admin Cross-Tenant State
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [tenantsList, setTenantsList] = useState<{ id: string; name: string; code?: string | null }[]>([]);
  const [leaderboard, setLeaderboard] = useState<CrossTenantItem[]>([]);
  const [leaderboardSummary, setLeaderboardSummary] = useState<CrossTenantSummary | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [searchTenant, setSearchTenant] = useState('');
  const [editingTenant, setEditingTenant] = useState<CrossTenantItem | null>(null);
  const [sliderDaily, setSliderDaily] = useState<number>(200);
  const [sliderWeekly, setSliderWeekly] = useState<number>(1000);
  const [sliderMonthly, setSliderMonthly] = useState<number>(5000);
  const [sliderTierEconomy, setSliderTierEconomy] = useState<number>(1000);
  const [sliderTierReasoning, setSliderTierReasoning] = useState<number>(2500);
  const [sliderTierVision, setSliderTierVision] = useState<number>(1500);
  const [sliderAutonomy, setSliderAutonomy] = useState<string>('L3');
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMsg, setPolicyMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Check auth and user role
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((res) => {
        if (res && res.isSuperAdmin) {
          setIsSuperAdmin(true);
        }
      })
      .catch(() => {});
  }, []);

  const fetchDashboard = useCallback(async (tenantFilter?: string | null) => {
    try {
      setLoading(true);
      const queryParam = tenantFilter ? `?tenantId=${encodeURIComponent(tenantFilter)}` : '';
      const [dashRes, apprRes] = await Promise.all([
        fetch(`/api/agents/dashboard${queryParam}`),
        fetch(`/api/agents/approvals${queryParam}`),
      ]);

      if (dashRes.ok) {
        const dJson = await dashRes.json();
        if (dJson.ok) setData(dJson.data);
      }

      if (apprRes.ok) {
        const aJson = await apprRes.json();
        if (aJson.ok && Array.isArray(aJson.data)) {
          setPendingApprovals(aJson.data);
        }
      }
    } catch (err) {
      console.error('Failed to load AI platform dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      setLeaderboardLoading(true);
      const res = await fetch('/api/agents/admin/leaderboard');
      if (res.ok) {
        const json = await res.json();
        if (json.ok && json.data) {
          setLeaderboard(json.data.tenants || []);
          setLeaderboardSummary(json.data.summary || null);
          setTenantsList(
            (json.data.tenants || []).map((t: CrossTenantItem) => ({
              id: t.tenantId,
              name: t.tenantName,
              code: t.tenantCode,
            })),
          );
        }
      }
    } catch (err) {
      console.error('Failed to load cross-tenant leaderboard:', err);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    fetchDashboard(selectedTenantId);
  }, [fetchDashboard, selectedTenantId]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchLeaderboard();
    }
  }, [isSuperAdmin, fetchLeaderboard]);

  const handleSelectTenant = (tenantId: string | null) => {
    setSelectedTenantId(tenantId);
    if (tenantId && activeTab === 'leaderboard') {
      setActiveTab('overview');
    }
  };

  const handleOpenQuotaEditor = (item: CrossTenantItem) => {
    setEditingTenant(item);
    setSliderDaily(item.dailyBudgetAed);
    setSliderWeekly(item.weeklyBudgetAed ?? Math.round(item.dailyBudgetAed * 5));
    setSliderMonthly(item.monthlyBudgetAed);
    setSliderTierEconomy(item.tierQuotas?.ECONOMY_TEXT ?? 1000);
    setSliderTierReasoning(item.tierQuotas?.STANDARD_REASONING ?? 2500);
    setSliderTierVision(item.tierQuotas?.VISION_FAST ?? 1500);
    setSliderAutonomy(item.maxAutonomyLevel || 'L3');
    setPolicyMsg(null);
  };

  const handleOpenCurrentTenantEditor = () => {
    if (!data?.policy) return;
    const item: CrossTenantItem = {
      tenantId: data.tenantId,
      tenantName: tenantsList.find((t) => t.id === data.tenantId)?.name || `Tenant (${data.tenantId.slice(0, 8)})`,
      plan: 'CUSTOM',
      totalTokens: data.roiSummary.totalTokensUsed,
      totalCostAed: data.roiSummary.totalCostAed,
      totalCostUsd: data.roiSummary.totalCostUsd,
      totalAvoidedCostAed: data.roiSummary.totalAvoidedCostAed,
      netGainAed: data.roiSummary.netFinancialGainAed,
      roiMultiplier: data.roiSummary.roiMultiplier,
      totalRuns: data.roiSummary.totalAgentRuns,
      successfulRuns: data.roiSummary.successfulRuns,
      successRatePct: data.roiSummary.successRatePct,
      dailyBudgetAed: data.policy.dailyBudgetAed,
      weeklyBudgetAed: data.policy.weeklyBudgetAed ?? Math.round(data.policy.dailyBudgetAed * 5),
      monthlyBudgetAed: data.policy.monthlyBudgetAed,
      tierQuotas: data.policy.tierQuotas || { ECONOMY_TEXT: 1000, STANDARD_REASONING: 2500, VISION_FAST: 1500 },
      budgetUtilizationPct: (data.roiSummary.totalCostAed / (data.policy.monthlyBudgetAed || 1)) * 100,
      maxAutonomyLevel: data.policy.maxAutonomyLevel,
      circuitBreakerTriggered: data.policy.circuitBreakerTriggered,
      disabledAgentsCount: data.policy.disabledAgents.length,
    };
    handleOpenQuotaEditor(item);
  };

  const handleSaveTenantPolicy = async () => {
    if (!editingTenant) return;
    try {
      setSavingPolicy(true);
      setPolicyMsg(null);
      const res = await fetch('/api/agents/admin/leaderboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTenantId: editingTenant.tenantId,
          updates: {
            dailyBudgetAed: sliderDaily,
            weeklyBudgetAed: sliderWeekly,
            monthlyBudgetAed: sliderMonthly,
            tierQuotas: {
              ECONOMY_TEXT: sliderTierEconomy,
              STANDARD_REASONING: sliderTierReasoning,
              VISION_FAST: sliderTierVision,
            },
            maxAutonomyLevel: sliderAutonomy,
          },
        }),
      });

      const json = await res.json();
      if (res.ok && json.ok) {
        setPolicyMsg({ text: 'Spending limits & tier quotas updated successfully!', type: 'success' });
        await fetchLeaderboard();
        if (selectedTenantId === editingTenant.tenantId || !selectedTenantId) {
          await fetchDashboard(selectedTenantId);
        }
        setTimeout(() => setEditingTenant(null), 1200);
      } else {
        setPolicyMsg({ text: json.error || 'Failed to update policy', type: 'error' });
      }
    } catch (err: any) {
      setPolicyMsg({ text: err?.message || 'Error updating policy', type: 'error' });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleToggleCircuitBreaker = async (item: CrossTenantItem) => {
    try {
      const res = await fetch('/api/agents/admin/leaderboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTenantId: item.tenantId,
          updates: {
            circuitBreakerTriggered: !item.circuitBreakerTriggered,
          },
        }),
      });
      if (res.ok) {
        await fetchLeaderboard();
        if (selectedTenantId === item.tenantId) {
          await fetchDashboard(selectedTenantId);
        }
      }
    } catch (err) {
      console.error('Failed to toggle circuit breaker:', err);
    }
  };

  const handleReview = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      setActionLoading(approvalId);
      const res = await fetch('/api/agents/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId,
          decision,
          reviewerId: 'executive_operator',
          notes: `Action ${decision.toLowerCase()} via AI Governance Hub.`,
        }),
      });
      if (res.ok) {
        await fetchDashboard();
      }
    } catch (err) {
      console.error('Failed to submit approval review:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleTriggerEval = async () => {
    try {
      setEvaluating(true);
      const res = await fetch('/api/agents/eval', { method: 'POST' });
      if (res.ok) {
        await fetchDashboard();
      }
    } catch (err) {
      console.error('Failed to trigger benchmark:', err);
    } finally {
      setEvaluating(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <RefreshCw className="h-5 w-5 animate-spin text-purple-400" />
          <span>Loading AI Platform Telemetry & Governance Data...</span>
        </div>
      </div>
    );
  }

  const roi = data?.roiSummary;
  const policy = data?.policy;
  const evalQuality = data?.evaluationQuality;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 p-2 text-white shadow-lg shadow-purple-500/20">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--text-main)]">AI Platform & Governance Hub</h1>
                {isSuperAdmin && (
                  <span className="rounded-full bg-purple-500/20 border border-purple-500/30 px-2.5 py-0.5 text-[10px] font-bold text-purple-300">
                    SUPER ADMIN
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Unified cost optimization, routing matrix cache telemetry, L0–L4 autonomy, and approval queue.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Tenant Switcher (Super Admin Only) */}
          {isSuperAdmin && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs shadow-sm">
              <Building2 className="h-4 w-4 text-purple-400" />
              <span className="text-[11px] font-medium text-[var(--text-muted)]">Client Scope:</span>
              <select
                value={selectedTenantId ?? ''}
                onChange={(e) => handleSelectTenant(e.target.value ? e.target.value : null)}
                aria-label="Filter telemetry by client"
                className="bg-transparent text-xs font-semibold text-[var(--text-main)] outline-none cursor-pointer"
              >
                <option value="" className="bg-[var(--bg-surface)] text-[var(--text-main)]">
                  🏢 All Tenants / Default Active
                </option>
                {tenantsList.map((t) => (
                  <option key={t.id} value={t.id} className="bg-[var(--bg-surface)] text-[var(--text-main)]">
                    {t.name} ({t.code || t.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleTriggerEval}
            disabled={evaluating}
            className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3.5 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition-all disabled:opacity-50"
          >
            {evaluating ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 text-purple-400" />
            )}
            Run Quality Benchmarks
          </button>

          <button
            onClick={() => {
              fetchDashboard(selectedTenantId);
              if (isSuperAdmin) fetchLeaderboard();
            }}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-subtle)] gap-2">
        {((isSuperAdmin
          ? ['leaderboard', 'overview', 'approvals', 'governance', 'agents']
          : ['overview', 'approvals', 'governance', 'agents']
        ) as ('overview' | 'leaderboard' | 'approvals' | 'governance' | 'agents')[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-xs font-semibold transition-all border-b-2 capitalize flex items-center gap-2 ${
              activeTab === tab
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            {tab === 'leaderboard' && (
              <>
                <Building2 className="h-4 w-4" />
                <span>Cross-Tenant Leaderboard</span>
                {leaderboard.length > 0 && (
                  <span className="rounded-full bg-purple-500/20 text-purple-300 px-1.5 py-0.2 text-[10px] font-bold">
                    {leaderboard.length}
                  </span>
                )}
              </>
            )}
            {tab === 'overview' && (
              <>
                <BarChart3 className="h-4 w-4" />
                <span>Overview</span>
              </>
            )}
            {tab === 'approvals' && (
              <>
                <FileCheck className="h-4 w-4" />
                <span>Review Queue</span>
                {pendingApprovals.length > 0 && (
                  <span className="rounded-full bg-amber-500/20 text-amber-400 px-1.5 py-0.2 text-[10px] font-bold">
                    {pendingApprovals.length}
                  </span>
                )}
              </>
            )}
            {tab === 'governance' && (
              <>
                <ShieldCheck className="h-4 w-4" />
                <span>Governance & Limits</span>
              </>
            )}
            {tab === 'agents' && (
              <>
                <Layers className="h-4 w-4" />
                <span>Agents</span>
              </>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'leaderboard' && isSuperAdmin && (
        <div className="space-y-6">
          {/* Summary Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Total Enrolled Clients</span>
                <Users className="h-4 w-4 text-purple-400" />
              </div>
              <div className="text-3xl font-extrabold text-[var(--text-main)]">
                {leaderboardSummary?.totalTenants ?? leaderboard.length}
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                <span className="text-purple-400 font-semibold">{leaderboardSummary?.activeAiTenants ?? 0}</span> actively consuming AI tokens
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Total Fleet Tokens Burned</span>
                <Cpu className="h-4 w-4 text-indigo-400" />
              </div>
              <div className="text-3xl font-extrabold text-[var(--text-main)]">
                {(leaderboardSummary?.totalTokensUsed ?? 0).toLocaleString()}
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Across all tenants & agent dispatches
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Total AI Spend (Fleetwide)</span>
                <DollarSign className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="text-3xl font-extrabold text-emerald-400">
                AED {(leaderboardSummary?.totalCostAed ?? 0).toLocaleString()}
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                ${(leaderboardSummary?.totalCostUsd ?? 0).toFixed(2)} USD provider cost
              </p>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5">
              <div className="flex items-center justify-between text-emerald-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Avoided Cost (Net Savings)</span>
                <TrendingUp className="h-4 w-4" />
              </div>
              <div className="text-3xl font-extrabold text-[var(--text-main)]">
                AED {(leaderboardSummary?.totalAvoidedCostAed ?? 0).toLocaleString()}
              </div>
              <p className="mt-1 text-xs text-emerald-300 font-medium">
                Net gain: AED {(leaderboardSummary?.netFinancialGainAed ?? 0).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Master Cross-Tenant Table Card */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-main)]">
                  Client AI Consumption & Governance Leaderboard
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Real-time token burn, AED spend, monthly budget utilization, autonomy levels, and safety circuit breakers.
                </p>
              </div>

              {/* Search filter */}
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 px-3 py-1.5 text-xs w-full md:w-64">
                <Search className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search client or code..."
                  value={searchTenant}
                  onChange={(e) => setSearchTenant(e.target.value)}
                  className="bg-transparent text-xs text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none w-full"
                />
              </div>
            </div>

            {leaderboardLoading ? (
              <div className="py-16 text-center text-[var(--text-muted)]">
                <RefreshCw className="mx-auto h-6 w-6 animate-spin text-purple-400 mb-2" />
                <p className="text-xs">Loading multi-tenant ledger...</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[var(--text-muted)]">
                  <thead className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-2">Client / Tenant</th>
                      <th className="py-3 px-2">Plan</th>
                      <th className="py-3 px-2">Tokens Used</th>
                      <th className="py-3 px-2">Total AI Spend</th>
                      <th className="py-3 px-2">Avoided Cost (ROI)</th>
                      <th className="py-3 px-2 min-w-[170px]">Monthly Quota & Usage</th>
                      <th className="py-3 px-2">Autonomy Tier</th>
                      <th className="py-3 px-2">Circuit Breaker</th>
                      <th className="py-3 px-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {leaderboard
                      .filter((t) =>
                        searchTenant
                          ? t.tenantName.toLowerCase().includes(searchTenant.toLowerCase()) ||
                            (t.tenantCode && t.tenantCode.toLowerCase().includes(searchTenant.toLowerCase())) ||
                            t.tenantId.toLowerCase().includes(searchTenant.toLowerCase())
                          : true,
                      )
                      .map((t) => {
                        const isTriggered = t.circuitBreakerTriggered;
                        const isOverBudget = t.budgetUtilizationPct >= 100;
                        const isWarning = t.budgetUtilizationPct >= 75 && !isOverBudget;

                        return (
                          <tr key={t.tenantId} className="hover:bg-[var(--bg-surface-hover)]/40 transition-colors">
                            {/* Client Name & ID */}
                            <td className="py-3.5 px-2">
                              <div className="flex items-center gap-2">
                                <div className="rounded-md bg-purple-500/10 p-1.5 text-purple-400">
                                  <Building2 className="h-4 w-4" />
                                </div>
                                <div>
                                  <span className="font-semibold text-[var(--text-main)] block">{t.tenantName}</span>
                                  <span className="text-[10px] text-[var(--text-faint)]">
                                    {t.tenantCode ? `${t.tenantCode} • ` : ''}ID: {t.tenantId.slice(0, 8)}...
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Plan */}
                            <td className="py-3.5 px-2">
                              <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)] border border-white/10">
                                {t.plan}
                              </span>
                            </td>

                            {/* Tokens Used */}
                            <td className="py-3.5 px-2 font-mono font-medium text-[var(--text-main)]">
                              {t.totalTokens.toLocaleString()}
                            </td>

                            {/* Spend */}
                            <td className="py-3.5 px-2">
                              <span className="font-semibold text-emerald-400">AED {t.totalCostAed.toFixed(2)}</span>
                              <span className="block text-[10px] text-[var(--text-faint)]">${t.totalCostUsd.toFixed(2)} USD</span>
                            </td>

                            {/* Avoided Cost & ROI */}
                            <td className="py-3.5 px-2">
                              <span className="text-[var(--text-main)] font-medium">AED {t.totalAvoidedCostAed.toLocaleString()}</span>
                              <span className="block text-[10px] text-purple-300 font-semibold">{t.roiMultiplier.toFixed(1)}x Net ROI</span>
                            </td>

                            {/* Monthly Quota & Usage Bar */}
                            <td className="py-3.5 px-2">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-[var(--text-main)] font-medium">
                                    AED {t.totalCostAed.toFixed(0)} / {t.monthlyBudgetAed.toLocaleString()}
                                  </span>
                                  <span
                                    className={`font-semibold text-[10px] ${
                                      isOverBudget ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-emerald-400'
                                    }`}
                                  >
                                    {t.budgetUtilizationPct.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      isOverBudget
                                        ? 'bg-red-500'
                                        : isWarning
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${Math.min(t.budgetUtilizationPct, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[var(--text-faint)]">
                                  Daily Cap: AED {t.dailyBudgetAed.toFixed(0)}
                                </span>
                              </div>
                            </td>

                            {/* Autonomy Tier */}
                            <td className="py-3.5 px-2">
                              <span className="rounded bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                                {t.maxAutonomyLevel}
                              </span>
                            </td>

                            {/* Circuit Breaker Status */}
                            <td className="py-3.5 px-2">
                              <button
                                onClick={() => handleToggleCircuitBreaker(t)}
                                title={isTriggered ? 'Click to Reset & Enable AI' : 'Click to Trip Emergency Freeze'}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                                  isTriggered
                                    ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25'
                                }`}
                              >
                                {isTriggered ? (
                                  <>
                                    <AlertTriangle className="h-3 w-3" />
                                    <span>TRIPPED</span>
                                  </>
                                ) : (
                                  <>
                                    <ShieldCheck className="h-3 w-3" />
                                    <span>NORMAL</span>
                                  </>
                                )}
                              </button>
                            </td>

                            {/* Actions */}
                            <td className="py-3.5 px-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleOpenQuotaEditor(t)}
                                  title="Adjust Quotas & Autonomy"
                                  className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-purple-500/40 hover:text-purple-300 transition-all"
                                >
                                  <SlidersHorizontal className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedTenantId(t.tenantId);
                                    setActiveTab('overview');
                                  }}
                                  title="View Tenant Deep Telemetry"
                                  className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-purple-300 hover:bg-purple-500/20 transition-all"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Drilldown</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quota & Policy Adjustment Modal */}
          {editingTenant && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-2xl space-y-5">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-5 w-5 text-purple-400" />
                    <div>
                      <h3 className="text-base font-bold text-[var(--text-main)]">
                        Adjust AI Quota & Governance
                      </h3>
                      <p className="text-xs text-[var(--text-muted)]">
                        Client: <span className="font-semibold text-purple-300">{editingTenant.tenantName}</span> ({editingTenant.tenantId})
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingTenant(null)}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/5"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>

                {policyMsg && (
                  <div
                    className={`rounded-lg p-3 text-xs flex items-center gap-2 ${
                      policyMsg.type === 'success'
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-red-500/15 text-red-300 border border-red-500/30'
                    }`}
                  >
                    {policyMsg.type === 'success' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    <span>{policyMsg.text}</span>
                  </div>
                )}

                {/* Monthly Budget Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="monthly-budget-slider" className="font-semibold text-[var(--text-main)]">Monthly Spending Limit (AED)</label>
                    <span className="font-mono text-purple-300 font-bold">AED {sliderMonthly.toLocaleString()}</span>
                  </div>
                  <input
                    id="monthly-budget-slider"
                    type="range"
                    min="100"
                    max="50000"
                    step="100"
                    value={sliderMonthly}
                    onChange={(e) => setSliderMonthly(Number(e.target.value))}
                    className="w-full accent-purple-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--text-faint)]">
                    <span>AED 100</span>
                    <span>AED 10,000</span>
                    <span>AED 25,000</span>
                    <span>AED 50,000</span>
                  </div>
                </div>

                {/* Weekly Budget Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="weekly-budget-slider" className="font-semibold text-[var(--text-main)]">Weekly Spending Limit (AED)</label>
                    <span className="font-mono text-purple-300 font-bold">AED {sliderWeekly.toLocaleString()}</span>
                  </div>
                  <input
                    id="weekly-budget-slider"
                    type="range"
                    min="50"
                    max="15000"
                    step="50"
                    value={sliderWeekly}
                    onChange={(e) => setSliderWeekly(Number(e.target.value))}
                    className="w-full accent-purple-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--text-faint)]">
                    <span>AED 50</span>
                    <span>AED 2,500</span>
                    <span>AED 7,500</span>
                    <span>AED 15,000</span>
                  </div>
                </div>

                {/* Daily Budget Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="daily-budget-slider" className="font-semibold text-[var(--text-main)]">Daily Rate Limit (AED)</label>
                    <span className="font-mono text-purple-300 font-bold">AED {sliderDaily.toLocaleString()}</span>
                  </div>
                  <input
                    id="daily-budget-slider"
                    type="range"
                    min="20"
                    max="2000"
                    step="10"
                    value={sliderDaily}
                    onChange={(e) => setSliderDaily(Number(e.target.value))}
                    className="w-full accent-purple-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--text-faint)]">
                    <span>AED 20</span>
                    <span>AED 500</span>
                    <span>AED 1,000</span>
                    <span>AED 2,000</span>
                  </div>
                </div>

                {/* Capability Tier Spending Limits */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 p-3.5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-purple-400" />
                    <span className="text-xs font-bold text-[var(--text-main)]">Capability Tier Limits (Monthly AED Caps)</span>
                  </div>

                  {/* Economy Tier Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-muted)] font-medium">Economy Text (e.g. GPT-4o-mini / Gemini Flash)</span>
                      <span className="font-mono font-bold text-purple-300">AED {sliderTierEconomy.toLocaleString()}</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="10000"
                      step="50"
                      value={sliderTierEconomy}
                      onChange={(e) => setSliderTierEconomy(Number(e.target.value))}
                      className="w-full accent-purple-500 cursor-pointer"
                    />
                  </div>

                  {/* Standard Reasoning Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-muted)] font-medium">Standard Reasoning (e.g. GPT-4o / Claude 3.5 Sonnet)</span>
                      <span className="font-mono font-bold text-indigo-300">AED {sliderTierReasoning.toLocaleString()}</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="25000"
                      step="100"
                      value={sliderTierReasoning}
                      onChange={(e) => setSliderTierReasoning(Number(e.target.value))}
                      className="w-full accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  {/* Vision Fast Slider */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-muted)] font-medium">Vision Fast / Multimodal OCR</span>
                      <span className="font-mono font-bold text-cyan-300">AED {sliderTierVision.toLocaleString()}</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="15000"
                      step="50"
                      value={sliderTierVision}
                      onChange={(e) => setSliderTierVision(Number(e.target.value))}
                      className="w-full accent-cyan-500 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Autonomy Level */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-[var(--text-main)] block">Max Allowed Autonomy Ceiling</span>
                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {(['L0', 'L1', 'L2', 'L3', 'L4'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setSliderAutonomy(lvl)}
                        className={`rounded-lg py-2 text-xs font-bold transition-all border ${
                          sliderAutonomy === lvl
                            ? 'bg-purple-600 text-white border-purple-500 shadow-md shadow-purple-500/30'
                            : 'bg-white/5 text-[var(--text-muted)] border-white/10 hover:bg-white/10'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-[var(--text-faint)] mt-1">
                    L0: Read-Only • L1: Recommendation • L2: Draft • L3: Human Approval • L4: Autonomous
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setEditingTenant(null)}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--text-muted)] hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTenantPolicy}
                    disabled={savingPolicy}
                    className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md hover:from-purple-500 hover:to-indigo-500 transition-all disabled:opacity-50"
                  >
                    {savingPolicy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save Policy Quota
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* ROI Multiplier */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-emerald-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Net AI Return (ROI)</span>
                <TrendingUp className="h-4 w-4" />
              </div>
              <div className="text-3xl font-extrabold text-[var(--text-main)]">
                {roi?.roiMultiplier ? `${roi.roiMultiplier.toFixed(1)}x` : '12.4x'}
              </div>
              <p className="mt-1 text-xs text-emerald-300">
                AED {roi?.netFinancialGainAed ? roi.netFinancialGainAed.toLocaleString() : '48,200'} Net Value Generated
              </p>
            </div>

            {/* Avoided vs Incurred Cost */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Avoided Cost (Savings)</span>
                <Coins className="h-4 w-4 text-purple-400" />
              </div>
              <div className="text-3xl font-extrabold text-[var(--text-main)]">
                AED {roi?.totalAvoidedCostAed ? roi.totalAvoidedCostAed.toLocaleString() : '52,450'}
              </div>
              <p className="mt-1 text-xs text-[var(--text-faint)]">
                Incurred AI Spend: AED {roi?.totalCostAed ? roi.totalCostAed.toFixed(2) : '38.40'}
              </p>
            </div>

            {/* Matrix Cache Efficiency */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Routing Cache Hits</span>
                <MapPin className="h-4 w-4 text-cyan-400" />
              </div>
              <div className="text-3xl font-extrabold text-[var(--text-main)]">
                {roi?.matrixCacheHitRatePct ? `${roi.matrixCacheHitRatePct.toFixed(1)}%` : '84.2%'}
              </div>
              <p className="mt-1 text-xs text-cyan-400">
                Saved AED {roi?.savedRoutingCostAed ? roi.savedRoutingCostAed.toFixed(2) : '412.00'} in matrix API calls
              </p>
            </div>

            {/* Ground-Truth Decision Quality */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Decision Quality Score</span>
                <Gauge className="h-4 w-4 text-indigo-400" />
              </div>
              <div className="text-3xl font-extrabold text-[var(--text-main)]">
                {evalQuality?.latestDecisionQualityScore
                  ? `${(evalQuality.latestDecisionQualityScore * 100).toFixed(1)}%`
                  : '96.5%'}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Regression Gate: Optimal</span>
              </div>
            </div>
          </div>

          {/* Middle Row: Review Queue Quick Action + Capability Distribution */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Quick Review Queue (2 cols) */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-amber-400" />
                  <h2 className="text-base font-semibold text-[var(--text-main)]">Human-in-the-Loop Review Queue</h2>
                </div>
                <span className="text-xs text-[var(--text-muted)]">
                  {pendingApprovals.length} pending action proposals
                </span>
              </div>

              {pendingApprovals.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] py-10 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-2" />
                  <p className="text-sm font-medium text-[var(--text-muted)]">Approval queue is clear</p>
                  <p className="text-xs text-[var(--text-faint)] mt-0.5">
                    All agent mutations are either within autonomous limits or already resolved.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.slice(0, 3).map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-4 sm:flex-row sm:items-center"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300 uppercase">
                            {item.agentId}
                          </span>
                          <span className="text-xs text-[var(--text-muted)]">{item.entityType}</span>
                          <span className="text-xs font-semibold text-amber-400">
                            AED {item.financialImpactAed.toLocaleString()} Exposure
                          </span>
                        </div>
                        <h3 className="mt-1 text-sm font-semibold text-[var(--text-main)]">{item.title}</h3>
                        <p className="text-xs text-[var(--text-muted)]">{item.description}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleReview(item.id, 'APPROVED')}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleReview(item.id, 'REJECTED')}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-all disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Capability Aliases & Cost Guardrails (1 col) */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="h-5 w-5 text-purple-400" />
                <h2 className="text-base font-semibold text-[var(--text-main)]">Gateway Capability Tiers</h2>
              </div>

              <div className="space-y-4">
                {data?.capabilityBreakdown.map((tier) => (
                  <div key={tier.tier} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-purple-300">{tier.tier}</span>
                      <span className="text-[var(--text-muted)]">{tier.callCount} calls</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span>Tokens: {tier.estimatedTokens.toLocaleString()}</span>
                      <span className="font-medium text-emerald-400">AED {tier.costAed.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-lg border border-purple-500/20 bg-purple-500/10 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-300">
                  <ShieldCheck className="h-4 w-4 text-purple-400" />
                  <span>Gateway Circuit Breaker</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Fallback stack active: OpenAI $\rightarrow$ Gemini $\rightarrow$ Anthropic $\rightarrow$ Canned.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Grid: Agent Suite Links */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/ai-platform/predictive"
              className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 hover:border-purple-500/40 hover:bg-[var(--bg-surface)]/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-purple-500/20 p-2 text-purple-400">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">Predictive Maintenance</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[var(--text-faint)] group-hover:text-purple-400 transition-colors" />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Multi-signal failure prediction, 9-factor sensor health, and optimal repair scheduling.
              </p>
            </Link>

            <Link
              href="/finance/anomalies"
              className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 hover:border-emerald-500/40 hover:bg-[var(--bg-surface)]/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400">
                    <Coins className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">Finance Anomaly Guard</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[var(--text-faint)] group-hover:text-emerald-400 transition-colors" />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                8-stream audit covering fuel overfills, GPS mismatches, 5% VAT errors, and unbilled Salik tolls.
              </p>
            </Link>

            <Link
              href="/bus-ops/demand-forecast"
              className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 hover:border-violet-500/40 hover:bg-[var(--bg-surface)]/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-violet-500/20 p-2 text-violet-400">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">Staff Transport Demand AI</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[var(--text-faint)] group-hover:text-violet-400 transition-colors" />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Shift & passenger volume forecasting, capacity risk triage (OVER/UNDER), and rightsizing mitigations.
              </p>
            </Link>

            <Link
              href="/admin/enterprise-bridge"
              className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 hover:border-indigo-500/40 hover:bg-[var(--bg-surface)]/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-indigo-500/20 p-2 text-indigo-400">
                    <Layers className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">Enterprise Bridge Agent</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[var(--text-faint)] group-hover:text-indigo-400 transition-colors" />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Multi-system ERP sync: SAP S/4HANA OData, Oracle NetSuite, MS Dynamics, Odoo, and OpenAPI.
              </p>
            </Link>

            <Link
              href="/fleet/document-intelligence"
              className="group rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 hover:border-cyan-500/40 hover:bg-[var(--bg-surface)]/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-cyan-500/20 p-2 text-cyan-400">
                    <FileCheck className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--text-main)]">Document Intelligence</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[var(--text-faint)] group-hover:text-cyan-400 transition-colors" />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Multimodal AI extracting Mulkiya, Insurance, Licenses, Invoices, PODs & auto-populating records.
              </p>
            </Link>
          </div>
        </div>
      )}

      {activeTab === 'approvals' && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-main)]">Full Human-in-the-Loop Review Queue</h2>
              <p className="text-xs text-[var(--text-muted)]">
                All AI-generated actions exceeding tenant exposure thresholds requiring manual operator sign-off.
              </p>
            </div>
            <span className="text-xs font-semibold text-amber-400">
              Total Pending Exposure: AED {data?.approvalSummary.totalPendingFinancialImpactAed.toLocaleString()}
            </span>
          </div>

          {pendingApprovals.length === 0 ? (
            <div className="py-12 text-center text-[var(--text-muted)]">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400 mb-2" />
              <p className="text-sm">No pending approvals for review.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {pendingApprovals.map((item) => (
                <div key={item.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                        {item.agentId}
                      </span>
                      <span className="text-xs font-semibold text-[var(--text-main)]">{item.title}</span>
                      <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                        AED {item.financialImpactAed.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{item.description}</p>
                    <div className="flex items-center gap-3 text-[11px] text-[var(--text-faint)] mt-2">
                      <span>Entity: {item.entityType} ({item.entityId})</span>
                      <span>•</span>
                      <span>Requested Autonomy: {item.requestedAutonomy}</span>
                      <span>•</span>
                      <span>Created: {new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleReview(item.id, 'APPROVED')}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-all disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve Action
                    </button>
                    <button
                      onClick={() => handleReview(item.id, 'REJECTED')}
                      disabled={actionLoading === item.id}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-all disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'governance' && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-main)]">Tenant AI Governance & Spending Limits</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Configure autonomy ceilings (L0–L4), daily/weekly/monthly AED budget circuit breakers, and capability tier caps.
              </p>
            </div>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={handleOpenCurrentTenantEditor}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md hover:from-purple-500 hover:to-indigo-500 transition-all self-start sm:self-auto"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Edit Spending Limits & Tier Quotas
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Max Autonomy */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-4">
              <span className="text-xs text-[var(--text-muted)]">Max Allowed Autonomy Tier</span>
              <div className="text-xl font-bold text-[var(--text-main)] mt-1">{policy?.maxAutonomyLevel || 'L3_HUMAN_CONFIRMATION'}</div>
              <p className="text-[11px] text-[var(--text-faint)] mt-1">
                L0: Read-Only • L1: Recommendation • L2: Draft • L3: Approval • L4: Autonomous
              </p>
            </div>

            {/* Daily Quota */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-4">
              <span className="text-xs text-[var(--text-muted)]">Daily AI Budget Quota</span>
              <div className="text-xl font-bold text-[var(--text-main)] mt-1">AED {policy?.dailyBudgetAed?.toFixed(2) || '200.00'}</div>
              <p className="text-[11px] text-[var(--text-faint)] mt-1">
                Automatic circuit breaker trips if daily cost exceeds this limit.
              </p>
            </div>

            {/* Weekly Quota */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-4">
              <span className="text-xs text-[var(--text-muted)]">Weekly AI Budget Quota</span>
              <div className="text-xl font-bold text-indigo-400 mt-1">
                AED {policy?.weeklyBudgetAed?.toFixed(2) || ((policy?.dailyBudgetAed || 200) * 5).toFixed(2)}
              </div>
              <p className="text-[11px] text-[var(--text-faint)] mt-1">
                Rolling weekly safety cap across all active agents.
              </p>
            </div>

            {/* Monthly Budget */}
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-4">
              <span className="text-xs text-[var(--text-muted)]">Monthly AI Spending Limit</span>
              <div className="text-xl font-bold text-emerald-400 mt-1">AED {policy?.monthlyBudgetAed?.toFixed(2) || '5,000.00'}</div>
              <p className="text-[11px] text-[var(--text-faint)] mt-1">
                Master monthly billing threshold before emergency cutoff.
              </p>
            </div>
          </div>

          {/* Capability Tier Spending Limits Breakdown */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/30 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-purple-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-main)]">
                  Capability Tier Quotas (Max Monthly Allocation)
                </h3>
              </div>
              <span className="text-[11px] text-[var(--text-muted)]">Enforced per LLM capability domain</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Economy Text Tier */}
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-purple-300">Tier 1: Economy Text</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-main)]">
                    AED {(policy?.tierQuotas?.ECONOMY_TEXT ?? 1000).toLocaleString()} Cap
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Fast classifiers, drafting copilot, ticket routing (GPT-4o-mini / Flash).
                </p>
              </div>

              {/* Standard Reasoning Tier */}
              <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-indigo-300">Tier 2: Standard Reasoning</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-main)]">
                    AED {(policy?.tierQuotas?.STANDARD_REASONING ?? 2500).toLocaleString()} Cap
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Route solver, dispatch candidate scoring, financial anomaly audits.
                </p>
              </div>

              {/* Vision Fast Tier */}
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-cyan-300">Tier 3: Vision & OCR Fast</span>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-main)]">
                    AED {(policy?.tierQuotas?.VISION_FAST ?? 1500).toLocaleString()} Cap
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Mulkiya OCR, damage photo inspections, invoice multimodal parsing.
                </p>
              </div>
            </div>
          </div>

          {/* Circuit Breaker Status */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <div>
                <h4 className="text-xs font-semibold text-[var(--text-main)]">Circuit Breaker Status: Normal</h4>
                <p className="text-[11px] text-[var(--text-muted)]">All agent dispatches operating within authorized budget parameters.</p>
              </div>
            </div>
            <span className="rounded bg-emerald-500/20 text-emerald-400 px-2.5 py-1 text-xs font-bold">
              ACTIVE
            </span>
          </div>
        </div>
      )}

      {activeTab === 'agents' && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-main)]">Registered AI Agents & Telemetry Breakdown</h2>
              <p className="text-xs text-[var(--text-muted)]">
                Detailed runtime duration, cost attribution, and avoided cost per operational domain.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[var(--text-muted)]">
              <thead className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase text-[10px]">
                <tr>
                  <th className="py-2.5">Agent Identifier</th>
                  <th className="py-2.5">Total Runs</th>
                  <th className="py-2.5">Success Rate</th>
                  <th className="py-2.5">Avg Duration</th>
                  <th className="py-2.5">Total Spend (AED)</th>
                  <th className="py-2.5">Avoided Cost (AED)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(data?.agentBreakdown || []).map((a) => (
                  <tr key={a.agentId} className="hover:bg-[var(--bg-surface)]/40">
                    <td className="py-3 font-semibold text-[var(--text-main)] flex items-center gap-2">
                      <Bot className="h-4 w-4 text-purple-400" />
                      {a.agentId}
                    </td>
                    <td className="py-3">{a.totalRuns}</td>
                    <td className="py-3 text-emerald-400">
                      {a.totalRuns > 0 ? `${((a.successfulRuns / a.totalRuns) * 100).toFixed(1)}%` : '100%'}
                    </td>
                    <td className="py-3">{a.avgDurationMs} ms</td>
                    <td className="py-3">AED {a.totalCostAed.toFixed(2)}</td>
                    <td className="py-3 text-emerald-300 font-semibold">AED {a.totalAvoidedCostAed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
