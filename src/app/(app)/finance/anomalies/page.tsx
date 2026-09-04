'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────
type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type FlagStatus = 'OPEN' | 'REVIEWED' | 'FALSE_POSITIVE' | 'CONFIRMED_ISSUE';
type StreamType =
  | 'ALL'
  | 'MAINTENANCE'
  | 'FUEL'
  | 'VENDOR_INVOICE'
  | 'PARTNER_SETTLEMENT'
  | 'DRIVER_EXPENSE'
  | 'TRIP_COST'
  | 'CONTRACT'
  | 'PROCUREMENT';

interface ActionRecommendation {
  actionType: string;
  title: string;
  description: string;
  financialRecoveryAed?: number;
}

interface AnomalyFlag {
  id: string;
  detectorId: string;
  entityType: string;
  entityId: string;
  streamType?: string;
  severity: Severity;
  confidence: number;
  explanation: string;
  amount?: number;
  currency?: string;
  expectedValue?: string;
  actualValue?: string;
  variancePercentage?: number;
  likelyCause?: string;
  financialExposureAed?: number;
  recommendedAction?: ActionRecommendation;
  status: FlagStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  actionTaken?: string;
  createdAt: string;
}

interface OpenCounts {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const SEV_CFG: Record<Severity, { color: string; bg: string; border: string; label: string; icon: string }> = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  label: 'Critical', icon: '🚨' },
  HIGH:     { color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.3)', label: 'High',     icon: '⚠️' },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', label: 'Medium',   icon: '🟡' },
  LOW:      { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)',  label: 'Low',      icon: 'ℹ️' },
};

const STREAM_TABS: { id: StreamType; label: string; icon: string }[] = [
  { id: 'ALL',                label: 'All Streams',          icon: '🌐' },
  { id: 'MAINTENANCE',        label: 'Maintenance & Garage', icon: '🔧' },
  { id: 'FUEL',               label: 'Fuel & Telematics',    icon: '⛽' },
  { id: 'VENDOR_INVOICE',     label: 'Vendor Invoices & VAT',icon: '🧾' },
  { id: 'PARTNER_SETTLEMENT', label: 'Spot Exchange & Subs', icon: '🤝' },
  { id: 'DRIVER_EXPENSE',     label: 'Driver Expenses',      icon: '👨‍✈️' },
  { id: 'TRIP_COST',          label: 'Trip Costs & Tolls',   icon: '🛣️' },
  { id: 'CONTRACT',           label: 'Contracts & Leasing',  icon: '📄' },
  { id: 'PROCUREMENT',        label: 'Procurement & POs',    icon: '📦' },
];

const STATUS_CFG: Record<FlagStatus, { label: string; color: string; bg: string }> = {
  OPEN:             { label: 'Open',              color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
  REVIEWED:         { label: 'Reviewed',          color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  FALSE_POSITIVE:   { label: 'False Positive',    color: '#64748b', bg: 'rgba(100,116,139,0.12)'},
  CONFIRMED_ISSUE:  { label: 'Resolved / Actioned',color: '#10b981', bg: 'rgba(16,185,129,0.12)'},
};

// ── Confidence Bar ─────────────────────────────────────────────────────────────
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const col = pct >= 85 ? '#ef4444' : pct >= 70 ? '#f97316' : pct >= 55 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color: col }}>{pct}%</span>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function FinanceAnomaliesPage() {
  const [flags,          setFlags]          = useState<AnomalyFlag[]>([]);
  const [total,          setTotal]          = useState(0);
  const [openCounts,     setOpenCounts]     = useState<OpenCounts>({});
  const [streamCounts,   setStreamCounts]   = useState<Record<string, { count: number; exposure: number }>>({});
  const [totalExposure,  setTotalExposure]  = useState(0);
  const [loading,        setLoading]        = useState(true);
  const [running,        setRunning]        = useState(false);
  const [actionLoading,  setActionLoading]  = useState<string | null>(null);
  const [error,          setError]          = useState<string | null>(null);
  const [filterSev,      setFilterSev]      = useState('');
  const [filterStream,   setFilterStream]   = useState<StreamType>('ALL');
  const [filterStatus,   setFilterStatus]   = useState('OPEN');
  const [selectedFlag,   setSelectedFlag]   = useState<AnomalyFlag | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filterSev)                  params.set('severity',    filterSev);
      if (filterStream !== 'ALL')     params.set('stream_type', filterStream);
      if (filterStatus)               params.set('status',      filterStatus);

      const res = await fetch(`/api/agents/anomalies?${params}`);
      if (!res.ok) throw new Error('Failed to load anomalies');
      const d = await res.json();
      setFlags(Array.isArray(d.data) ? d.data : []);
      setTotal(d.total ?? 0);
      setOpenCounts(d.openCounts ?? {});
      setStreamCounts(d.streamCounts ?? {});
      setTotalExposure(d.totalExposureAed ?? 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filterSev, filterStream, filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function handleRunAudit() {
    setRunning(true);
    try {
      await fetch('/api/agents/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: 'finance-anomaly', event_type: 'manual.trigger' }),
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  async function handleExecuteAction(flag: AnomalyFlag, actionType: string, actionNote?: string) {
    setActionLoading(`${flag.id}-${actionType}`);
    try {
      const res = await fetch('/api/agents/anomalies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: flag.id,
          actionType,
          actionNote: actionNote ?? flag.recommendedAction?.description,
          status: actionType === 'DISMISS' ? 'FALSE_POSITIVE' : 'CONFIRMED_ISSUE',
          reviewedBy: 'Finance Controller',
        }),
      });
      if (res.ok) {
        await load();
        if (selectedFlag?.id === flag.id) setSelectedFlag(null);
      }
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
              💰 Finance Anomaly Control Layer
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Expected vs Actual Intelligence
            </span>
          </div>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            Cross-stream auditing for maintenance overbilling, fuel theft, rate card breaches, ghost trips, and revenue leakage.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleRunAudit}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600/30 to-violet-600/30 border border-indigo-500/30 text-indigo-300 text-sm font-semibold hover:from-indigo-600/40 hover:to-violet-600/40 transition-all disabled:opacity-50"
          >
            {running ? '🤖 Auditing Transactions…' : '🤖 Run AI Financial Audit'}
          </button>
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-sm hover:bg-[var(--bg-surface-elevated)] transition-all"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--bg-surface)] border border-rose-500/20 rounded-2xl p-4 space-y-1">
          <span className="text-xs text-rose-400 font-medium">Financial Exposure at Risk</span>
          <p className="text-2xl font-extrabold text-rose-400 tabular-nums">
            AED {totalExposure.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <span className="text-[11px] text-[var(--text-muted)]">Identified overbilling & leakage</span>
        </div>

        <div className="bg-[var(--bg-surface)] border border-red-500/20 rounded-2xl p-4 space-y-1">
          <span className="text-xs text-red-400 font-medium">Critical Issues</span>
          <p className="text-2xl font-extrabold text-red-400 tabular-nums">
            {openCounts.critical ?? 0}
          </p>
          <span className="text-[11px] text-[var(--text-muted)]">Immediate action required</span>
        </div>

        <div className="bg-[var(--bg-surface)] border border-amber-500/20 rounded-2xl p-4 space-y-1">
          <span className="text-xs text-amber-400 font-medium">High / Medium Alerts</span>
          <p className="text-2xl font-extrabold text-amber-400 tabular-nums">
            {(openCounts.high ?? 0) + (openCounts.medium ?? 0)}
          </p>
          <span className="text-[11px] text-[var(--text-muted)]">Under policy review</span>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-4 space-y-1">
          <span className="text-xs text-[var(--text-muted)] font-medium">Total Open Anomalies</span>
          <p className="text-2xl font-extrabold text-[var(--text-main)] tabular-nums">{total}</p>
          <span className="text-[11px] text-[var(--text-muted)]">Across 8 operational streams</span>
        </div>
      </div>

      {/* 8-Stream Navigation Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {STREAM_TABS.map((tab) => {
          const countInfo = tab.id === 'ALL' ? total : (streamCounts[tab.id]?.count ?? 0);
          const isSelected = filterStream === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setFilterStream(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                  : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {countInfo > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-[var(--bg-surface-hover)] text-indigo-400 border border-indigo-500/20'
                }`}>
                  {countInfo}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Status & Severity Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--text-muted)] font-medium ml-1">Status:</span>
          {(['OPEN', 'CONFIRMED_ISSUE', 'FALSE_POSITIVE', 'ALL'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                filterStatus === st
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]'
              }`}
            >
              {st.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] font-medium">Severity:</span>
          <select
            value={filterSev}
            onChange={(e) => setFilterSev(e.target.value)}
            className="bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-2.5 py-1 text-xs text-[var(--text-main)] focus:outline-none"
          >
            <option value="">All Severities</option>
            <option value="CRITICAL">🚨 Critical</option>
            <option value="HIGH">⚠️ High</option>
            <option value="MEDIUM">🟡 Medium</option>
            <option value="LOW">ℹ️ Low</option>
          </select>
        </div>
      </div>

      {/* Anomalies List Table */}
      <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-[var(--text-faint)] text-sm">
            Auditing financial streams…
          </div>
        ) : flags.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <span className="text-3xl">✨</span>
            <p className="text-[var(--text-muted)] text-sm font-medium">No financial anomalies match the current filters</p>
            <p className="text-[var(--text-faint)] text-xs">All scanned transactions comply with policy and baseline expectations.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {flags.map((flag) => {
              const sev = SEV_CFG[flag.severity] ?? SEV_CFG.LOW;
              const isActioning = actionLoading?.startsWith(flag.id);

              return (
                <div
                  key={flag.id}
                  className="p-4 hover:bg-[var(--bg-surface-hover)] transition-colors space-y-3"
                >
                  {/* Top Bar: Badges, Severity, Entity, Financial Exposure */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="px-2.5 py-0.5 rounded-md text-xs font-bold flex items-center gap-1"
                        style={{ color: sev.color, background: sev.bg, border: `1px solid ${sev.border}` }}
                      >
                        {sev.icon} {sev.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        {flag.streamType ?? 'TRANSACTION'}
                      </span>
                      <span className="text-xs font-mono text-[var(--text-muted)] select-all">
                        {flag.entityType} #{flag.entityId.slice(0, 14)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {flag.financialExposureAed !== undefined && flag.financialExposureAed > 0 && (
                        <div className="text-right">
                          <span className="text-[11px] text-[var(--text-muted)] block">Exposure:</span>
                          <span className="text-sm font-extrabold text-rose-400 tabular-nums">
                            AED {flag.financialExposureAed.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      <ConfidenceBar value={flag.confidence} />
                    </div>
                  </div>

                  {/* Root Cause & Explanation */}
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-[var(--text-main)] leading-relaxed">
                      {flag.explanation}
                    </p>
                    {flag.likelyCause && (
                      <p className="text-xs text-[var(--text-muted)] flex items-start gap-1">
                        <span className="text-amber-400 font-bold">🔍 Likely Cause:</span> {flag.likelyCause}
                      </p>
                    )}
                  </div>

                  {/* Expected vs Actual KPI Badge */}
                  {(flag.expectedValue || flag.actualValue) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-[var(--bg-surface-elevated)]/60 border border-[var(--border-subtle)] p-2.5 rounded-xl text-xs">
                      <div>
                        <span className="text-[11px] text-[var(--text-muted)] block">Expected Baseline:</span>
                        <span className="font-semibold text-emerald-400">{flag.expectedValue ?? '—'}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-[var(--text-muted)] block">Actual Invoiced / Logged:</span>
                        <span className="font-semibold text-rose-400">{flag.actualValue ?? '—'}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-[var(--text-muted)] block">Variance:</span>
                        <span className="font-bold text-amber-400">
                          {flag.variancePercentage !== undefined ? `+${flag.variancePercentage.toFixed(1)}%` : 'Divergence Flagged'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Recommended Action & 1-Click Action Workflow */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-[var(--border-subtle)]/40">
                    <div className="text-xs text-[var(--text-muted)]">
                      {flag.recommendedAction ? (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          ⚡ Action: {flag.recommendedAction.title} — {flag.recommendedAction.description}
                        </span>
                      ) : (
                        <span>Flagged by {flag.detectorId}</span>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {flag.status === 'OPEN' ? (
                        <>
                          {flag.recommendedAction && (
                            <button
                              onClick={() => handleExecuteAction(flag, flag.recommendedAction!.actionType)}
                              disabled={Boolean(isActioning)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-600/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-600/30 transition-all disabled:opacity-50"
                            >
                              {isActioning ? '…' : `⚡ Execute: ${flag.recommendedAction.actionType.replace(/_/g, ' ')}`}
                            </button>
                          )}
                          <button
                            onClick={() => handleExecuteAction(flag, 'HOLD_PAYMENT')}
                            disabled={Boolean(isActioning)}
                            className="px-3 py-1.5 rounded-lg bg-rose-600/20 border border-rose-600/30 text-rose-300 text-xs font-semibold hover:bg-rose-600/30 transition-all disabled:opacity-50"
                          >
                            🛑 Hold Payment
                          </button>
                          <button
                            onClick={() => handleExecuteAction(flag, 'DISMISS')}
                            disabled={Boolean(isActioning)}
                            className="px-2.5 py-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs transition-all"
                          >
                            Dismiss
                          </button>
                        </>
                      ) : (
                        <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          ✓ {flag.actionTaken ?? flag.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
