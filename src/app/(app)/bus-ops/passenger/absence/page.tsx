'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function PassengerAbsencePage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null);
  const [tripDate, setTripDate] = useState(() => {
    const d = new Date(Date.now() + 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('Personal leave');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const eid = typeof window !== 'undefined' ? localStorage.getItem('busPassengerEmployeeId') : null;
    if (!eid) return;
    setEmployeeId(eid);
    fetch(`/api/bus-ops/passenger/today?employeeId=${encodeURIComponent(eid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setStaffMemberId(d?.staff?.id ?? null))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffMemberId) { setMsg({ kind: 'err', text: 'Profile not loaded — set your employee ID first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/bus-ops/transport-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffMemberId,
          requestType: 'TEMPORARY',
          tripDate: new Date(tripDate).toISOString(),
          reason: `ABSENCE: ${reason}`,
          status: 'PENDING',
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Submission failed');
      }
      setMsg({ kind: 'ok', text: 'Absence recorded. Dispatch will free your seat for tomorrow\'s waitlist.' });
      setTimeout(() => router.push('/bus-ops/passenger'), 1500);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Submission failed' });
    } finally {
      setBusy(false);
    }
  };

  if (!employeeId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Absence</h1>
        <Link href="/bus-ops/passenger/profile" className="block text-center py-3 rounded-xl bg-cyan-600 text-white">Set Employee ID first →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/bus-ops/passenger" className="text-xs text-cyan-400 hover:underline">← My Bus</Link>
      <div>
        <h1 className="text-2xl font-bold">Mark Absence</h1>
        <p className="text-sm text-slate-400">Skip the bus on a specific date so dispatch can free your seat for the waitlist.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Date *</label>
          <input
            type="date" required min={new Date().toISOString().slice(0, 10)}
            value={tripDate} onChange={e => setTripDate(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white">
            <option>Personal leave</option>
            <option>Sick leave</option>
            <option>Working from home</option>
            <option>Annual leave</option>
            <option>Out of country</option>
            <option>Other</option>
          </select>
        </div>

        {msg && (
          <div className={`p-3 rounded-lg text-sm ${msg.kind === 'ok' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-200 border border-rose-500/40'}`}>
            {msg.text}
          </div>
        )}

        <button type="submit" disabled={busy} className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50">
          {busy ? 'Submitting…' : 'Mark Absent'}
        </button>
      </form>
    </div>
  );
}
