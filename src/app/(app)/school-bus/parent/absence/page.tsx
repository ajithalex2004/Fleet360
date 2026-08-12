'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Student {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  studentCode: string | null;
}

const SESSIONS = [
  { value: 'BOTH', label: 'Whole day' },
  { value: 'MORNING', label: 'Morning only' },
  { value: 'AFTERNOON', label: 'Afternoon only' },
];

export default function ParentAbsencePage() {
  const [phone, setPhone] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [date, setDate] = useState(() => {
    const d = new Date(Date.now() + 86400000); // tomorrow default
    return d.toISOString().slice(0, 10);
  });
  const [sessionType, setSessionType] = useState<'BOTH' | 'MORNING' | 'AFTERNOON'>('BOTH');
  const [reason, setReason] = useState('Family commitment');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const todayDate = new Date().toISOString().slice(0, 10);

  const load = useCallback(async (p: string) => {
    if (!p) return;
    try {
      const res = await fetch(`/api/school-bus/parent/today?guardianPhone=${encodeURIComponent(p)}`);
      const json = await res.json();
      if (res.ok) {
        const list: Student[] = (json.students ?? []).map((s: { studentId: string; firstName: string | null; lastName: string | null; studentCode: string | null }) => ({
          studentId: s.studentId, firstName: s.firstName, lastName: s.lastName, studentCode: s.studentCode,
        }));
        setStudents(list);
        if (list.length === 1) setStudentId(list[0].studentId);
      }
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = localStorage.getItem('parentGuardianPhone') ?? '';
    setPhone(p);
    load(p);
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId) { setMsg({ kind: 'err', text: 'Pick a child first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/school-bus/parent/absence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, date, sessionType, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setMsg({ kind: 'ok', text: `Absence recorded for ${date} (${sessionType.toLowerCase()}). The bus won't stop for them.` });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  };

  if (!phone) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Mark Absence</h1>
        <Link href="/school-bus/parent/profile" className="block text-center py-3 rounded-xl bg-amber-600 text-white">Set Phone Number first →</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/school-bus/parent" className="text-xs text-amber-400 hover:underline">← Today</Link>
      <div>
        <h1 className="text-2xl font-bold">Mark Absence</h1>
        <p className="text-sm text-slate-400">The bus skips your child's stop for the selected sessions.</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Child *</label>
          <select required value={studentId} onChange={e => setStudentId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white focus:border-amber-500 focus:outline-none">
            <option value="">Select child</option>
            {students.map(s => (
              <option key={s.studentId} value={s.studentId}>
                {[s.firstName, s.lastName].filter(Boolean).join(' ') || s.studentCode}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Date *</label>
          <input type="date" required min={todayDate} value={date} onChange={e => setDate(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white focus:border-amber-500 focus:outline-none" />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Session</label>
          <div className="grid grid-cols-3 gap-2">
            {SESSIONS.map(s => (
              <button key={s.value} type="button" onClick={() => setSessionType(s.value as 'BOTH' | 'MORNING' | 'AFTERNOON')}
                className={`py-2.5 rounded-lg text-xs font-medium border ${sessionType === s.value ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-300'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-white focus:border-amber-500 focus:outline-none">
            <option>Family commitment</option>
            <option>Sick</option>
            <option>Doctor's appointment</option>
            <option>School trip</option>
            <option>Picked up by parent</option>
            <option>Other</option>
          </select>
        </div>

        {msg && (
          <div className={`p-3 rounded-lg text-sm border ${msg.kind === 'ok' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200' : 'bg-rose-500/20 border-rose-500/40 text-rose-200'}`}>
            {msg.text}
          </div>
        )}

        <button type="submit" disabled={busy || !studentId} className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Mark Absent'}
        </button>
      </form>
    </div>
  );
}
