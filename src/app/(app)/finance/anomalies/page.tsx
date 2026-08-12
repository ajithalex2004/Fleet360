'use client';
import React, { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type FlagStatus = 'OPEN' | 'REVIEWED' | 'FALSE_POSITIVE' | 'CONFIRMED_ISSUE';

interface AnomalyFlag {
  id: string;
  detectorId: string;
  entityType: string;
  entityId: string;
  severity: Severity;
  confidence: number;
  explanation: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  status: FlagStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

interface OpenCounts {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const SEV_CFG: Record<Severity, { color: string; bg: string; label: string; icon: string }> = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'Critical', icon: '🚨' },
  HIGH:     { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'High',     icon: '⚠️' },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Medium',   icon: '🟡' },
  LOW:      { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  label: 'Low',      icon: 'ℹ️' },
};

const DETECTOR_LABELS: Record<string, string> = {
  'duplicate-invoice': '🔁 Duplicate Invoice',
  'amount-outlier':    '📊 Amount Outlier',
  'round-number':      '🔵 Round Number',
  'velocity-spike':    '⚡ Velocity Spike',
  'category-mismatch': '⛽ Category Mismatch',
};

const STATUS_CFG: Record<FlagStatus, { label: string; color: string; bg: string }> = {
  OPEN:             { label: 'Open',              color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
  REVIEWED:         { label: 'Reviewed',          color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  FALSE_POSITIVE:   { label: 'False Positive',    color: '#64748b', bg: 'rgba(100,116,139,0.12)'},
  CONFIRMED_ISSUE:  { label: 'Confirmed Issue',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
};

// ── Confidence Bar ─────────────────────────────────────────────────────────────
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const col = pct >= 85 ? '#ef4444' : pct >= 70 ? '#f97316' : pct >= 55 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color: col }}>{pct}%</span>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function FinanceAnomaliesPage() {
  const [flags,       setFlags]       = useState<AnomalyFlag[]>([]);
  const [total,       setTotal]       = useState(0);
  const [openCounts,  setOpenCounts]  = useState<OpenCounts>({});
  const [loading,     setLoading]     = useState(true);
  const [running,     setRunning]     = useState(false);
  const [reviewing,   setReviewing]   = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [filterSev,   setFilterSev]   = useState('');
  const [filterType,  setFilterType]  = useState('');
  const [filterStatus, setFilterStatus] = useState('OPEN');
  const [lastRun,     setLastRun]     = useState<string | null>(null);
  const [runResult,   setRunResult]   = useState<{ itemsProcessed: number; actionsCreated: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filterSev)    params.set('severity',    filterSev);
      if (filterType)   params.set('entity_type', filterType);
      if (filterStatus) params.set('status',      filterStatus);
      const res = await fetch(`/api/agents/anomalies?${params}`);
      if (!res.ok) throw new Error('Failed to load anomalies');
      const d = await res.json();
      setFlags(Array.isArray(d.data) ? d.data : []);
      setTotal(d.total ?? 0);
      setOpenCounts(d.openCounts ?? {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filterSev, filterType, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const runScan = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/agents/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ agent_id: 'finance-anomaly' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Scan failed');
      setLastRun(new Date().toLocaleTimeString());
      setRunResult({ itemsProcessed: d.itemsProcessed, actionsCreated: d.actionsCreated });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const updateStatus = async (id: string, status: FlagStatus) => {
    setReviewing(id);
    try {
      await fetch('/api/agents/anomalies', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, status }),
      });
      await load();
    } finally {
      setReviewing(null);
    }
  };

  const totalOpen = Object.values(openCounts).reduce((a, b) => a + (b ?? 0), 0);

  const kpiCards = [
    { label: 'Open Flags',    value: totalOpen,              color: '#6366f1', icon: '🚩' },
    { label: 'Critical',      value: openCounts.critical ?? 0, color: '#ef4444', icon: '🚨' },
    { label: 'High',          value: openCounts.high     ?? 0, color: '#f97316', icon: '⚠️' },
    { label: 'Medium',        value: openCounts.medium   ?? 0, color: '#f59e0b', icon: '🟡' },
    { label: 'Low',           value: openCounts.low      ?? 0, color: '#22c55e', icon: 'ℹ️' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🔍 Finance Anomaly Detection
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            5 statistical detectors · Duplicate invoices · Amount outliers · Velocity spikes · Fuel fraud
            {lastRun && <span className="ml-2 text-indigo-400">· Last scan: {lastRun}</span>}
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={running}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all
            bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500
            text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          {running ? (
            <><span className="animate-spin">⚙️</span> Scanning…</>
          ) : (
            <><span>🔍</span> Run Scan</>
          )}
        </button>
      </div>

      {/* Run result */}
      {runResult && (
        <div className="bg-indigo-950/60 border border-indigo-500/30 rounded-xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="text-indigo-400 font-semibold">✓ Scan Complete</span>
          <span className="text-slate-400">{runResult.itemsProcessed} records scanned</span>
          <span className="text-amber-400 font-semibold">· {runResult.actionsCreated} new flags raised</span>
          <button onClick={() => setRunResult(null)} className="ml-auto text-slate-500 hover:text-slate-300">✕</button>
        </div>
      )}

      {error && (
        <div className="bg-red-950/60 border border-red-500/30 rounded-xl px-5 py-3 text-red-400 text-sm">{error}</div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpiCards.map((k) => (
          <div key={k.label} className="bg-slate-800/50 border border-white/5 rounded-xl p-4 text-center">
            <div className="text-xl mb-1">{k.icon}</div>
            <div className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap bg-slate-800/50 border border-white/5 rounded-xl px-4 py-3">
        <span className="text-xs text-slate-500 font-semibold">STATUS:</span>
        {(['OPEN','REVIEWED','FALSE_POSITIVE','CONFIRMED_ISSUE'] as FlagStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
              filterStatus === s ? 'text-white border-indigo-500 bg-indigo-600' : 'text-slate-400 border-slate-700 bg-slate-800 hover:border-slate-600'
            }`}
          >
            {STATUS_CFG[s].label}
          </button>
        ))}
        <span className="text-xs text-slate-500 font-semibold ml-2">SEVERITY:</span>
        {['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterSev(s)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
              filterSev === s ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
            }`}
          >
            {s === '' ? 'All' : s}
          </button>
        ))}
        <span className="text-xs text-slate-500 font-semibold ml-2">TYPE:</span>
        {['', 'INVOICE', 'EXPENSE', 'FUEL_LOG'].map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
              filterType === t ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
            }`}
          >
            {t === '' ? 'All' : t}
          </button>
        ))}
      </div>

      {/* Anomaly Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-slate-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : flags.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔍</div>
          <p className="font-semibold text-slate-400">
            {filterStatus === 'OPEN' ? 'No open anomalies detected' : 'No records found'}
          </p>
          <p className="text-sm mt-1">
            {filterStatus === 'OPEN' ? 'Click "Run Scan" to analyse your financial records.' : 'Try changing your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => {
            const sev = SEV_CFG[flag.severity];
            const sts = STATUS_CFG[flag.status];
            const isReviewing = reviewing === flag.id;

            return (
              <div
                key={flag.id}
                className="rounded-xl border p-4 transition-all"
                style={{ borderColor: 'rgba(255,255,255,0.06)', background: flag.status === 'OPEN' ? sev.bg : 'rgba(30,41,59,0.3)' }}
              >
                <div className="flex items-start gap-3 flex-wrap">
                  {/* Severity badge */}
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md shrink-0 mt-0.5"
                    style={{ background: sev.color + '25', color: sev.color }}>
                    {sev.icon} {sev.label}
                  </span>

                  {/* Detector type */}
                  <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md shrink-0 mt-0.5">
                    {DETECTOR_LABELS[flag.detectorId] ?? flag.detectorId}
                  </span>

                  {/* Entity type */}
                  <span className="text-xs text-slate-500 bg-slate-800/50 px-2 py-0.5 rounded-md shrink-0 mt-0.5">
                    {flag.entityType}
                  </span>

                  {/* Amount */}
                  {flag.amount != null && (
                    <span className="text-xs font-bold text-slate-300 shrink-0 mt-0.5">
                      {flag.currency ?? 'AED'} {flag.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}

                  {/* Status */}
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md shrink-0 mt-0.5 ml-auto"
                    style={{ background: sts.bg, color: sts.color }}>
                    {sts.label}
                  </span>
                </div>

                {/* Explanation */}
                <p className="text-sm text-slate-300 mt-2 leading-relaxed">{flag.explanation}</p>

                {/* Confidence + metadata */}
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Confidence:</span>
                    <ConfidenceBar value={flag.confidence} />
                  </div>
                  {flag.metadata && Object.keys(flag.metadata).length > 0 && (
                    <div className="flex gap-3 flex-wrap">
                      {Object.entries(flag.metadata).slice(0, 3).map(([k, v]) => (
                        <span key={k} className="text-xs text-slate-500">
                          {k.replace(/([A-Z])/g, ' $1').toLowerCase()}: <span className="text-slate-400">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-xs text-slate-600 ml-auto">
                    {new Date(flag.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Action buttons — only for OPEN flags */}
                {flag.status === 'OPEN' && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                    <span className="text-xs text-slate-500 mr-1">Mark as:</span>
                    {(['REVIEWED', 'FALSE_POSITIVE', 'CONFIRMED_ISSUE'] as FlagStatus[]).map((s) => (
                      <button
                        key={s}
                        disabled={isReviewing}
                        onClick={() => updateStatus(flag.id, s)}
                        className="px-3 py-1 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50"
                        style={{
                          color: STATUS_CFG[s].color,
                          borderColor: STATUS_CFG[s].color + '50',
                          background: STATUS_CFG[s].bg,
                        }}
                      >
                        {isReviewing ? '…' : STATUS_CFG[s].label}
                      </button>
                    ))}
                  </div>
                )}

                {flag.reviewedBy && (
                  <p className="text-xs text-slate-600 mt-2">
                    Reviewed by {flag.reviewedBy} · {flag.reviewedAt ? new Date(flag.reviewedAt).toLocaleString() : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination hint */}
      {total > flags.length && (
        <p className="text-center text-xs text-slate-500">
          Showing {flags.length} of {total} records
        </p>
      )}
    </div>
  );
}
