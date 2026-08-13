'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Clock, AlertTriangle, Users, FileText, ShieldCheck, ArrowRight } from 'lucide-react';

interface Student {
  studentId: string;
  studentCode: string;
  name: string;
  pickupStop: string | null;
  hasMedicalAlert: boolean;
  attendance: { status: string; boardedAt: string | null };
}

interface Trip {
  id: string;
  route_id: string;
  route_name: string | null;
  status: string;
  session_type: string | null;
  scheduled_departure: string;
  actual_departure: string | null;
  actual_arrival: string | null;
  totalStudents: number;
  boardedCount: number;
  excusedCount: number;
  absentCount: number;
  medicalAlertCount: number;
  students: Student[];
}

const STATUS_PILL: Record<string, string> = {
  SCHEDULED:   'bg-blue-500/20 text-blue-300 border-blue-500/40',
  IN_PROGRESS: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  COMPLETED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CANCELLED:   'bg-rose-500/20 text-rose-300 border-rose-500/40',
  BREAKDOWN:   'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function SchoolBusDriverTodayPage() {
  const [driverCode, setDriverCode] = useState('');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (code: string) => {
    if (!code) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/school-bus/driver/today?driverCode=${encodeURIComponent(code)}`);
      const data = res.ok ? await res.json() : { trips: [] };
      setTrips(data.trips ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const code = localStorage.getItem('sbDriverCode') ?? '';
    setDriverCode(code);
    load(code);
  }, [load]);

  if (!driverCode) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Today</h1>
        <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-5">
          <p className="text-sm text-slate-300 mb-3">Pin your driver code to see today's trips.</p>
          <Link href="/school-bus/driver/profile" className="block w-full text-center py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold">
            Set Driver Code →
          </Link>
        </div>
      </div>
    );
  }
  if (loading) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Today's Trips</h1>
        <p className="text-sm text-slate-400">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
          {' · '}driver {driverCode}
        </p>
      </div>

      {trips.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No school-bus trips assigned to you today.
        </div>
      ) : (
        <div className="space-y-3">
          {trips.map(t => {
            const status = (t.status ?? 'SCHEDULED').toUpperCase();
            return (
              <div key={t.id} className="rounded-2xl bg-slate-800/60 border border-white/10 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_PILL[status]}`}>{status}</span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wide">{t.session_type ?? '—'}</span>
                    </div>
                    <div className="text-base font-semibold mt-1 truncate">{t.route_name ?? 'Route'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold inline-flex items-center gap-1"><Clock className="w-4 h-4 text-slate-500" /> {fmt(t.scheduled_departure)}</div>
                    <div className="text-[10px] text-slate-500 uppercase">depart</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-900/40 p-2 text-center">
                    <div className="text-base font-bold text-white">{t.totalStudents}</div>
                    <div className="text-[9px] text-slate-500 uppercase">Total</div>
                  </div>
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2 text-center">
                    <div className="text-base font-bold text-emerald-300">{t.boardedCount}</div>
                    <div className="text-[9px] text-emerald-300/70 uppercase">Boarded</div>
                  </div>
                  <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-2 text-center">
                    <div className="text-base font-bold text-cyan-300">{t.excusedCount}</div>
                    <div className="text-[9px] text-cyan-300/70 uppercase">Excused</div>
                  </div>
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2 text-center">
                    <div className="text-base font-bold text-rose-300">{t.medicalAlertCount}</div>
                    <div className="text-[9px] text-rose-300/70 uppercase">Medical</div>
                  </div>
                </div>

                {t.medicalAlertCount > 0 && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <div className="font-semibold text-rose-300">Medical alert: {t.medicalAlertCount} student{t.medicalAlertCount === 1 ? '' : 's'}</div>
                      <div className="text-rose-200/80 truncate">
                        {t.students.filter(s => s.hasMedicalAlert).map(s => s.name).join(', ')}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/school-bus/driver/trip/${t.id}`}
                    className="text-center py-2.5 rounded-xl bg-slate-900/50 border border-white/10 text-sm hover:bg-slate-900/70 inline-flex items-center justify-center gap-1.5">
                    <Users className="w-4 h-4" /> Manifest
                  </Link>
                  <Link href={`/school-bus/driver/trip/${t.id}/pretrip`}
                    className="text-center py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> Safety Check
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/school-bus/driver/trip/${t.id}/scan?direction=BOARDING`}
                    className="text-center py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                    Board <ArrowRight className="w-4 h-4" />
                  </Link>
                  <a href={`/api/school-bus/trips/${t.id}/manifest/pdf?lang=en&download=1`} target="_blank" rel="noopener noreferrer"
                    className="text-center py-2.5 rounded-xl border border-white/10 text-slate-200 text-sm inline-flex items-center justify-center gap-1.5">
                    <FileText className="w-4 h-4" /> PDF
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
