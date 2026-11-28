'use client';

/**
 * TicketFieldExecutionPanel — Embedded on /service-tickets/[id] showing:
 *   1. Multi-Visit Field Appointments (with quick Schedule Visit + Dispatch Board link)
 *   2. Work Order Sub-Tasks (inline add, toggle completion, dependency status)
 *   3. Digital SOP / Safety Checklists (start from template, interactive completion)
 *   4. Signed Field Service Reports (FSR) with e-signatures & print view
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  CheckSquare,
  ClipboardCheck,
  FileSignature,
  Plus,
  ExternalLink,
  CheckCircle2,
  Circle,
  Printer,
  Loader2,
  Users,
  MapPin,
} from 'lucide-react';
import type {
  ChecklistResponseItem,
  FsmChecklistRun,
  FsmChecklistTemplate,
  FsmServiceReport,
  FsmWorkTask,
  FsmWorkVisit,
} from '@/lib/service-tickets/dispatch';
import { evaluateChecklistCompletion } from '@/lib/service-tickets/dispatch';

const VISIT_STATUS_BADGE: Record<string, string> = {
  SCHEDULED: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  DISPATCHED: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  EN_ROUTE: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  ON_SITE: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  IN_PROGRESS: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  PAUSED: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  INCOMPLETE: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  CANCELLED: 'bg-slate-500/15 text-slate-400 border-slate-500/40',
};

export function TicketFieldExecutionPanel({
  ticketId,
  ticketType,
  onUpdated,
}: {
  ticketId: string;
  ticketType: string;
  onUpdated?: () => void;
}) {
  const [tab, setTab] = useState<'visits' | 'tasks' | 'checklists' | 'fsr'>('visits');
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<FsmWorkVisit[]>([]);
  const [tasks, setTasks] = useState<FsmWorkTask[]>([]);
  const [templates, setTemplates] = useState<FsmChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<FsmChecklistRun[]>([]);
  const [reports, setReports] = useState<FsmServiceReport[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewReport, setPreviewReport] = useState<FsmServiceReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vRes, tRes, tplRes, runRes, fsrRes] = await Promise.all([
        fetch(`/api/service-tickets/visits?ticketId=${ticketId}`).then((r) => (r.ok ? r.json() : { visits: [] })),
        fetch(`/api/service-tickets/tasks?ticketId=${ticketId}`).then((r) => (r.ok ? r.json() : { tasks: [] })),
        fetch(`/api/service-tickets/checklists/templates?serviceTypeKey=${encodeURIComponent(ticketType)}`).then((r) =>
          r.ok ? r.json() : { templates: [] },
        ),
        fetch(`/api/service-tickets/checklists/runs?ticketId=${ticketId}`).then((r) => (r.ok ? r.json() : { runs: [] })),
        fetch(`/api/service-tickets/service-reports?ticketId=${ticketId}`).then((r) =>
          r.ok ? r.json() : { reports: [] },
        ),
      ]);
      setVisits(Array.isArray(vRes.visits) ? vRes.visits : []);
      setTasks(Array.isArray(tRes.tasks) ? tRes.tasks : []);
      setTemplates(Array.isArray(tplRes.templates) ? tplRes.templates : []);
      setRuns(Array.isArray(runRes.runs) ? runRes.runs : []);
      setReports(Array.isArray(fsrRes.reports) ? fsrRes.reports : []);
    } finally {
      setLoading(false);
    }
  }, [ticketId, ticketType]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/service-tickets/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, title: newTaskTitle.trim(), taskCategory: 'WORK_ORDER_TASK' }),
      });
      if (res.ok) {
        setNewTaskTitle('');
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (task: FsmWorkTask) => {
    const nextStatus = task.status === 'COMPLETED' ? 'OPEN' : 'COMPLETED';
    const res = await fetch('/api/service-tickets/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: nextStatus }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? 'Could not update task.');
      return;
    }
    await load();
  };

  const seedTemplates = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/service-tickets/checklists/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seedDefaults: true }),
      });
      if (res.ok) await load();
    } finally {
      setSaving(false);
    }
  };

  const startChecklist = async (templateId: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/service-tickets/checklists/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, visitId: visits[0]?.id ?? null, templateId }),
      });
      if (res.ok) await load();
    } finally {
      setSaving(false);
    }
  };

  const updateRunResponse = async (run: FsmChecklistRun, itemId: string, value: boolean | string | number | null) => {
    const nextResponses: ChecklistResponseItem[] = run.responses.map((r) =>
      r.itemId === itemId ? { ...r, value } : r,
    );
    setRuns((prev) =>
      prev.map((r) =>
        r.id === run.id
          ? { ...r, responses: nextResponses, status: evaluateChecklistCompletion(nextResponses).status }
          : r,
      ),
    );
    await fetch('/api/service-tickets/checklists/runs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: run.id, responses: nextResponses }),
    });
    onUpdated?.();
  };

  return (
    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setTab('visits')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'visits' ? 'bg-violet-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" /> Visits ({visits.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('tasks')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'tasks' ? 'bg-violet-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" /> Sub-Tasks ({tasks.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('checklists')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'checklists' ? 'bg-violet-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" /> Checklists ({runs.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('fsr')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'fsr' ? 'bg-violet-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            <FileSignature className="w-3.5 h-3.5" /> Field Reports ({reports.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/service-tickets/dispatch"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 inline-flex items-center gap-1 font-semibold"
          >
            Dispatch Board <ExternalLink className="w-3 h-3" />
          </Link>
          <Link
            href="/service-tickets/field-app"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1 font-semibold"
          >
            Field App <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading field execution data…
        </div>
      ) : tab === 'visits' ? (
        visits.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-950/50 border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-2">
            <p>No field visits scheduled yet for this work order.</p>
            <Link
              href="/service-tickets/dispatch"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold"
            >
              <CalendarClock className="w-3.5 h-3.5" /> Schedule on Dispatch Board
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visits.map((v) => (
              <div key={v.id} className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-200">Visit #{v.visitNumber}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        VISIT_STATUS_BADGE[v.status] ?? VISIT_STATUS_BADGE.SCHEDULED
                      }`}
                    >
                      {v.status.replace('_', ' ')}
                    </span>
                    {v.teamName && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                        Team: {v.teamName}
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400 tabular-nums">
                    {new Date(v.scheduledStartAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    – {new Date(v.scheduledEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3 h-3 text-violet-400" />
                    {v.crew.map((c) => `${c.fullName} (${c.role})`).join(', ') || 'No crew assigned'}
                  </span>
                  {v.checkinDistanceM !== null && (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <MapPin className="w-3 h-3" /> Check-in {v.checkinDistanceM}m from site
                    </span>
                  )}
                  {(v.actualTravelMins > 0 || v.actualWorkMins > 0) && (
                    <span>
                      Travel: {v.actualTravelMins}m · Work: {v.actualWorkMins}m
                    </span>
                  )}
                </div>
                {v.resolutionSummary && (
                  <div className="text-slate-300 bg-slate-900/80 rounded-lg px-2.5 py-1.5 border border-slate-800">
                    {v.resolutionSummary}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === 'tasks' ? (
        <div className="space-y-3">
          <form onSubmit={handleAddTask} className="flex items-center gap-2">
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Add sub-task (e.g. Isolate main breaker, procure spare capacitor)…"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              type="submit"
              disabled={saving || !newTaskTitle.trim()}
              className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </form>

          {tasks.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-950/50 border border-dashed border-slate-800 text-center text-xs text-slate-500">
              No sub-tasks defined for this work order yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((t) => {
                const done = t.status === 'COMPLETED';
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => void toggleTask(t)}
                      className="flex items-center gap-2.5 text-left flex-1 min-w-0"
                    >
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <span className={`truncate ${done ? 'line-through text-slate-500' : 'text-slate-200 font-medium'}`}>
                        {t.title}
                      </span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-400">
                      {t.assignedTechName && <span>{t.assignedTechName}</span>}
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                        {t.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : tab === 'checklists' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {templates.length === 0 ? (
              <button
                type="button"
                onClick={() => void seedTemplates()}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
              >
                Install 4 Starter FM Checklists (Safety / HVAC / Electrical / Handover)
              </button>
            ) : (
              templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => void startChecklist(tpl.id)}
                  disabled={saving}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3 text-violet-400" /> {tpl.name}
                </button>
              ))
            )}
          </div>

          {runs.map((run) => {
            const evalSummary = evaluateChecklistCompletion(run.responses);
            return (
              <div key={run.id} className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white">{run.templateName}</span>
                    <span className="ml-2 text-[10px] text-slate-400">
                      ({evalSummary.answeredCount}/{evalSummary.totalCount})
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      run.status === 'PASSED'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : run.status === 'FAILED'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="space-y-2">
                  {run.responses.map((item) => (
                    <div key={item.itemId} className="flex flex-wrap items-center justify-between gap-2 py-1 border-t border-slate-800/70">
                      <span className="text-slate-300 flex-1 min-w-[200px]">
                        {item.label} {item.required && <span className="text-rose-400">*</span>}
                      </span>
                      {item.type === 'BOOL' ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void updateRunResponse(run, item.itemId, true)}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                              item.value === true ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            Pass / Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateRunResponse(run, item.itemId, false)}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                              item.value === false ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            Fail / No
                          </button>
                        </div>
                      ) : (
                        <input
                          type={item.type === 'NUMBER' ? 'number' : 'text'}
                          value={item.value === null || item.value === undefined ? '' : String(item.value)}
                          onChange={(e) =>
                            void updateRunResponse(
                              run,
                              item.itemId,
                              item.type === 'NUMBER' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value,
                            )
                          }
                          placeholder={item.type === 'NUMBER' ? 'Reading…' : 'Enter notes…'}
                          className="w-40 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : reports.length === 0 ? (
        <div className="p-4 rounded-xl bg-slate-950/50 border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-2">
          <p>No signed Field Service Reports submitted yet.</p>
          <Link
            href="/service-tickets/field-app"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          >
            <FileSignature className="w-3.5 h-3.5" /> Capture e-Sign FSR in Field App
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {reports.map((r) => (
            <div key={r.id} className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-bold text-emerald-300">{r.reportNumber}</span>
                  {r.customerSignerName && (
                    <span className="ml-2 text-slate-400">Signed by {r.customerSignerName}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewReport(r)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
                >
                  <Printer className="w-3 h-3" /> View / Print FSR
                </button>
              </div>
              <p className="text-slate-300">{r.workPerformed}</p>
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                {r.rootCauseCode && <span>Root cause: {r.rootCauseCode}</span>}
                {r.remedyCode && <span>Remedy: {r.remedyCode}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Printable FSR Modal */}
      {previewReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white text-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <div className="text-xs uppercase font-bold text-violet-700">Field Service Report</div>
                <h3 className="text-lg font-bold">{previewReport.reportNumber}</h3>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / Save PDF
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewReport(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-800 text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="text-xs space-y-2">
              <div>
                <strong>Work Order:</strong> {previewReport.ticketReadableId ?? previewReport.ticketId} —{' '}
                {previewReport.ticketTitle}
              </div>
              <div>
                <strong>Work Performed:</strong>
                <p className="mt-1 p-2.5 rounded bg-slate-50 border whitespace-pre-wrap">{previewReport.workPerformed}</p>
              </div>
              {(previewReport.rootCauseCode || previewReport.remedyCode) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <strong>Root Cause:</strong> {previewReport.rootCauseCode ?? '—'}
                  </div>
                  <div>
                    <strong>Remedy:</strong> {previewReport.remedyCode ?? '—'}
                  </div>
                </div>
              )}
              {previewReport.recommendations && (
                <div>
                  <strong>Recommendations:</strong> {previewReport.recommendations}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                <div>
                  <div className="font-semibold mb-1">
                    Customer Signature ({previewReport.customerSignerName || 'Client'})
                  </div>
                  {previewReport.customerSignatureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewReport.customerSignatureUrl}
                      alt="Customer signature"
                      className="h-20 border rounded bg-white p-1"
                    />
                  ) : (
                    <div className="h-20 border rounded flex items-center justify-center text-slate-400">Unsigned</div>
                  )}
                </div>
                <div>
                  <div className="font-semibold mb-1">Technician Signature</div>
                  {previewReport.technicianSignatureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewReport.technicianSignatureUrl}
                      alt="Technician signature"
                      className="h-20 border rounded bg-white p-1"
                    />
                  ) : (
                    <div className="h-20 border rounded flex items-center justify-center text-slate-400">Unsigned</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
