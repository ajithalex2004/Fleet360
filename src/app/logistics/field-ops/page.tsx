'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, ClipboardCheck, MapPin, RefreshCcw, Send, Smartphone } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = { tenantId: string; userId?: string };
type FieldShipment = {
  id: string;
  shipmentNo: string;
  customerName: string | null;
  status: string;
  originName: string | null;
  destinationName: string | null;
  carrierName: string | null;
  pickupWindowTo: string | null;
  deliveryWindowTo: string | null;
  latestEtaAt: string | null;
  slaStatus: string;
};

const EVENT_TYPES = [
  ['PICKUP_CONFIRMED', 'Pickup confirmed'],
  ['ETA_UPDATED', 'ETA update'],
  ['DELIVERY_CONFIRMED', 'Delivery confirmed / POD'],
  ['EXCEPTION_REPORTED', 'Exception reported'],
  ['OPERATIONAL_REMARK', 'Operational remark'],
  ['PHOTO_ATTACHED', 'Photo attached'],
];

function withTenant(path: string, tenantId: string | null, extra?: Record<string, string | number | null | undefined>) {
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

export default function LogisticsFieldOpsPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [shipments, setShipments] = useState<FieldShipment[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [eventType, setEventType] = useState('PICKUP_CONFIRMED');
  const [remarks, setRemarks] = useState('');
  const [etaAt, setEtaAt] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [signatureUrl, setSignatureUrl] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const tenantId = me?.tenantId ?? null;

  const selected = useMemo(() => shipments.find(row => row.id === selectedId) ?? null, [selectedId, shipments]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening Field Ops.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(withTenant('/api/logistics/field-ops', tenantId, { limit: 100 }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      const rows = payload.shipments ?? [];
      setShipments(rows);
      setSelectedId(prev => prev || rows[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load field ops worklist');
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
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = '/logistics-field-manifest.json';
    document.head.appendChild(manifestLink);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/logistics-field-sw.js').catch(() => {});
    }
    return () => {
      document.head.removeChild(manifestLink);
    };
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!tenantId) return;
    const timer = setInterval(loadData, 20000);
    return () => clearInterval(timer);
  }, [loadData, tenantId]);

  function captureLocation() {
    setError('');
    if (!navigator.geolocation) {
      setError('GPS is not available on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => setGps({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      () => setError('GPS permission denied or unavailable.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submitEvent() {
    if (!tenantId || !selectedId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(withTenant('/api/logistics/field-ops', tenantId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentOrderId: selectedId,
          eventType,
          remarks,
          etaAt: etaAt || null,
          recipientName: recipientName || null,
          signatureUrl: signatureUrl || null,
          latitude: gps?.lat ?? null,
          longitude: gps?.lng ?? null,
          metadata: { gpsAccuracy: gps?.accuracy ?? null, sourcePage: 'field-ops' },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSuccess('Field update recorded.');
      setRemarks('');
      setRecipientName('');
      setSignatureUrl('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record field update');
    } finally {
      setSaving(false);
    }
  }

  const breached = shipments.filter(row => row.slaStatus === 'BREACHED').length;
  const atRisk = shipments.filter(row => row.slaStatus === 'AT_RISK').length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Field Ops Mobile Console"
        subtitle="PWA-ready pickup, delivery, ETA, exception, photo, and remark updates for cargo collection and delivery teams."
        icon={Smartphone}
        accent="emerald"
        actions={(
          <button onClick={loadData} className="btn-secondary inline-flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" /> Refresh
          </button>
        )}
      />

      {error && <div className="rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-900">{error}</div>}
      {success && <div className="rounded-2xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-900">{success}</div>}

      <KpiGrid>
        <KpiCard label="Worklist" value={shipments.length} icon={ClipboardCheck} accent="blue" />
        <KpiCard label="Breached" value={breached} icon={MapPin} accent="rose" />
        <KpiCard label="At Risk" value={atRisk} icon={MapPin} accent="amber" />
      </KpiGrid>

      <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
        <Panel title="Shipment Worklist" subtitle={loading ? 'Loading active shipments...' : `${shipments.length} open shipment(s)`} icon={ClipboardCheck} accent="blue">
          <div className="space-y-3">
            {shipments.map(row => (
              <button
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === row.id ? 'border-emerald-300 bg-emerald-100 text-slate-950' : 'border-white/10 bg-white/5 text-[color:var(--text-primary)] hover:border-emerald-300/60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{row.shipmentNo}</div>
                    <div className="mt-1 text-sm opacity-80">{row.customerName ?? 'Customer not set'}</div>
                    <div className="mt-2 text-xs opacity-75">{row.originName ?? '-'} -&gt; {row.destinationName ?? '-'}</div>
                  </div>
                  <StatusPill status={row.slaStatus === 'BREACHED' ? 'danger' : row.slaStatus === 'AT_RISK' ? 'warning' : 'ok'} label={row.slaStatus.replace('_', ' ')} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs opacity-80">
                  <span>Pickup: {dateLabel(row.pickupWindowTo)}</span>
                  <span>Delivery: {dateLabel(row.deliveryWindowTo)}</span>
                </div>
              </button>
            ))}
            {!loading && shipments.length === 0 && <div className="py-10 text-center text-[color:var(--text-secondary)]">No active field work.</div>}
          </div>
        </Panel>

        <Panel title="Record Field Update" subtitle={selected ? selected.shipmentNo : 'Select a shipment'} icon={Send} accent="emerald">
          <div className="space-y-3">
            <select value={eventType} onChange={e => setEventType(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]">
              {EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={4} placeholder="Operational remarks, exception detail, or delivery note" className="w-full rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">ETA</label>
            <input value={etaAt} onChange={e => setEtaAt(e.target.value)} type="datetime-local" className="w-full rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
            {eventType === 'DELIVERY_CONFIRMED' && (
              <>
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Recipient name" className="w-full rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
                <input value={signatureUrl} onChange={e => setSignatureUrl(e.target.value)} placeholder="Signature/photo URL or uploaded file URL" className="w-full rounded-xl border border-white/10 bg-[color:var(--app-card)] px-3 py-2 text-[color:var(--text-primary)]" />
              </>
            )}
            <button onClick={captureLocation} className="btn-secondary inline-flex w-full items-center justify-center gap-2">
              <MapPin className="h-4 w-4" /> {gps ? `GPS captured ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Capture GPS'}
            </button>
            <button className="btn-secondary inline-flex w-full items-center justify-center gap-2" type="button">
              <Camera className="h-4 w-4" /> Photo capture ready
            </button>
            <button onClick={submitEvent} disabled={!selectedId || saving} className="btn-primary inline-flex w-full items-center justify-center gap-2">
              <Send className="h-4 w-4" /> {saving ? 'Sending...' : 'Submit field update'}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
