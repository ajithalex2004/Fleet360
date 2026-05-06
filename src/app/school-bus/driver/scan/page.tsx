'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ScanLine, AlertTriangle, CheckCircle2, ChevronLeft } from 'lucide-react';

interface Trip { id: string; route_name: string | null; session_type: string | null; }

function ScanInner() {
  const sp = useSearchParams();
  const tripIdFromUrl = sp.get('tripId') ?? '';
  const directionFromUrl = (sp.get('direction') ?? 'BOARDING') as 'BOARDING' | 'ALIGHTING';

  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState(tripIdFromUrl);
  const [direction, setDirection] = useState<'BOARDING' | 'ALIGHTING'>(directionFromUrl);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ kind: 'ok' | 'err'; name?: string; medical?: boolean; medicalNotes?: string | null; text: string } | null>(null);

  useEffect(() => {
    const driver = typeof window !== 'undefined' ? localStorage.getItem('sbDriverCode') ?? '' : '';
    if (!driver) return;
    fetch(`/api/school-bus/driver/today?driverCode=${encodeURIComponent(driver)}`)
      .then(r => r.ok ? r.json() : { trips: [] })
      .then(d => setTrips(d.trips ?? []))
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!tripId || !code) return;
    setBusy(true); setLastResult(null);
    try {
      const driver = typeof window !== 'undefined' ? localStorage.getItem('sbDriverCode') ?? '' : '';
      // Try as RFID first, then as student code if 404
      const tryScan = async (asRfid: boolean) => {
        return fetch('/api/school-bus/attendance/scan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tripId, scanType: direction,
            ...(asRfid ? { rfidCard: code } : { studentCode: code }),
            scannedBy: driver,
          }),
        });
      };
      let res = await tryScan(true);
      if (res.status === 404) res = await tryScan(false);
      const data = await res.json();
      if (!res.ok) {
        setLastResult({ kind: 'err', text: data.error ?? 'Scan failed' });
      } else {
        setLastResult({
          kind: 'ok',
          name: data.student?.name,
          medical: data.student?.hasMedicalAlert,
          medicalNotes: data.student?.medicalNotes,
          text: data.deduplicated ? 'Already scanned recently' : `${direction === 'BOARDING' ? 'Boarded' : 'Dropped off'}: ${data.student?.name}`,
        });
        setCode('');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Link href="/school-bus/driver" className="text-xs text-rose-400 hover:underline inline-flex items-center gap-1">
        <ChevronLeft className="w-3 h-3" /> Today
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Scan</h1>
        <p className="text-sm text-slate-400">Scan a student's RFID card or enter their student code.</p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Trip *</label>
        <select required value={tripId} onChange={e => setTripId(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
          <option value="">Select trip</option>
          {trips.map(t => <option key={t.id} value={t.id}>{t.route_name ?? t.id.slice(0, 8)} · {t.session_type ?? '—'}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setDirection('BOARDING')}
          className={`py-2.5 rounded-xl text-sm font-semibold border ${direction === 'BOARDING' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
          ✓ Boarding
        </button>
        <button onClick={() => setDirection('ALIGHTING')}
          className={`py-2.5 rounded-xl text-sm font-semibold border ${direction === 'ALIGHTING' ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
          Drop off
        </button>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">RFID card / Student code</label>
        <input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="Tap card or type code"
          className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white text-2xl font-mono focus:border-rose-500 focus:outline-none"
          autoFocus />
        <p className="text-[11px] text-slate-500 mt-1">Web-NFC card readers send the UID to this field automatically.</p>
      </div>

      <button onClick={submit} disabled={busy || !tripId || !code}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
        <ScanLine className="w-5 h-5" /> {busy ? 'Recording…' : 'Submit Scan'}
      </button>

      {lastResult && (
        <div className={`p-4 rounded-2xl border space-y-2 ${lastResult.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-rose-500/10 border-rose-500/40'}`}>
          <div className="flex items-start gap-2">
            {lastResult.kind === 'ok'
              ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              : <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
            <div className="flex-1">
              <div className={`text-sm font-semibold ${lastResult.kind === 'ok' ? 'text-emerald-200' : 'text-rose-200'}`}>
                {lastResult.text}
              </div>
              {lastResult.medical && (
                <div className="mt-2 p-2 rounded-lg bg-rose-500/20 border border-rose-500/40 text-xs text-rose-200">
                  <span className="font-bold">⚠ MEDICAL ALERT:</span> {lastResult.medicalNotes ?? 'See manifest'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Loading…</div>}>
      <ScanInner />
    </Suspense>
  );
}
