/**
 * /carrier-portal/logistics/offer/[token] — the driver's fixed-price offer page.
 *
 * A gig driver opens the broadcast magic link, sees the load + the fixed offer,
 * and taps Accept or Decline. Unlike the RFQ invite page (where they bid), here
 * the price is set — they take it or leave it. Multiple drivers can accept; the
 * shipper confirms one. Token-authed, standalone (no operator chrome).
 */
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MapPin, Package, Truck, Clock, CheckCircle2, AlertTriangle, Coins } from 'lucide-react';

interface OfferCtx {
  offer: { id: string; status: string; carrierName: string | null };
  broadcast: { amount: number; currency: string; status: string; responseDeadlineAt: string | null };
  shipment: {
    shipmentNo: string | null; originName: string | null; destinationName: string | null;
    shipmentType: string | null; vehicleType: string | null; totalWeightKg: number | null;
    pickupWindowFrom: string | null; deliveryWindowTo: string | null;
  };
  canRespond: boolean; expired: boolean; taken: boolean; assignedToMe: boolean;
}

function money(n: number, c: string) {
  return `${c} ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function OfferPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params?.token) ? params.token[0] : params?.token ?? '';

  const [ctx, setCtx] = useState<OfferCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!token) { setLoadError('Missing offer token.'); setLoading(false); return; }
    setLoading(true); setLoadError(null);
    try {
      const res = await fetch('/api/carrier-portal/offer/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'This offer link is invalid or has expired.');
      setCtx(body as OfferCtx);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the offer');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void resolve(); }, [resolve]);

  const respond = async (action: 'accept' | 'decline') => {
    setActing(true); setActionError(null);
    try {
      const res = await fetch('/api/carrier-portal/offer/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not record your response');
      setCtx(body as OfferCtx);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to respond');
    } finally { setActing(false); }
  };

  const ship = ctx?.shipment;
  const accepted = ctx?.offer.status === 'ACCEPTED';

  return (
    <div className="min-h-screen bg-slate-950 text-white py-10 px-4">
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-sky-500/15 flex items-center justify-center">
            <Truck className="w-6 h-6 text-sky-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Load offer</h1>
            <p className="text-sm text-slate-400">{ctx?.offer.carrierName ? `For ${ctx.offer.carrierName}` : 'A new load is available'}</p>
          </div>
        </div>

        {loading && <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-5 py-8 text-center text-slate-400 animate-pulse">Loading the offer…</div>}

        {!loading && loadError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-2" />
            <p className="text-red-200">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && ctx && (
          <>
            <div className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.07] p-5 text-center">
              <div className="text-xs uppercase tracking-wider text-sky-300/70 flex items-center justify-center gap-1.5">
                <Coins className="w-3.5 h-3.5" /> Fixed offer
              </div>
              <div className="text-3xl font-bold text-white mt-1">{money(ctx.broadcast.amount, ctx.broadcast.currency)}</div>
              {ctx.broadcast.responseDeadlineAt && <div className="text-xs text-slate-500 mt-1">Respond by {dt(ctx.broadcast.responseDeadlineAt)}</div>}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-sky-300 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="text-white font-medium">{ship?.originName ?? '—'}</span>
                  <span className="text-slate-500"> → </span>
                  <span className="text-white font-medium">{ship?.destinationName ?? '—'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <F icon={Package} label="Cargo" value={ship?.shipmentType ?? '—'} />
                <F icon={Truck} label="Vehicle" value={ship?.vehicleType ?? 'Any'} />
                <F icon={Package} label="Weight" value={ship?.totalWeightKg != null ? `${ship.totalWeightKg} kg` : '—'} />
                <F icon={Clock} label="Pickup" value={dt(ship?.pickupWindowFrom ?? null)} />
                <F icon={Clock} label="Deliver by" value={dt(ship?.deliveryWindowTo ?? null)} />
              </div>
            </div>

            {ctx.assignedToMe ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-center text-sm text-emerald-200 flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> You&rsquo;ve got the load — it&rsquo;s assigned to you. Head to pickup.
              </div>
            ) : ctx.taken ? (
              <div className="rounded-xl border border-slate-600/40 bg-slate-800/40 px-4 py-4 text-center text-sm text-slate-400">
                This load has already been assigned to another driver.
              </div>
            ) : accepted ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-center text-sm text-emerald-200 flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> You accepted this load. Waiting for the shipper to confirm.
              </div>
            ) : ctx.expired ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-center text-sm text-amber-200">This offer has expired.</div>
            ) : ctx.canRespond ? (
              <div className="space-y-2">
                {actionError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{actionError}</div>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => void respond('accept')} disabled={acting}
                    className="flex-1 rounded-xl bg-sky-500 text-slate-950 font-medium px-4 py-3 text-sm hover:bg-sky-400 disabled:opacity-50">
                    {acting ? '…' : `Accept ${money(ctx.broadcast.amount, ctx.broadcast.currency)}`}
                  </button>
                  <button type="button" onClick={() => void respond('decline')} disabled={acting}
                    className="rounded-xl border border-white/10 text-slate-300 px-4 py-3 text-sm hover:bg-slate-800">
                    Decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-600/40 bg-slate-800/40 px-4 py-4 text-center text-sm text-slate-400">This offer is no longer open.</div>
            )}

            <p className="text-center text-xs text-slate-600">Powered by Fleet360 · Private load offer.</p>
          </>
        )}
      </div>
    </div>
  );
}

function F({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
      <div className="text-white mt-0.5 truncate">{value}</div>
    </div>
  );
}
