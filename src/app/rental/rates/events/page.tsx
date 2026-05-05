'use client';

/**
 * Rate Events admin — calendar of festival / event-driven price adjustments.
 * Operators add Eid / DSF / F1 / Cricket / NYE windows and the yield engine
 * applies the multiplier automatically when bookings overlap.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';

interface RateEvent {
  id: string;
  eventCode: string;
  name: string;
  description: string | null;
  dateFrom: string;
  dateTo: string;
  multiplier: number;
  applicableCategories: string | null;
  applicableChannels: string | null;
  priority: number | null;
  isActive: boolean | null;
  notes: string | null;
}

const PRESETS = [
  { eventCode: 'DSF',         name: 'Dubai Shopping Festival',  multiplier: 1.20 },
  { eventCode: 'EID_FITR',    name: 'Eid Al-Fitr',              multiplier: 1.30 },
  { eventCode: 'EID_ADHA',    name: 'Eid Al-Adha',              multiplier: 1.30 },
  { eventCode: 'NYE',         name: 'New Year holiday',         multiplier: 1.40 },
  { eventCode: 'F1',          name: 'Abu Dhabi Grand Prix',     multiplier: 1.45 },
  { eventCode: 'NATIONAL_DAY', name: 'UAE National Day',        multiplier: 1.25 },
  { eventCode: 'SUMMER_LOW',  name: 'Summer low-demand period', multiplier: 0.85 },
  { eventCode: 'GITEX',       name: 'GITEX Tech Week',          multiplier: 1.30 },
];

const blankForm = {
  eventCode: '',
  name: '',
  description: '',
  dateFrom: '',
  dateTo: '',
  multiplier: 1.2,
  applicableCategories: '',
  applicableChannels: '',
  priority: 0,
  isActive: true,
  notes: '',
};

export default function RateEventsPage() {
  const [events, setEvents] = useState<RateEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rental/rate-events');
      const data = res.ok ? await res.json() : [];
      setEvents(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function applyPreset(preset: typeof PRESETS[number]) {
    setForm((f) => ({
      ...f,
      eventCode: preset.eventCode,
      name: preset.name,
      multiplier: preset.multiplier,
    }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rental/rate-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setShowForm(false);
      setForm(blankForm);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Soft-delete this event?')) return;
    const res = await fetch(`/api/rental/rate-events/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/rental/rates" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400">
            <ChevronLeft className="h-3 w-3" /> Back to rates
          </Link>
          <h1 className="text-3xl font-bold text-white mt-2">Rate Events</h1>
          <p className="text-sm text-slate-400 mt-1">
            Calendar-driven multipliers applied by the yield engine. Set up DSF, Eid,
            F1 etc. once — pricing adjusts automatically for any booking overlap.
          </p>
        </div>
        <button
          onClick={() => { setForm(blankForm); setShowForm(true); }}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> New Event
        </button>
      </div>

      {/* Quick presets */}
      <div className="bg-slate-900/40 border border-slate-700 rounded-xl p-4">
        <div className="text-xs text-slate-400 mb-2">Quick presets — click to load form:</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.eventCode}
              onClick={() => { applyPreset(p); setShowForm(true); }}
              className="text-xs px-3 py-1 rounded-full bg-slate-700/60 text-slate-200 hover:bg-slate-600/60 border border-slate-600"
              title={`${p.eventCode} — multiplier ${p.multiplier}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm">
          {error}
        </div>
      )}

      {/* Existing events table */}
      {loading ? (
        <div className="text-slate-500 text-center py-12">Loading…</div>
      ) : events.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No rate events yet. Add one or pick a preset above.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Multiplier</th>
                <th className="px-4 py-3">Categories</th>
                <th className="px-4 py-3">Channels</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const m = Number(e.multiplier);
                const pct = ((m - 1) * 100).toFixed(0);
                return (
                  <tr key={e.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-cyan-300">{e.eventCode}</td>
                    <td className="px-4 py-3 text-white">{e.name}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {new Date(e.dateFrom).toLocaleDateString('en-GB')} → {new Date(e.dateTo).toLocaleDateString('en-GB')}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${m > 1 ? 'text-rose-300' : m < 1 ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {m.toFixed(2)}× ({m > 1 ? '+' : ''}{pct}%)
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{e.applicableCategories ?? 'ALL'}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{e.applicableChannels ?? 'ALL'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{e.priority ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${e.isActive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                        {e.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => remove(e.id)}
                        className="text-rose-400 hover:text-rose-300"
                        title="Soft-delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">New Rate Event</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Event code *</label>
                <input
                  type="text"
                  value={form.eventCode}
                  onChange={(e) => setForm({ ...form, eventCode: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                  placeholder="DSF"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Display name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Dubai Shopping Festival"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">From *</label>
                <input
                  type="date"
                  value={form.dateFrom}
                  onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">To *</label>
                <input
                  type="date"
                  value={form.dateTo}
                  onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Multiplier *</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="5"
                  value={form.multiplier}
                  onChange={(e) => setForm({ ...form, multiplier: parseFloat(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
                />
                <div className="text-[10px] text-slate-500 mt-1">
                  1.20 = +20% surge · 0.85 = -15% off
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Priority</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
                />
                <div className="text-[10px] text-slate-500 mt-1">Higher wins on overlap</div>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Applicable categories (CSV or blank = ALL)</label>
                <input
                  type="text"
                  value={form.applicableCategories}
                  onChange={(e) => setForm({ ...form, applicableCategories: e.target.value })}
                  placeholder="e.g. LUXURY_SEDAN,LUXURY_SUV"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Applicable channels (CSV or blank = ALL)</label>
                <input
                  type="text"
                  value={form.applicableChannels}
                  onChange={(e) => setForm({ ...form, applicableChannels: e.target.value })}
                  placeholder="e.g. DIRECT,ONLINE"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !form.eventCode || !form.name || !form.dateFrom || !form.dateTo}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Save Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
