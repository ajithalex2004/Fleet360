'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ClipboardList, Clock3, RefreshCcw, ShieldCheck } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = { tenantId: string; userId?: string };
type SummaryPayload = {
  generatedAt: string;
  summary: {
    activeShipments: number;
    breached: number;
    atRisk: number;
    openExceptions: number;
  };
  pendingActions: Array<{ shipmentNo: string; action: string; priority?: string | null; status: string }>;
  delayedMovements: Array<{ shipmentNo: string; status: string; originName?: string | null; destinationName?: string | null }>;
  exceptionRisks: Array<{ shipmentNo: string; openExceptions: number; highExceptions: number }>;
  slaRisks: Array<{ shipmentNo: string; slaStatus: string; deliveryWindowTo?: string | null }>;
};
type Handover = {
  id: string;
  shiftDate: string | null;
  shiftCode: string;
  status: string;
  notes: string | null;
  createdAt: string | null;
  acceptedAt: string | null;
  summary: SummaryPayload | Record<string, unknown>;
};

function withTenant(path: string, tenantId: string | null, extra?: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}`;
}

function dateLabel(value?: string | null) {
  return value ? new Date(value).toLocaleString('en-AE') : '-';
}

export default function LogisticsShiftHandoversPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [shiftCode, setShiftCode] = useState('MORNING');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tenantId = me?.tenantId ?? null;

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening shift handovers.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [summaryRes, listRes] = await Promise.all([
        fetch(withTenant('/api/logistics/shift-handovers', tenantId, { summary: true }), { cache: 'no-store' }),
        fetch(withTenant('/api/logistics/shift-handovers', tenantId), { cache: 'no-store' }),
      ]);
      if (!summaryRes.ok) throw new Error(await summaryRes.text());
      if (!listRes.ok) throw new Error(await listRes.text());
      setSummary(await summaryRes.json());
      const listPayload = await listRes.json();
      setHandovers(listPayload.handovers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load handovers');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!tenantId) return;
    const timer = setInterval(loadData, 30000);
    return () => clearInterval(timer);
  }, [loadData, tenantId]);

  async function createHandover() {
    if (!tenantId) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(withTenant('/api/logistics/shift-handovers', tenantId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftCode, notes }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotes('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create handover');
    } finally {
      setSaving(false);
    }
  }

  async function acceptHandover(id: string) {
    if (!tenantId) return;
    setError('');
    try {
      const res = await fetch(withTenant(`/api/logistics/shift-handovers/${id}/accept`, tenantId), { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept handover');
    }
  }

  const kpi = summary?.summary ?? { activeShipments: 0, breached: 0, atRisk: 0, openExceptions: 0 };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shift Handover"
        subtitle="Structured shift summaries for open shipments, pending actions, delayed movements, exceptions, and SLA risks."
        icon={ClipboardList}
        accent="amber"
        actions={(
          <button onClick={loadData} className="btn-secondary inline-flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        )}
      />

      {error && <div className="rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-900">{error}</div>}

      <KpiGrid>
        <KpiCard label="Active" value={kpi.activeShipments} icon={Clock3} accent="blue" />
        <KpiCard label="Breached" value={kpi.breached} icon={AlertTriangle} accent="rose" />
        <KpiCard label="At Risk" value={kpi.atRisk} icon={AlertTriangle} accent="amber" />
        <KpiCard label="Exceptions" value={kpi.openExceptions} icon={ShieldCheck} accent="rose" />
      </KpiGrid>

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel title="Create Handover" subtitle="Snapshot the current operational position for the next shift." icon={ClipboardList} accent="emerald">
          <div className="grid gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Shift</label>
            <select value={shiftCode} onChange={e => setShiftCode(e.target.value)} className="rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]">
              <option value="MORNING">Morning</option>
              <option value="AFTERNOON">Afternoon</option>
              <option value="NIGHT">Night</option>
            </select>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} className="rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" placeholder="Critical notes for incoming team" />
            <button onClick={createHandover} disabled={saving} className="btn-primary inline-flex items-center justify-center gap-2">
              <ClipboardList className="h-4 w-4" /> {saving ? 'Creating...' : 'Create handover'}
            </button>
          </div>
        </Panel>

        <Panel title="Current Summary" subtitle={summary ? `Generated ${dateLabel(summary.generatedAt)}` : 'Loading summary...'} icon={AlertTriangle} accent="amber">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-semibold text-[color:var(--text-primary)]">Pending Actions</h4>
              <div className="space-y-2">
                {(summary?.pendingActions ?? []).slice(0, 6).map((item, index) => (
                  <div key={`${item.shipmentNo}-${index}`} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                    <div className="font-semibold text-[color:var(--text-primary)]">{item.shipmentNo}</div>
                    <div className="text-[color:var(--text-secondary)]">{item.action} - {item.status}</div>
                  </div>
                ))}
                {!loading && (summary?.pendingActions ?? []).length === 0 && <div className="text-sm text-[color:var(--text-secondary)]">No pending actions.</div>}
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-[color:var(--text-primary)]">SLA Risks</h4>
              <div className="space-y-2">
                {(summary?.slaRisks ?? []).slice(0, 6).map(item => (
                  <div key={item.shipmentNo} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                    <span className="font-semibold text-[color:var(--text-primary)]">{item.shipmentNo}</span>
                    <StatusPill status={item.slaStatus === 'BREACHED' ? 'danger' : 'warning'} label={item.slaStatus.replace('_', ' ')} />
                  </div>
                ))}
                {!loading && (summary?.slaRisks ?? []).length === 0 && <div className="text-sm text-[color:var(--text-secondary)]">No SLA risks.</div>}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Handover History" subtitle={`${handovers.length} handover(s)`} icon={ClipboardList} accent="blue">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Shift</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Notes</th>
                <th className="px-3 py-3">Created</th>
                <th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {handovers.map(item => (
                <tr key={item.id} className="border-b border-white/6">
                  <td className="px-3 py-3 font-semibold text-[color:var(--text-primary)]">{item.shiftDate}</td>
                  <td className="px-3 py-3 text-[color:var(--text-secondary)]">{item.shiftCode}</td>
                  <td className="px-3 py-3"><StatusPill status={item.status} /></td>
                  <td className="px-3 py-3 text-[color:var(--text-secondary)]">{item.notes ?? '-'}</td>
                  <td className="px-3 py-3 text-[color:var(--text-secondary)]">{dateLabel(item.createdAt)}</td>
                  <td className="px-3 py-3 text-right">
                    {item.status !== 'ACCEPTED' ? (
                      <button onClick={() => acceptHandover(item.id)} className="btn-secondary px-3 py-1.5 text-xs">Accept</button>
                    ) : (
                      <span className="text-xs text-[color:var(--text-secondary)]">{dateLabel(item.acceptedAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && handovers.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-[color:var(--text-secondary)]">No handovers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
