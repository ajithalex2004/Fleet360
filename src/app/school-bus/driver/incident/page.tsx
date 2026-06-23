'use client';

import React, { useEffect, useState } from 'react';

interface Trip { id: string; route_name: string | null; session_type: string | null; }

const TYPES = ['INCIDENT', 'BREAKDOWN', 'GEOFENCE_EXIT'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function SchoolBusIncidentPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState('');
  const [eventType, setEventType] = useState<typeof TYPES[number]>('INCIDENT');
  const [severity, setSeverity] = useState('LOW');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const driver = typeof window !== 'undefined' ? localStorage.getItem('sbDriverCode') ?? '' : '';
    if (!driver) return;
    fetch(`/api/school-bus/driver/today?driverCode=${encodeURIComponent(driver)}`)
      .then(r => r.ok ? r.json() : { trips: [] })
      .then(d => setTrips(d.trips ?? []))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/school-bus/trips/${tripId}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType, description,
          metadata: { severity },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Submit failed');
      setMsg({ kind: 'ok', text: 'Incident logged. Dispatch and guardians have been notified.' });
      setDescription('');
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Submit failed' });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Report Incident</h1>
        <p className="text-sm text-slate-400">Filing this notifies dispatch AND all parents on the route.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Trip *</label>
          <select required value={tripId} onChange={e => setTripId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
            <option value="">Select today's trip</option>
            {trips.map(t => <option key={t.id} value={t.id}>{t.route_name ?? t.id.slice(0, 8)} · {t.session_type ?? '—'}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Type *</label>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map(t => (
              <button type="button" key={t} onClick={() => setEventType(t)}
                className={`py-2.5 rounded-lg text-xs font-medium border ${eventType === t ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Severity</label>
          <div className="grid grid-cols-4 gap-2">
            {SEVERITIES.map(s => (
              <button type="button" key={s} onClick={() => setSeverity(s)}
                className={`py-2 rounded-lg text-xs font-medium border ${severity === s ? (s === 'CRITICAL' ? 'bg-rose-700' : s === 'HIGH' ? 'bg-rose-600' : s === 'MEDIUM' ? 'bg-amber-600' : 'bg-slate-600') + ' border-white/30 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Description *</label>
          <textarea required value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What happened?"
            className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white" />
        </div>

        {msg && (
          <div className={`p-3 rounded-lg text-sm ${msg.kind === 'ok' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-200 border border-rose-500/40'}`}>
            {msg.text}
          </div>
        )}

        <button type="submit" disabled={busy || !description || !tripId}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-red-700 to-rose-700 text-white font-semibold disabled:opacity-50">
          {busy ? 'Submitting…' : '⚠ Report Incident'}
        </button>
      </form>
    </div>
  );
}
