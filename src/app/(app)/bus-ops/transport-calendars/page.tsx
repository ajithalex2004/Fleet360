'use client';
/**
 * /bus-ops/transport-calendars — Transport Calendar management.
 *
 * Split pane: calendar list on the left, entries table for the
 * selected calendar on the right. New calendar + new entry via
 * inline modals.
 *
 * The schedule-template generator reads active calendars during
 * generation — HOLIDAY entries block that date, WORKING_OVERRIDE
 * entries force generation even if the day-of-week isn't active.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

type EntryKind = 'HOLIDAY' | 'WORKING_OVERRIDE' | 'HALF_DAY' | 'REDUCED_SERVICE';

interface Entry {
  id: string;
  calendarId: string;
  entryDate: string;
  kind: EntryKind;
  note: string | null;
}
interface Calendar {
  id: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
  entries: Entry[];
}

const KIND_PILL: Record<EntryKind, string> = {
  HOLIDAY:          'bg-rose-500/20 text-rose-300 border-rose-500/40',
  WORKING_OVERRIDE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  HALF_DAY:         'bg-amber-500/20 text-amber-300 border-amber-500/40',
  REDUCED_SERVICE:  'bg-sky-500/20 text-sky-300 border-sky-500/40',
};
const KIND_LABEL: Record<EntryKind, string> = {
  HOLIDAY: 'Holiday — skip',
  WORKING_OVERRIDE: 'Working override — force',
  HALF_DAY: 'Half day',
  REDUCED_SERVICE: 'Reduced service',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function TransportCalendarsPage() {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNewCalendar, setShowNewCalendar] = useState(false);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/bus-ops/transport-calendars', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Calendar[];
      setCalendars(data);
      // Auto-select first calendar if none selected.
      if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calendars');
    } finally { setLoading(false); }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => calendars.find(c => c.id === selectedId) ?? null, [calendars, selectedId]);

  const deleteEntry = async (entryId: string) => {
    if (!selectedId || !confirm('Remove this entry?')) return;
    try {
      const res = await fetch(`/api/bus-ops/transport-calendars/${selectedId}/entries/${entryId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const deleteCalendar = async (id: string) => {
    if (!confirm('Delete this calendar? (soft delete — its entries stay but stop applying)')) return;
    try {
      const res = await fetch(`/api/bus-ops/transport-calendars/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const entryColumns: DataGridColumn<Entry>[] = [
    { key: 'entryDate', header: 'Date', accessor: e => e.entryDate,
      render: e => <span className="text-white whitespace-nowrap">{fmtDate(e.entryDate)}</span> },
    { key: 'kind', header: 'Kind', accessor: e => e.kind, filter: 'select',
      render: e => (
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${KIND_PILL[e.kind]}`}>
          {KIND_LABEL[e.kind]}
        </span>
      ) },
    { key: 'note', header: 'Note', accessor: e => e.note,
      render: e => <span className="text-slate-300 truncate max-w-md block">{e.note ?? '—'}</span> },
    { key: 'actions', header: 'Actions', align: 'right', filter: false, sortable: false,
      render: e => (
        <button onClick={() => deleteEntry(e.id)}
          className="p-1 rounded border border-white/10 text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transport Calendars"
        subtitle={`${calendars.length} calendar${calendars.length === 1 ? '' : 's'} · holidays and working overrides consumed by the schedule template generator`}
        icon={CalendarDays}
        accent="violet"
        actions={
          <button onClick={() => setShowNewCalendar(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> New Calendar
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: calendar list */}
        <div className="lg:col-span-1 space-y-2">
          {loading ? (
            <div className="text-slate-400 text-sm animate-pulse py-6 text-center">Loading…</div>
          ) : calendars.length === 0 ? (
            <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 text-center text-slate-400 text-sm">
              No calendars yet. Click <strong className="text-violet-300">New Calendar</strong>.
            </div>
          ) : (
            calendars.map(c => (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${
                  selectedId === c.id
                    ? 'bg-violet-500/10 border-violet-500/40'
                    : 'bg-slate-800/50 border-white/10 hover:border-white/20'
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{c.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {fmtDate(c.effectiveFrom)} → {c.effectiveTo ? fmtDate(c.effectiveTo) : 'open'}
                      <span className="ml-2">· {c.entries.length} entries</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!c.isActive && <span className="text-[10px] text-slate-500 italic">inactive</span>}
                    <button onClick={e => { e.stopPropagation(); deleteCalendar(c.id); }}
                      className="p-1 rounded border border-white/10 text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right: entries table */}
        <div className="lg:col-span-2">
          {selected ? (
            <FleetDataGrid
              gridName="CalendarEntries"
              rows={selected.entries}
              getRowId={e => e.id}
              loading={false}
              emptyMessage="No entries yet."
              columns={entryColumns}
              numbered
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              toolbar={{
                title: selected.name,
                exportName: `calendar-${selected.name}`,
                actions: (
                  <>
                    {selectedIds.size > 0 && (
                      <span className="inline-flex items-center gap-2 text-xs text-violet-300">
                        {selectedIds.size} selected
                        <button type="button" onClick={() => setSelectedIds(new Set())}
                          className="text-slate-400 hover:text-white underline underline-offset-2">
                          Clear
                        </button>
                      </span>
                    )}
                    <button onClick={() => setShowNewEntry(true)}
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-500/20 border border-violet-500/40 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/30">
                      <Plus className="w-3.5 h-3.5" /> Add Entry
                    </button>
                  </>
                ),
              }}
            />
          ) : (
            <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-10 text-center text-slate-500 text-sm">
              Select a calendar on the left to see its entries.
            </div>
          )}
        </div>
      </div>

      {showNewCalendar && (
        <NewCalendarModal
          onClose={() => setShowNewCalendar(false)}
          onCreated={(newId) => { setShowNewCalendar(false); setSelectedId(newId); load(); }}
        />
      )}

      {showNewEntry && selected && (
        <NewEntryModal
          calendarId={selected.id}
          onClose={() => setShowNewEntry(false)}
          onCreated={() => { setShowNewEntry(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Sub-modals ────────────────────────────────────────────────────────────

function NewCalendarModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/bus-ops/transport-calendars', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), effectiveFrom, effectiveTo: effectiveTo || null, notes: notes || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const created = await res.json();
      onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-800/95 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">New Calendar</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {err && <div className="mb-3 bg-rose-500/15 border border-rose-500/40 rounded-lg px-3 py-2 text-rose-200 text-xs">{err}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-300 mb-1">Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. UAE Public Holidays 2026"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Effective From *</label>
              <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Effective To</label>
              <input type="date" value={effectiveTo} onChange={e => setEffectiveTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm">
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewEntryModal({ calendarId, onClose, onCreated }: { calendarId: string; onClose: () => void; onCreated: () => void }) {
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState<EntryKind>('HOLIDAY');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!entryDate) { setErr('Date is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/bus-ops/transport-calendars/${calendarId}/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryDate, kind, note: note || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-800/95 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">New Entry</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {err && <div className="mb-3 bg-rose-500/15 border border-rose-500/40 rounded-lg px-3 py-2 text-rose-200 text-xs">{err}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-300 mb-1">Date *</label>
            <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Kind *</label>
            <select value={kind} onChange={e => setKind(e.target.value as EntryKind)}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
              <option value="HOLIDAY">Holiday — skip generation</option>
              <option value="WORKING_OVERRIDE">Working override — force generation</option>
              <option value="HALF_DAY">Half day — informational</option>
              <option value="REDUCED_SERVICE">Reduced service — informational</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-300 mb-1">Note</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Eid al Fitr"
              className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm">
            {saving ? 'Adding…' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
