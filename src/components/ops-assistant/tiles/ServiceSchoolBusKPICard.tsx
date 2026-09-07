'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface SchoolBusStats {
  activeStudents: number;
  activeBuses: number;
  attendanceScanRate: number;
  guardianAlertRate: number;
  safetyCompliance: number;
  activeSchools: number;
  safetyMetrics: Array<{ label: string; value: string; status: 'ok' | 'warning' }>;
}

export default function ServiceSchoolBusKPICard() {
  const [stats, setStats] = useState<SchoolBusStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (!cancelled) {
          setStats({
            activeStudents: 3420,
            activeBuses: 62,
            attendanceScanRate: 99.4,
            guardianAlertRate: 99.8,
            safetyCompliance: 100,
            activeSchools: 18,
            safetyMetrics: [
              { label: 'RFID Tap-on / Tap-off Scanning', value: '3,399 / 3,420 (99.4%)', status: 'ok' },
              { label: 'Guardian WhatsApp Push SMS Rate', value: '3,414 / 3,420 (99.8%)', status: 'ok' },
              { label: 'DOT Safety Inspection & Cameras', value: '62 / 62 Validated (100%)', status: 'ok' },
              { label: 'Emergency Sleeping Child Checks', value: 'Zero Left-Behind Incidents', status: 'ok' },
            ],
          });
        }
      } catch (err) {
        console.error('Failed to load School Bus KPI stats:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-5 w-full max-w-2xl animate-pulse space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-4 bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-slate-700 rounded w-1/6" />
        </div>
        <div className="grid grid-cols-4 gap-2 pt-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-700/50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🎓</span>
            <h3 className="text-base font-bold text-white tracking-tight">School Bus Safety & Attendance</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
              DOT COMPLIANT
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Student RFID badge tracking, guardian SMS alerts, speed limiters & DOT child checks
          </p>
        </div>
        <Link
          href="/school-bus"
          className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>School Hub</span>
          <span>→</span>
        </Link>
      </div>

      {/* 4 KPI Metric Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-amber-400">{s.activeStudents.toLocaleString()}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Active Students</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">{s.attendanceScanRate}%</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">RFID Scan Rate</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-cyan-400">{s.activeBuses}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">School Buses</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">{s.safetyCompliance}%</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">DOT Safety Score</p>
        </div>
      </div>

      {/* Safety & Attendance Audits */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Student Safety & Attendance Audit</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {s.safetyMetrics.map((m, idx) => (
            <div key={idx} className="bg-slate-900/40 rounded-xl p-2.5 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-slate-400 text-[11px] truncate">{m.label}</p>
                <p className="font-semibold text-white mt-0.5">{m.value}</p>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Footer Quick CTAs */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <Link href="/school-bus" className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 font-semibold">
            Live Student Registry
          </Link>
          <Link href="/school-bus/reports" className="px-2.5 py-1 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white font-medium">
            Guardian Alerts Log
          </Link>
        </div>
        <Link href="/school-bus/reports" className="text-amber-400 hover:text-amber-300 font-medium">
          Open School Bus Safety Report →
        </Link>
      </div>
    </div>
  );
}
