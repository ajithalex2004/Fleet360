'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileText, ScanLine, ShieldCheck, ChevronLeft, MapPin, Phone } from 'lucide-react';

interface Student {
  studentId: string;
  studentCode: string;
  name: string;
  pickupStop: string | null;
  dropoffStop: string | null;
  rfidCardLast4: string | null;
  hasMedicalAlert: boolean;
  medicalNotes: string | null;
  guardian1Name: string | null;
  guardian1Phone: string | null;
  guardian2Phone: string | null;
  attendance: { status: string; boardedAt: string | null };
}

interface Trip {
  id: string;
  route_name: string | null;
  status: string;
  session_type: string | null;
  scheduled_departure: string;
  totalStudents: number;
  boardedCount: number;
  excusedCount: number;
  absentCount: number;
  medicalAlertCount: number;
  students: Student[];
}

const ATT_PILL: Record<string, string> = {
  PRESENT: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  ABSENT:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  EXCUSED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  LATE:    'bg-amber-500/20 text-amber-300 border-amber-500/40',
  PENDING: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
};

export default function SchoolBusDriverTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all' | 'medical'>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const code = typeof window !== 'undefined' ? localStorage.getItem('sbDriverCode') ?? '' : '';
      const res = await fetch(`/api/school-bus/driver/today?driverCode=${encodeURIComponent(code)}`);
      const data = res.ok ? await res.json() : { trips: [] };
      const found = (data.trips ?? []).find((t: Trip) => t.id === id);
      setTrip(found ?? null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const scan = async (student: Student, direction: 'BOARDING' | 'ALIGHTING') => {
    setBusy(student.studentId);
    try {
      const driver = typeof window !== 'undefined' ? localStorage.getItem('sbDriverName') || localStorage.getItem('sbDriverCode') || null : null;
      const res = await fetch('/api/school-bus/attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: id,
          studentCode: student.studentCode,
          scanType: direction,
          stopName: direction === 'BOARDING' ? student.pickupStop : student.dropoffStop,
          scannedBy: driver,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Scan failed');
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-slate-500">Loading…</div>;
  if (!trip) return <div className="text-rose-400 text-sm">Trip not found or not assigned to you.</div>;

  const visible = trip.students.filter(s => {
    if (filter === 'pending') return s.attendance.status === 'PENDING';
    if (filter === 'medical') return s.hasMedicalAlert;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/school-bus/driver" className="text-xs text-rose-400 hover:underline inline-flex items-center gap-1">
          <ChevronLeft className="w-3 h-3" /> Today
        </Link>
        <div className="flex gap-1.5">
          <a href={`/api/school-bus/trips/${id}/manifest/pdf?lang=en&download=1`} target="_blank" rel="noopener noreferrer"
            className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 inline-flex items-center gap-1">
            <FileText className="w-3 h-3" /> EN
          </a>
          <a href={`/api/school-bus/trips/${id}/manifest/pdf?lang=ar&download=1`} target="_blank" rel="noopener noreferrer"
            className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 inline-flex items-center gap-1">
            <FileText className="w-3 h-3" /> AR
          </a>
          <Link href={`/school-bus/driver/trip/${id}/pretrip`}
            className="text-xs px-2.5 py-1 rounded-lg bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 inline-flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Check
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-4">
        <div className="text-base font-bold">{trip.route_name ?? 'Route'}</div>
        <div className="text-xs text-slate-400">
          {trip.session_type ?? '—'} · depart {new Date(trip.scheduled_departure).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3 text-xs">
          <Stat value={trip.totalStudents} label="Total" />
          <Stat value={trip.boardedCount} label="Boarded" tone="emerald" />
          <Stat value={trip.excusedCount} label="Excused" tone="cyan" />
          <Stat value={trip.medicalAlertCount} label="Medical" tone="rose" />
        </div>
      </div>

      <div className="inline-flex rounded-xl bg-slate-800/60 border border-white/10 p-1 w-full">
        {(['pending', 'all', 'medical'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium ${filter === f ? 'bg-rose-600 text-white' : 'text-slate-400'}`}>
            {f === 'pending' ? `Pending (${trip.students.filter(s => s.attendance.status === 'PENDING').length})`
            : f === 'medical' ? `Medical (${trip.medicalAlertCount})`
            : `All (${trip.students.length})`}
          </button>
        ))}
      </div>

      <Link href={`/school-bus/driver/scan?tripId=${id}`}
        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold">
        <ScanLine className="w-4 h-4" /> RFID / Code Scanner
      </Link>

      {visible.length === 0 ? (
        <div className="p-6 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-sm text-slate-400">
          {filter === 'pending' ? '✓ All students accounted for.' : 'No students.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(s => {
            const status = s.attendance.status;
            const isBusy = busy === s.studentId;
            return (
              <div key={s.studentId}
                className={`p-3 rounded-xl border ${s.hasMedicalAlert ? 'bg-rose-500/10 border-rose-500/40' : 'bg-slate-800/40 border-white/10'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm">{s.name}</span>
                      <span className="text-[11px] text-slate-400 font-mono">{s.studentCode}</span>
                      {s.hasMedicalAlert && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-rose-500/30 text-rose-200 border border-rose-500/60">
                          <AlertTriangle className="w-2.5 h-2.5" /> MEDICAL
                        </span>
                      )}
                    </div>
                    {s.hasMedicalAlert && s.medicalNotes && (
                      <div className="text-[11px] text-rose-200 mt-1 italic">{s.medicalNotes}</div>
                    )}
                    {s.pickupStop && (
                      <div className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-amber-400" /> {s.pickupStop}
                      </div>
                    )}
                    {s.guardian1Phone && (
                      <a href={`tel:${s.guardian1Phone}`} className="text-[11px] text-slate-400 mt-0.5 inline-flex items-center gap-1 hover:text-cyan-400">
                        <Phone className="w-3 h-3" /> {s.guardian1Name ?? 'Guardian'} {s.guardian1Phone}
                      </a>
                    )}
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] border ${ATT_PILL[status]}`}>{status}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  <button onClick={() => scan(s, 'BOARDING')} disabled={isBusy || status === 'PRESENT'}
                    className={`py-2 rounded-lg text-[11px] font-medium border disabled:opacity-50 ${
                      status === 'PRESENT'
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-slate-900/40 border-white/10 text-slate-300 hover:bg-emerald-500/20 hover:border-emerald-500/40'
                    }`}>
                    {status === 'PRESENT' ? '✓ Boarded' : '✓ Board'}
                  </button>
                  <button onClick={() => scan(s, 'ALIGHTING')} disabled={isBusy || status !== 'PRESENT'}
                    className="py-2 rounded-lg text-[11px] font-medium bg-slate-900/40 border border-white/10 text-slate-300 hover:bg-cyan-500/20 hover:border-cyan-500/40 disabled:opacity-50">
                    Drop off
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, tone = 'slate' }: { value: number; label: string; tone?: string }) {
  const cls: Record<string, string> = { slate: 'text-white', emerald: 'text-emerald-300', cyan: 'text-cyan-300', rose: 'text-rose-300' };
  return (
    <div className="rounded-lg bg-slate-900/40 p-2 text-center">
      <div className={`text-base font-bold ${cls[tone]}`}>{value}</div>
      <div className="text-[9px] text-slate-500 uppercase">{label}</div>
    </div>
  );
}
