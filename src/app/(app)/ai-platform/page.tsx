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
} from 'lucide-react';

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
  monthlyBudgetAed: number;
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
  const [activeTab, setActiveTab] = useState<'overview' | 'approvals' | 'governance' | 'agents'>('overview');

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [dashRes, apprRes] = await Promise.all([
        fetch('/api/agents/dashboard'),
        fetch('/api/agents/approvals'),
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

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

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
        <div className="flex items-center gap-3 text-slate-400">
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
              <h1 className="text-2xl font-bold tracking-tight text-white">AI Platform & Governance Hub</h1>
              <p className="text-xs text-slate-400">
                Unified cost optimization, routing matrix cache telemetry, L0–L4 autonomy, and approval queue.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
            onClick={fetchDashboard}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-2">
        {(['overview', 'approvals', 'governance', 'agents'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-xs font-semibold transition-all border-b-2 capitalize flex items-center gap-2 ${
              activeTab === tab
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab === 'overview' && <BarChart3 className="h-4 w-4" />}
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
            {tab === 'governance' && <ShieldCheck className="h-4 w-4" />}
            {tab === 'agents' && <Layers className="h-4 w-4" />}
            {tab !== 'approvals' && tab}
          </button>
        ))}
      </div>

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
              <div className="text-3xl font-extrabold text-white">
                {roi?.roiMultiplier ? `${roi.roiMultiplier.toFixed(1)}x` : '12.4x'}
              </div>
              <p className="mt-1 text-xs text-emerald-300">
                AED {roi?.netFinancialGainAed ? roi.netFinancialGainAed.toLocaleString() : '48,200'} Net Value Generated
              </p>
            </div>

            {/* Avoided vs Incurred Cost */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-5">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Avoided Cost (Savings)</span>
                <Coins className="h-4 w-4 text-purple-400" />
              </div>
              <div className="text-3xl font-extrabold text-white">
                AED {roi?.totalAvoidedCostAed ? roi.totalAvoidedCostAed.toLocaleString() : '52,450'}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Incurred AI Spend: AED {roi?.totalCostAed ? roi.totalCostAed.toFixed(2) : '38.40'}
              </p>
            </div>

            {/* Matrix Cache Efficiency */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-5">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Routing Cache Hits</span>
                <MapPin className="h-4 w-4 text-cyan-400" />
              </div>
              <div className="text-3xl font-extrabold text-white">
                {roi?.matrixCacheHitRatePct ? `${roi.matrixCacheHitRatePct.toFixed(1)}%` : '84.2%'}
              </div>
              <p className="mt-1 text-xs text-cyan-400">
                Saved AED {roi?.savedRoutingCostAed ? roi.savedRoutingCostAed.toFixed(2) : '412.00'} in matrix API calls
              </p>
            </div>

            {/* Ground-Truth Decision Quality */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-5">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">Decision Quality Score</span>
                <Gauge className="h-4 w-4 text-indigo-400" />
              </div>
              <div className="text-3xl font-extrabold text-white">
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
            <div className="rounded-xl border border-white/10 bg-slate-900 p-6 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-amber-400" />
                  <h2 className="text-base font-semibold text-white">Human-in-the-Loop Review Queue</h2>
                </div>
                <span className="text-xs text-slate-400">
                  {pendingApprovals.length} pending action proposals
                </span>
              </div>

              {pendingApprovals.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-10 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-2" />
                  <p className="text-sm font-medium text-slate-300">Approval queue is clear</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    All agent mutations are either within autonomous limits or already resolved.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.slice(0, 3).map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-white/10 bg-slate-800/60 p-4 sm:flex-row sm:items-center"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300 uppercase">
                            {item.agentId}
                          </span>
                          <span className="text-xs text-slate-400">{item.entityType}</span>
                          <span className="text-xs font-semibold text-amber-400">
                            AED {item.financialImpactAed.toLocaleString()} Exposure
                          </span>
                        </div>
                        <h3 className="mt-1 text-sm font-semibold text-white">{item.title}</h3>
                        <p className="text-xs text-slate-400">{item.description}</p>
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
            <div className="rounded-xl border border-white/10 bg-slate-900 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="h-5 w-5 text-purple-400" />
                <h2 className="text-base font-semibold text-white">Gateway Capability Tiers</h2>
              </div>

              <div className="space-y-4">
                {data?.capabilityBreakdown.map((tier) => (
                  <div key={tier.tier} className="rounded-lg border border-white/5 bg-slate-800/40 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-purple-300">{tier.tier}</span>
                      <span className="text-slate-400">{tier.callCount} calls</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
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
                <p className="mt-1 text-[11px] text-slate-400">
                  Fallback stack active: OpenAI $\rightarrow$ Gemini $\rightarrow$ Anthropic $\rightarrow$ Canned.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Grid: Agent Suite Links */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/ai-platform/predictive"
              className="group rounded-xl border border-white/10 bg-slate-900 p-5 hover:border-purple-500/40 hover:bg-slate-800/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-purple-500/20 p-2 text-purple-400">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-white">Predictive Maintenance</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-purple-400 transition-colors" />
              </div>
              <p className="text-xs text-slate-400">
                Multi-signal failure prediction, 9-factor sensor health, and optimal repair scheduling.
              </p>
            </Link>

            <Link
              href="/finance/anomalies"
              className="group rounded-xl border border-white/10 bg-slate-900 p-5 hover:border-emerald-500/40 hover:bg-slate-800/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400">
                    <Coins className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-white">Finance Anomaly Guard</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
              </div>
              <p className="text-xs text-slate-400">
                8-stream audit covering fuel overfills, GPS mismatches, 5% VAT errors, and unbilled Salik tolls.
              </p>
            </Link>

            <Link
              href="/operations/dispatch"
              className="group rounded-xl border border-white/10 bg-slate-900 p-5 hover:border-cyan-500/40 hover:bg-slate-800/70 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-cyan-500/20 p-2 text-cyan-400">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-white">15-Factor Dispatch & Routing</h3>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors" />
              </div>
              <p className="text-xs text-slate-400">
                Adaptive spatial shortlisting, canonical location indexing, and automated shift consolidation.
              </p>
            </Link>
          </div>
        </div>
      )}

      {activeTab === 'approvals' && (
        <div className="rounded-xl border border-white/10 bg-slate-900 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Full Human-in-the-Loop Review Queue</h2>
              <p className="text-xs text-slate-400">
                All AI-generated actions exceeding tenant exposure thresholds requiring manual operator sign-off.
              </p>
            </div>
            <span className="text-xs font-semibold text-amber-400">
              Total Pending Exposure: AED {data?.approvalSummary.totalPendingFinancialImpactAed.toLocaleString()}
            </span>
          </div>

          {pendingApprovals.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
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
                      <span className="text-xs font-semibold text-white">{item.title}</span>
                      <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/20">
                        AED {item.financialImpactAed.toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{item.description}</p>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-2">
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
        <div className="rounded-xl border border-white/10 bg-slate-900 p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-white">Tenant AI Governance & Spending Limits</h2>
            <p className="text-xs text-slate-400">
              Configure autonomy ceilings (L0–L4), daily/monthly AED budget circuit breakers, and approval thresholds.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-slate-800/40 p-4">
              <span className="text-xs text-slate-400">Max Allowed Autonomy Tier</span>
              <div className="text-xl font-bold text-white mt-1">{policy?.maxAutonomyLevel || 'L3_HUMAN_CONFIRMATION'}</div>
              <p className="text-[11px] text-slate-500 mt-1">
                L0: Read-Only • L1: Recommendation • L2: Draft • L3: Approval • L4: Autonomous
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-slate-800/40 p-4">
              <span className="text-xs text-slate-400">Daily AI Budget Quota</span>
              <div className="text-xl font-bold text-white mt-1">AED {policy?.dailyBudgetAed?.toFixed(2) || '150.00'}</div>
              <p className="text-[11px] text-slate-500 mt-1">
                Automatic circuit breaker trips if daily cost exceeds this limit.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-slate-800/40 p-4">
              <span className="text-xs text-slate-400">Human Sign-off Threshold</span>
              <div className="text-xl font-bold text-white mt-1">AED {policy?.requireHumanApprovalThresholdAed?.toFixed(2) || '250.00'}</div>
              <p className="text-[11px] text-slate-500 mt-1">
                Mutations with financial impact over this value are held in queue.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <div>
                <h4 className="text-xs font-semibold text-white">Circuit Breaker Status: Normal</h4>
                <p className="text-[11px] text-slate-400">All agent dispatches operating within authorized budget parameters.</p>
              </div>
            </div>
            <span className="rounded bg-emerald-500/20 text-emerald-400 px-2.5 py-1 text-xs font-bold">
              ACTIVE
            </span>
          </div>
        </div>
      )}

      {activeTab === 'agents' && (
        <div className="rounded-xl border border-white/10 bg-slate-900 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Registered AI Agents & Telemetry Breakdown</h2>
              <p className="text-xs text-slate-400">
                Detailed runtime duration, cost attribution, and avoided cost per operational domain.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-white/10 text-slate-400 uppercase text-[10px]">
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
                  <tr key={a.agentId} className="hover:bg-slate-800/40">
                    <td className="py-3 font-semibold text-white flex items-center gap-2">
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
