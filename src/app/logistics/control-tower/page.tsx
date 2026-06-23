'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Loader2, MapPin, RefreshCcw, Satellite, Send, ShieldAlert, TowerControl } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  LogisticsMessage,
  readLogisticsApiError,
  ShipmentValidationSummary,
  type LogisticsApiError,
  useLogisticsMasterData,
  useLogisticsPolling,
  useShipmentValidation,
} from '@/components/logistics/master-data-fields';

type SessionMe = { tenantId: string };
type TowerShipment = {
  id: string;
  shipmentNo: string;
  customerName: string | null;
  status: string;
  priority: string | null;
  originName: string | null;
  destinationName: string | null;
  requestedVehicleType: string | null;
  carrierName: string | null;
  pickupWindowFrom: string | null;
  pickupWindowTo: string | null;
  deliveryWindowFrom: string | null;
  deliveryWindowTo: string | null;
  latestLatitude: number | null;
  latestLongitude: number | null;
  latestEtaAt: string | null;
  latestEventAt: string | null;
  openExceptions: number;
  highExceptions: number;
  slaStatus: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
};

type TowerPayload = {
  generatedAt: string;
  summary: {
    activeShipments: number;
    breached: number;
    atRisk: number;
    openExceptions: number;
    trackedShipments: number;
  };
  shipments: TowerShipment[];
};

type ShipmentException = {
  id: string;
  shipmentOrderId: string;
  exceptionType: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  assignedTo: string | null;
  acknowledgedAt: string | null;
  escalatedAt: string | null;
  slaDueAt: string | null;
  slaBreachedAt: string | null;
  resolvedAt: string | null;
};

type ShipmentTimeline = {
  events: Array<{
    id: string;
    type: string;
    status: string | null;
    source: string;
    occurredAt: string | null;
    notes: string | null;
  }>;
  pods: Array<{ id: string; recipientName: string | null; status: string; deliveredAt: string | null }>;
  finance: {
    postings?: Array<{ id: string; postingType: string; status: string; amount: number; currency: string }>;
  };
};

function useTenantQuery(tenantId: string | null) {
  return useCallback((path: string, extra?: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    Object.entries(extra ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
    });
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  }, [tenantId]);
}

function dateLabel(value?: string | null) {
  return value ? new Date(value).toLocaleString('en-AE') : '-';
}

function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

const emptyExceptionForm = {
  eventType: 'EXCEPTION_REPORTED',
  etaAt: '',
  severity: 'MEDIUM',
  remarks: '',
};

export default function LogisticsControlTowerPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [payload, setPayload] = useState<TowerPayload | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiError, setApiError] = useState<LogisticsApiError | null>(null);
  const [notice, setNotice] = useState('');
  const [selectedShipment, setSelectedShipment] = useState<TowerShipment | null>(null);
  const [exceptions, setExceptions] = useState<ShipmentException[]>([]);
  const [timeline, setTimeline] = useState<ShipmentTimeline | null>(null);
  const [exceptionLoading, setExceptionLoading] = useState(false);
  const [exceptionActionSaving, setExceptionActionSaving] = useState('');
  const [exceptionAssignee, setExceptionAssignee] = useState('');
  const [exceptionNote, setExceptionNote] = useState('');
  const [exceptionForm, setExceptionForm] = useState(emptyExceptionForm);
  const [saving, setSaving] = useState(false);
  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);
  const masterData = useLogisticsMasterData(['SERVICE_TYPE', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY']);
  const exceptionValidationPayload = useMemo(() => selectedShipment ? {
    originName: selectedShipment.originName,
    destinationName: selectedShipment.destinationName,
    pickupWindowFrom: selectedShipment.pickupWindowFrom,
    pickupWindowTo: selectedShipment.pickupWindowTo,
    deliveryWindowFrom: exceptionForm.etaAt ? toIsoOrNull(exceptionForm.etaAt) : selectedShipment.deliveryWindowFrom,
    deliveryWindowTo: selectedShipment.deliveryWindowTo,
  } : null, [exceptionForm.etaAt, selectedShipment]);
  const exceptionValidation = useShipmentValidation(exceptionValidationPayload, masterData.tenantId ?? tenantId);

  const shipments = useMemo(() => {
    const rows = payload?.shipments ?? [];
    return filter === 'ALL' ? rows : rows.filter(row => row.slaStatus === filter);
  }, [filter, payload]);
  const needsAttention = useMemo(() => {
    const rows = payload?.shipments ?? [];
    return rows
      .filter(row => row.slaStatus !== 'ON_TRACK' || row.openExceptions > 0 || row.highExceptions > 0 || !row.carrierName)
      .slice(0, 6);
  }, [payload]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening the Logistics Control Tower.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    setApiError(null);
    try {
      const res = await fetch(url('/api/logistics/control-tower', { limit: 200 }), { cache: 'no-store' });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setPayload(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load control tower');
    } finally {
      setLoading(false);
    }
  }, [tenantId, url]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useLogisticsPolling(loadData, Boolean(tenantId), 20000);

  const loadExceptions = useCallback(async (shipmentId: string | null) => {
    if (!tenantId || !shipmentId) {
      setExceptions([]);
      return;
    }
    setExceptionLoading(true);
    try {
      const res = await fetch(url('/api/logistics/exceptions', {
        shipmentOrderId: shipmentId,
        includeResolved: 'true',
        limit: 50,
      }), { cache: 'no-store' });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      const data = await res.json();
      setExceptions(Array.isArray(data.exceptions) ? data.exceptions : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shipment exceptions');
    } finally {
      setExceptionLoading(false);
    }
  }, [tenantId, url]);

  const loadTimeline = useCallback(async (shipmentId: string | null) => {
    if (!tenantId || !shipmentId) {
      setTimeline(null);
      return;
    }
    try {
      const res = await fetch(url(`/api/logistics/shipments/${shipmentId}/timeline`), { cache: 'no-store' });
      if (!res.ok) {
        setTimeline(null);
        return;
      }
      setTimeline(await res.json());
    } catch {
      setTimeline(null);
    }
  }, [tenantId, url]);

  useEffect(() => {
    loadExceptions(selectedShipment?.id ?? null);
    loadTimeline(selectedShipment?.id ?? null);
  }, [loadExceptions, loadTimeline, selectedShipment?.id]);

  useLogisticsPolling(() => loadExceptions(selectedShipment?.id ?? null), Boolean(tenantId && selectedShipment), 15000);
  useLogisticsPolling(() => loadTimeline(selectedShipment?.id ?? null), Boolean(tenantId && selectedShipment), 15000);

  const submitControlTowerUpdate = async () => {
    if (!tenantId || !selectedShipment) return;
    setSaving(true);
    setError('');
    setApiError(null);
    setNotice('');
    try {
      if (!exceptionValidation.result.ok) {
        setError(exceptionValidation.result.issues.join(' '));
        return;
      }
      const res = await fetch(url('/api/logistics/field-ops'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentOrderId: selectedShipment.id,
          eventType: exceptionForm.eventType,
          etaAt: exceptionForm.eventType === 'ETA_UPDATED' ? toIsoOrNull(exceptionForm.etaAt) : null,
          exceptionSeverity: exceptionForm.eventType === 'EXCEPTION_REPORTED' ? exceptionForm.severity : null,
          remarks: exceptionForm.remarks || `${exceptionForm.eventType.replace(/_/g, ' ')} from Control Tower`,
          metadata: {
            source: 'control-tower-governed-update',
            slaStatus: selectedShipment.slaStatus,
            openExceptions: selectedShipment.openExceptions,
          },
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setNotice(`${exceptionForm.eventType.replace(/_/g, ' ')} recorded for ${selectedShipment.shipmentNo}.`);
      setExceptionForm(emptyExceptionForm);
      setSelectedShipment(null);
      await loadData();
      await loadExceptions(selectedShipment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record Control Tower update');
    } finally {
      setSaving(false);
    }
  };

  const applyExceptionLifecycle = async (exceptionId: string, action: string) => {
    if (!tenantId) return;
    setExceptionActionSaving(`${exceptionId}:${action}`);
    setError('');
    setApiError(null);
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/exceptions/${exceptionId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          assignedTo: action === 'ASSIGN' ? exceptionAssignee : null,
          note: exceptionNote || null,
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setNotice(`Exception ${action.replace(/_/g, ' ').toLowerCase()} saved.`);
      setExceptionAssignee('');
      setExceptionNote('');
      await loadExceptions(selectedShipment?.id ?? null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update exception lifecycle');
    } finally {
      setExceptionActionSaving('');
    }
  };

  const summary = payload?.summary ?? {
    activeShipments: 0,
    breached: 0,
    atRisk: 0,
    openExceptions: 0,
    trackedShipments: 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipment Control Tower"
        subtitle="SLA, exception, telematics, ETA, and dispatch visibility across active Logistics shipments."
        icon={TowerControl}
        accent="amber"
        actions={(
          <button onClick={loadData} className="btn-secondary inline-flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        )}
      />

      {apiError ? (
        <LogisticsMessage
          type="error"
          title="Control Tower update failed"
          message={apiError.message}
          issues={apiError.issues}
          warnings={apiError.warnings}
        />
      ) : error ? (
        <LogisticsMessage type="error" title="Control Tower update failed" message={error} />
      ) : null}
      {notice && <div className="rounded-2xl border border-emerald-300 bg-emerald-100 p-4 text-sm font-semibold text-emerald-950">{notice}</div>}

      <KpiGrid>
        <KpiCard label="Active" value={summary.activeShipments} icon={Clock3} accent="blue" />
        <KpiCard label="Breached" value={summary.breached} icon={ShieldAlert} accent="rose" />
        <KpiCard label="At Risk" value={summary.atRisk} icon={AlertTriangle} accent="amber" />
        <KpiCard label="Exceptions" value={summary.openExceptions} icon={AlertTriangle} accent="rose" />
        <KpiCard label="Tracked" value={summary.trackedShipments} icon={Satellite} accent="emerald" />
      </KpiGrid>

      <Panel
        title="Needs Attention"
        subtitle="SLA breaches, open exceptions, unassigned carriers, and stale operational signals."
        icon={ShieldAlert}
        accent="rose"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {needsAttention.map(row => (
            <button
              key={row.id}
              onClick={() => {
                setSelectedShipment(row);
                setExceptionForm({
                  ...emptyExceptionForm,
                  etaAt: row.latestEtaAt ? new Date(row.latestEtaAt).toISOString().slice(0, 16) : '',
                });
                setError('');
                setNotice('');
              }}
              className="rounded-2xl border border-rose-300/30 bg-rose-950/25 p-4 text-left transition hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-900/35"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-white">{row.shipmentNo}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-300">{row.originName ?? '-'} to {row.destinationName ?? '-'}</p>
                </div>
                <StatusPill status={row.slaStatus === 'BREACHED' ? 'danger' : row.slaStatus === 'AT_RISK' ? 'warning' : 'pending'} label={row.slaStatus.replace('_', ' ')} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <span>Owner: {row.carrierName ?? 'Unassigned'}</span>
                <span>{row.openExceptions} exception(s)</span>
                <span>ETA: {dateLabel(row.latestEtaAt)}</span>
                <span>Signal: {dateLabel(row.latestEventAt)}</span>
              </div>
            </button>
          ))}
          {!loading && needsAttention.length === 0 && (
            <div className="rounded-2xl border border-emerald-300/30 bg-emerald-950/20 p-4 text-sm font-semibold text-emerald-100">
              No shipments need attention right now.
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Operational Watchlist"
        subtitle={loading ? 'Loading live logistics posture...' : `${shipments.length} shipment(s) in current filter`}
        icon={MapPin}
        accent="amber"
        actions={(
          <div className="flex flex-wrap gap-2">
            {['ALL', 'BREACHED', 'AT_RISK', 'ON_TRACK'].map(item => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === item ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-white/10 bg-white/5 text-slate-300'}`}
              >
                {item.replace('_', ' ')}
              </button>
            ))}
          </div>
        )}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Shipment</th>
                <th className="px-3 py-3">Lane</th>
                <th className="px-3 py-3">Carrier</th>
                <th className="px-3 py-3">SLA</th>
                <th className="px-3 py-3">ETA</th>
                <th className="px-3 py-3">Exceptions</th>
                <th className="px-3 py-3">Last Signal</th>
                <th className="px-3 py-3 text-right">Update</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map(row => (
                <tr key={row.id} className="border-t border-white/8">
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">{row.shipmentNo}</div>
                    <div className="text-xs text-slate-400">{row.customerName ?? 'Customer not set'} · {row.status}</div>
                  </td>
                  <td className="px-3 py-4 text-slate-300">{row.originName ?? '-'} → {row.destinationName ?? '-'}</td>
                  <td className="px-3 py-4 text-slate-300">{row.carrierName ?? 'Unassigned'}</td>
                  <td className="px-3 py-4"><StatusPill status={row.slaStatus === 'BREACHED' ? 'danger' : row.slaStatus === 'AT_RISK' ? 'warning' : 'ok'} label={row.slaStatus.replace('_', ' ')} /></td>
                  <td className="px-3 py-4 text-slate-300">{dateLabel(row.latestEtaAt)}</td>
                  <td className="px-3 py-4 text-slate-300">{row.openExceptions} open · {row.highExceptions} high</td>
                  <td className="px-3 py-4 text-slate-300">{dateLabel(row.latestEventAt)}</td>
                  <td className="px-3 py-4 text-right">
                    <button
                      onClick={() => {
                        setSelectedShipment(row);
                        setExceptionForm({
                          ...emptyExceptionForm,
                          etaAt: row.latestEtaAt ? new Date(row.latestEtaAt).toISOString().slice(0, 16) : '',
                        });
                        setError('');
                        setNotice('');
                      }}
                      className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-bold text-amber-950 hover:bg-amber-200"
                    >
                      Update
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && shipments.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-500">No shipments found for this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {selectedShipment && (
        <Panel
          title={`Governed Update - ${selectedShipment.shipmentNo}`}
          subtitle="Record an ETA, exception, or operations remark against the canonical shipment timeline."
          icon={AlertTriangle}
          accent="rose"
          actions={(
            <button
              onClick={() => setSelectedShipment(null)}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/5"
            >
              Close
            </button>
          )}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Update Type</span>
              <select
                value={exceptionForm.eventType}
                onChange={e => setExceptionForm(form => ({ ...form, eventType: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-amber-400"
              >
                <option value="EXCEPTION_REPORTED">Exception reported</option>
                <option value="ETA_UPDATED">ETA updated</option>
                <option value="OPERATIONAL_REMARK">Operational remark</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Severity</span>
              <select
                value={exceptionForm.severity}
                onChange={e => setExceptionForm(form => ({ ...form, severity: e.target.value }))}
                disabled={exceptionForm.eventType !== 'EXCEPTION_REPORTED'}
                className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-amber-400 disabled:opacity-50"
              >
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(severity => (
                  <option key={severity} value={severity}>{severity}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">ETA</span>
              <input
                value={exceptionForm.etaAt}
                onChange={e => setExceptionForm(form => ({ ...form, etaAt: e.target.value }))}
                disabled={exceptionForm.eventType !== 'ETA_UPDATED'}
                type="datetime-local"
                className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-amber-400 disabled:opacity-50"
              />
            </label>
          </div>
          <label className="mt-4 block space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Remarks</span>
            <textarea
              value={exceptionForm.remarks}
              onChange={e => setExceptionForm(form => ({ ...form, remarks: e.target.value }))}
              rows={3}
              placeholder="Describe the delay, exception, ETA reason, or operator remark..."
              className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-amber-400"
            />
          </label>
          <div className="mt-4">
            <ShipmentValidationSummary
              result={exceptionValidation.result}
              validating={exceptionValidation.validating}
            />
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">Operational timeline</p>
                <p className="text-xs text-slate-400">
                  Assignment owner: {selectedShipment.carrierName ?? 'Unassigned'} - ETA {dateLabel(selectedShipment.latestEtaAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill status={(timeline?.pods.length ?? 0) > 0 ? 'active' : 'pending'} label={`${timeline?.pods.length ?? 0} POD`} />
                <StatusPill status={(timeline?.finance.postings?.length ?? 0) > 0 ? 'active' : 'pending'} label={`${timeline?.finance.postings?.length ?? 0} Finance`} />
              </div>
            </div>
            <div className="space-y-2">
              {(timeline?.events ?? []).slice(0, 6).map(event => (
                <div key={event.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-wide text-white">{event.type.replace(/_/g, ' ')}</p>
                    <p className="text-[11px] font-semibold text-slate-400">{dateLabel(event.occurredAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{event.notes ?? event.status ?? event.source}</p>
                </div>
              ))}
              {timeline && timeline.events.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm font-semibold text-slate-400">
                  No operational timeline events yet.
                </div>
              )}
              {!timeline && (
                <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm font-semibold text-slate-400">
                  Timeline loads after selecting a shipment.
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">Exception lifecycle</p>
                <p className="text-xs text-slate-400">Open, assign, acknowledge, escalate, resolve, or mark SLA breach.</p>
              </div>
              <StatusPill status={exceptions.some(item => item.status === 'SLA_BREACHED' || item.status === 'ESCALATED') ? 'danger' : exceptions.some(item => item.status !== 'RESOLVED') ? 'warning' : 'ok'} label={`${exceptions.filter(item => item.status !== 'RESOLVED').length} active`} />
            </div>
            <div className="mb-3 grid gap-3 lg:grid-cols-[1fr_2fr]">
              <input
                value={exceptionAssignee}
                onChange={e => setExceptionAssignee(e.target.value)}
                placeholder="Assignee email / team"
                className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-amber-400"
              />
              <input
                value={exceptionNote}
                onChange={e => setExceptionNote(e.target.value)}
                placeholder="Lifecycle note / resolution summary"
                className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-amber-400"
              />
            </div>
            {exceptionLoading ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm font-semibold text-slate-300">
                Loading exception lifecycle...
              </div>
            ) : exceptions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm font-semibold text-slate-400">
                No exceptions recorded for this shipment yet.
              </div>
            ) : (
              <div className="space-y-3">
                {exceptions.map(item => (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={item.status === 'RESOLVED' ? 'ok' : item.status === 'ESCALATED' || item.status === 'SLA_BREACHED' ? 'danger' : 'warning'} label={item.status.replace(/_/g, ' ')} />
                          <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] font-bold uppercase text-slate-300">{item.severity}</span>
                        </div>
                        <p className="mt-2 text-sm font-bold text-white">{item.title}</p>
                        <p className="mt-1 max-w-3xl text-xs text-slate-400">{item.description ?? 'No description'}</p>
                        <p className="mt-2 text-[11px] font-semibold text-slate-500">
                          Assigned: {item.assignedTo ?? '-'} · SLA due: {dateLabel(item.slaDueAt)} · Resolved: {dateLabel(item.resolvedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {[
                          ['ASSIGN', 'Assign'],
                          ['ACKNOWLEDGE', 'Acknowledge'],
                          ['ESCALATE', 'Escalate'],
                          ['MARK_SLA_BREACHED', 'SLA breach'],
                          ['RESOLVE', 'Resolve'],
                        ].map(([action, label]) => (
                          <button
                            key={action}
                            onClick={() => applyExceptionLifecycle(item.id, action)}
                            disabled={exceptionActionSaving === `${item.id}:${action}` || (action === 'ASSIGN' && !exceptionAssignee.trim()) || item.status === 'RESOLVED'}
                            className="rounded-lg border border-white/10 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {exceptionActionSaving === `${item.id}:${action}` ? 'Saving...' : label}
                          </button>
                        ))}
                        {item.status === 'RESOLVED' && (
                          <button
                            onClick={() => applyExceptionLifecycle(item.id, 'REOPEN')}
                            disabled={exceptionActionSaving === `${item.id}:REOPEN`}
                            className="rounded-lg border border-sky-300 bg-sky-100 px-2.5 py-1.5 text-[11px] font-bold text-sky-950 transition hover:bg-sky-200 disabled:opacity-50"
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={submitControlTowerUpdate}
              disabled={saving || exceptionValidation.validating || !exceptionValidation.result.ok}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Record update
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
