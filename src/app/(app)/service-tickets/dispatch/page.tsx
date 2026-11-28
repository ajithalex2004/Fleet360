'use client';

/**
 * /service-tickets/dispatch — Visual Field Service Dispatch Board & Live Field Map
 *
 * Combines:
 *   - Unscheduled & open work order queue with 1-click Best-Fit Smart Scheduling
 *   - Technician resource timeline (Gantt calendar 07:00–20:00) with visits,
 *     non-job activities (training/meetings/permits), and leave/blocked overlays
 *   - Split / Full Live Field Operations Map (Mapbox GL JS or interactive SVG fallback)
 *   - Quick visit inspector (reschedule, reassign, transition status, delete)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Columns2,
  GanttChartSquare,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Smartphone,
  Users,
  X,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Navigation,
} from 'lucide-react';
import { PageHeader, KpiCard, StatGrid } from '@/components/ui/page-theme';
import { scoreTechnicianForAssignment } from '@/lib/service-tickets/workforce';
import {
  TASK_CATEGORIES,
  canTransitionVisitStatus,
  suggestNextAvailableSlot,
  type DispatchBoardPayload,
  type FsmWorkVisit,
  type TaskCategory,
  type UnscheduledTicketCard,
  type VisitStatus,
} from '@/lib/service-tickets/dispatch';
import { FsmLiveFieldMap } from '../components/fsm-live-field-map';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 .. 20:00
const TIMELINE_START_HOUR = 7;
const TIMELINE_END_HOUR = 21;
const TIMELINE_HOURS_SPAN = TIMELINE_END_HOUR - TIMELINE_START_HOUR;

const VISIT_BLOCK_STYLE: Record<VisitStatus, string> = {
  SCHEDULED: 'bg-violet-600/90 border-violet-400 text-white',
  DISPATCHED: 'bg-indigo-600/90 border-indigo-400 text-white',
  EN_ROUTE: 'bg-cyan-600/90 border-cyan-400 text-white',
  ON_SITE: 'bg-sky-600/90 border-sky-400 text-white',
  IN_PROGRESS: 'bg-amber-600/90 border-amber-400 text-white',
  PAUSED: 'bg-orange-600/90 border-orange-400 text-white',
  COMPLETED: 'bg-emerald-600/90 border-emerald-400 text-white',
  INCOMPLETE: 'bg-rose-600/90 border-rose-400 text-white',
  CANCELLED: 'bg-slate-600/60 border-slate-400 text-slate-200 line-through',
};

const PRIORITY_PILL: Record<string, string> = {
  Critical: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
  High: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40',
  Medium: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  Low: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
};

const AVAIL_DOT: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500',
  EN_ROUTE: 'bg-cyan-500',
  ON_JOB: 'bg-blue-500',
  ON_BREAK: 'bg-amber-500',
  OFF_SHIFT: 'bg-slate-400',
  ON_LEAVE: 'bg-rose-500',
};

function addDays(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function computeBarPosition(startIso: string, endIso: string, dayIso: string): { leftPct: number; widthPct: number } | null {
  const dayStart = new Date(`${dayIso}T00:00:00`);
  const windowStart = new Date(dayStart);
  windowStart.setHours(TIMELINE_START_HOUR, 0, 0, 0);
  const windowEnd = new Date(dayStart);
  windowEnd.setHours(TIMELINE_END_HOUR, 0, 0, 0);

  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  const ws = windowStart.getTime();
  const we = windowEnd.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= ws || s >= we) return null;

  const clampedStart = Math.max(s, ws);
  const clampedEnd = Math.min(e, we);
  const totalMs = TIMELINE_HOURS_SPAN * 3_600_000;
  const leftPct = ((clampedStart - ws) / totalMs) * 100;
  const widthPct = Math.max(3.5, ((clampedEnd - clampedStart) / totalMs) * 100);
  return { leftPct, widthPct };
}

export default function FsmDispatchBoardPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [territoryId, setTerritoryId] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [viewMode, setViewMode] = useState<'split' | 'gantt' | 'map'>('split');
  const [queueSearch, setQueueSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [board, setBoard] = useState<DispatchBoardPayload | null>(null);

  const [selectedVisit, setSelectedVisit] = useState<FsmWorkVisit | null>(null);
  const [scheduleModal, setScheduleModal] = useState<{
    ticketId?: string;
    leadTechnicianId?: string;
    startLocal?: string;
    endLocal?: string;
  } | null>(null);
  const [activityModal, setActivityModal] = useState<{ technicianId?: string } | null>(null);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ date: selectedDate, endDate: selectedDate });
      if (territoryId) qs.set('territoryId', territoryId);
      if (department) qs.set('department', department);
      const res = await fetch(`/api/service-tickets/dispatch?${qs.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load dispatch board');
      setBoard(data as DispatchBoardPayload);
      setSelectedVisit((prev) => (prev ? (data.visits as FsmWorkVisit[]).find((v) => v.id === prev.id) ?? null : null));
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : 'Failed to load dispatch board.' });
    } finally {
      setLoading(false);
    }
  }, [selectedDate, territoryId, department]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const filteredQueue = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return (board?.unscheduledTickets ?? []).filter((t) => {
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.readableId ?? '').toLowerCase().includes(q) ||
        (t.siteName ?? '').toLowerCase().includes(q) ||
        t.ticketType.toLowerCase().includes(q)
      );
    });
  }, [board, queueSearch]);

  const kpis = useMemo(() => {
    const visits = board?.visits ?? [];
    const active = visits.filter((v) => v.status !== 'CANCELLED');
    const inField = active.filter((v) => ['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(v.status));
    const completed = active.filter((v) => v.status === 'COMPLETED');
    const unassignedQueue = (board?.unscheduledTickets ?? []).filter((t) => t.visitCount === 0);
    return {
      unscheduled: unassignedQueue.length,
      scheduled: active.length,
      inField: inField.length,
      completed: completed.length,
    };
  }, [board]);

  // 1-click Smart Schedule: picks highest-scoring technician + earliest open slot
  const handleSmartSchedule = (ticket: UnscheduledTicketCard) => {
    const techs = board?.technicians ?? [];
    let bestTechId: string | undefined;
    let bestStart: string | undefined;
    let bestEnd: string | undefined;

    if (techs.length > 0) {
      const ranked = techs
        .map((tech) => ({
          tech,
          rec: scoreTechnicianForAssignment({
            tech,
            department: ticket.assignedDepartment,
            territoryId: ticket.territoryId,
            siteLat: ticket.siteLat,
            siteLng: ticket.siteLng,
            shifts: tech.shifts,
          }),
        }))
        .sort((a, b) => Number(b.rec.eligible) - Number(a.rec.eligible) || b.rec.score - a.rec.score);

      const tzOffsetMinutes = -new Date().getTimezoneOffset();
      for (const candidate of ranked) {
        const slot = suggestNextAvailableSlot({
          dayIso: selectedDate,
          technicianId: candidate.tech.id,
          durationMins: 60,
          existingVisits: board?.visits ?? [],
          shifts: candidate.tech.shifts,
          tzOffsetMinutes,
        });
        if (slot) {
          bestTechId = candidate.tech.id;
          bestStart = toLocalDateTimeInput(slot.startAt);
          bestEnd = toLocalDateTimeInput(slot.endAt);
          break;
        }
      }
      if (!bestTechId) bestTechId = ranked[0]?.tech.id;
    }

    setScheduleModal({
      ticketId: ticket.id,
      leadTechnicianId: bestTechId,
      startLocal: bestStart ?? `${selectedDate}T09:00`,
      endLocal: bestEnd ?? `${selectedDate}T10:00`,
    });
  };

  const openSlotSchedule = (techId: string, hour: number) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduleModal({
      leadTechnicianId: techId,
      startLocal: `${selectedDate}T${pad(hour)}:00`,
      endLocal: `${selectedDate}T${pad(Math.min(23, hour + 1))}:00`,
    });
  };

  const handleQuickTransition = async (visit: FsmWorkVisit, status: VisitStatus) => {
    setBanner(null);
    const res = await fetch(`/api/service-tickets/visits/${visit.id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, bypassGeofence: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBanner({ kind: 'error', text: data.error ?? 'Status update failed.' });
      return;
    }
    setBanner({ kind: 'success', text: `Visit #${visit.visitNumber} moved to ${status.replace('_', ' ')}.` });
    await loadBoard();
  };

  const handleDeleteVisit = async (visit: FsmWorkVisit) => {
    if (!window.confirm(`Remove Visit #${visit.visitNumber} for ${visit.ticketReadableId ?? visit.ticketTitle}?`)) return;
    const res = await fetch(`/api/service-tickets/visits/${visit.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBanner({ kind: 'error', text: data.error ?? 'Delete failed.' });
      return;
    }
    setSelectedVisit(null);
    setBanner({ kind: 'success', text: 'Scheduled visit removed.' });
    await loadBoard();
  };

  const departments = useMemo(() => {
    const set = new Set<string>();
    (board?.technicians ?? []).forEach((t) => set.add(t.primaryDepartment));
    (board?.unscheduledTickets ?? []).forEach((t) => set.add(t.assignedDepartment));
    return Array.from(set).sort();
  }, [board]);

  return (
    <div className="space-y-5 max-w-[1600px]">
      <PageHeader
        title="FSM Dispatch Board & Live Map"
        subtitle="Visual resource Gantt timeline · Best-fit auto-slot scheduling · Multi-visit crew dispatch · Real-time GPS field map"
        icon={GanttChartSquare}
        accent="cyan"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/service-tickets/field-app"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--bg-surface)] border border-emerald-500/40 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
            >
              <Smartphone className="w-3.5 h-3.5" /> Field App
            </Link>
            <Link
              href="/service-tickets/technicians"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
            >
              <Users className="w-3.5 h-3.5" /> Roster &amp; Teams
            </Link>
            <button
              type="button"
              onClick={() => setActivityModal({})}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
            >
              <Plus className="w-3.5 h-3.5" /> Activity
            </button>
            <button
              type="button"
              onClick={() =>
                setScheduleModal({
                  startLocal: `${selectedDate}T09:00`,
                  endLocal: `${selectedDate}T10:00`,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> Schedule Visit
            </button>
          </div>
        }
      />

      {banner && (
        <div
          className={`rounded-xl px-4 py-2.5 text-xs font-medium flex items-center justify-between border ${
            banner.kind === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          <span className="flex items-center gap-2">
            {banner.kind === 'error' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {banner.text}
          </span>
          <button type="button" onClick={() => setBanner(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <StatGrid cols={4}>
        <KpiCard label="Unscheduled Tickets" value={kpis.unscheduled} sub="awaiting visit slot" accent="amber" icon={Clock} />
        <KpiCard label="Scheduled Visits" value={kpis.scheduled} sub={`on ${selectedDate}`} accent="violet" icon={Calendar} />
        <KpiCard label="Active In Field" value={kpis.inField} sub="en route / on site / working" accent="cyan" icon={Navigation} />
        <KpiCard label="Completed Visits" value={kpis.completed} sub="signed & closed today" accent="emerald" icon={CheckCircle2} />
      </StatGrid>

      {/* Toolbar: Date, Filters, Layout Mode */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSelectedDate((d) => addDays(d, -1))}
            className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]"
          />
          <button
            type="button"
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
            className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
            className="ml-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
          >
            Today
          </button>
        </div>

        <select
          value={territoryId}
          onChange={(e) => setTerritoryId(e.target.value)}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-1.5 text-xs text-[var(--text-main)]"
        >
          <option value="">All Territories</option>
          {(board?.territories ?? []).map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name} ({tr.code})
            </option>
          ))}
        </select>

        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-1.5 text-xs text-[var(--text-main)]"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] p-0.5">
            {(
              [
                { key: 'split', label: 'Split', icon: Columns2 },
                { key: 'gantt', label: 'Gantt', icon: GanttChartSquare },
                { key: 'map', label: 'Live Map', icon: Compass },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setViewMode(key)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  viewMode === key ? 'bg-violet-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadBoard()}
            disabled={loading}
            className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
            title="Refresh dispatch board"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left Queue: Unscheduled & Open Work Orders */}
        <div className="xl:col-span-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden flex flex-col max-h-[680px]">
          <div className="px-3.5 py-3 border-b border-[var(--border-subtle)] space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-main)]">
                Open Work Orders ({filteredQueue.length})
              </h2>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Filter tickets or sites…"
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] pl-8 pr-2.5 py-1.5 text-xs text-[var(--text-main)]"
              />
            </div>
          </div>

          <div className="overflow-y-auto divide-y divide-[var(--border-subtle)] flex-1">
            {filteredQueue.length === 0 ? (
              <div className="p-6 text-center text-xs text-[var(--text-muted)]">
                No open work orders match your filter.
              </div>
            ) : (
              filteredQueue.map((t) => (
                <div key={t.id} className="p-3 space-y-1.5 hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-mono text-[10px] font-bold text-[var(--text-muted)]">
                      {t.readableId ?? t.id.slice(0, 8)}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        PRIORITY_PILL[t.priority] ?? PRIORITY_PILL.Medium
                      }`}
                    >
                      {t.priority}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-[var(--text-main)] line-clamp-2">{t.title}</div>
                  {t.siteName && (
                    <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0 text-violet-500" /> {t.siteName}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {t.visitCount > 0 ? `${t.visitCount} visit(s)` : 'Unscheduled'} · {t.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSmartSchedule(t)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-semibold"
                    >
                      <Sparkles className="w-3 h-3" /> Smart Schedule
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Center + Right: Gantt Timeline & Live Map */}
        <div className="xl:col-span-9 space-y-4">
          {viewMode !== 'map' && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <div className="text-xs font-bold text-[var(--text-main)] flex items-center gap-2">
                  <GanttChartSquare className="w-4 h-4 text-violet-500" />
                  <span>Resource Schedule — {selectedDate} (07:00 – 21:00)</span>
                </div>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Click any empty slot to dispatch · Click a visit block to inspect
                </span>
              </div>

              {(board?.technicians ?? []).length === 0 ? (
                <div className="p-10 text-center space-y-2 text-xs text-[var(--text-muted)]">
                  <p>No active technicians found for the selected filter.</p>
                  <Link
                    href="/service-tickets/technicians"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold"
                  >
                    + Add Technicians &amp; Territories
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[820px]">
                    {/* Hour Headers */}
                    <div className="grid grid-cols-[200px_1fr] border-b border-[var(--border-subtle)] bg-[var(--bg-main)]">
                      <div className="px-3 py-2 text-[11px] font-bold uppercase text-[var(--text-muted)] border-r border-[var(--border-subtle)]">
                        Technician
                      </div>
                      <div className="grid" style={{ gridTemplateColumns: `repeat(${TIMELINE_HOURS_SPAN}, minmax(0, 1fr))` }}>
                        {HOURS.map((h) => (
                          <div
                            key={h}
                            className="px-1 py-2 text-[10px] font-semibold text-center text-[var(--text-muted)] border-r border-[var(--border-subtle)] last:border-r-0"
                          >
                            {String(h).padStart(2, '0')}:00
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Technician Rows */}
                    {(board?.technicians ?? []).map((tech) => {
                      const techVisits = (board?.visits ?? []).filter(
                        (v) => v.status !== 'CANCELLED' && v.crew.some((c) => c.technicianId === tech.id),
                      );
                      const techTasks = (board?.tasks ?? []).filter(
                        (tk) => tk.assignedTechId === tech.id && tk.scheduledStartAt && tk.scheduledEndAt,
                      );
                      const blockedShifts = tech.shifts.filter((s) => s.entryType === 'LEAVE' || s.entryType === 'BLOCKED');

                      return (
                        <div
                          key={tech.id}
                          className="grid grid-cols-[200px_1fr] border-b border-[var(--border-subtle)] last:border-b-0 min-h-[64px]"
                        >
                          {/* Tech label */}
                          <div className="px-3 py-2 border-r border-[var(--border-subtle)] flex flex-col justify-center gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${AVAIL_DOT[tech.availabilityStatus] ?? 'bg-slate-400'}`}
                              />
                              <span className="text-xs font-semibold text-[var(--text-main)] truncate">{tech.fullName}</span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] flex items-center justify-between">
                              <span className="truncate">{tech.employeeCode}</span>
                              <span className="tabular-nums font-semibold">
                                {techVisits.length}/{tech.maxDailyJobs} jobs
                              </span>
                            </div>
                          </div>

                          {/* Hourly Timeline Track */}
                          <div className="relative">
                            {/* Clickable hour cells */}
                            <div
                              className="grid h-full min-h-[64px]"
                              style={{ gridTemplateColumns: `repeat(${TIMELINE_HOURS_SPAN}, minmax(0, 1fr))` }}
                            >
                              {HOURS.map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => openSlotSchedule(tech.id, h)}
                                  title={`Schedule visit for ${tech.fullName} at ${String(h).padStart(2, '0')}:00`}
                                  className="h-full border-r border-[var(--border-subtle)]/60 last:border-r-0 hover:bg-violet-500/10 transition-colors"
                                />
                              ))}
                            </div>

                            {/* Blocked / Leave Shift Overlays */}
                            {blockedShifts.map((s) => {
                              const pos = computeBarPosition(s.startsAt, s.endsAt, selectedDate);
                              if (!pos) return null;
                              return (
                                <div
                                  key={s.id}
                                  style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }}
                                  className="pointer-events-none absolute top-1 bottom-1 rounded-md bg-rose-500/15 border border-dashed border-rose-500/50 flex items-center justify-center text-[10px] font-bold text-rose-700 dark:text-rose-300 overflow-hidden px-1"
                                >
                                  {s.entryType}
                                </div>
                              );
                            })}

                            {/* Non-Job Activity Task Blocks */}
                            {techTasks.map((tk) => {
                              const pos = computeBarPosition(tk.scheduledStartAt!, tk.scheduledEndAt!, selectedDate);
                              if (!pos) return null;
                              return (
                                <div
                                  key={tk.id}
                                  style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }}
                                  title={`${tk.taskCategory}: ${tk.title}`}
                                  className="absolute bottom-1 h-5 rounded bg-slate-700/90 border border-slate-500 text-white text-[9px] font-semibold px-1.5 flex items-center truncate"
                                >
                                  {tk.taskCategory}: {tk.title}
                                </div>
                              );
                            })}

                            {/* Scheduled Visit Bars */}
                            {techVisits.map((v) => {
                              const pos = computeBarPosition(v.scheduledStartAt, v.scheduledEndAt, selectedDate);
                              if (!pos) return null;
                              const isSel = selectedVisit?.id === v.id;
                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => setSelectedVisit(v)}
                                  style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }}
                                  className={`absolute top-1.5 h-10 rounded-lg border px-2 py-1 text-left shadow-sm transition-transform hover:scale-[1.01] overflow-hidden ${
                                    VISIT_BLOCK_STYLE[v.status]
                                  } ${isSel ? 'ring-2 ring-white dark:ring-cyan-300 z-10' : ''}`}
                                >
                                  <div className="text-[10px] font-bold leading-tight truncate">
                                    {v.ticketReadableId ?? 'WO'} · V{v.visitNumber}
                                  </div>
                                  <div className="text-[9px] opacity-90 truncate">{v.ticketTitle}</div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live Field Map */}
          {viewMode !== 'gantt' && (
            <FsmLiveFieldMap
              technicians={board?.technicians ?? []}
              visits={board?.visits ?? []}
              territories={board?.territories ?? []}
              unscheduledTickets={board?.unscheduledTickets ?? []}
              selectedVisitId={selectedVisit?.id}
              onSelectVisit={(v) => setSelectedVisit(v)}
              className={viewMode === 'map' ? 'h-[560px]' : 'h-[360px]'}
            />
          )}
        </div>
      </div>

      {/* Selected Visit Inspector Modal */}
      {selectedVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono font-bold text-violet-600 dark:text-violet-300">
                  {selectedVisit.ticketReadableId ?? selectedVisit.ticketId.slice(0, 8)} · Visit #{selectedVisit.visitNumber}
                </div>
                <h3 className="text-sm font-bold text-[var(--text-main)]">{selectedVisit.ticketTitle}</h3>
              </div>
              <button type="button" onClick={() => setSelectedVisit(null)} className="p-1 text-[var(--text-muted)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                  <div className="text-[10px] uppercase text-[var(--text-muted)]">Status</div>
                  <div className="font-bold text-[var(--text-main)] mt-0.5">{selectedVisit.status.replace('_', ' ')}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                  <div className="text-[10px] uppercase text-[var(--text-muted)]">Schedule Window</div>
                  <div className="font-semibold text-[var(--text-main)] mt-0.5 tabular-nums">
                    {new Date(selectedVisit.scheduledStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                    {new Date(selectedVisit.scheduledEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Dispatched Crew</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedVisit.crew.map((c) => (
                    <span
                      key={c.id}
                      className="px-2 py-1 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-medium"
                    >
                      {c.fullName} ({c.role})
                    </span>
                  ))}
                </div>
              </div>

              {selectedVisit.siteName && (
                <div className="text-[var(--text-muted)] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-violet-500" />
                  <span>
                    {selectedVisit.siteName}
                    {selectedVisit.siteAddress ? ` — ${selectedVisit.siteAddress}` : ''}
                  </span>
                </div>
              )}

              {/* Quick status transitions */}
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Quick Field Status Action</div>
                <div className="flex flex-wrap gap-1.5">
                  {(['DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'INCOMPLETE'] as VisitStatus[])
                    .filter((st) => st !== selectedVisit.status && canTransitionVisitStatus(selectedVisit.status, st))
                    .map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => void handleQuickTransition(selectedVisit, st)}
                        className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold"
                      >
                        → {st.replace('_', ' ')}
                      </button>
                    ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/service-tickets/${selectedVisit.ticketId}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold hover:bg-[var(--bg-surface-hover)]"
                  >
                    Open Ticket <ExternalLink className="w-3 h-3" />
                  </Link>
                  <Link
                    href="/service-tickets/field-app"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500"
                  >
                    Field App
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteVisit(selectedVisit)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600/15 hover:bg-rose-600 text-rose-700 dark:text-rose-300 hover:text-white font-semibold transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Visit Modal */}
      {scheduleModal && board && (
        <ScheduleVisitModal
          board={board}
          initial={scheduleModal}
          onClose={() => setScheduleModal(null)}
          onCreated={async (msg) => {
            setScheduleModal(null);
            setBanner({ kind: 'success', text: msg });
            await loadBoard();
          }}
        />
      )}

      {/* Schedule Non-Job Activity Modal */}
      {activityModal && board && (
        <ScheduleActivityModal
          board={board}
          defaultDate={selectedDate}
          onClose={() => setActivityModal(null)}
          onCreated={async () => {
            setActivityModal(null);
            setBanner({ kind: 'success', text: 'Technician activity added to timeline.' });
            await loadBoard();
          }}
        />
      )}
    </div>
  );
}

// ── Schedule Visit Modal ─────────────────────────────────────────────────────

function ScheduleVisitModal({
  board,
  initial,
  onClose,
  onCreated,
}: {
  board: DispatchBoardPayload;
  initial: { ticketId?: string; leadTechnicianId?: string; startLocal?: string; endLocal?: string };
  onClose: () => void;
  onCreated: (message: string) => Promise<void>;
}) {
  const [ticketId, setTicketId] = useState(initial.ticketId ?? board.unscheduledTickets[0]?.id ?? '');
  const [leadTechnicianId, setLeadTechnicianId] = useState(
    initial.leadTechnicianId ?? board.technicians[0]?.id ?? '',
  );
  const [helperIds, setHelperIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState('');
  const [startLocal, setStartLocal] = useState(initial.startLocal ?? '');
  const [endLocal, setEndLocal] = useState(initial.endLocal ?? '');
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [allowConflicts, setAllowConflicts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTicket = board.unscheduledTickets.find((t) => t.id === ticketId) ?? null;

  const rankedTechs = useMemo(
    () =>
      board.technicians
        .map((tech) => ({
          tech,
          rec: scoreTechnicianForAssignment({
            tech,
            department: selectedTicket?.assignedDepartment,
            territoryId: selectedTicket?.territoryId,
            siteLat: selectedTicket?.siteLat,
            siteLng: selectedTicket?.siteLng,
            shifts: tech.shifts,
          }),
        }))
        .sort((a, b) => Number(b.rec.eligible) - Number(a.rec.eligible) || b.rec.score - a.rec.score),
    [board.technicians, selectedTicket],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketId) {
      setError('Select a work order to schedule.');
      return;
    }
    if (!startLocal || !endLocal) {
      setError('Start and end times are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const crew = [
        ...(leadTechnicianId ? [{ technicianId: leadTechnicianId, role: 'LEAD' }] : []),
        ...helperIds.filter((id) => id !== leadTechnicianId).map((id) => ({ technicianId: id, role: 'HELPER' })),
      ];
      const res = await fetch('/api/service-tickets/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          teamId: teamId || null,
          crew,
          scheduledStartAt: new Date(startLocal).toISOString(),
          scheduledEndAt: new Date(endLocal).toISOString(),
          dispatchNotes,
          allowConflicts,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not schedule visit.');
        return;
      }
      await onCreated(`Scheduled Visit #${data.visit?.visitNumber ?? 1} successfully.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--text-main)]">Schedule &amp; Dispatch Field Visit</h3>
          <button type="button" onClick={onClose} className="p-1 text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2.5 text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <label className="block space-y-1">
            <span className="font-semibold text-[var(--text-muted)]">Work Order *</span>
            <select
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
            >
              <option value="">Select open work order…</option>
              {board.unscheduledTickets.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.priority}] {t.readableId ?? t.id.slice(0, 8)} — {t.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="font-semibold text-[var(--text-muted)]">Lead Technician (Ranked Best-Fit)</span>
            <select
              value={leadTechnicianId}
              onChange={(e) => setLeadTechnicianId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
            >
              <option value="">— Dispatch via Team or Unassigned —</option>
              {rankedTechs.map(({ tech, rec }) => (
                <option key={tech.id} value={tech.id}>
                  {rec.score}% match · {tech.fullName} ({tech.availabilityStatus})
                  {rec.distanceKm !== null ? ` · ${rec.distanceKm} km` : ''}
                </option>
              ))}
            </select>
          </label>

          {board.teams.length > 0 && (
            <label className="block space-y-1">
              <span className="font-semibold text-[var(--text-muted)]">Optional Team / Squad</span>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
              >
                <option value="">None</option>
                {board.teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name} ({tm.members.length} members)
                  </option>
                ))}
              </select>
            </label>
          )}

          {board.technicians.length > 1 && (
            <div className="space-y-1">
              <span className="font-semibold text-[var(--text-muted)]">Additional Helper Crew (Optional)</span>
              <div className="flex flex-wrap gap-1.5">
                {board.technicians
                  .filter((t) => t.id !== leadTechnicianId)
                  .map((t) => {
                    const checked = helperIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setHelperIds((prev) =>
                            checked ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                          )
                        }
                        className={`px-2 py-1 rounded-md border text-[11px] font-medium ${
                          checked
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-[var(--bg-main)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                        }`}
                      >
                        {checked ? '✓ ' : '+ '}
                        {t.fullName}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="font-semibold text-[var(--text-muted)]">Start *</span>
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 text-[var(--text-main)]"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold text-[var(--text-muted)]">End *</span>
              <input
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 text-[var(--text-main)]"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="font-semibold text-[var(--text-muted)]">Dispatch Instructions</span>
            <textarea
              rows={2}
              value={dispatchNotes}
              onChange={(e) => setDispatchNotes(e.target.value)}
              placeholder="Gate access code, required spares, site contact notes…"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-[11px] text-[var(--text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={allowConflicts}
              onChange={(e) => setAllowConflicts(e.target.checked)}
              className="rounded"
            />
            Allow double-booking / override schedule conflicts
          </label>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold"
          >
            {saving ? 'Scheduling…' : 'Dispatch Visit'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Schedule Non-Job Technician Activity Modal ───────────────────────────────

function ScheduleActivityModal({
  board,
  defaultDate,
  onClose,
  onCreated,
}: {
  board: DispatchBoardPayload;
  defaultDate: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskCategory>('PARTS_PICKUP');
  const [assignedTechId, setAssignedTechId] = useState(board.technicians[0]?.id ?? '');
  const [startLocal, setStartLocal] = useState(`${defaultDate}T08:00`);
  const [endLocal, setEndLocal] = useState(`${defaultDate}T09:00`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Activity title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/service-tickets/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          taskCategory: category,
          assignedTechId: assignedTechId || null,
          scheduledStartAt: new Date(startLocal).toISOString(),
          scheduledEndAt: new Date(endLocal).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Failed to add activity.');
        return;
      }
      await onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--text-main)]">Add Technician Gantt Activity</h3>
          <button type="button" onClick={onClose} className="p-1 text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-xs">
          {error && <div className="text-rose-600 dark:text-rose-400">{error}</div>}
          <label className="block space-y-1">
            <span className="font-semibold text-[var(--text-muted)]">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TaskCategory)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
            >
              {TASK_CATEGORIES.filter((c) => c !== 'WORK_ORDER_TASK').map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-semibold text-[var(--text-muted)]">Title *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Collect chiller spares from Al Quoz depot"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-semibold text-[var(--text-muted)]">Technician</span>
            <select
              value={assignedTechId}
              onChange={(e) => setAssignedTechId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
            >
              {board.technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="font-semibold text-[var(--text-muted)]">Start</span>
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 text-[var(--text-main)]"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold text-[var(--text-muted)]">End</span>
              <input
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 text-[var(--text-main)]"
              />
            </label>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--border-subtle)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold"
          >
            {saving ? 'Saving…' : 'Add Activity'}
          </button>
        </div>
      </form>
    </div>
  );
}
