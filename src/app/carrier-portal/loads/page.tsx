'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw, Send, Truck } from 'lucide-react';

interface LoadRow {
  id: string;
  rfqNo: string;
  status: string;
  shipmentOrderId: string;
  shipment: {
    id: string;
    shipmentNo: string | null;
    originName: string | null;
    destinationName: string | null;
    pickupWindowFrom: string | null;
    requestedVehicleType: string | null;
    totalWeightKg: number | null;
    currency: string | null;
  } | null;
  carrierBid: { amount: number; currency: string | null; status: string | null } | null;
}

interface AssignedLoadRow {
  id: string;
  shipmentNo: string | null;
  status: string;
  cargoOwnerName: string | null;
  originName: string | null;
  originAddress: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  pickupWindowFrom: string | null;
  deliveryWindowTo: string | null;
  requestedVehicleType: string | null;
  totalWeightKg: number | null;
  carrierCostAmount: number | null;
  currency: string | null;
  latestEventType: string | null;
  latestEventAt: string | null;
  podCount: number;
}

function dt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-AE') : '-';
}

export default function CarrierAppPage() {
  const [token, setToken] = useState('');
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [assignedLoads, setAssignedLoads] = useState<AssignedLoadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [amountById, setAmountById] = useState<Record<string, string>>({});

  useEffect(() => {
    const saved = window.localStorage.getItem('fleet360-carrier-token');
    if (saved) setToken(saved);
  }, []);

  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      window.localStorage.setItem('fleet360-carrier-token', token);
      const [openRes, assignedRes] = await Promise.all([
        fetch('/api/carrier-portal/app/loads?status=OPEN', {
          headers: { 'x-carrier-app-token': token },
          cache: 'no-store',
        }),
        fetch('/api/carrier-portal/app/loads?view=assigned', {
          headers: { 'x-carrier-app-token': token },
          cache: 'no-store',
        }),
      ]);
      const openBody = await openRes.json().catch(() => ({}));
      const assignedBody = await assignedRes.json().catch(() => ({}));
      if (!openRes.ok) throw new Error(openBody.error || 'Failed to load available loads');
      if (!assignedRes.ok) throw new Error(assignedBody.error || 'Failed to load awarded loads');
      setLoads(Array.isArray(openBody.data) ? openBody.data : []);
      setAssignedLoads(Array.isArray(assignedBody.data) ? assignedBody.data : []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load carrier app');
    } finally {
      setLoading(false);
    }
  };

  const bid = async (loadRow: LoadRow) => {
    setMessage(null);
    const amount = amountById[loadRow.id] ?? '';
    const res = await fetch('/api/carrier-portal/app/loads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-carrier-app-token': token },
      body: JSON.stringify({
        rfqId: loadRow.id,
        shipmentOrderId: loadRow.shipment?.id ?? loadRow.shipmentOrderId,
        amount,
        currency: loadRow.shipment?.currency ?? 'AED',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error || 'Failed to submit bid');
      return;
    }
    setMessage('Bid submitted.');
    await load();
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-emerald-300/70">Fleet360 carrier app</p>
            <h1 className="text-2xl font-bold">Carrier loads</h1>
          </div>
          <Truck className="h-7 w-7 text-emerald-300" />
        </div>

        <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="Carrier app device token" className="min-w-[260px] flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" />
          <button type="button" onClick={() => void load()} disabled={loading || !token} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> {loading ? 'Loading...' : 'Load'}</button>
        </div>

        {message && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200">{message}</div>}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Awarded loads</h2>
            <span className="text-xs text-slate-500">{assignedLoads.length} active</span>
          </div>
          <div className="grid gap-3">
            {assignedLoads.map(loadRow => (
              <Link key={loadRow.id} href={`/carrier-portal/loads/${loadRow.id}`} className="block rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 transition hover:bg-emerald-500/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-emerald-300">{loadRow.shipmentNo ?? loadRow.id.slice(0, 8)}</p>
                    <h3 className="mt-1 text-lg font-semibold">{loadRow.originName ?? loadRow.originAddress ?? '-'} to {loadRow.destinationName ?? loadRow.destinationAddress ?? '-'}</h3>
                    <p className="mt-1 text-sm text-slate-400">{loadRow.requestedVehicleType ?? 'Any vehicle'} · pickup {dt(loadRow.pickupWindowFrom)} · {loadRow.totalWeightKg ?? 0} kg</p>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-200">{loadRow.status}</span>
                    <p className="mt-2 text-sm text-slate-300">{loadRow.currency ?? 'AED'} {(loadRow.carrierCostAmount ?? 0).toLocaleString('en-AE')}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Latest: {loadRow.latestEventType ?? 'No updates'} {loadRow.latestEventAt ? `· ${dt(loadRow.latestEventAt)}` : ''}</span>
                  <span className="inline-flex items-center gap-1 text-emerald-300">Open execution <ArrowRight className="h-3.5 w-3.5" /></span>
                </div>
              </Link>
            ))}
            {!loading && assignedLoads.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No awarded loads assigned to this carrier token yet.</div>}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Available RFQs</h2>
            <span className="text-xs text-slate-500">{loads.length} open</span>
          </div>
          <div className="grid gap-3">
          {loads.map(loadRow => (
            <div key={loadRow.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-emerald-300">{loadRow.rfqNo}</p>
                  <h2 className="mt-1 text-lg font-semibold">{loadRow.shipment?.originName ?? '-'} to {loadRow.shipment?.destinationName ?? '-'}</h2>
                  <p className="mt-1 text-sm text-slate-400">{loadRow.shipment?.requestedVehicleType ?? 'Any vehicle'} · pickup {dt(loadRow.shipment?.pickupWindowFrom)} · {loadRow.shipment?.totalWeightKg ?? 0} kg</p>
                </div>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">{loadRow.status}</span>
              </div>
              {loadRow.carrierBid ? (
                <p className="mt-3 text-sm text-emerald-300">Your bid: {loadRow.carrierBid.currency ?? 'AED'} {loadRow.carrierBid.amount.toLocaleString('en-AE')} ({loadRow.carrierBid.status})</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input value={amountById[loadRow.id] ?? ''} onChange={e => setAmountById(prev => ({ ...prev, [loadRow.id]: e.target.value }))} type="number" min={0} step="0.01" placeholder="Bid amount" className="w-40 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" />
                  <button type="button" onClick={() => void bid(loadRow)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"><Send className="h-4 w-4" /> Submit bid</button>
                </div>
              )}
            </div>
          ))}
          {!loading && loads.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No open loads for this carrier token.</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
