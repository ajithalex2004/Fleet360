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
  primaryFailureReason?: string;
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
    // 9 Failure Estimation Signals
    dtcFaultScore?: number;
    activeDtcCodes?: string[];
    dtcSeveritySummary?: string;
    sensorAnomalyScore?: number;
    coolantTempC?: number;
    oilPressureKpa?: number;
    batteryVoltage?: number;
    transmissionTempC?: number;
    sensorWarningList?: string[];
    operatingHoursFactor?: number;
    engineOperatingHours?: number;
    dutyCycleStressRatio?: number;
    repeatFailureScore?: number;
    repeatFailureCount?: number;
    repeatSubsystems?: string[];
    subsystemRUL?: {
      powertrainPct: number;
      brakeSystemPct: number;
      electricalPct: number;
      hvacPct: number;
    };
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
      <span className="text-[10px] text-slate-500 w-36 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="text-[10px] text-slate-400 w-6 text-right">{Math.round(value * 100)}</span>
    </div>
  );
}

function SubsystemGauge({ label, value }: { label: string; value: number }) {
  const color = value < 30 ? '#ef4444' : value < 60 ? '#f59e0b' : '#10b981';
  return (
    <div className="bg-slate-900/60 border border-white/5 rounded-xl p-2.5 text-center">
      <div className="text-[10px] text-slate-400 font-medium truncate">{label}</div>
      <div className="text-base font-bold my-0.5" style={{ color }}>{value}%</div>
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <div className="text-[9px] text-slate-500 mt-1">RUL Health</div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function FleetIntelligencePage() {
  const [scores,      setScores]      = useState<RiskScore[]>([]);
  const [summary,     setSummary]     = useState<Summary>({});
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [running,     setRunning]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState('');
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [lastRun,     setLastRun]     = useState<string | null>(null);
  const [runResult,   setRunResult]   = useState<{ itemsProcessed: number; actionsCreated: number } | null>(null);

  useEffect(() => {
    fetch('/api/fleet/init').catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filterLevel ? `/api/fleet/risk-scores?risk_level=${filterLevel}` : '/api/fleet/risk-scores';
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load risk scores');
      setScores(json.scores || []);
      setSummary(json.summary || {});
      setTotal(json.total || 0);
      if (json.lastRun) setLastRun(new Date(json.lastRun).toLocaleString());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error loading fleet intelligence');
    } finally {
      setLoading(false);
    }
  }, [filterLevel]);

  useEffect(() => { load(); }, [load]);

  const runAnalysis = async () => {
    setRunning(true);
    setRunResult(null);
    setError(null);
    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: 'predictive-maintenance',
          event_type: 'manual.trigger',
          tenant_id: 'default',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Agent run failed');
      setRunResult({
        itemsProcessed: json.itemsProcessed ?? 0,
        actionsCreated: json.actionsCreated ?? 0,
      });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error executing predictive maintenance agent');
    } finally {
      setRunning(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const kpiCards = [
    { label: 'Vehicles Scored', value: total,                             color: '#6366f1', icon: '🎯' },
    { label: 'Critical Risk',   value: summary.critical?.count ?? 0,      color: '#ef4444', icon: '🚨' },
    { label: 'High Risk',       value: summary.high?.count     ?? 0,      color: '#f97316', icon: '⚠️' },
    { label: 'Medium Risk',     value: summary.medium?.count   ?? 0,      color: '#f59e0b', icon: '🟡' },
    { label: 'Healthy (Low)',   value: summary.low?.count      ?? 0,      color: '#22c55e', icon: '✅' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🧠 Predictive Maintenance &amp; Fleet Intelligence
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            9-Signal AI Failure Estimation Engine — CAN-bus DTCs, Sensors, Operating Hours, Thermal &amp; Component RUL
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
            <><span className="animate-spin">⚙️</span> Scoring Fleet Telematics…</>
          ) : (
            <><span>▶</span> Run 9-Signal Analysis</>
          )}
        </button>
      </div>

      {/* Run result toast */}
      {runResult && (
        <div className="bg-indigo-950/60 border border-indigo-500/30 rounded-xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="text-indigo-400 font-semibold">✓ Multi-Signal Analysis Complete</span>
          <span className="text-slate-400">{runResult.itemsProcessed} vehicles analyzed</span>
          {runResult.actionsCreated > 0 && (
            <span className="text-red-400 font-semibold">· {runResult.actionsCreated} preventive work orders auto-created</span>
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
          <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-widest">Fleet Breakdown Hazard Breakdown</p>
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
          <p className="text-sm mt-1">Click &quot;Run 9-Signal Analysis&quot; to score your fleet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {scores.map((score) => {
            const cfg      = RISK_CFG[score.riskLevel];
            const isOpen   = expanded.has(score.vehicleId);
            const dtcCount = score.factors.activeDtcCodes?.length ?? 0;
            const hasSensors = (score.factors.sensorWarningList?.length ?? 0) > 0;

            return (
              <div
                key={score.vehicleId}
                className="rounded-2xl border transition-all"
                style={{
                  borderColor: isOpen ? cfg.color + '70' : 'rgba(255,255,255,0.08)',
                  background: isOpen ? cfg.bg : 'rgba(30,41,59,0.55)',
                }}
              >
                {/* Main Row */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer flex-wrap"
                  onClick={() => toggleExpand(score.vehicleId)}
                >
                  {/* Risk Badge */}
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-lg shrink-0"
                    style={{ background: cfg.color + '25', color: cfg.color }}
                  >
                    {cfg.label}
                  </span>

                  {/* Vehicle Info */}
                  <div className="min-w-[150px]">
                    <p className="text-sm font-semibold text-white">
                      {score.make} {score.model}
                    </p>
                    <p className="text-xs text-slate-400 font-mono">{score.licensePlate || score.vehicleCode}</p>
                  </div>

                  {/* Score Bar */}
                  <div className="flex-1 min-w-[130px]">
                    <ScoreBar value={score.riskScore} level={score.riskLevel} />
                  </div>

                  {/* Diagnostic Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {dtcCount > 0 && (
                      <span className="text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-md font-bold">
                        ⚡ {dtcCount} DTC{dtcCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {hasSensors && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md font-semibold">
                        ⚠️ Sensor Alert
                      </span>
                    )}
                    {(score.factors.repeatFailureCount ?? 0) > 0 && (
                      <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-md font-semibold">
                        🔁 Repeat Fault
                      </span>
                    )}
                  </div>

                  {/* Action & Window */}
                  <div className="min-w-[180px]">
                    <p className="text-xs font-semibold text-slate-200">{score.recommendedAction.replace(/_/g,' ')}</p>
                    <p className="text-[11px] text-slate-500 font-medium">{score.predictedFailureWindow}</p>
                  </div>

                  {/* Auto WO badge */}
                  {score.autoWorkOrderId && (
                    <span className="text-xs bg-red-950/80 text-red-400 border border-red-500/40 px-2.5 py-1 rounded-md font-semibold shrink-0">
                      WO Created
                    </span>
                  )}

                  <span className="text-slate-500 text-xs ml-auto shrink-0 font-bold">{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* Expanded Multi-Signal Breakdown */}
                {isOpen && (
                  <div className="px-5 pb-5 border-t border-white/10 pt-4 space-y-4">
                    
                    {/* Primary Failure Reason Banner */}
                    {score.primaryFailureReason && (
                      <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 flex items-start gap-2.5">
                        <span className="text-base">🚨</span>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">Primary Failure Reason</div>
                          <div className="text-xs font-semibold text-amber-300 mt-0.5">{score.primaryFailureReason}</div>
                        </div>
                      </div>
                    )}

                    {/* Subsystem RUL Health Gauges */}
                    {score.factors.subsystemRUL && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Component Remaining Useful Life (RUL)</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <SubsystemGauge label="Powertrain & Engine" value={score.factors.subsystemRUL.powertrainPct} />
                          <SubsystemGauge label="Brake Subsystem" value={score.factors.subsystemRUL.brakeSystemPct} />
                          <SubsystemGauge label="Electrical & Battery" value={score.factors.subsystemRUL.electricalPct} />
                          <SubsystemGauge label="HVAC / Climate" value={score.factors.subsystemRUL.hvacPct} />
                        </div>
                      </div>
                    )}

                    {/* 9 Factor Breakdown Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">9-Signal Degradation Model</p>
                        <div className="space-y-2">
                          <FactorBar label="1. DTC Faults (22%)"          value={score.factors.dtcFaultScore ?? 0}        color="#ef4444" />
                          <FactorBar label="2. Sensor Telemetry (18%)"    value={score.factors.sensorAnomalyScore ?? 0}   color="#f97316" />
                          <FactorBar label="3. Service Overdue (18%)"     value={score.factors.serviceOverdue}            color="#f59e0b" />
                          <FactorBar label="4. Fuel Anomaly (12%)"        value={score.factors.fuelAnomalyScore}          color="#eab308" />
                          <FactorBar label="5. Repeat Failures (10%)"     value={score.factors.repeatFailureScore ?? 0}   color="#a855f7" />
                          <FactorBar label="6. Work Order Freq (8%)"      value={score.factors.workOrderFrequency}        color="#8b5cf6" />
                          <FactorBar label="7. Operating Hours (5%)"      value={score.factors.operatingHoursFactor ?? 0} color="#3b82f6" />
                          <FactorBar label="8. Mileage Curve (4%)"        value={score.factors.odometerFactor}            color="#06b6d4" />
                          <FactorBar label="9. Vehicle Age (3%)"          value={score.factors.vehicleAgeFactor}          color="#64748b" />
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">Live Telematics &amp; Diagnostics</p>
                        <div className="bg-slate-900/50 rounded-xl p-3 border border-white/5 space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Active DTC Codes:</span>
                            <span className="text-white font-mono font-bold">
                              {(score.factors.activeDtcCodes?.length ?? 0) > 0 ? score.factors.activeDtcCodes?.join(', ') : 'None (0 Clean)'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Coolant Temp / Oil Press:</span>
                            <span className="text-slate-300 font-medium">
                              {score.factors.coolantTempC ? `${score.factors.coolantTempC}°C` : '—'} / {score.factors.oilPressureKpa ? `${score.factors.oilPressureKpa} kPa` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Battery / Trans Temp:</span>
                            <span className="text-slate-300 font-medium">
                              {score.factors.batteryVoltage ? `${score.factors.batteryVoltage}V` : '—'} / {score.factors.transmissionTempC ? `${score.factors.transmissionTempC}°C` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Engine Operating Hours:</span>
                            <span className="text-slate-300 font-medium">
                              {score.factors.engineOperatingHours ? `${score.factors.engineOperatingHours.toFixed(0)} hrs (Stress: ${score.factors.dutyCycleStressRatio ?? 1}x)` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Days / KM Since Service:</span>
                            <span className="text-slate-300 font-medium">{score.factors.serviceOverdueDays} days / {score.factors.serviceOverdueKm?.toFixed(0)} km</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Fuel Baseline vs Recent:</span>
                            <span className="text-slate-300 font-medium">
                              {score.factors.fuelConsumptionBaseline > 0 ? `${score.factors.fuelConsumptionBaseline.toFixed(1)} L` : '—'} vs {score.factors.fuelConsumptionRecent > 0 ? `${score.factors.fuelConsumptionRecent.toFixed(1)} L/100km` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Repeat Subsystems (90d):</span>
                            <span className="text-purple-400 font-medium">
                              {(score.factors.repeatSubsystems?.length ?? 0) > 0 ? score.factors.repeatSubsystems?.join(', ') : 'None'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-white/5">
                      <span>Evaluated by Predictive Maintenance Agent v2.0.0</span>
                      <span>Scored {new Date(score.scoredAt).toLocaleString()}</span>
                    </div>
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
