'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Info } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

type Mode = 'shadow' | 'live' | 'off';

type Settings = {
  mode: Mode;
  useFormulas: boolean;
  hysteresisM: number | null;
  startDwellMs: number | null;
  completeDwellMs: number | null;
  startSpeedKmh: number | null;
  completeSpeedKmh: number | null;
  maxAccuracyM: number | null;
  startWindowMin: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

const empty: Settings = {
  mode: 'shadow',
  useFormulas: true,
  hysteresisM: null,
  startDwellMs: null,
  completeDwellMs: null,
  startSpeedKmh: null,
  completeSpeedKmh: null,
  maxAccuracyM: null,
  startWindowMin: null,
  updatedAt: null,
  updatedBy: null,
};

function numField(v: number | null): string {
  return v == null ? '' : String(v);
}

export default function BusOpsTelemetrySettingsPage() {
  const [form, setForm] = useState<Settings>(empty);
  const [formulas, setFormulas] = useState<Record<string, string>>({});
  const [envMode, setEnvMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/bus-ops/telemetry-settings', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setForm({ ...empty, ...data.settings });
      setFormulas(data.formulas ?? {});
      setEnvMode(data.envOverride?.mode ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setNum = (key: keyof Settings, raw: string) => {
    if (raw.trim() === '') {
      setForm((p) => ({ ...p, [key]: null }));
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setForm((p) => ({ ...p, [key]: n }));
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/bus-ops/telemetry-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: form.mode,
          useFormulas: form.useFormulas,
          hysteresisM: form.hysteresisM,
          startDwellMs: form.startDwellMs,
          completeDwellMs: form.completeDwellMs,
          startSpeedKmh: form.startSpeedKmh,
          completeSpeedKmh: form.completeSpeedKmh,
          maxAccuracyM: form.maxAccuracyM,
          startWindowMin: form.startWindowMin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setForm({ ...empty, ...data.settings });
      setMsg('Settings saved for this tenant.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500/50 focus:outline-none';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5';

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link
          href="/bus-ops"
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Bus Ops
        </Link>
      </div>

      <PageHeader
        title="Telemetry settings"
        subtitle="Auto Start / Complete from GPS · per tenant · shadow mode recommended first"
      />

      {envMode && (
        <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Process env <code className="text-amber-100">TELEMETRY_TRIP_MODE={envMode}</code> is
            set and overrides the mode below for this server process.
          </span>
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}
      {msg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="space-y-6">
          {/* Mode */}
          <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">Rollout mode</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { id: 'shadow', title: 'Shadow', desc: 'Log only — no status writes' },
                  { id: 'live', title: 'Live', desc: 'Apply Start / En Route / Complete' },
                  { id: 'off', title: 'Off', desc: 'Disable telemetry evaluation' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, mode: opt.id }))}
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    form.mode === opt.id
                      ? 'border-violet-500/50 bg-violet-500/15'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="text-sm font-medium text-white">{opt.title}</div>
                  <div className="text-xs text-slate-400 mt-1">{opt.desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Formulas */}
          <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Hysteresis &amp; dwell</h2>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.useFormulas}
                  onChange={(e) => setForm((p) => ({ ...p, useFormulas: e.target.checked }))}
                  className="rounded border-slate-600"
                />
                Use formulas when field is empty
              </label>
            </div>
            <p className="text-xs text-slate-500">
              Leave a number empty to use the formula (if enabled) or engine default. Filling a number
              forces that fixed value for this tenant.
            </p>
            {formulas.hysteresis && (
              <pre className="text-[10px] text-slate-500 bg-black/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {formulas.hysteresis}
                {'\n'}
                {formulas.startDwell}
                {'\n'}
                {formulas.completeDwell}
              </pre>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Hysteresis (m)</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="Auto / formula"
                  value={numField(form.hysteresisM)}
                  onChange={(e) => setNum('hysteresisM', e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Start dwell (ms)</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="e.g. 35000"
                  value={numField(form.startDwellMs)}
                  onChange={(e) => setNum('startDwellMs', e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Complete dwell (ms)</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="e.g. 150000"
                  value={numField(form.completeDwellMs)}
                  onChange={(e) => setNum('completeDwellMs', e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Max GPS accuracy (m)</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="e.g. 45"
                  value={numField(form.maxAccuracyM)}
                  onChange={(e) => setNum('maxAccuracyM', e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Start speed min (km/h)</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="e.g. 8"
                  value={numField(form.startSpeedKmh)}
                  onChange={(e) => setNum('startSpeedKmh', e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Complete speed max (km/h)</label>
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="e.g. 3"
                  value={numField(form.completeSpeedKmh)}
                  onChange={(e) => setNum('completeSpeedKmh', e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Start time window (± min)</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  placeholder="e.g. 60"
                  value={numField(form.startWindowMin)}
                  onChange={(e) => setNum('startWindowMin', e.target.value)}
                />
              </div>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {form.updatedAt
                ? `Last saved ${new Date(form.updatedAt).toLocaleString()}${
                    form.updatedBy ? ` · ${form.updatedBy}` : ''
                  }`
                : 'Not saved yet — defaults apply'}
            </p>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
