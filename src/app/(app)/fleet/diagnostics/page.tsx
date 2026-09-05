'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Gauge,
  HelpCircle,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Thermometer,
  Wrench,
  Zap,
  Radio,
  Sliders,
} from 'lucide-react';

interface DtcFaultItem {
  code: string;
  subsystem: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MODERATE' | 'MINOR';
  title: string;
  description: string;
  recommendedAction: string;
  breakdownRiskPenalty: number;
}

interface VehicleDiagnosticItem {
  vehicleId: string;
  vehicleCode: string;
  licensePlate: string;
  makeModel: string;
  status: string;
  health: {
    vhiScore: number;
    healthGrade: 'OPTIMAL' | 'GOOD' | 'ELEVATED_RISK' | 'CRITICAL_BREAKDOWN_IMMINENT';
    activeDtcFaults: DtcFaultItem[];
    sensorAnomalies: {
      coolantStatus: string;
      oilPressureStatus: string;
      electricalStatus: string;
      emissionsStatus: string;
      anomaliesDetected: string[];
      requiresImmediateStop: boolean;
    };
    breakdownRiskDescription: string;
    recommendedWorkshopAction?: string;
  };
  sensors: {
    coolantTempC: number;
    engineRpm: number;
    oilPressureKpa: number;
    batteryVoltage: number;
    defLevelPercent: number;
    dpfSootLoadPercent: number;
  };
}

interface DiagnosticsData {
  summary: {
    totalVehiclesTracked: number;
    fleetAverageVhi: number;
    criticalBreakdownRiskCount: number;
    elevatedRiskCount: number;
    optimalCount: number;
  };
  vehicles: VehicleDiagnosticItem[];
  dtcDictionarySample: DtcFaultItem[];
}

export default function FleetDiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSubsystem, setSelectedSubsystem] = useState('ALL');
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleDiagnosticItem | null>(null);

  // Simulation state
  const [simVehicleId, setSimVehicleId] = useState('');
  const [simFaultPreset, setSimFaultPreset] = useState<'OVERHEAT' | 'OIL_LOSS' | 'MISFIRE' | 'HEALTHY'>('OVERHEAT');
  const [simulating, setSimulating] = useState(false);
  const [simResultMsg, setSimResultMsg] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/fleet/diagnostics');
      if (!res.ok) throw new Error('Failed to fetch CAN-bus telemetry diagnostics');
      const json = await res.json();
      setData(json);
      if (json.vehicles?.length && !simVehicleId) {
        setSimVehicleId(json.vehicles[0].vehicleId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CAN-bus diagnostics');
    } finally {
      setLoading(false);
    }
  }, [simVehicleId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSimulateInject = async () => {
    if (!simVehicleId) return;
    try {
      setSimulating(true);
      setSimResultMsg('');

      let dtcCodes: string[] = [];
      let sensors: Record<string, number> = {
        coolantTempC: 90,
        engineRpm: 1500,
        oilPressureKpa: 340,
        batteryVoltage: 13.9,
      };

      if (simFaultPreset === 'OVERHEAT') {
        dtcCodes = ['P0217'];
        sensors.coolantTempC = 118; // Critical overheat
      } else if (simFaultPreset === 'OIL_LOSS') {
        dtcCodes = ['P0524'];
        sensors.oilPressureKpa = 115; // Critical oil pressure loss
      } else if (simFaultPreset === 'MISFIRE') {
        dtcCodes = ['P0300', 'P0301'];
        sensors.coolantTempC = 96;
      }

      const res = await fetch('/api/fleet/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: simVehicleId,
          dtcCodes,
          sensors,
        }),
      });

      const resJson = await res.json();
      if (!res.ok) throw new Error(resJson.error || 'Simulation failed');
      setSimResultMsg(resJson.message);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Diagnostic injection failed');
    } finally {
      setSimulating(false);
    }
  };

  const filteredVehicles = useMemo(() => {
    if (!data?.vehicles) return [];
    return data.vehicles.filter((v) => {
      if (selectedSubsystem !== 'ALL') {
        const hasSubsystem = v.health.activeDtcFaults.some(
          (d) => d.subsystem === selectedSubsystem
        );
        if (!hasSubsystem) return false;
      }

      if (search) {
        const q = search.toLowerCase();
        return (
          v.vehicleCode.toLowerCase().includes(q) ||
          v.licensePlate.toLowerCase().includes(q) ||
          v.makeModel.toLowerCase().includes(q) ||
          v.health.activeDtcFaults.some((d) => d.code.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [data, selectedSubsystem, search]);

  const summary = data?.summary;
  const criticalBreakdownVehicles = data?.vehicles.filter(
    (v) => v.health.healthGrade === 'CRITICAL_BREAKDOWN_IMMINENT'
  ) || [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-2">
              <Cpu className="w-6 h-6 text-cyan-400" />
              CAN-bus Telematics & DTC Diagnostics
            </h1>
            <span className="px-2 py-0.5 text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full">
              Predictive Maintenance
            </span>
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Real-time OBD-II/CAN-bus PID stream analysis, SAE J2012 fault decoding, and predictive breakdown prevention.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchData()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold border border-[var(--border-subtle)] transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Telemetry
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-cyan-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-cyan-400 font-medium">Fleet Health Index</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="text-2xl font-bold text-cyan-300">
            {summary?.fleetAverageVhi ?? 100}%
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Fleet-wide mechanical health mean</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-rose-500/40 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-rose-400 font-medium">Breakdown Hazards</span>
            <AlertOctagon className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl font-bold text-rose-300">
            {summary?.criticalBreakdownRiskCount ?? criticalBreakdownVehicles.length}
          </p>
          <p className="text-[11px] text-rose-400/80">Critical engine/thermal faults</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-amber-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-400 font-medium">Elevated Risk Assets</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-300">
            {summary?.elevatedRiskCount ?? 0}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Preventive workshop tickets advised</p>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/60 border border-emerald-500/30 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400 font-medium">Optimal Vehicles</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-300">
            {summary?.optimalCount ?? 0}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Zero DTCs & optimal PIDs</p>
        </div>
      </div>

      {/* Breakdown Hazard Warning Banner */}
      {criticalBreakdownVehicles.length > 0 && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-rose-400" />
              Imminent Mechanical Breakdown Alert ({criticalBreakdownVehicles.length} vehicles)
            </h3>
            <span className="text-xs text-rose-400 font-mono">EMERGENCY WORKSHOP ACTION</span>
          </div>
          <p className="text-xs text-rose-200/80">
            The following vehicles have reported critical CAN-bus sensor stress or severe engine trouble codes. Immediate shutdown and workshop triage is required to prevent catastrophic engine seizure.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
            {criticalBreakdownVehicles.map((v) => (
              <div
                key={v.vehicleId}
                className="p-3 rounded-xl bg-rose-900/40 border border-rose-500/30 text-xs space-y-1"
              >
                <div className="flex items-center justify-between font-bold text-[var(--text-main)]">
                  <span>{v.vehicleCode}</span>
                  <span className="font-mono text-rose-300">VHI: {v.health.vhiScore}%</span>
                </div>
                <p className="text-[11px] text-rose-200/90">{v.health.breakdownRiskDescription}</p>
                <p className="text-[10px] text-rose-300 font-mono mt-1">
                  {v.health.sensorAnomalies.anomaliesDetected.join('; ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CAN-bus Diagnostic Simulator */}
      <div className="p-4 rounded-2xl bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-[var(--text-main)] uppercase tracking-wider flex items-center gap-2">
            <Radio className="w-4 h-4 text-amber-400" />
            CAN-bus Telemetry Injection Simulator
          </h3>
          <span className="text-[11px] text-[var(--text-muted)]">Test predictive breakdown prevention</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">Target Vehicle</label>
            <select
              value={simVehicleId}
              onChange={(e) => setSimVehicleId(e.target.value)}
              className="w-full px-3 py-1.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
            >
              {data?.vehicles.map((v) => (
                <option key={v.vehicleId} value={v.vehicleId}>
                  {v.vehicleCode} · {v.licensePlate} ({v.makeModel})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">Simulate Fault Scenario</label>
            <select
              value={simFaultPreset}
              onChange={(e) => setSimFaultPreset(e.target.value as any)}
              className="w-full px-3 py-1.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
            >
              <option value="OVERHEAT">P0217 - Engine Coolant Overheat (118°C)</option>
              <option value="OIL_LOSS">P0524 - Critical Oil Pressure Loss (115 kPa)</option>
              <option value="MISFIRE">P0300 - Random Multiple Cylinder Misfire</option>
              <option value="HEALTHY">Clear Faults (Optimal Operation)</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleSimulateInject}
              disabled={simulating || !simVehicleId}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold shadow transition disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {simulating ? 'Injecting Telemetry...' : 'Inject CAN-bus Frame'}
            </button>
          </div>
        </div>

        {simResultMsg && (
          <p className="text-xs text-emerald-400 bg-emerald-950/30 p-2 rounded-xl border border-emerald-500/20">
            {simResultMsg}
          </p>
        )}
      </div>

      {/* Subsystem Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {(['ALL', 'POWERTRAIN', 'CHASSIS', 'BODY', 'NETWORK', 'EMISSIONS_DPF'] as const).map(
            (sub) => (
              <button
                key={sub}
                onClick={() => setSelectedSubsystem(sub)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  selectedSubsystem === sub
                    ? 'bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-slate-500'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-transparent'
                }`}
              >
                {sub === 'ALL' && 'All Subsystems'}
                {sub === 'POWERTRAIN' && 'Powertrain (P)'}
                {sub === 'CHASSIS' && 'Chassis / Brakes (C)'}
                {sub === 'BODY' && 'Body & SRS (B)'}
                {sub === 'NETWORK' && 'CAN Network (U)'}
                {sub === 'EMISSIONS_DPF' && 'Emissions / DPF'}
              </button>
            )
          )}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search vehicle, plate, DTC code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Diagnostics Grid */}
      <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-muted)]">
            <thead className="bg-[var(--bg-canvas)]/80 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
              <tr>
                <th className="p-3.5">Vehicle</th>
                <th className="p-3.5">Health Score (VHI)</th>
                <th className="p-3.5">Live Sensor Gauges</th>
                <th className="p-3.5">Active DTC Faults</th>
                <th className="p-3.5">Predictive Risk & Action</th>
                <th className="p-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {!filteredVehicles.length ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[var(--text-faint)]">
                    No vehicles matching diagnostic filter.
                  </td>
                </tr>
              ) : (
                filteredVehicles.map((v) => {
                  const isCritical =
                    v.health.healthGrade === 'CRITICAL_BREAKDOWN_IMMINENT';
                  const isRisk = v.health.healthGrade === 'ELEVATED_RISK';

                  return (
                    <tr key={v.vehicleId} className="hover:bg-[var(--bg-surface-hover)] transition">
                      <td className="p-3.5">
                        <div className="font-bold text-[var(--text-main)]">{v.vehicleCode}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">{v.makeModel}</div>
                        <div className="text-[10px] text-[var(--text-faint)] font-mono">{v.licensePlate}</div>
                      </td>

                      <td className="p-3.5 font-mono">
                        <div
                          className={`text-base font-bold ${
                            isCritical
                              ? 'text-rose-400'
                              : isRisk
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {v.health.vhiScore}%
                        </div>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold ${
                            isCritical
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : isRisk
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {v.health.healthGrade}
                        </span>
                      </td>

                      {/* Sensor Gauges */}
                      <td className="p-3.5 space-y-1 font-mono text-[11px]">
                        <div className="flex items-center gap-2">
                          <Thermometer className="w-3 h-3 text-[var(--text-muted)]" />
                          <span
                            className={
                              v.sensors.coolantTempC >= 105 ? 'text-rose-400 font-bold' : 'text-[var(--text-muted)]'
                            }
                          >
                            Coolant: {v.sensors.coolantTempC}°C
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Gauge className="w-3 h-3 text-[var(--text-muted)]" />
                          <span
                            className={
                              v.sensors.oilPressureKpa < 180 ? 'text-rose-400 font-bold' : 'text-[var(--text-muted)]'
                            }
                          >
                            Oil: {v.sensors.oilPressureKpa} kPa
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[var(--text-muted)] text-[10px]">
                          <span>Battery: {v.sensors.batteryVoltage.toFixed(1)}V</span>
                          <span>· DEF: {v.sensors.defLevelPercent}%</span>
                        </div>
                      </td>

                      {/* Active DTC Faults */}
                      <td className="p-3.5">
                        {!v.health.activeDtcFaults.length ? (
                          <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" /> No active DTCs
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {v.health.activeDtcFaults.map((dtc) => (
                              <span
                                key={dtc.code}
                                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                                  dtc.severity === 'CRITICAL'
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                }`}
                                title={`${dtc.title}: ${dtc.description}`}
                              >
                                {dtc.code}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Predictive Risk Description */}
                      <td className="p-3.5 text-[11px] max-w-xs">
                        <p className="text-[var(--text-muted)]">{v.health.breakdownRiskDescription}</p>
                        {v.health.recommendedWorkshopAction && (
                          <p className="text-cyan-400 font-semibold mt-0.5">
                            👉 {v.health.recommendedWorkshopAction}
                          </p>
                        )}
                      </td>

                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => setSelectedVehicle(v)}
                          className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold border border-[var(--border-subtle)] transition"
                        >
                          Deep Dive
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
    </div>
  );
}
