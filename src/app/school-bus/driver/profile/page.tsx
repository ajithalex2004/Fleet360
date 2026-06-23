'use client';

import React, { useEffect, useState } from 'react';

export default function SchoolBusDriverProfilePage() {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCode(localStorage.getItem('sbDriverCode') ?? '');
      setName(localStorage.getItem('sbDriverName') ?? '');
    }
  }, []);

  const save = () => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('sbDriverCode', code.trim());
    localStorage.setItem('sbDriverName', name.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const clear = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('sbDriverCode');
    localStorage.removeItem('sbDriverName');
    setCode(''); setName('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-slate-400">Pin your driver code so the Trips tab filters to your assigned routes.</p>
      </div>
      <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-5 space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Driver Code / ID *</label>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. d-1234"
            className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-white/10 text-white text-lg font-mono focus:border-rose-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Display Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name"
            className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-white/10 text-white focus:border-rose-500 focus:outline-none" />
        </div>
        <div className="flex gap-3">
          <button onClick={clear} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-300">Clear</button>
          <button onClick={save} disabled={!code.trim()} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-red-700 to-rose-700 text-white font-semibold disabled:opacity-50">
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
