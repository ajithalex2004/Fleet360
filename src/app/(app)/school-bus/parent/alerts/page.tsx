'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCircle2, XCircle } from 'lucide-react';

interface Notification {
  kind: string;
  subject: string | null;
  sent_at: string;
  reached_guardian1: boolean;
  reached_guardian2: boolean;
}

interface Student {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  studentCode: string | null;
  notifications: Notification[];
}

const KIND_COLOR: Record<string, string> = {
  DEPARTURE:  'text-blue-400',
  ETA_5MIN:   'text-amber-400',
  BOARDED:    'text-emerald-400',
  ALIGHTED:   'text-emerald-400',
  NO_SHOW:    'text-rose-400',
  NO_PICKUP:  'text-rose-400',
  INCIDENT:   'text-rose-400',
  CUSTOM:     'text-slate-300',
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ParentAlertsPage() {
  const [phone, setPhone] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    if (!p) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/school-bus/parent/today?guardianPhone=${encodeURIComponent(p)}`);
      const json = await res.json();
      if (res.ok) setStudents(json.students ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = localStorage.getItem('parentGuardianPhone') ?? '';
    setPhone(p);
    load(p);
  }, [load]);

  if (!phone) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Alerts</h1>
        <Link href="/school-bus/parent/profile" className="block text-center py-3 rounded-xl bg-amber-600 text-white">Set Phone Number first →</Link>
      </div>
    );
  }
  if (loading) return <div className="text-slate-500">Loading…</div>;

  const merged = students.flatMap(s => s.notifications.map(n => ({ ...n, studentName: [s.firstName, s.lastName].filter(Boolean).join(' ') || s.studentCode || s.studentId })));
  merged.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Alerts</h1>
        <p className="text-sm text-slate-400">Last 7 days · most recent first</p>
      </div>

      {merged.length === 0 ? (
        <div className="p-6 rounded-2xl bg-slate-800/40 border border-slate-700 text-center text-sm text-slate-400">
          No alerts yet. We'll notify you here when buses depart, your child boards, or anything needs your attention.
        </div>
      ) : (
        <div className="space-y-2">
          {merged.map((n, i) => {
            const reached = n.reached_guardian1 || n.reached_guardian2;
            return (
              <div key={i} className="rounded-xl bg-slate-800/40 border border-white/10 p-3 flex items-start gap-3">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-900/60 border border-white/10 flex items-center justify-center">
                  <Bell className={`w-4 h-4 ${KIND_COLOR[n.kind] ?? 'text-slate-300'}`} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] uppercase tracking-wide font-semibold ${KIND_COLOR[n.kind] ?? 'text-slate-300'}`}>{n.kind}</span>
                    <span className="text-xs text-slate-300 truncate">{n.studentName}</span>
                  </div>
                  <div className="text-sm text-white mt-0.5 truncate">{n.subject ?? '—'}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                    {reached
                      ? <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Delivered</span>
                      : <span className="inline-flex items-center gap-1 text-rose-400"><XCircle className="w-3 h-3" /> Not delivered</span>}
                    <span>·</span>
                    <span>{fmtDateTime(n.sent_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
