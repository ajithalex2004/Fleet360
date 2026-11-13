'use client';

/**
 * Rate Events admin — calendar of festival / event-driven price adjustments.
 * Operators add Eid / DSF / F1 / Cricket / NYE windows and the yield engine
 * applies the multiplier automatically when bookings overlap.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Pencil, Trash2, ShieldAlert } from 'lucide-react';
import { BACK_BUTTON } from '@/lib/ui/toggle';

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
  { eventCode: 'DSF',          name: 'Dubai Shopping Festival',  multiplier: 1.20 },
  { eventCode: 'EID_FITR',     name: 'Eid Al-Fitr',              multiplier: 1.30 },
  { eventCode: 'EID_ADHA',     name: 'Eid Al-Adha',              multiplier: 1.30 },
  { eventCode: 'NYE',          name: 'New Year holiday',         multiplier: 1.40 },
  { eventCode: 'F1',           name: 'Abu Dhabi Grand Prix',     multiplier: 1.45 },
  { eventCode: 'NATIONAL_DAY', name: 'UAE National Day',         multiplier: 1.25 },
  { eventCode: 'SUMMER_LOW',   name: 'Summer low-demand period', multiplier: 0.85 },
  { eventCode: 'GITEX',        name: 'GITEX Tech Week',          multiplier: 1.30 },
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rbacError, setRbacError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rental/rate-events', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(data?.error ?? 'Requires permission to view rate events.');
        setEvents([]);
        return;
      }
      if (!res.ok) {
        setError(data?.error ?? `Failed to load rate events (${res.status})`);
        setEvents([]);
        return;
      }
      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.events)
            ? data.events
            : [];
      setEvents(rows);
    } catch {
      setError('Failed to load rate events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function applyPreset(preset: typeof PRESETS[number]) {
    setEditingId(null);
    setForm((f) => ({
      ...f,
      eventCode: preset.eventCode,
      name: preset.name,
      multiplier: preset.multiplier,
    }));
  }

  function openNew() {
    setEditingId(null);
    setForm(blankForm);
    setError(null);
    setShowForm(true);
  }

  function openEdit(ev: RateEvent) {
    setEditingId(ev.id);
    setError(null);
    setForm({
      eventCode: ev.eventCode ?? '',
      name: ev.name ?? '',
      description: ev.description ?? '',
      dateFrom: ev.dateFrom ? ev.dateFrom.slice(0, 10) : '',
      dateTo: ev.dateTo ? ev.dateTo.slice(0, 10) : '',
      multiplier: Number(ev.multiplier) || 1.0,
      applicableCategories: ev.applicableCategories ?? '',
      applicableChannels: ev.applicableChannels ?? '',
      priority: ev.priority ?? 0,
      isActive: ev.isActive ?? true,
      notes: ev.notes ?? '',
    });
    setShowForm(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setRbacError(null);
    try {
      const url = editingId
        ? `/api/rental/rate-events/${encodeURIComponent(editingId)}`
        : '/api/rental/rate-events';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = data.error ?? 'Requires RAC Manager permission to configure event surge multipliers.';
        setRbacError(msg);
        setError(`Requires RAC Manager permission (403): ${msg}`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Server returned ${res.status}`);
        return;
      }
      setShowForm(false);
      setEditingId(null);
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
    setRbacError(null);
    setError(null);
    try {
      const res = await fetch(`/api/rental/rate-events/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacError(data.error ?? 'Requires RAC Manager permission to delete rate events.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `Failed to delete rate event (${res.status})`);
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rate event');
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/rental/rates" className={BACK_BUTTON}>
            <ChevronLeft className="h-3 w-3" /> Back to Master Price List
          </Link>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mt-2">Event Surge Multipliers</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Calendar-driven multipliers applied by the yield engine. Set up DSF, Eid,
            F1 etc. once — pricing adjusts automatically for any booking overlap.
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
        >
          <Plus className="h-4 w-4" /> New Event
        </button>
      </div>

      {/* Quick presets */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-xl p-4">
        <div className="text-xs text-[var(--text-muted)] mb-2">Quick presets — click to load form:</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.eventCode}
              onClick={() => { applyPreset(p); setError(null); setShowForm(true); }}
              className="text-xs px-3 py-1 rounded-full bg-[var(--bg-surface-hover)]/60 text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-strong)]"
              title={`${p.eventCode} — multiplier ${p.multiplier}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {rbacError && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Requires RAC Manager Permission (403)</p>
              <p className="text-xs text-amber-200/80 mt-0.5">{rbacError}</p>
            </div>
          </div>
          <button onClick={() => setRbacError(null)} className="text-amber-300/70 hover:text-amber-200 text-sm">✕</button>
        </div>
      )}

      {error && !rbacError && (
        <div className="rounded-xl bg-rose-900/30 border border-rose-700 p-4 text-rose-200 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-200/80 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Existing events table */}
      {loading ? (
        <div className="text-[var(--text-faint)] text-center py-12">Loading…</div>
      ) : events.length === 0 ? (
        <div className="p-8 rounded-xl bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] text-center text-[var(--text-muted)]">
          No rate events yet. Add one or pick a preset above.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-surface)]/60">
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Multiplier</th>
                <th className="px-4 py-3">Categories</th>
                <th className="px-4 py-3">Channels</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const m = Number(e.multiplier);
                const pct = ((m - 1) * 100).toFixed(0);
                return (
                  <tr key={e.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]/30">
                    <td className="px-4 py-3 font-mono text-cyan-300">{e.eventCode}</td>
                    <td className="px-4 py-3 text-[var(--text-main)]">{e.name}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                      {new Date(e.dateFrom).toLocaleDateString('en-GB')} → {new Date(e.dateTo).toLocaleDateString('en-GB')}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${m > 1 ? 'text-rose-300' : m < 1 ? 'text-emerald-300' : 'text-[var(--text-muted)]'}`}>
                      {m.toFixed(2)}× ({m > 1 ? '+' : ''}{pct}%)
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{e.applicableCategories ?? 'ALL'}</td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{e.applicableChannels ?? 'ALL'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{e.priority ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${e.isActive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-strong)]'}`}>
                        {e.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(e)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 text-xs font-medium transition-colors"
                          title="Edit event"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => remove(e.id)}
                          className="text-rose-400 hover:text-rose-300 p-1"
                          title="Soft-delete"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[var(--text-main)]">
                {editingId ? 'Edit Rate Event' : 'New Rate Event'}
              </h2>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                ×
              </button>
            </div>
            {error && (
              <div className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
                {error}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--text-muted)]">Event code *</label>
                <input
                  type="text"
                  value={form.eventCode}
                  onChange={(e) => setForm({ ...form, eventCode: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                  placeholder="DSF"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)]">Display name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Dubai Shopping Festival"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)]">From *</label>
                <input
                  type="date"
                  value={form.dateFrom}
                  onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)]">To *</label>
                <input
                  type="date"
                  value={form.dateTo}
                  onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)]">Multiplier *</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="5"
                  value={form.multiplier}
                  onChange={(e) => setForm({ ...form, multiplier: parseFloat(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                />
                <div className="text-[10px] text-[var(--text-faint)] mt-1">
                  1.20 = +20% surge · 0.85 = -15% off
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)]">Priority</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                />
                <div className="text-[10px] text-[var(--text-faint)] mt-1">Higher wins on overlap</div>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--text-muted)]">Applicable categories (CSV or blank = ALL)</label>
                <input
                  type="text"
                  value={form.applicableCategories}
                  onChange={(e) => setForm({ ...form, applicableCategories: e.target.value })}
                  placeholder="e.g. LUXURY,FULL_SIZE_SUV"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--text-muted)]">Applicable channels (CSV or blank = ALL)</label>
                <input
                  type="text"
                  value={form.applicableChannels}
                  onChange={(e) => setForm({ ...form, applicableChannels: e.target.value })}
                  placeholder="e.g. DIRECT,ONLINE"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm font-mono"
                />
              </div>
              <div className="col-span-2 flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="rateEventActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 accent-teal-500 rounded"
                />
                <label htmlFor="rateEventActive" className="text-xs text-[var(--text-main)]">
                  Active (applied automatically during date window)
                </label>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-[var(--text-muted)]">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !form.eventCode || !form.name || !form.dateFrom || !form.dateTo}
                className="px-6 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Saving…' : editingId ? 'Update Event' : 'Save Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
