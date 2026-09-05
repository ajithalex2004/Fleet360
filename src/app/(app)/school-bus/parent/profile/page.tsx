'use client';

import React, { useEffect, useState } from 'react';

export default function ParentProfilePage() {
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPhone(localStorage.getItem('parentGuardianPhone') ?? '');
    }
  }, []);

  const save = () => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('parentGuardianPhone', phone.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const clear = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('parentGuardianPhone');
    setPhone('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-[var(--text-muted)]">Pin the phone number you registered with the school. We use it to find your children.</p>
      </div>

      <div className="rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] p-5 space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1.5 font-semibold">Guardian Phone *</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+971 50 000 0000"
            inputMode="tel"
            className="w-full px-4 py-3 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-[var(--text-main)] text-lg font-mono focus:border-amber-500 focus:outline-none"
          />
          <p className="text-[11px] text-[var(--text-faint)] mt-1">Same format you gave the school registrar.</p>
        </div>

        <div className="flex gap-3">
          <button onClick={clear} className="flex-1 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--text-muted)]">Clear</button>
          <button onClick={save} disabled={!phone.trim()} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-semibold disabled:opacity-50">
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-faint)]">Stored locally on this device only. No server account needed yet.</p>
      </div>
    </div>
  );
}
