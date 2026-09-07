'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface ScheduledReport {
  id: string;
  name: string;
  frequency: string;
  lastRun?: string | null;
  nextRun?: string | null;
  isActive?: boolean;
}

interface Props {
  title?: string;
  reportType?: string;
  frequency?: string;
}

export default function ReportScheduleCard({ title = 'Automated Scheduled BI Reports', reportType, frequency }: Props) {
  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/reports/dashboard', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled && Array.isArray(json.scheduledReports)) {
            setSchedules(json.scheduledReports);
          }
        }
      } catch (err) {
        console.error('Failed to load scheduled reports:', err);
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
        <div className="space-y-2 pt-2">
          <div className="h-12 bg-slate-700/50 rounded-xl" />
          <div className="h-12 bg-slate-700/50 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">⏰</span>
            <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              CRON AUTOMATION
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Automated recurring PDF / CSV dispatch to operations and management teams
          </p>
        </div>
        <Link
          href="/reports/scheduled"
          className="px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>Manage Schedules</span>
          <span>→</span>
        </Link>
      </div>

      {/* Suggested or Created Schedule Info */}
      {(reportType || frequency) && (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 text-xs text-indigo-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>✨</span>
            <span>Requested: <strong>{reportType || 'Operations BI Report'}</strong> ({frequency || 'Weekly'})</span>
          </div>
          <span className="text-[10px] font-bold uppercase bg-indigo-500/20 px-2 py-0.5 rounded">Queued</span>
        </div>
      )}

      {/* Active Schedules List */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Automated Schedules</p>
        {schedules.length === 0 ? (
          <div className="bg-slate-900/40 rounded-xl p-4 text-center text-xs text-slate-400">
            No active schedules configured. Use the link below or ask me to schedule any report.
          </div>
        ) : (
          <div className="space-y-2">
            {schedules.slice(0, 4).map(s => (
              <div key={s.id} className="bg-slate-900/40 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{s.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Cadence: <span className="text-indigo-300 font-medium uppercase">{s.frequency}</span>
                    {s.nextRun && ` · Next run: ${new Date(s.nextRun).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 font-bold text-[11px]">ACTIVE</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs text-slate-400">
        <span>Email & Webhook distribution ready</span>
        <Link href="/reports/scheduled" className="text-indigo-400 hover:text-indigo-300 font-medium">
          Open Scheduled Reports Module →
        </Link>
      </div>
    </div>
  );
}
