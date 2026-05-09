'use client';

import React, { useEffect, useState } from 'react';

export default function DriverProfilePage() {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCode(localStorage.getItem('busDriverCode') ?? '');
      setName(localStorage.getItem('busDriverName') ?? '');
    }
  }, []);

  const save = () => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('busDriverCode', code.trim());
    localStorage.setItem('busDriverName', name.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clear = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('busDriverCode');
    localStorage.removeItem('busDriverName');
    setCode(''); setName('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Me</h1>
        <p className="text-sm text-slate-400">Pin your driver code so the Today tab filters to your trips.</p>
      </div>

      <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-5 space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Driver Code / ID *</label>
          <input
            value={code} onChange={e => setCode(e.target.value)}
            placeholder="e.g. d-1234"
            className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-white/10 text-white text-lg font-mono"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Display Name (optional)</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Your name"
            className="w-full px-4 py-3 rounded-xl bg-slate-900/60 border border-white/10 text-white"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={clear} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-300">Clear</button>
          <button onClick={save} disabled={!code.trim()} className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-50">
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          Stored locally on this device only. Use the same browser/PWA install on the same phone — no server account needed yet.
        </p>
      </div>
    </div>
  );
}
