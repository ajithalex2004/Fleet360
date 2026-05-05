'use client';

import React, { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
type DutyStatus = 'DRIVING' | 'ON_DUTY' | 'OFF_DUTY' | 'SLEEPER_BERTH';
type ViolationType = 'DAILY_DRIVING' | 'DAILY_ON_DUTY' | 'WEEKLY_DRIVING' | 'WEEKLY_ON_DUTY' | 'REST_BREAK';
type RiskLevel = 'GREEN' | 'AMBER' | 'RED';

interface HosLog {
  id: string;
  driverId: string;
  driverName: string | null;
  vehicleId: string | null;
  vehicleCode: string | null;
  dutyStatus: DutyStatus;
  startedAt: string;
  endedAt: string | null;
  durationMins: number | null;
  location: string | null;
  notes: string | null;
  source: string;
}

interface DriverSummary {
  driverId: string;
  driverName: string;
  today: {
    drivingMins: number;
    onDutyMins: number;
    offDutyMins: number;
    drivingHours: number;
    onDutyHours: number;
    remainingDrivingHours: number;
    remainingOnDutyHours: number;
  };
  week: {
    drivingHours: number;
    onDutyHours: number;
    remainingWeeklyDrivingHours: number;
    remainingWeeklyOnDutyHours: number;
  };
  currentStatus: DutyStatus | null;
  currentStatusSince: string | null;
  openViolations: number;
  riskLevel: RiskLevel;
}

interface HosViolation {
  id: string;
  driverId: string;
  driverName: string | null;
  violationType: ViolationType;
  occurredAt: string;
  severity: string;
  description: string | null;
  hoursExceeded: number | null;
  status: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_META: Record<DutyStatus, { label: string; color: string; bg: string; border: string; icon: string }> = {
  DRIVING: { label: 'Driving', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30', icon: '🚗' },
  ON_DUTY: { label: 'On Duty', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/30', icon: '🔷' },
  OFF_DUTY: { label: 'Off Duty', color: 'text-slate-400', bg: 'bg-slate-500/20', border: 'border-slate-500/30', icon: '⭕' },
  SLEEPER_BERTH: { label: 'Sleeper Berth', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/30', icon: '🌙' },
};

const VIOLATION_META: Record<ViolationType, { label: string; rule: string }> = {
  DAILY_DRIVING: { label: 'Daily Driving Limit', rule: 'Exceeded 10-hour daily driving limit' },
  DAILY_ON_DUTY: { label: 'Daily On-Duty Limit', rule: 'Exceeded 14-hour on-duty window' },
  WEEKLY_DRIVING: { label: 'Weekly Driving Limit', rule: 'Exceeded 56-hour 7-day driving limit' },
  WEEKLY_ON_DUTY: { label: 'Weekly On-Duty Limit', rule: 'Exceeded 70-hour 8-day on-duty limit' },
  REST_BREAK: { label: 'Mandatory Rest Break', rule: 'Drove >5.5 hours without a 30-min break' },
};

const RISK_META: Record<RiskLevel, { label: string; color: string; bg: string; border: string; dot: string }> = {
  GREEN: { label: 'Compliant', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  AMBER: { label: 'Caution', color: 'text-amber-400', bg: 'bg-amber-500/20', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  RED: { label: 'Violation', color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30', dot: 'bg-red-400' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' });
}
function hoursBar(used: number, max: number): number {
  return Math.min(100, (used / max) * 100);
}
function barColor(used: number, max: number): string {
  const pct = used / max;
  if (pct >= 1) return 'bg-red-500';
  if (pct >= 0.8) return 'bg-amber-500';
  return 'bg-emerald-500';
}

// ─── Log Entry Modal ──────────────────────────────────────────────────────────
function LogEntryModal({
  onClose,
  onSaved,
  driverIdDefault,
}: {
  onClose: () => void;
  onSaved: () => void;
  driverIdDefault?: string;
}) {
  const [form, setForm] = useState({
    driver_id: driverIdDefault ?? '',
    driver_name: '',
    vehicle_code: '',
    duty_status: 'DRIVING' as DutyStatus,
    started_at: new Date().toISOString().slice(0, 16),
    location: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.driver_id.trim()) { setErr('Driver ID is required'); return; }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/fleet/hos/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          started_at: new Date(form.started_at).toISOString(),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h3 className="text-white font-semibold text-lg">Log Duty Status Entry</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <form onSubmit={save} className="p-6 space-y-4">
          {err && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">{err}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Driver ID *</label>
              <input
                value={form.driver_id}
                onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                placeholder="UUID or code"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Driver Name</label>
              <input
                value={form.driver_name}
                onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                placeholder="Display name"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Duty Status *</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STATUS_META) as DutyStatus[]).map(s => {
                const m = STATUS_META[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, duty_status: s }))}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      form.duty_status === s
                        ? `${m.bg} ${m.border} ${m.color}`
                        : 'bg-slate-800 border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    <span>{m.icon}</span> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Started At *</label>
              <input
                type="datetime-local"
                value={form.started_at}
                onChange={e => setForm(f => ({ ...f, started_at: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Vehicle Code</label>
              <input
                value={form.vehicle_code}
                onChange={e => setForm(f => ({ ...f, vehicle_code: e.target.value }))}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
                placeholder="e.g. VEH-001"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Location</label>
            <input
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
              placeholder="e.g. Dubai Logistics City"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:border-white/20 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white text-sm font-medium hover:shadow-lg hover:shadow-orange-500/20 transition-all disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Log Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Close Log Modal ──────────────────────────────────────────────────────────
function CloseLogModal({ log, onClose, onSaved }: { log: HosLog; onClose: () => void; onSaved: () => void }) {
  const [endedAt, setEndedAt] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState(log.notes ?? '');
  const [saving, setSaving] = useState(false);
  const meta = STATUS_META[log.dutyStatus];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch(`/api/fleet/hos/logs/${log.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: new Date(endedAt).toISOString(), notes }),
      });
      onSaved(); onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="p-6 border-b border-white/10">
          <h3 className="text-white font-semibold">Close Duty Entry</h3>
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mt-2 ${meta.bg} ${meta.border} border ${meta.color}`}>
            {meta.icon} {meta.label} · Started {fmtTime(log.startedAt)}
          </div>
        </div>
        <form onSubmit={save} className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Ended At</label>
            <input
              type="datetime-local"
              value={endedAt}
              onChange={e => setEndedAt(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50 resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white transition-all">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Close Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Driver Card ──────────────────────────────────────────────────────────────
function DriverCard({ summary, onSelect, selected }: { summary: DriverSummary; onSelect: () => void; selected: boolean }) {
  const risk = RISK_META[summary.riskLevel];
  const currMeta = summary.currentStatus ? STATUS_META[summary.currentStatus] : null;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl p-4 border transition-all ${
        selected
          ? 'bg-gradient-to-br from-orange-500/20 to-amber-500/20 border-orange-500/40'
          : 'bg-slate-800/50 border-white/10 hover:border-white/20'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold">
            {(summary.driverName || 'DR').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-white text-sm font-medium">{summary.driverName}</p>
            <p className="text-slate-500 text-xs font-mono">{summary.driverId.slice(0, 8)}…</p>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${risk.bg} ${risk.border} ${risk.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
          {risk.label}
        </div>
      </div>

      {currMeta && (
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs mb-3 ${currMeta.bg} border ${currMeta.border}`}>
          <span>{currMeta.icon}</span>
          <span className={currMeta.color}>{currMeta.label}</span>
          {summary.currentStatusSince && (
            <span className="text-slate-500 ml-1">since {fmtTime(summary.currentStatusSince)}</span>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Driving today</span>
            <span className={summary.today.drivingHours >= 10 ? 'text-red-400' : 'text-slate-300'}>
              {summary.today.drivingHours.toFixed(1)}h / 10h
            </span>
          </div>
          <div className="w-full bg-slate-700/50 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${barColor(summary.today.drivingHours, 10)}`}
              style={{ width: `${hoursBar(summary.today.drivingHours, 10)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">On-duty today</span>
            <span className={summary.today.onDutyHours >= 14 ? 'text-red-400' : 'text-slate-300'}>
              {summary.today.onDutyHours.toFixed(1)}h / 14h
            </span>
          </div>
          <div className="w-full bg-slate-700/50 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${barColor(summary.today.onDutyHours, 14)}`}
              style={{ width: `${hoursBar(summary.today.onDutyHours, 14)}%` }}
            />
          </div>
        </div>
      </div>

      {summary.openViolations > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-red-400">
          <span>⚠️</span>
          <span>{summary.openViolations} open violation{summary.openViolations > 1 ? 's' : ''}</span>
        </div>
      )}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function HosDashboard() {
  const [summaries, setSummaries] = useState<DriverSummary[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [logs, setLogs] = useState<HosLog[]>([]);
  const [violations, setViolations] = useState<HosViolation[]>([]);
  const [activeTab, setActiveTab] = useState<'logs' | 'violations'>('logs');
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<HosLog | null>(null);
  const [error, setError] = useState('');

  const fetchSummaries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fleet/hos/summary');
      if (!res.ok) throw new Error('Failed to fetch HoS summaries');
      const d = await res.json();
      setSummaries(Array.isArray(d) ? d : d.drivers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDriverData = useCallback(async (driverId: string) => {
    setLogsLoading(true);
    try {
      const [logsRes, vRes] = await Promise.all([
        fetch(`/api/fleet/hos/logs?driver_id=${driverId}&limit=50`),
        fetch(`/api/fleet/hos/violations?driver_id=${driverId}&limit=20`),
      ]);
      const logsData = await logsRes.json();
      const vData = await vRes.json();
      setLogs(Array.isArray(logsData) ? logsData : logsData.data ?? []);
      setViolations(Array.isArray(vData) ? vData : vData.data ?? []);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);

  useEffect(() => {
    if (selectedDriver) fetchDriverData(selectedDriver);
  }, [selectedDriver, fetchDriverData]);

  const handleRefresh = () => {
    fetchSummaries();
    if (selectedDriver) fetchDriverData(selectedDriver);
  };

  // Fleet-level KPIs
  const totalDrivers = summaries.length;
  const redCount = summaries.filter(s => s.riskLevel === 'RED').length;
  const amberCount = summaries.filter(s => s.riskLevel === 'AMBER').length;
  const totalViolations = summaries.reduce((a, s) => a + s.openViolations, 0);

  const selected = summaries.find(s => s.driverId === selectedDriver) ?? null;

  const acknowledgeViolation = async (ids: string[]) => {
    await fetch('/api/fleet/hos/violations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status: 'ACKNOWLEDGED' }),
    });
    if (selectedDriver) fetchDriverData(selectedDriver);
    fetchSummaries();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Driver Hours of Service</h1>
          <p className="text-slate-400 mt-1">UAE/GCC duty-cycle compliance · Real-time tracking</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="px-4 py-2 rounded-xl border border-white/10 text-slate-400 text-sm hover:text-white hover:border-white/20 transition-all"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setShowLogModal(true)}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white text-sm font-medium hover:shadow-lg hover:shadow-orange-500/20 transition-all"
          >
            + Log Entry
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>
      )}

      {/* Fleet KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Drivers', value: loading ? '…' : String(totalDrivers), icon: '👤', color: 'text-white', grad: 'from-slate-500/10 to-slate-600/10', border: 'border-slate-500/20' },
          { label: 'Compliant', value: loading ? '…' : String(totalDrivers - redCount - amberCount), icon: '✅', color: 'text-emerald-400', grad: 'from-emerald-500/10 to-green-500/10', border: 'border-emerald-500/20' },
          { label: 'Caution', value: loading ? '…' : String(amberCount), icon: '🟡', color: 'text-amber-400', grad: 'from-amber-500/10 to-yellow-500/10', border: 'border-amber-500/20' },
          { label: 'Violations', value: loading ? '…' : String(totalViolations), icon: '🚨', color: 'text-red-400', grad: 'from-red-500/10 to-rose-500/10', border: 'border-red-500/20' },
        ].map(k => (
          <div key={k.label} className={`bg-gradient-to-br ${k.grad} border ${k.border} rounded-2xl p-4`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-xs font-medium mb-1">{k.label}</p>
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
              </div>
              <span className="text-2xl">{k.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* HoS Rules Reference */}
      <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-4">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">UAE/GCC HoS Regulations</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { rule: 'Max Daily Driving', limit: '10 hrs', icon: '🚗' },
            { rule: 'Max On-Duty Window', limit: '14 hrs', icon: '🔷' },
            { rule: 'Min Rest Period', limit: '8 hrs', icon: '⭕' },
            { rule: 'Break After', limit: '5.5 hrs driving → 30 min', icon: '⏸️' },
            { rule: 'Weekly Driving', limit: '56 hrs / 7 days', icon: '📅' },
          ].map(r => (
            <div key={r.rule} className="bg-slate-900/40 rounded-xl p-3 text-center">
              <div className="text-xl mb-1">{r.icon}</div>
              <p className="text-white text-xs font-semibold">{r.limit}</p>
              <p className="text-slate-500 text-xs mt-0.5">{r.rule}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content: Driver List + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Driver List */}
        <div className="space-y-3">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider px-1">
            Drivers ({totalDrivers})
          </p>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-slate-800/50 border border-white/10 rounded-2xl animate-pulse" />
            ))
          ) : summaries.length === 0 ? (
            <div className="text-center py-12 bg-slate-800/50 border border-white/10 rounded-2xl">
              <div className="text-3xl mb-2">👤</div>
              <p className="text-slate-400 text-sm">No driver logs yet</p>
              <p className="text-slate-500 text-xs mt-1">Use &ldquo;+ Log Entry&rdquo; to start tracking</p>
            </div>
          ) : (
            summaries.map(s => (
              <DriverCard
                key={s.driverId}
                summary={s}
                selected={selectedDriver === s.driverId}
                onSelect={() => setSelectedDriver(prev => prev === s.driverId ? null : s.driverId)}
              />
            ))
          )}
        </div>

        {/* Driver Detail Panel */}
        <div className="lg:col-span-2">
          {!selectedDriver || !selected ? (
            <div className="h-96 flex items-center justify-center bg-slate-800/30 border border-dashed border-white/10 rounded-2xl">
              <div className="text-center">
                <div className="text-4xl mb-3">👈</div>
                <p className="text-slate-400">Select a driver to view their duty log</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Driver Header */}
              <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white font-bold">
                      {(selected.driverName || 'DR').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{selected.driverName}</p>
                      <div className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border mt-0.5 ${RISK_META[selected.riskLevel].bg} ${RISK_META[selected.riskLevel].border} ${RISK_META[selected.riskLevel].color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${RISK_META[selected.riskLevel].dot}`} />
                        {RISK_META[selected.riskLevel].label}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowLogModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-orange-600/20 border border-orange-500/30 text-orange-400 text-xs font-medium hover:bg-orange-600/30 transition-all"
                  >
                    + Log for driver
                  </button>
                </div>

                {/* Hour Gauges */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Driving Today', used: selected.today.drivingHours, max: 10, remaining: selected.today.remainingDrivingHours },
                    { label: 'On-Duty Today', used: selected.today.onDutyHours, max: 14, remaining: selected.today.remainingOnDutyHours },
                    { label: 'Driving This Week', used: selected.week.drivingHours, max: 56, remaining: selected.week.remainingWeeklyDrivingHours },
                    { label: 'On-Duty This Week', used: selected.week.onDutyHours, max: 70, remaining: selected.week.remainingWeeklyOnDutyHours },
                  ].map(g => (
                    <div key={g.label} className="bg-slate-900/40 rounded-xl p-3">
                      <div className="flex justify-between text-xs mb-2">
                        <span className="text-slate-400">{g.label}</span>
                        <span className={g.used >= g.max ? 'text-red-400 font-bold' : 'text-slate-300'}>
                          {g.used.toFixed(1)}h / {g.max}h
                        </span>
                      </div>
                      <div className="w-full bg-slate-700/50 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${barColor(g.used, g.max)}`}
                          style={{ width: `${Math.min(100, (g.used / g.max) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{Math.max(0, g.remaining).toFixed(1)}h remaining</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabs */}
              <div className="border-b border-white/10">
                <div className="flex gap-6">
                  {['logs', 'violations'].map(t => (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t as typeof activeTab)}
                      className={`pb-3 px-1 text-sm font-medium transition-all capitalize ${
                        activeTab === t
                          ? 'text-orange-400 border-b-2 border-orange-400'
                          : 'text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      {t}
                      {t === 'violations' && selected.openViolations > 0 && (
                        <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">
                          {selected.openViolations}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Logs Tab */}
              {activeTab === 'logs' && (
                <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                  {logsLoading ? (
                    <div className="p-8 text-center">
                      <div className="w-8 h-8 border-4 border-slate-700 border-t-orange-500 rounded-full animate-spin mx-auto" />
                    </div>
                  ) : logs.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">No logs recorded</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/5 bg-slate-900/30">
                            <th className="px-4 py-3 text-left text-xs text-slate-400">Status</th>
                            <th className="px-4 py-3 text-left text-xs text-slate-400">Started</th>
                            <th className="px-4 py-3 text-left text-xs text-slate-400">Ended</th>
                            <th className="px-4 py-3 text-left text-xs text-slate-400">Duration</th>
                            <th className="px-4 py-3 text-left text-xs text-slate-400">Location</th>
                            <th className="px-4 py-3 text-left text-xs text-slate-400"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map(log => {
                            const meta = STATUS_META[log.dutyStatus];
                            const isOpen = !log.endedAt;
                            const dur = log.durationMins
                              ? fmtDuration(log.durationMins)
                              : isOpen
                              ? `${fmtDuration(Math.floor((Date.now() - new Date(log.startedAt).getTime()) / 60000))} ⏳`
                              : '—';
                            return (
                              <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                <td className="px-4 py-3">
                                  <span className={`flex items-center gap-1.5 text-xs font-medium ${meta.color}`}>
                                    {meta.icon} {meta.label}
                                    {isOpen && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-300">{fmtDateTime(log.startedAt)}</td>
                                <td className="px-4 py-3 text-xs text-slate-300">{log.endedAt ? fmtDateTime(log.endedAt) : <span className="text-emerald-400">Open</span>}</td>
                                <td className="px-4 py-3 text-xs text-slate-300">{dur}</td>
                                <td className="px-4 py-3 text-xs text-slate-400">{log.location ?? '—'}</td>
                                <td className="px-4 py-3">
                                  {isOpen && (
                                    <button
                                      onClick={() => setCloseTarget(log)}
                                      className="px-2.5 py-1 text-xs rounded-lg bg-slate-700/50 border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition-all"
                                    >
                                      Close
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Violations Tab */}
              {activeTab === 'violations' && (
                <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
                  {logsLoading ? (
                    <div className="p-8 text-center">
                      <div className="w-8 h-8 border-4 border-slate-700 border-t-orange-500 rounded-full animate-spin mx-auto" />
                    </div>
                  ) : violations.length === 0 ? (
                    <div className="p-8 text-center">
                      <div className="text-3xl mb-2">✅</div>
                      <p className="text-slate-400 text-sm">No violations recorded</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {violations.map(v => {
                        const vmeta = VIOLATION_META[v.violationType as ViolationType];
                        return (
                          <div key={v.id} className="p-4 flex items-start gap-4">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              v.severity === 'CRITICAL' ? 'bg-red-500/20' : 'bg-amber-500/20'
                            }`}>
                              <span className="text-sm">{v.severity === 'CRITICAL' ? '🚨' : '⚠️'}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-white text-sm font-medium">{vmeta?.label ?? v.violationType}</p>
                                <span className={`px-2 py-0.5 rounded-full text-xs border ${
                                  v.status === 'OPEN'
                                    ? 'bg-red-500/20 border-red-500/30 text-red-400'
                                    : v.status === 'ACKNOWLEDGED'
                                    ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                                    : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                }`}>
                                  {v.status}
                                </span>
                              </div>
                              <p className="text-slate-400 text-xs mt-0.5">{vmeta?.rule}</p>
                              {v.hoursExceeded && (
                                <p className="text-xs text-red-400 mt-0.5">{Number(v.hoursExceeded).toFixed(1)}h exceeded</p>
                              )}
                              <p className="text-slate-500 text-xs mt-1">{fmtDateTime(v.occurredAt)}</p>
                            </div>
                            {v.status === 'OPEN' && (
                              <button
                                onClick={() => acknowledgeViolation([v.id])}
                                className="px-3 py-1.5 text-xs rounded-lg bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/30 transition-all flex-shrink-0"
                              >
                                Acknowledge
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showLogModal && (
        <LogEntryModal
          onClose={() => setShowLogModal(false)}
          onSaved={handleRefresh}
          driverIdDefault={selectedDriver ?? undefined}
        />
      )}
      {closeTarget && (
        <CloseLogModal
          log={closeTarget}
          onClose={() => setCloseTarget(null)}
          onSaved={handleRefresh}
        />
      )}
    </div>
  );
}
