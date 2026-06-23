'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPinned, PackageCheck, RefreshCcw, Search, Send, Truck } from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

// Mapbox component touches window — load client-only.
const ShipmentTrackingMap = dynamic(() => import('@/components/logistics/ShipmentTrackingMap'), { ssr: false });

type SessionMe = { tenantId: string };
type CustomerShipment = {
  id: string;
  shipmentNo: string;
  customerName: string | null;
  status: string;
  originName: string | null;
  destinationName: string | null;
  pickupWindowFrom: string | null;
  deliveryWindowTo: string | null;
  latestEventType: string | null;
  latestEventStatus: string | null;
  latestLatitude: number | null;
  latestLongitude: number | null;
  latestEtaAt: string | null;
  latestEventAt: string | null;
  podStatus: string | null;
  podDeliveredAt: string | null;
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

export default function LogisticsCustomerTrackingPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [shipments, setShipments] = useState<CustomerShipment[]>([]);
  const [shipmentNo, setShipmentNo] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [trackingToken, setTrackingToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mapOpenId, setMapOpenId] = useState<string | null>(null);
  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);

  const tracked = useMemo(() => shipments.filter(row => row.latestEventAt).length, [shipments]);
  const delivered = useMemo(() => shipments.filter(row => ['DELIVERED', 'POD_SUBMITTED', 'CLOSED'].includes(row.status)).length, [shipments]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening customer tracking.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(url('/api/logistics/customer-tracking', {
        shipmentNo,
        customerId,
        trackingToken,
        limit: 100,
      }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setShipments(Array.isArray(json.shipments) ? json.shipments : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer tracking');
    } finally {
      setLoading(false);
    }
  }, [customerId, shipmentNo, tenantId, trackingToken, url]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Tracking Portal"
        subtitle="Customer-safe shipment visibility with status, ETA, POD status, and live location signals without exposing internal payable data."
        icon={MapPinned}
        accent="cyan"
        actions={<button onClick={loadData} className="btn-secondary inline-flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> Refresh</button>}
      />
      {error && <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-100">{error}</div>}

      <KpiGrid>
        <KpiCard label="Visible" value={shipments.length} icon={Truck} accent="blue" />
        <KpiCard label="Tracked" value={tracked} icon={MapPinned} accent="cyan" />
        <KpiCard label="Delivered" value={delivered} icon={PackageCheck} accent="emerald" />
      </KpiGrid>

      <Panel title="Lookup Filters" icon={Search} accent="cyan">
        <div className="grid gap-3 md:grid-cols-4">
          <input value={shipmentNo} onChange={event => setShipmentNo(event.target.value)} placeholder="Shipment number" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />
          <input value={customerId} onChange={event => setCustomerId(event.target.value)} placeholder="Customer ID" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />
          <input value={trackingToken} onChange={event => setTrackingToken(event.target.value)} placeholder="Tracking token" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none" />
          <button onClick={loadData} className="btn-primary inline-flex items-center justify-center gap-2"><Send className="h-4 w-4" /> Apply</button>
        </div>
      </Panel>

      <Panel title="Customer Shipment Timeline" subtitle={loading ? 'Loading tracking feed...' : `${shipments.length} shipment(s)`} icon={MapPinned} accent="cyan">
        <div className="grid gap-4 lg:grid-cols-2">
          {shipments.map(row => (
            <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{row.shipmentNo}</div>
                  <div className="text-sm text-slate-400">{row.customerName ?? 'Customer'} · {row.originName ?? '-'} → {row.destinationName ?? '-'}</div>
                </div>
                <StatusPill status={row.status === 'DELIVERED' ? 'active' : 'info'} label={row.status} />
              </div>
              <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <div><span className="text-slate-500">ETA</span><br />{dateLabel(row.latestEtaAt ?? row.deliveryWindowTo)}</div>
                <div><span className="text-slate-500">Last event</span><br />{row.latestEventType ?? '-'} · {dateLabel(row.latestEventAt)}</div>
                <div><span className="text-slate-500">POD</span><br />{row.podStatus ?? '-'} · {dateLabel(row.podDeliveredAt)}</div>
                <div><span className="text-slate-500">Location</span><br />{row.latestLatitude && row.latestLongitude ? `${row.latestLatitude}, ${row.latestLongitude}` : '-'}</div>
              </div>

              <button
                onClick={() => setMapOpenId(prev => prev === row.id ? null : row.id)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition-colors">
                <MapPinned className="h-3.5 w-3.5" />
                {mapOpenId === row.id ? 'Hide live map' : 'View live map'}
              </button>

              {mapOpenId === row.id && (
                <div className="mt-3">
                  <ShipmentTrackingMap shipmentId={row.id} className="w-full" />
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                    <span><span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: '#10b981' }} /> Pickup zone</span>
                    <span><span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: '#ef4444' }} /> Delivery zone</span>
                    <span><span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: '#38bdf8' }} /> GPS trail</span>
                    <span><span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: '#f59e0b' }} /> Live position</span>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!loading && shipments.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-slate-500">No customer-visible shipments found.</div>}
        </div>
      </Panel>
    </div>
  );
}
