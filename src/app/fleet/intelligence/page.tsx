'use client';
import React, { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
interface RiskScore {
  vehicleId: string;
  vehicleCode: string;
  make: string;
  model: string;
  licensePlate: string;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendedAction: string;
  predictedFailureWindow: string;
  autoWorkOrderId?: string;
  scoredAt: string;
  vehicleStatus?: string;
  vehicleUsage?: string;
  branchName?: string;
  factors: {
    serviceOverdue: number;
    fuelAnomalyScore: number;
    workOrderFrequency: number;
    vehicleAgeFactor: number;
    odometerFactor: number;
    serviceOverdueDays: number;
    serviceOverdueKm: number;
    fuelConsumptionBaseline: number;
    fuelConsumptionRecent: number;
    openWorkOrders: number;
    vehicleAgeYears: number;
    odometerKm: number;
  };
}

interface Summary {
  critical?: { count: number; avgScore: number };
  high?:     { count: number; avgScore: number };
  medium?:   { count: number; avgScore: number };
  low?:      { count: number; avgScore: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const RISK_CFG = {
  CRITICAL: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', text: 'text-red-400',    border: 'border-red-500/30',    label: 'Critical'  },
  HIGH:     { color: '#f97316', bg: 'rgba(249,115,22,0.12)', text: 'text-orange-400', border: 'border-orange-500/30', label: 'High'      },
  MEDIUM:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', text: 'text-amber-400',  border: 'border-amber-500/30',  label: 'Medium'    },
  LOW:      { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  text: 'text-green-400',  border: 'border-green-500/30',  label: 'Low'       },
} as const;

function ScoreBar({ value, level }: { value: number; level: keyof typeof RISK_CFG }) {
  const cfg = RISK_CFG[level];
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round(value * 100)}%`, background: cfg.color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color: cfg.color }}>
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

function FactorBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="text-[10px] text-slate-400 w-6 text-right">{Math.round(value * 100)}</span>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function FleetIntelligencePage() {
  const [scores,    setScores]    = useState<RiskScore[]>([]);
  const [summary,   setSummary]   = useState<Summary>({});
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [running,   setRunning]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState('');
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
  const [lastRun,   setLastRun]   = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ itemsProcessed: number; actionsCreated: number } | null>(null);

  // Pre-warm agent schema tables on first mount
  useEffect(() => {
    fetch('/api/fleet/init').catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filterLevel) params.set('risk_level', filterLevel);
      const res = await fetch(`/api/agents/risk-scores?${params}`);
      if (!res.ok) throw new Error('Failed to load risk scores');
      const d = await res.json();
      setScores(Array.isArray(d.data) ? d.data : []);
      setTotal(d.total ?? 0);
      setSummary(d.summary ?? {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filterLevel]);

  useEffect(() => { load(); }, [load]);

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/agents/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ agent_id: 'predictive-maintenance' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Analysis failed');
      setLastRun(new Date().toLocaleTimeString());
      setRunResult({ itemsProcessed: d.itemsProcessed, actionsCreated: d.actionsCreated });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const kpiCards = [
    { label: 'Vehicles Scored', value: total,                                      color: '#6366f1', icon: '🎯' },
    { label: 'Critical Risk',   value: summary.critical?.count ?? 0,               color: '#ef4444', icon: '🚨' },
    { label: 'High Risk',       value: summary.high?.count     ?? 0,               color: '#f97316', icon: '⚠️' },
    { label: 'Medium Risk',     value: summary.medium?.count   ?? 0,               color: '#f59e0b', icon: '🟡' },
    { label: 'Healthy (Low)',   value: summary.low?.count      ?? 0,               color: '#22c55e', icon: '✅' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🧠 Fleet Intelligence
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Predictive Maintenance Agent — 5-factor statistical risk scoring
            {lastRun && <span className="ml-2 text-indigo-400">· Last run: {lastRun}</span>}
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={running}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all
            bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500
            text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          {running ? (
            <><span className="animate-spin">⚙️</span> Analysing…</>
          ) : (
            <><span>▶</span> Run Analysis</>
          )}
        </button>
      </div>

      {/* Run result toast */}
      {runResult && (
        <div className="bg-indigo-950/60 border border-indigo-500/30 rounded-xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="text-indigo-400 font-semibold">✓ Analysis Complete</span>
          <span className="text-slate-400">{runResult.itemsProcessed} vehicles scored</span>
          {runResult.actionsCreated > 0 && (
            <span className="text-red-400 font-semibold">· {runResult.actionsCreated} work orders auto-created</span>
          )}
          <button onClick={() => setRunResult(null)} className="ml-auto text-slate-500 hover:text-slate-300">✕</button>
        </div>
      )}

      {error && (
        <div className="bg-red-950/60 border border-red-500/30 rounded-xl px-5 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpiCards.map((k) => (
          <div
            key={k.label}
            className="bg-slate-800/50 border border-white/5 rounded-xl p-4 text-center cursor-pointer hover:border-white/10 transition-all"
            onClick={() => setFilterLevel(k.label === 'Vehicles Scored' || k.label === 'Healthy (Low)' ? (k.label === 'Healthy (Low)' ? 'LOW' : '') : k.label.replace(' Risk','').toUpperCase())}
          >
            <div className="text-xl mb-1">{k.icon}</div>
            <div className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Risk Distribution Bar */}
      {total > 0 && (
        <div className="bg-slate-800/50 border border-white/5 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-widest">Fleet Risk Distribution</p>
          <div className="flex h-6 rounded-lg overflow-hidden gap-0.5">
            {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map((level) => {
              const count = summary[level.toLowerCase() as keyof Summary]?.count ?? 0;
              const pct   = total > 0 ? (count / total) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={level}
                  style={{ width: `${pct}%`, background: RISK_CFG[level].color }}
                  className="flex items-center justify-center text-[10px] font-bold text-white/90 cursor-pointer"
                  title={`${RISK_CFG[level].label}: ${count} vehicles (${pct.toFixed(1)}%)`}
                  onClick={() => setFilterLevel(level === filterLevel ? '' : level)}
                >
                  {pct > 8 ? `${count}` : ''}
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2 flex-wrap">
            {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map((level) => {
              const count = summary[level.toLowerCase() as keyof Summary]?.count ?? 0;
              if (count === 0) return null;
              return (
                <div key={level} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: RISK_CFG[level].color }} />
                  {RISK_CFG[level].label}: {count}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500">Filter:</span>
        {['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((level) => (
          <button
            key={level}
            onClick={() => setFilterLevel(level)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border ${
              filterLevel === level
                ? level === '' ? 'bg-indigo-600 text-white border-indigo-500' : `border-transparent text-white`
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
            }`}
            style={filterLevel === level && level !== '' ? { background: RISK_CFG[level as keyof typeof RISK_CFG].color } : {}}
          >
            {level === '' ? 'All' : RISK_CFG[level as keyof typeof RISK_CFG].label}
          </button>
        ))}
        {filterLevel && (
          <span className="text-xs text-slate-500 ml-2">
            Showing {scores.length} of {total} vehicles
          </span>
        )}
      </div>

      {/* Vehicle Risk Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : scores.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🤖</div>
          <p className="font-semibold text-slate-400">No risk scores yet</p>
          <p className="text-sm mt-1">Click "Run Analysis" to score your fleet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {scores.map((score) => {
            const cfg      = RISK_CFG[score.riskLevel];
            const isOpen   = expanded.has(score.vehicleId);
            return (
              <div
                key={score.vehicleId}
                className="rounded-xl border transition-all"
                style={{ borderColor: isOpen ? cfg.color + '60' : 'rgba(255,255,255,0.06)', background: isOpen ? cfg.bg : 'rgba(30,41,59,0.5)' }}
              >
                {/* Main Row */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer flex-wrap"
                  onClick={() => toggleExpand(score.vehicleId)}
                >
                  {/* Risk Badge */}
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-md shrink-0"
                    style={{ background: cfg.color + '25', color: cfg.color }}
                  >
                    {cfg.label}
                  </span>

                  {/* Vehicle Info */}
                  <div className="min-w-[140px]">
                    <p className="text-sm font-semibold text-white">
                      {score.make} {score.model}
                    </p>
                    <p className="text-xs text-slate-500">{score.licensePlate || score.vehicleCode}</p>
                  </div>

                  {/* Score Bar */}
                  <div className="flex-1 min-w-[130px]">
                    <ScoreBar value={score.riskScore} level={score.riskLevel} />
                  </div>

                  {/* Action */}
                  <div className="min-w-[160px]">
                    <p className="text-xs text-slate-400">{score.recommendedAction.replace(/_/g,' ')}</p>
                    <p className="text-xs text-slate-600">{score.predictedFailureWindow}</p>
                  </div>

                  {/* Auto WO badge */}
                  {score.autoWorkOrderId && (
                    <span className="text-xs bg-red-950/60 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-md shrink-0">
                      WO Created
                    </span>
                  )}

                  {/* Branch */}
                  {score.branchName && (
                    <span className="text-xs text-slate-500 shrink-0">{score.branchName}</span>
                  )}

                  <span className="text-slate-600 text-xs ml-auto shrink-0">{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* Expanded Factor Breakdown */}
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-white/5 pt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Risk Factors</p>
                        <div className="space-y-2">
                          <FactorBar label="Service Overdue (35%)"   value={score.factors.serviceOverdue}     color="#ef4444" />
                          <FactorBar label="Fuel Anomaly (25%)"      value={score.factors.fuelAnomalyScore}   color="#f97316" />
                          <FactorBar label="Work Order Freq (20%)"   value={score.factors.workOrderFrequency} color="#f59e0b" />
                          <FactorBar label="Vehicle Age (10%)"       value={score.factors.vehicleAgeFactor}   color="#a78bfa" />
                          <FactorBar label="Odometer (10%)"          value={score.factors.odometerFactor}     color="#60a5fa" />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Data Points</p>
                        <div className="space-y-1.5">
                          {[
                            ['Days since service',        score.factors.serviceOverdueDays,            'days'],
                            ['KM since service',          score.factors.serviceOverdueKm?.toFixed(0),  'km'],
                            ['Open work orders',          score.factors.openWorkOrders,                ''],
                            ['Vehicle age',               score.factors.vehicleAgeYears?.toFixed(1),   'years'],
                            ['Odometer',                  score.factors.odometerKm?.toLocaleString(),  'km'],
                            ['Fuel baseline (90d)',        score.factors.fuelConsumptionBaseline > 0 ? score.factors.fuelConsumptionBaseline.toFixed(1) : '—', 'L/100km'],
                            ['Fuel recent (30d)',          score.factors.fuelConsumptionRecent   > 0 ? score.factors.fuelConsumptionRecent.toFixed(1)   : '—', 'L/100km'],
                          ].map(([lbl, val, unit]) => (
                            <div key={String(lbl)} className="flex justify-between text-xs">
                              <span className="text-slate-500">{lbl}</span>
                              <span className="text-slate-300 font-medium">{val} {unit}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-3">
                      Scored {new Date(score.scoredAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
