'use client';

/**
 * /service-tickets/field-app — Offline-Ready Technician Mobile Execution Console
 *
 * Designed for field technicians (mobile/tablet/desktop):
 *   - Offline mutation queue in localStorage with UUID idempotencyKey + auto-sync on reconnect
 *   - Live GPS heartbeat (browser Geolocation API + test-coordinate fallback)
 *   - Step-by-step visit execution: Start Travel -> GPS Geofence Check-In -> Start Work -> Pause -> Complete
 *   - Asset QR/tag entry, Sub-Tasks completion, Digital SOP/Safety Checklists, and e-Sign FSR capture
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Smartphone,
  Wifi,
  WifiOff,
  Navigation,
  MapPin,
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  CheckSquare,
  FileSignature,
  RefreshCw,
  Circle,
  Plus,
  QrCode,
  Radio,
  GanttChartSquare,
  Clock,
  X,
  UploadCloud,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import type { FsmTechnician } from '@/lib/service-tickets/workforce';
import {
  REMEDY_CODES,
  ROOT_CAUSE_CODES,
  evaluateChecklistCompletion,
  type ChecklistResponseItem,
  type FsmChecklistRun,
  type FsmChecklistTemplate,
  type FsmServiceReport,
  type FsmWorkTask,
  type FsmWorkVisit,
  type VisitStatus,
} from '@/lib/service-tickets/dispatch';
import { SignaturePad } from '../components/signature-pad';

const OFFLINE_QUEUE_KEY = 'fleet360_fsm_offline_queue_v1';

interface QueuedMutation {
  id: string;
  idempotencyKey: string;
  label: string;
  endpoint: string;
  method: 'POST' | 'PATCH';
  body: Record<string, unknown>;
  queuedAt: string;
}

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readQueue(): QueuedMutation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedMutation[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
  } catch {
    // ignore quota issues
  }
}

const STEPS: Array<{ key: VisitStatus; label: string }> = [
  { key: 'DISPATCHED', label: 'Dispatched' },
  { key: 'EN_ROUTE', label: 'En Route' },
  { key: 'ON_SITE', label: 'On Site' },
  { key: 'IN_PROGRESS', label: 'Working' },
  { key: 'COMPLETED', label: 'Done' },
];

function stepIndex(status: VisitStatus): number {
  if (status === 'SCHEDULED') return 0;
  if (status === 'PAUSED') return 3;
  const idx = STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

export default function TechnicianFieldAppPage() {
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedMutation[]>([]);
  const [syncingQueue, setSyncingQueue] = useState(false);

  const [technicians, setTechnicians] = useState<FsmTechnician[]>([]);
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [visits, setVisits] = useState<FsmWorkVisit[]>([]);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Selected visit detail state
  const [execTab, setExecTab] = useState<'tasks' | 'checklists' | 'fsr'>('checklists');
  const [tasks, setTasks] = useState<FsmWorkTask[]>([]);
  const [templates, setTemplates] = useState<FsmChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<FsmChecklistRun[]>([]);
  const [reports, setReports] = useState<FsmServiceReport[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [scannedAssetTag, setScannedAssetTag] = useState('');

  // Geofence override modal
  const [geoPrompt, setGeoPrompt] = useState<{
    visit: FsmWorkVisit;
    lat: number;
    lng: number;
    message: string;
    reason: string;
  } | null>(null);

  // FSR form
  const [workPerformed, setWorkPerformed] = useState('');
  const [rootCauseCode, setRootCauseCode] = useState('');
  const [remedyCode, setRemedyCode] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [customerSig, setCustomerSig] = useState<string | null>(null);
  const [techSig, setTechSig] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedVisit = useMemo(
    () => visits.find((v) => v.id === selectedVisitId) ?? visits[0] ?? null,
    [visits, selectedVisitId],
  );
  const activeTech = useMemo(
    () => technicians.find((t) => t.id === selectedTechId) ?? null,
    [technicians, selectedTechId],
  );

  // Online/offline listeners & queue init
  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    setQueue(readQueue());
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadTechnicians = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, techRes] = await Promise.all([
        fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/service-tickets/technicians?activeOnly=true').then((r) => (r.ok ? r.json() : { technicians: [] })),
      ]);
      const list: FsmTechnician[] = Array.isArray(techRes.technicians) ? techRes.technicians : [];
      setTechnicians(list);
      if (list.length > 0 && !selectedTechId) {
        const match =
          list.find((t) => meRes?.userId && t.userId === meRes.userId) ??
          list.find((t) => meRes?.email && t.email.toLowerCase() === String(meRes.email).toLowerCase()) ??
          list[0];
        setSelectedTechId(match.id);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedTechId]);

  useEffect(() => {
    void loadTechnicians();
  }, [loadTechnicians]);

  const loadVisits = useCallback(async () => {
    if (!selectedTechId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/service-tickets/visits?technicianId=${selectedTechId}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && Array.isArray(data.visits)) {
        const ordered = [...(data.visits as FsmWorkVisit[])].sort((a, b) => {
          const doneA = ['COMPLETED', 'CANCELLED'].includes(a.status) ? 1 : 0;
          const doneB = ['COMPLETED', 'CANCELLED'].includes(b.status) ? 1 : 0;
          return doneA - doneB || a.scheduledStartAt.localeCompare(b.scheduledStartAt);
        });
        setVisits(ordered);
        if (ordered.length > 0 && (!selectedVisitId || !ordered.some((v) => v.id === selectedVisitId))) {
          setSelectedVisitId(ordered[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selectedTechId, selectedVisitId]);

  useEffect(() => {
    void loadVisits();
  }, [loadVisits]);

  const loadVisitDetails = useCallback(async () => {
    if (!selectedVisit) return;
    const [detailRes, tplRes] = await Promise.all([
      fetch(`/api/service-tickets/visits/${selectedVisit.id}`, { cache: 'no-store' }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/service-tickets/checklists/templates?serviceTypeKey=${encodeURIComponent(selectedVisit.ticketType)}`).then(
        (r) => (r.ok ? r.json() : { templates: [] }),
      ),
    ]);
    if (detailRes) {
      setTasks(Array.isArray(detailRes.tasks) ? detailRes.tasks : []);
      setRuns(Array.isArray(detailRes.checklists) ? detailRes.checklists : []);
      setReports(Array.isArray(detailRes.reports) ? detailRes.reports : []);
      setScannedAssetTag(detailRes.visit?.scannedAssetTag ?? '');
    }
    setTemplates(Array.isArray(tplRes.templates) ? tplRes.templates : []);
  }, [selectedVisit]);

  useEffect(() => {
    void loadVisitDetails();
  }, [loadVisitDetails]);

  // Enqueue offline mutation helper
  const enqueueMutation = (item: Omit<QueuedMutation, 'id' | 'queuedAt'>) => {
    const next = [...readQueue(), { ...item, id: makeUuid(), queuedAt: new Date().toISOString() }];
    writeQueue(next);
    setQueue(next);
  };

  // Flush offline mutation queue
  const flushOfflineQueue = useCallback(async () => {
    const pending = readQueue();
    if (pending.length === 0 || !navigator.onLine) return;
    setSyncingQueue(true);
    const remaining: QueuedMutation[] = [];
    let syncedCount = 0;
    for (const item of pending) {
      try {
        const res = await fetch(item.endpoint, {
          method: item.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...item.body, idempotencyKey: item.idempotencyKey }),
        });
        if (res.ok || res.status === 409 || res.status === 400) {
          syncedCount++;
        } else {
          remaining.push(item);
        }
      } catch {
        remaining.push(item);
      }
    }
    writeQueue(remaining);
    setQueue(remaining);
    setSyncingQueue(false);
    if (syncedCount > 0) {
      setBanner({ kind: 'success', text: `Synced ${syncedCount} offline field update(s).` });
      await loadVisits();
      await loadVisitDetails();
    }
  }, [loadVisits, loadVisitDetails]);

  useEffect(() => {
    if (isOnline && queue.length > 0) {
      void flushOfflineQueue();
    }
  }, [isOnline, queue.length, flushOfflineQueue]);

  // Acquire browser GPS or fallback to site/homeBase coordinates
  const captureCoords = async (fallbackLat?: number | null, fallbackLng?: number | null) => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 4000 }),
        );
        return {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
        };
      } catch {
        // Fallback for desktop browsers / denied GPS permission
      }
    }
    return {
      latitude: fallbackLat ?? activeTech?.homeBaseLat ?? 25.2048,
      longitude: fallbackLng ?? activeTech?.homeBaseLng ?? 55.2708,
      accuracyM: 25,
    };
  };

  const handleSendGpsHeartbeat = async () => {
    if (!selectedTechId) return;
    const coords = await captureCoords(selectedVisit?.siteLat, selectedVisit?.siteLng);
    const res = await fetch('/api/service-tickets/technicians/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        technicianId: selectedTechId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyM: coords.accuracyM,
        batteryPct: 88,
      }),
    });
    if (res.ok) {
      setBanner({
        kind: 'success',
        text: `Live GPS ping sent (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}). Visible on Dispatch Map.`,
      });
    }
  };

  const runTransition = async (
    visit: FsmWorkVisit,
    status: VisitStatus,
    extra?: Record<string, unknown>,
  ) => {
    setBanner(null);
    const idempotencyKey = makeUuid();
    let coords: { latitude: number; longitude: number; accuracyM: number } | null = null;
    if (status === 'ON_SITE' || status === 'EN_ROUTE') {
      coords = await captureCoords(visit.siteLat, visit.siteLng);
    }

    const payload: Record<string, unknown> = {
      status,
      technicianId: selectedTechId,
      scannedAssetTag: scannedAssetTag.trim() || undefined,
      ...(coords ? coords : {}),
      ...(extra ?? {}),
      idempotencyKey,
    };

    if (!navigator.onLine) {
      enqueueMutation({
        idempotencyKey,
        label: `Visit #${visit.visitNumber} → ${status}`,
        endpoint: `/api/service-tickets/visits/${visit.id}/transition`,
        method: 'POST',
        body: payload,
      });
      setBanner({ kind: 'info', text: `Offline: queued "${status.replace('_', ' ')}" — will sync when reconnected.` });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/service-tickets/visits/${visit.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && status === 'ON_SITE' && coords) {
        setGeoPrompt({
          visit,
          lat: coords.latitude,
          lng: coords.longitude,
          message: data.error ?? 'Outside site geofence.',
          reason: '',
        });
        return;
      }
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error ?? 'Transition failed.' });
        return;
      }
      setBanner({
        kind: 'success',
        text: `Visit #${visit.visitNumber} updated to ${status.replace('_', ' ')}${
          data.geofenceDistanceM !== null && status === 'ON_SITE' ? ` (${data.geofenceDistanceM}m from site)` : ''
        }.`,
      });
      await loadVisits();
      await loadVisitDetails();
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddFieldTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit || !newTaskTitle.trim()) return;
    const res = await fetch('/api/service-tickets/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: selectedVisit.ticketId,
        visitId: selectedVisit.id,
        assignedTechId: selectedTechId || null,
        title: newTaskTitle.trim(),
      }),
    });
    if (res.ok) {
      setNewTaskTitle('');
      await loadVisitDetails();
    }
  };

  const toggleFieldTask = async (task: FsmWorkTask) => {
    const res = await fetch('/api/service-tickets/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: task.status === 'COMPLETED' ? 'OPEN' : 'COMPLETED' }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setBanner({ kind: 'error', text: d.error ?? 'Could not update task.' });
      return;
    }
    await loadVisitDetails();
  };

  const seedTemplates = async () => {
    await fetch('/api/service-tickets/checklists/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedDefaults: true }),
    });
    await loadVisitDetails();
  };

  const startChecklist = async (templateId: string) => {
    if (!selectedVisit) return;
    await fetch('/api/service-tickets/checklists/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: selectedVisit.ticketId,
        visitId: selectedVisit.id,
        templateId,
        completedBy: selectedTechId || null,
      }),
    });
    await loadVisitDetails();
  };

  const updateChecklistItem = async (run: FsmChecklistRun, itemId: string, value: boolean | string | number | null) => {
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
    if (!navigator.onLine) {
      enqueueMutation({
        idempotencyKey: makeUuid(),
        label: `Checklist ${run.templateName}`,
        endpoint: '/api/service-tickets/checklists/runs',
        method: 'PATCH',
        body: { id: run.id, responses: nextResponses, completedBy: selectedTechId || null },
      });
      return;
    }
    await fetch('/api/service-tickets/checklists/runs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: run.id, responses: nextResponses, completedBy: selectedTechId || null }),
    });
  };

  const handleSubmitFsr = async (e: React.FormEvent, completeVisit: boolean) => {
    e.preventDefault();
    if (!selectedVisit) return;
    if (!workPerformed.trim()) {
      setBanner({ kind: 'error', text: 'Please summarize the work performed before signing.' });
      return;
    }
    const idempotencyKey = makeUuid();
    const payload: Record<string, unknown> = {
      ticketId: selectedVisit.ticketId,
      visitId: selectedVisit.id,
      workPerformed: workPerformed.trim(),
      rootCauseCode: rootCauseCode || null,
      remedyCode: remedyCode || null,
      recommendations: recommendations.trim() || null,
      customerSignerName: signerName.trim() || null,
      customerSignerTitle: signerTitle.trim() || null,
      customerSignatureUrl: customerSig,
      technicianSignatureUrl: techSig,
      completeVisit,
      idempotencyKey,
    };

    if (!navigator.onLine) {
      enqueueMutation({
        idempotencyKey,
        label: `FSR for ${selectedVisit.ticketReadableId ?? 'Visit'}`,
        endpoint: '/api/service-tickets/service-reports',
        method: 'POST',
        body: payload,
      });
      setBanner({ kind: 'info', text: 'Offline: signed FSR queued and will upload automatically when online.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/service-tickets/service-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ kind: 'error', text: data.error ?? 'Failed to submit FSR.' });
        return;
      }
      setBanner({
        kind: 'success',
        text: `Field Service Report ${data.report?.reportNumber ?? ''} signed${completeVisit ? ' & visit completed' : ''}!`,
      });
      setWorkPerformed('');
      setRecommendations('');
      setSignerName('');
      setSignerTitle('');
      setCustomerSig(null);
      setTechSig(null);
      await loadVisits();
      await loadVisitDetails();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="Technician Field Execution App"
        subtitle="Mobile-first visits · GPS geofenced check-in · SOP checklists · e-Sign Field Service Reports · Offline sync queue"
        icon={Smartphone}
        accent="emerald"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                isOnline
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? 'Online' : 'Offline Mode'}
            </span>
            {queue.length > 0 && (
              <button
                type="button"
                onClick={() => void flushOfflineQueue()}
                disabled={!isOnline || syncingQueue}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 text-white text-xs font-semibold"
              >
                <UploadCloud className="w-3.5 h-3.5" /> Sync Queue ({queue.length})
              </button>
            )}
            <Link
              href="/service-tickets/dispatch"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-main)]"
            >
              <GanttChartSquare className="w-3.5 h-3.5 text-cyan-500" /> Dispatch Board
            </Link>
          </div>
        }
      />

      {/* Technician Selector & Live GPS Bar */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-[var(--text-muted)]">Technician Profile:</span>
            <select
              value={selectedTechId}
              onChange={(e) => setSelectedTechId(e.target.value)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)]"
            >
              {technicians.length === 0 && <option value="">No active technicians</option>}
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName} ({t.employeeCode}) — {t.availabilityStatus}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSendGpsHeartbeat()}
            disabled={!selectedTechId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold"
          >
            <Radio className="w-3.5 h-3.5" /> Send Live GPS Ping
          </button>
          <button
            type="button"
            onClick={() => void loadVisits()}
            className="p-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] text-[var(--text-main)]"
            title="Refresh visits"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`rounded-xl px-4 py-2.5 text-xs font-medium flex items-center justify-between border ${
            banner.kind === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
              : banner.kind === 'info'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {visits.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center space-y-3 text-xs text-[var(--text-muted)]">
          <p className="text-sm font-semibold text-[var(--text-main)]">
            No scheduled visits assigned to {activeTech?.fullName ?? 'this technician'} yet.
          </p>
          <p>Use the Dispatch Board to schedule and assign a field visit, then execute it here step by step.</p>
          <Link
            href="/service-tickets/dispatch"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white font-semibold"
          >
            <GanttChartSquare className="w-4 h-4" /> Go to Dispatch Board
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Visit List Rail */}
          <div className="lg:col-span-4 space-y-2">
            {visits.map((v) => {
              const active = selectedVisit?.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVisitId(v.id)}
                  className={`w-full text-left rounded-2xl border p-3.5 space-y-1.5 transition-all ${
                    active
                      ? 'border-violet-500 bg-violet-500/10 shadow-sm'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono font-bold text-violet-700 dark:text-violet-300">
                      {v.ticketReadableId ?? 'WO'} · Visit #{v.visitNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)]">
                      {v.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-[var(--text-main)] line-clamp-2">{v.ticketTitle}</div>
                  <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(v.scheduledStartAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {v.siteName && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 text-emerald-500" /> {v.siteName}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Visit Execution Workspace */}
          {selectedVisit && (
            <div className="lg:col-span-8 space-y-4">
              {/* Stepper + Primary Action Card */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono font-bold text-violet-700 dark:text-violet-300">
                      {selectedVisit.ticketReadableId ?? selectedVisit.ticketId.slice(0, 8)} · Visit #{selectedVisit.visitNumber}
                    </div>
                    <h2 className="text-base font-bold text-[var(--text-main)]">{selectedVisit.ticketTitle}</h2>
                    {selectedVisit.siteName && (
                      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                        {selectedVisit.siteName}
                        {selectedVisit.siteAddress ? ` — ${selectedVisit.siteAddress}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-[var(--text-muted)]">
                    <div>Travel: {selectedVisit.actualTravelMins}m · Work: {selectedVisit.actualWorkMins}m</div>
                    {selectedVisit.checkinDistanceM !== null && (
                      <div className="text-emerald-700 dark:text-emerald-300 font-semibold">
                        GPS Check-In: {selectedVisit.checkinDistanceM}m from site
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress Stepper */}
                <div className="grid grid-cols-5 gap-1.5">
                  {STEPS.map((st, idx) => {
                    const currentIdx = stepIndex(selectedVisit.status);
                    const reached = idx <= currentIdx;
                    return (
                      <div key={st.key} className="space-y-1 text-center">
                        <div
                          className={`h-1.5 rounded-full ${
                            reached ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-800'
                          }`}
                        />
                        <div
                          className={`text-[10px] font-semibold ${
                            reached ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--text-faint)]'
                          }`}
                        >
                          {st.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Asset QR Tag Input */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <QrCode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                    <input
                      value={scannedAssetTag}
                      onChange={(e) => setScannedAssetTag(e.target.value)}
                      placeholder="Scan or enter Asset QR / Serial Tag…"
                      className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] pl-9 pr-3 py-2 text-xs text-[var(--text-main)]"
                    />
                  </div>
                </div>

                {/* Primary Tap-Friendly Execution Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {(selectedVisit.status === 'SCHEDULED' || selectedVisit.status === 'DISPATCHED') && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void runTransition(selectedVisit, 'EN_ROUTE')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-sm"
                    >
                      <Navigation className="w-4 h-4" /> Start Travel (En Route)
                    </button>
                  )}

                  {['SCHEDULED', 'DISPATCHED', 'EN_ROUTE'].includes(selectedVisit.status) && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void runTransition(selectedVisit, 'ON_SITE')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-sm"
                    >
                      <MapPin className="w-4 h-4" /> GPS Check-In (On Site)
                    </button>
                  )}

                  {['ON_SITE', 'PAUSED', 'EN_ROUTE', 'DISPATCHED'].includes(selectedVisit.status) && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void runTransition(selectedVisit, 'IN_PROGRESS')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-sm"
                    >
                      <Play className="w-4 h-4" /> {selectedVisit.status === 'PAUSED' ? 'Resume Work' : 'Start Work'}
                    </button>
                  )}

                  {selectedVisit.status === 'IN_PROGRESS' && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void runTransition(selectedVisit, 'PAUSED')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-bold"
                    >
                      <Pause className="w-4 h-4" /> Pause
                    </button>
                  )}

                  {['ON_SITE', 'IN_PROGRESS', 'PAUSED'].includes(selectedVisit.status) && (
                    <>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void runTransition(selectedVisit, 'COMPLETED')}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Complete Visit
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          const reason = window.prompt('Reason visit could not be completed (e.g. awaiting spare part):');
                          if (reason !== null) {
                            void runTransition(selectedVisit, 'INCOMPLETE', {
                              incompleteReason: reason.trim() || 'Follow-up required',
                            });
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-600/15 hover:bg-rose-600 text-rose-700 dark:text-rose-300 hover:text-white text-xs font-bold transition-colors"
                      >
                        <AlertTriangle className="w-4 h-4" /> Incomplete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Execution Sub-Tabs: Checklists / Tasks / FSR & e-Sign */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setExecTab('checklists')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      execTab === 'checklists'
                        ? 'bg-violet-600 text-white'
                        : 'bg-[var(--bg-main)] text-[var(--text-muted)]'
                    }`}
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" /> Checklists ({runs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setExecTab('tasks')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      execTab === 'tasks'
                        ? 'bg-violet-600 text-white'
                        : 'bg-[var(--bg-main)] text-[var(--text-muted)]'
                    }`}
                  >
                    <CheckSquare className="w-3.5 h-3.5" /> Sub-Tasks ({tasks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setExecTab('fsr')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      execTab === 'fsr'
                        ? 'bg-violet-600 text-white'
                        : 'bg-[var(--bg-main)] text-[var(--text-muted)]'
                    }`}
                  >
                    <FileSignature className="w-3.5 h-3.5" /> FSR &amp; e-Sign ({reports.length})
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {execTab === 'checklists' && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {templates.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => void seedTemplates()}
                            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold"
                          >
                            + Load 4 Standard FM Checklists
                          </button>
                        ) : (
                          templates.map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => void startChecklist(tpl.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] text-xs font-medium text-[var(--text-main)] hover:border-violet-500"
                            >
                              <Plus className="w-3 h-3 text-violet-500" /> {tpl.name}
                            </button>
                          ))
                        )}
                      </div>

                      {runs.map((run) => {
                        const evalSum = evaluateChecklistCompletion(run.responses);
                        return (
                          <div
                            key={run.id}
                            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3.5 space-y-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-bold text-[var(--text-main)]">
                                {run.templateName}{' '}
                                <span className="font-normal text-[var(--text-muted)]">
                                  ({evalSum.answeredCount}/{evalSum.totalCount})
                                </span>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  run.status === 'PASSED'
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                    : run.status === 'FAILED'
                                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {run.status}
                              </span>
                            </div>
                            <div className="space-y-2">
                              {run.responses.map((item) => (
                                <div
                                  key={item.itemId}
                                  className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]"
                                >
                                  <span className="text-[var(--text-main)] flex-1 min-w-[180px]">
                                    {item.label} {item.required && <span className="text-rose-500">*</span>}
                                  </span>
                                  {item.type === 'BOOL' ? (
                                    <div className="flex gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => void updateChecklistItem(run, item.itemId, true)}
                                        className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                                          item.value === true
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)]'
                                        }`}
                                      >
                                        Pass
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void updateChecklistItem(run, item.itemId, false)}
                                        className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                                          item.value === false
                                            ? 'bg-rose-600 text-white'
                                            : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)]'
                                        }`}
                                      >
                                        Fail
                                      </button>
                                    </div>
                                  ) : (
                                    <input
                                      type={item.type === 'NUMBER' ? 'number' : 'text'}
                                      value={item.value === null || item.value === undefined ? '' : String(item.value)}
                                      onChange={(e) =>
                                        void updateChecklistItem(
                                          run,
                                          item.itemId,
                                          item.type === 'NUMBER'
                                            ? e.target.value === ''
                                              ? null
                                              : Number(e.target.value)
                                            : e.target.value,
                                        )
                                      }
                                      placeholder={item.type === 'NUMBER' ? 'Enter reading' : 'Notes'}
                                      className="w-36 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs text-[var(--text-main)]"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {execTab === 'tasks' && (
                    <div className="space-y-3">
                      <form onSubmit={handleAddFieldTask} className="flex gap-2">
                        <input
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          placeholder="Add field task…"
                          className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-xs text-[var(--text-main)]"
                        />
                        <button
                          type="submit"
                          className="px-3.5 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold"
                        >
                          Add
                        </button>
                      </form>
                      {tasks.map((t) => {
                        const done = t.status === 'COMPLETED';
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => void toggleFieldTask(t)}
                            className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] text-left text-xs"
                          >
                            {done ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <Circle className="w-4 h-4 text-[var(--text-faint)] shrink-0" />
                            )}
                            <span className={done ? 'line-through text-[var(--text-muted)]' : 'font-medium text-[var(--text-main)]'}>
                              {t.title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {execTab === 'fsr' && (
                    <form onSubmit={(e) => void handleSubmitFsr(e, true)} className="space-y-3 text-xs">
                      <label className="block space-y-1">
                        <span className="font-semibold text-[var(--text-muted)]">Work Performed Summary *</span>
                        <textarea
                          rows={3}
                          value={workPerformed}
                          onChange={(e) => setWorkPerformed(e.target.value)}
                          placeholder="Describe diagnostic findings, repair completed, and verification test results…"
                          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
                        />
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block space-y-1">
                          <span className="font-semibold text-[var(--text-muted)]">Root Cause Code</span>
                          <select
                            value={rootCauseCode}
                            onChange={(e) => setRootCauseCode(e.target.value)}
                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
                          >
                            <option value="">Select root cause…</option>
                            {ROOT_CAUSE_CODES.map((c) => (
                              <option key={c} value={c}>
                                {c.replace(/_/g, ' ')}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block space-y-1">
                          <span className="font-semibold text-[var(--text-muted)]">Remedy Code</span>
                          <select
                            value={remedyCode}
                            onChange={(e) => setRemedyCode(e.target.value)}
                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
                          >
                            <option value="">Select remedy…</option>
                            {REMEDY_CODES.map((c) => (
                              <option key={c} value={c}>
                                {c.replace(/_/g, ' ')}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block space-y-1">
                          <span className="font-semibold text-[var(--text-muted)]">Customer Signer Name</span>
                          <input
                            value={signerName}
                            onChange={(e) => setSignerName(e.target.value)}
                            placeholder="Facility Manager / Site Contact"
                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="font-semibold text-[var(--text-muted)]">Signer Title</span>
                          <input
                            value={signerTitle}
                            onChange={(e) => setSignerTitle(e.target.value)}
                            placeholder="e.g. Operations Supervisor"
                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
                          />
                        </label>
                      </div>

                      <label className="block space-y-1">
                        <span className="font-semibold text-[var(--text-muted)]">Follow-Up Recommendations</span>
                        <input
                          value={recommendations}
                          onChange={(e) => setRecommendations(e.target.value)}
                          placeholder="Optional preventive maintenance or parts follow-up notes"
                          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
                        />
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <SignaturePad label="Customer e-Signature" value={customerSig} onChange={setCustomerSig} />
                        <SignaturePad label="Technician e-Signature" value={techSig} onChange={setTechSig} />
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={(e) => void handleSubmitFsr(e, false)}
                          className="px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold"
                        >
                          Save FSR Only
                        </button>
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm"
                        >
                          {submitting ? 'Submitting…' : 'Sign FSR & Complete Visit'}
                        </button>
                      </div>

                      {reports.length > 0 && (
                        <div className="pt-3 border-t border-[var(--border-subtle)] space-y-1.5">
                          <div className="text-[11px] font-bold text-[var(--text-muted)]">Submitted Reports</div>
                          {reports.map((r) => (
                            <div
                              key={r.id}
                              className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex items-center justify-between"
                            >
                              <div>
                                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                                  {r.reportNumber}
                                </span>
                                <span className="ml-2 text-[var(--text-muted)]">{r.workPerformed.slice(0, 70)}</span>
                              </div>
                              <span className="text-[10px] text-[var(--text-faint)]">
                                {r.signedAt ? 'Signed' : 'Draft'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Geofence Override Modal */}
      {geoPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-3 shadow-2xl text-xs">
            <div className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300 text-sm">
              <AlertTriangle className="w-5 h-5" /> Outside Site Geofence
            </div>
            <p className="text-[var(--text-muted)]">{geoPrompt.message}</p>
            <input
              value={geoPrompt.reason}
              onChange={(e) => setGeoPrompt({ ...geoPrompt, reason: e.target.value })}
              placeholder="Override reason (e.g. parked at service gate B, indoor GPS drift)…"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-[var(--text-main)]"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGeoPrompt(null)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!geoPrompt.reason.trim()}
                onClick={async () => {
                  const p = geoPrompt;
                  setGeoPrompt(null);
                  await runTransition(p.visit, 'ON_SITE', {
                    latitude: p.lat,
                    longitude: p.lng,
                    geofenceOverrideReason: p.reason.trim(),
                  });
                }}
                className="px-4 py-1.5 rounded-lg bg-amber-600 text-white font-semibold disabled:opacity-50"
              >
                Check In with Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
