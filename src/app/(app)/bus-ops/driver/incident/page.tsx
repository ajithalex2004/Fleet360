'use client';

import React, { useEffect, useState } from 'react';

interface Trip {
  id: string;
  tripNumber: string | null;
  routeId: string;
  vehicleId: string | null;
  driverId: string | null;
  departureTime: string;
  status: string | null;
  route?: { name?: string };
}

const TYPES = ['ACCIDENT', 'BREAKDOWN', 'DELAY', 'MEDICAL', 'PASSENGER_COMPLAINT', 'OTHER'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export default function DriverIncidentPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [scheduleId, setScheduleId] = useState('');
  const [incidentType, setIncidentType] = useState<typeof TYPES[number]>('DELAY');
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]>('LOW');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [injuries, setInjuries] = useState(false);
  const [policeReport, setPoliceReport] = useState(false);
  const [policeReportNo, setPoliceReportNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/bus-ops/schedules')
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
        const code = typeof window !== 'undefined' ? localStorage.getItem('busDriverCode') : null;
        const today = (Array.isArray(d) ? d : []).filter((t: Trip) => {
          const dt = new Date(t.departureTime);
          if (dt < todayStart || dt >= todayEnd) return false;
          if (code && t.driverId !== code) return false;
          return true;
        });
        setTrips(today);
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const trip = trips.find(t => t.id === scheduleId);
      const res = await fetch('/api/bus-ops/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: scheduleId || null,
          routeId: trip?.routeId ?? null,
          vehicleId: trip?.vehicleId ?? null,
          driverId: trip?.driverId ?? null,
          incidentDate: new Date().toISOString(),
          incidentType,
          severity,
          location: location || null,
          description: description || null,
          injuriesReported: injuries,
          policeReport,
          policeReportNo: policeReportNo || null,
          status: 'OPEN',
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Submit failed');
      }
      setMsg({ kind: 'ok', text: 'Incident reported. Dispatch will follow up.' });
      setLocation(''); setDescription(''); setPoliceReportNo('');
      setInjuries(false); setPoliceReport(false);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Submit failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Report Incident</h1>
        <p className="text-sm text-slate-400">Anything from a delay to an accident — log it now, follow up later.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Trip (optional)">
          <select value={scheduleId} onChange={e => setScheduleId(e.target.value)} className="input">
            <option value="">Not linked to a specific trip</option>
            {trips.map(t => (
              <option key={t.id} value={t.id}>
                {t.tripNumber ?? t.id.slice(0, 8)} — {t.route?.name ?? ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Incident Type *">
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map(t => (
              <button type="button" key={t} onClick={() => setIncidentType(t)}
                className={`py-2 rounded-lg text-[11px] font-medium border ${incidentType === t ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Severity *">
          <div className="grid grid-cols-4 gap-2">
            {SEVERITIES.map(s => (
              <button type="button" key={s} onClick={() => setSeverity(s)}
                className={`py-2 rounded-lg text-xs font-medium border ${severity === s ? (s === 'CRITICAL' ? 'bg-rose-700' : s === 'HIGH' ? 'bg-rose-600' : s === 'MEDIUM' ? 'bg-amber-600' : 'bg-slate-600') + ' border-white/30 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
                {s}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Location">
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. SZR near Mall of Emirates" className="input" />
        </Field>

        <Field label="Description *">
          <textarea required value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What happened?" className="input" />
        </Field>

        <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-white/10">
          <input type="checkbox" checked={injuries} onChange={e => setInjuries(e.target.checked)} className="w-5 h-5" />
          <div className="text-sm font-medium">Injuries reported</div>
        </label>

        <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-white/10">
          <input type="checkbox" checked={policeReport} onChange={e => setPoliceReport(e.target.checked)} className="w-5 h-5" />
          <div className="text-sm font-medium">Police report filed</div>
        </label>

        {policeReport && (
          <Field label="Police Report Number">
            <input value={policeReportNo} onChange={e => setPoliceReportNo(e.target.value)} className="input" />
          </Field>
        )}

        {msg && (
          <div className={`p-3 rounded-lg text-sm ${msg.kind === 'ok' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-200 border border-rose-500/40'}`}>
            {msg.text}
          </div>
        )}

        <button type="submit" disabled={busy || !description} className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-50">
          {busy ? 'Submitting…' : '⚠ Submit Incident'}
        </button>
      </form>

      <style jsx>{`
        .input { width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; background: rgb(30 41 59 / 0.6); border: 1px solid rgb(255 255 255 / 0.1); color: white; }
        .input:focus { outline: none; border-color: rgb(225 29 72); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">{label}</label>
      {children}
    </div>
  );
}
