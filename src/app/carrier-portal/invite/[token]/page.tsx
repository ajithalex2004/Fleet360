/**
 * /carrier-portal/logistics/invite/[token] — the carrier's magic-link page.
 *
 * A carrier opens the invite link they were sent, sees the load they were
 * invited to bid on, and submits a bid — no account or password. The token in
 * the URL is the credential: the page POSTs it to /api/carrier-portal/resolve
 * (auth + load data) and /api/carrier-portal/bid (submit). Standalone surface —
 * no operator chrome.
 */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Package, MapPin, Clock, Truck, CheckCircle2, AlertTriangle, Send } from 'lucide-react';

interface CarrierBid {
  id: string; amount: number; currency: string | null; status: string;
  transitTimeHours: number | null; validityUntil: string | null; notes: string | null;
}
interface RfqShipment {
  shipmentNo: string | null; cargoOwnerName: string | null; shipmentType: string | null;
  originName: string | null; originAddress: string | null;
  destinationName: string | null; destinationAddress: string | null;
  pickupWindowFrom: string | null; pickupWindowTo: string | null;
  deliveryWindowFrom: string | null; deliveryWindowTo: string | null;
  requestedVehicleType: string | null; totalWeightKg: number | null;
  currency: string | null;
}
interface PortalRfq {
  rfqNo?: string; status?: string; bidDeadlineAt?: string | null;
  shipment?: RfqShipment | null; carrierBid?: CarrierBid | null;
}
interface ResolveContext {
  carrier: { name: string | null; status: string | null; complianceStatus: string | null };
  rfq: PortalRfq | null;
  compliance: { canBid: boolean; blockers: Array<{ label?: string; reason?: string }> };
}

function money(n: number, c: string | null) {
  return `${c || 'AED'} ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dt(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function CarrierInvitePage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params?.token) ? params.token[0] : params?.token ?? '';

  const [ctx, setCtx] = useState<ResolveContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AED');
  const [transit, setTransit] = useState('');
  const [validity, setValidity] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!token) { setLoadError('Missing invite token.'); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/carrier-portal/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'This invite link is invalid or has expired.');
      setCtx(body as ResolveContext);
      const existing = (body as ResolveContext).rfq?.carrierBid;
      if (existing) {
        setAmount(String(existing.amount ?? ''));
        if (existing.currency) setCurrency(existing.currency);
        if (existing.transitTimeHours != null) setTransit(String(existing.transitTimeHours));
        if (existing.notes) setNotes(existing.notes);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the invitation');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void resolve(); }, [resolve]);

  const rfq = ctx?.rfq ?? null;
  const ship = rfq?.shipment ?? null;
  const rfqClosed = useMemo(() => ['AWARDED', 'CLOSED', 'CANCELLED'].includes((rfq?.status ?? '').toUpperCase()), [rfq]);
  const canBid = !!ctx?.compliance?.canBid && !rfqClosed;

  const submit = async () => {
    setFormError(null);
    setSuccess(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setFormError('Enter a valid bid amount.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/carrier-portal/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          amount: amt,
          currency,
          transitTimeHours: transit === '' ? null : Number(transit),
          validityUntil: validity || null,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Bid failed (${res.status})`);
      setSuccess('Your bid has been submitted. The shipper will review it.');
      await resolve();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to submit the bid');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/15 flex items-center justify-center">
            <Truck className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Freight invitation</h1>
            <p className="text-sm text-slate-400">{ctx?.carrier?.name ? `For ${ctx.carrier.name}` : 'Submit your bid for this load'}</p>
          </div>
        </div>

        {loading && (
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-5 py-8 text-center text-slate-400 animate-pulse">
            Loading the invitation…
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-2" />
            <p className="text-red-200">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && rfq && (
          <>
            {/* Load details */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-slate-500">
                  {rfq.rfqNo} · {ship?.shipmentNo ?? ''}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {rfq.status}
                </span>
              </div>

              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="text-white font-medium">{ship?.originName ?? '—'}</span>
                  <span className="text-slate-500"> → </span>
                  <span className="text-white font-medium">{ship?.destinationName ?? '—'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <Field icon={Package} label="Cargo" value={ship?.shipmentType ?? '—'} />
                <Field icon={Truck} label="Vehicle" value={ship?.requestedVehicleType ?? 'Any'} />
                <Field icon={Package} label="Weight" value={ship?.totalWeightKg != null ? `${ship.totalWeightKg} kg` : '—'} />
                <Field icon={Clock} label="Pickup" value={dt(ship?.pickupWindowFrom)} />
                <Field icon={Clock} label="Deliver by" value={dt(ship?.deliveryWindowTo)} />
                <Field icon={Clock} label="Bid deadline" value={dt(rfq.bidDeadlineAt)} />
              </div>
            </div>

            {/* Existing bid */}
            {rfq.carrierBid && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Your current bid: <span className="font-medium text-white">{money(rfq.carrierBid.amount, rfq.carrierBid.currency)}</span>
                <span className="text-emerald-300/70">({rfq.carrierBid.status})</span>
              </div>
            )}

            {/* Bid form */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <h2 className="text-sm font-semibold text-white mb-3">{rfq.carrierBid ? 'Update your bid' : 'Submit your bid'}</h2>

              {!canBid ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  {rfqClosed
                    ? 'This load is no longer accepting bids.'
                    : 'Bidding is unavailable — your carrier account needs to be active and compliant.'}
                  {ctx?.compliance?.blockers?.length ? (
                    <ul className="mt-2 list-disc list-inside text-xs">
                      {ctx.compliance.blockers.map((b, i) => <li key={i}>{b.label ?? b.reason ?? 'Compliance issue'}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="text-[11px] uppercase tracking-wider text-slate-500">Bid amount *</label>
                      <input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
                        className="w-full mt-1 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-500">Currency</label>
                      <input value={currency} onChange={e => setCurrency(e.target.value)}
                        className="w-full mt-1 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-500">Transit time (hours)</label>
                      <input type="number" min={0} value={transit} onChange={e => setTransit(e.target.value)} placeholder="—"
                        className="w-full mt-1 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-slate-500">Bid valid until</label>
                      <input type="date" value={validity} onChange={e => setValidity(e.target.value)}
                        className="w-full mt-1 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-slate-500">Notes</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything the shipper should know…"
                      className="w-full mt-1 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40" />
                  </div>

                  {formError && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{formError}</div>}
                  {success && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">{success}</div>}

                  <button type="button" onClick={() => void submit()} disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 text-slate-950 font-medium px-4 py-2.5 text-sm hover:bg-amber-400 disabled:opacity-50">
                    <Send className="w-4 h-4" /> {submitting ? 'Submitting…' : rfq.carrierBid ? 'Update bid' : 'Submit bid'}
                  </button>
                </div>
              )}
            </div>

            <p className="text-center text-xs text-slate-600">Powered by Fleet360 · This is a private invitation link.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-white mt-0.5 truncate">{value}</div>
    </div>
  );
}
