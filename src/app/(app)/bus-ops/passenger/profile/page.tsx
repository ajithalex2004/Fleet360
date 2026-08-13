'use client';

import React, { useEffect, useState } from 'react';

export default function PassengerProfilePage() {
  const [eid, setEid] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setEid(localStorage.getItem('busPassengerEmployeeId') ?? '');
    }
  }, []);

  const save = () => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('busPassengerEmployeeId', eid.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const clear = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('busPassengerEmployeeId');
    setEid('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Me</h1>
        <p className="text-sm text-slate-400">Pin your employee ID. The app uses it to look up your trip.</p>
      </div>
      <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-5 space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Employee ID *</label>
          <input
            value={eid} onChange={e => setEid(e.target.value)}
            placeholder="e.g. EMP-1024"
            className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-white/10 text-white text-lg font-mono"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={clear} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-300">Clear</button>
          <button onClick={save} disabled={!eid.trim()} className="flex-1 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50">
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">Stored locally on this device only. No server account needed.</p>
      </div>
    </div>
  );
}
