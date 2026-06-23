'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { GraduationCap, AlertTriangle, Clock, MapPin } from 'lucide-react';

interface Notification {
  kind: string;
  subject: string | null;
  sent_at: string;
  reached_guardian1: boolean;
  reached_guardian2: boolean;
}

interface AttendanceRow {
  session_type: string;
  status: string;
  boarded_at: string | null;
  reason: string | null;
}

interface TripRow {
  id: string;
  status: string;
  session_type: string;
  scheduled_departure: string;
  actual_departure: string | null;
  actual_arrival: string | null;
}

interface Student {
  studentId: string;
  studentCode: string | null;
  firstName: string | null;
  lastName: string | null;
  grade: string | null;
  section: string | null;
  schoolName: string | null;
  photoUrl: string | null;
  pickupStop: string | null;
  dropoffStop: string | null;
  rfidCard: string | null;
  medicalNotes: string | null;
  hasMedicalAlert: boolean;
  attendance: AttendanceRow[];
  trips: TripRow[];
  notifications: Notification[];
}

interface ApiResp {
  guardianPhone: string;
  students: Student[];
}

const STATUS_PILL: Record<string, string> = {
  PRESENT: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  ABSENT:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  LATE:    'bg-amber-500/20 text-amber-300 border-amber-500/40',
  EXCUSED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  SCHEDULED:   'bg-blue-500/20 text-blue-300 border-blue-500/40',
  IN_PROGRESS: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  COMPLETED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  BREAKDOWN:   'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function ParentTodayPage() {
  const [phone, setPhone] = useState('');
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    if (!p) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/school-bus/parent/today?guardianPhone=${encodeURIComponent(p)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Lookup failed');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
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
        <h1 className="text-2xl font-bold">Welcome</h1>
        <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-5">
          <p className="text-sm text-slate-300 mb-3">
            Pin your guardian phone number first so we can show your child's bus and attendance. Stored on this device only.
          </p>
          <Link href="/school-bus/parent/profile" className="block w-full text-center py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold">
            Set Phone Number →
          </Link>
        </div>
      </div>
    );
  }

  if (loading) return <div className="text-slate-500">Loading…</div>;

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My Children</h1>
        <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">{error}</div>
        <Link href="/school-bus/parent/profile" className="block text-center text-sm text-amber-400 underline">
          Re-check your phone number
        </Link>
      </div>
    );
  }

  if (!data || data.students.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My Children</h1>
        <div className="p-6 rounded-2xl bg-slate-800/40 border border-slate-700 text-sm text-slate-400 text-center">
          No children found for {phone}. Confirm the number you're registered under matches the school's records, or contact transport ops.
        </div>
        <Link href="/school-bus/parent/profile" className="block text-center text-sm text-amber-400 underline">
          Update phone number
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Today</h1>
        <p className="text-sm text-slate-400">{data.students.length} child{data.students.length === 1 ? '' : 'ren'} · {phone}</p>
      </div>

      {data.students.map(s => (
        <div key={s.studentId} className="rounded-2xl bg-slate-800/60 border border-white/10 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-br from-amber-600 to-orange-600 flex items-center justify-center shadow-lg">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold">{[s.firstName, s.lastName].filter(Boolean).join(' ') || s.studentCode}</div>
              <div className="text-xs text-slate-400 truncate">
                {s.schoolName ?? '—'}{s.grade ? ` · Grade ${s.grade}${s.section ? `-${s.section}` : ''}` : ''}
              </div>
              {s.pickupStop && (
                <div className="text-xs text-slate-300 mt-1 inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-amber-400" /> {s.pickupStop}
                </div>
              )}
            </div>
            {s.hasMedicalAlert && (
              <div title={s.medicalNotes ?? ''} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px]">
                <AlertTriangle className="w-3 h-3" /> Medical
              </div>
            )}
          </div>

          {s.trips.length > 0 ? (
            <div className="space-y-2">
              {s.trips.map(t => {
                const statusClass = STATUS_PILL[t.status] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40';
                const att = s.attendance.find(a => a.session_type === t.session_type);
                return (
                  <div key={t.id} className="rounded-xl bg-slate-900/40 border border-white/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-400 uppercase tracking-wide flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {t.session_type}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] border ${statusClass}`}>{t.status}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                      <div>
                        <div className="text-slate-500 text-[10px] uppercase">Scheduled</div>
                        <div className="text-slate-200">{fmt(t.scheduled_departure)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-[10px] uppercase">Departed</div>
                        <div className="text-slate-200">{fmt(t.actual_departure)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-[10px] uppercase">Arrived</div>
                        <div className="text-slate-200">{fmt(t.actual_arrival)}</div>
                      </div>
                    </div>
                    {att && (
                      <div className="mt-2 flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                        <span className="text-xs text-slate-400">Attendance</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_PILL[att.status] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
                          {att.status}{att.boarded_at ? ` · ${fmt(att.boarded_at)}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-slate-500 italic">No trips scheduled today on this route.</div>
          )}
        </div>
      ))}

      <div className="text-xs text-slate-500 text-center pt-2">
        Notifications go to the WhatsApp number above. <Link href="/school-bus/parent/absence" className="text-amber-400">Mark absence</Link> if your child won't ride.
      </div>
    </div>
  );
}
