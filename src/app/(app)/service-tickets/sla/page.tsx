'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  AlertTriangle,
  Flame,
  ShieldCheck,
  RefreshCw,
  Zap,
  ArrowUpRight,
  BellRing,
  PhoneCall,
  ChevronRight,
  Calendar,
} from 'lucide-react';
import Link from 'next/link';

interface SlaEvaluationItem {
  ticketId: string;
  readableId?: string | null;
  title: string;
  status: string;
  priority: string;
  ticketType: string;
  clockType: 'EMERGENCY_24_7' | 'BUSINESS_HOURS';
  escalationTier: 'TIER_1_NORMAL' | 'TIER_2_ESCALATED' | 'TIER_3_BREACHED';
  elapsedWorkingMinutes: number;
  ackDeadlineMinutes: number;
  resolveDeadlineMinutes: number;
  isAckOverdue: boolean;
  isResolveOverdue: boolean;
  minutesUntilBreach: number;
  shouldAutoEscalateToTier2: boolean;
  shouldTriggerTier3DirectorAlert: boolean;
  escalationReason?: string;
  pagingTargetRole?: 'CONTROLLER' | 'SHIFT_SUPERVISOR' | 'OPERATIONS_DIRECTOR';
}

interface SlaSummary {
  totalOpen: number;
  tier1Normal: number;
  tier2Escalated: number;
  tier3Breached: number;
  onTimeComplianceRate: number;
}

export default function ServiceTicketsSlaControlTower() {
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [summary, setSummary] = useState<SlaSummary | null>(null);
  const [evaluations, setEvaluations] = useState<SlaEvaluationItem[]>([]);
  const [filterTier, setFilterTier] = useState<'ALL' | 'TIER_2' | 'TIER_3'>('ALL');
  const [sweepNotice, setSweepNotice] = useState<string | null>(null);

  const fetchSlaData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/service-tickets/sla/sweep');
      if (res.ok) {
        const json = await res.json();
        setSummary(json.summary);
        setEvaluations(json.evaluations || []);
      }
    } catch (e) {
      console.error('Failed to fetch SLA data', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlaData();
    const interval = setInterval(fetchSlaData, 30_000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [fetchSlaData]);

  const handleRunSweep = async () => {
    setSweeping(true);
    setSweepNotice(null);
    try {
      const res = await fetch('/api/service-tickets/sla/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        const escalatedCount = json.sweepResult?.autoEscalatedTickets?.length || 0;
        const alertsCount = json.sweepResult?.directorAlerts?.length || 0;
        setSweepNotice(
          `✅ Sweep Complete: Auto-escalated ${escalatedCount} unacknowledged tickets. Generated ${alertsCount} Director alerts.`
        );
        await fetchSlaData();
      }
    } catch (e) {
      console.error('Sweep failed', e);
      setSweepNotice('❌ Failed to execute SLA sweep');
    } finally {
      setSweeping(false);
    }
  };

  const filteredItems = evaluations.filter((item) => {
    if (filterTier === 'TIER_2') return item.escalationTier === 'TIER_2_ESCALATED';
    if (filterTier === 'TIER_3') return item.escalationTier === 'TIER_3_BREACHED';
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
              🚨 Active SLA & On-Call Paging
            </span>
            <span className="text-xs text-slate-400">Pillar 2 (P0)</span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">SLA Control Tower & Escalation Matrix</h1>
          <p className="text-sm text-slate-400">
            Real-time multi-tier SLA tracking, automated unacknowledged supervisor escalations, and 24/7 vs business hour calendars.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/service-tickets"
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
          >
            ← Back to Tickets
          </Link>
          <button
            onClick={handleRunSweep}
            disabled={sweeping}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all disabled:opacity-50"
          >
            {sweeping ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sweeping...
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 text-amber-300" /> Run SLA Escalation Sweep
              </>
            )}
          </button>
        </div>
      </div>

      {sweepNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
          <span>{sweepNotice}</span>
          <button onClick={() => setSweepNotice(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Open Tickets
          </div>
          <div className="text-2xl font-bold text-white mt-1">{summary?.totalOpen ?? 0}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-emerald-500/20">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Tier 1 Normal
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{summary?.tier1Normal ?? 0}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-amber-500/20">
          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Tier 2 Escalated
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{summary?.tier2Escalated ?? 0}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-rose-500/30">
          <div className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-rose-500" /> Tier 3 Breached
          </div>
          <div className="text-2xl font-bold text-rose-400 mt-1">{summary?.tier3Breached ?? 0}</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            On-Time Compliance
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            {summary?.onTimeComplianceRate ?? 100}%
          </div>
        </div>
      </div>

      {/* Escalation Policy Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-900/50 border border-slate-800 text-xs text-slate-300 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
            24/7/365 Emergency Clock Policy
          </div>
          <p className="text-slate-400 text-[11px]">
            Applies to <strong>TOWING</strong>, <strong>INCIDENT</strong>, and High-Priority <strong>MAINTENANCE</strong>. Unacknowledged tickets escalate to Supervisor at 15m, and page Director at 30m / SLA Breach.
          </p>
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-white flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            Business Hours Clock Policy (08:00–18:00 Mon–Fri)
          </div>
          <p className="text-slate-400 text-[11px]">
            Applies to <strong>RENEWAL</strong>, <strong>COMPLAINT</strong>, <strong>CLEANING</strong>, and <strong>SUPPORT</strong>. SLA elapsed timer pauses overnight and on weekends.
          </p>
        </div>
      </div>

      {/* Filters & Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Filter View:</span>
            <button
              onClick={() => setFilterTier('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                filterTier === 'ALL'
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-white'
              }`}
            >
              All Open ({evaluations.length})
            </button>
            <button
              onClick={() => setFilterTier('TIER_2')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                filterTier === 'TIER_2'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-950 text-slate-400 hover:text-amber-300'
              }`}
            >
              Tier 2 Escalated ({summary?.tier2Escalated ?? 0})
            </button>
            <button
              onClick={() => setFilterTier('TIER_3')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                filterTier === 'TIER_3'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-slate-950 text-slate-400 hover:text-rose-300'
              }`}
            >
              Tier 3 Breached ({summary?.tier3Breached ?? 0})
            </button>
          </div>

          <button
            onClick={fetchSlaData}
            disabled={loading}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Ticket</th>
                <th className="py-3 px-4">Type & Clock</th>
                <th className="py-3 px-4">Status & Priority</th>
                <th className="py-3 px-4">Elapsed (Mins)</th>
                <th className="py-3 px-4">Target Limit</th>
                <th className="py-3 px-4">Escalation Tier</th>
                <th className="py-3 px-4">Paging Role</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 text-xs">
                    No active tickets matching the selected SLA filter.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.ticketId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-emerald-400">
                        {item.readableId || item.ticketId.slice(0, 8)}
                      </div>
                      <div className="text-slate-300 font-medium truncate max-w-[180px]">
                        {item.title}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-white">{item.ticketType}</span>
                      <div className="text-[10px] text-slate-500">
                        {item.clockType === 'EMERGENCY_24_7' ? '24/7 Clock' : 'Business Hours'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-medium">
                          {item.status}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            item.priority === 'High' ? 'text-rose-400' : 'text-amber-400'
                          }`}
                        >
                          {item.priority}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                      {item.elapsedWorkingMinutes} m
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {item.resolveDeadlineMinutes} m
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          item.escalationTier === 'TIER_3_BREACHED'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                            : item.escalationTier === 'TIER_2_ESCALATED'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                        }`}
                      >
                        {item.escalationTier.replace('TIER_', 'Tier ').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <PhoneCall className="w-3 h-3 text-slate-500" />
                        {item.pagingTargetRole?.replace(/_/g, ' ') || 'Controller'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/service-tickets?id=${item.ticketId}`}
                        className="text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 font-semibold"
                      >
                        View <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
