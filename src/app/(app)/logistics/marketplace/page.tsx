/**
 * /logistics/marketplace — the freight load board.
 *
 * The operator-facing half of the marketplace: browse the tenant's open freight
 * RFQs (loads posted to carriers), compare the carrier bids on a load, and award
 * the winner. The shipper side (posting loads) lives in the shipper portal; the
 * RFQ/bid data + the governed award transaction live in src/lib/logistics/domain.ts.
 *
 * Reads /api/logistics/rfqs and /api/logistics/rfqs/[id]/bids; awards via
 * POST /api/logistics/rfqs/[id]/award (which enforces carrier compliance — a
 * blocked award returns the structured blockers, surfaced inline here).
 *
 * Fixes the dangling "Freight marketplace" deep-link on the logistics dashboard.
 */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gavel, RefreshCw, Truck, Clock, CheckCircle2, Trophy, Plus, Link2, X, Copy, Radio, MapPin } from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import { LogisticsMessage, readLogisticsApiError } from '@/components/logistics/master-data-fields';
import CargoClassificationPanel, { type CargoClassificationMeta } from '@/components/logistics/CargoClassificationPanel';

// ── Types (mirror mapRfq / mapBid) ─────────────────────────────────────────────

interface Rfq {
  id: string;
  rfqNo: string;
  status: string;
  shipmentOrderId: string;
  bidDeadlineAt: string | null;
  negotiationRound: number;
  awardedBidId: string | null;
  bidCount: number;
  shipment: {
    origin: string | null;
    destination: string | null;
    customerName: string | null;
    vehicleType: string | null;
    // Shipper-declared cargo classification. Rendered in the RFQ detail panel
    // so bidders know the shipment is cross-border / hazmat / customs-cleared
    // before they price.
    metadata: CargoClassificationMeta | null;
  } | null;
}

interface Bid {
  id: string;
  carrierId: string;
  carrierName: string | null;
  bidNo: string | null;
  amount: number;
  currency: string;
  transitTimeHours: number | null;
  validityUntil: string | null;
  status: string;
  notes: string | null;
}

interface ComplianceBlocker { label?: string; reason?: string; code?: string }
interface Carrier { id: string; name: string | null; carrierCode?: string | null }
interface PostableShipment {
  id: string;
  shipmentNo?: string | null;
  originName?: string | null;
  destinationName?: string | null;
  cargoOwnerName?: string | null;
}

const STATUS_FILTERS = ['ALL', 'OPEN', 'AWARDED', 'CLOSED', 'CANCELLED'] as const;
const TERMINAL_RFQ = ['AWARDED', 'CLOSED', 'CANCELLED'];

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('OPEN');
  const [loadingRfqs, setLoadingRfqs] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loadingBids, setLoadingBids] = useState(false);

  const [confirmBidId, setConfirmBidId] = useState<string | null>(null);
  const [awarding, setAwarding] = useState(false);
  const [awardError, setAwardError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<ComplianceBlocker[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  // Post-a-load form + carrier-invite generation.
  const [showPost, setShowPost] = useState(false);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [shipments, setShipments] = useState<PostableShipment[]>([]);
  const [postShipmentId, setPostShipmentId] = useState('');
  const [postScope, setPostScope] = useState<'SELECTED_CARRIERS' | 'ALL_ACTIVE_CARRIERS'>('SELECTED_CARRIERS');
  const [postCarrierIds, setPostCarrierIds] = useState<Set<string>>(new Set());
  const [postDeadline, setPostDeadline] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const [inviteCarrierId, setInviteCarrierId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Driver broadcast (fixed-price → nearest gig drivers).
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ carrierId: string; carrierName: string | null; distanceKm: number | null; vehicleType: string | null }>>([]);
  const [candidateNote, setCandidateNote] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  // Geocode the load's origin text into lat/lng on its PICKUP stop, so the
  // candidate finder can rank drivers by distance. Called from the amber
  // "no pickup GPS" banner when a shipper-portal submission arrived without
  // map coordinates.
  const geocodePickup = async () => {
    if (!selected || geocoding) return;
    setGeocoding(true);
    setBcError(null);
    try {
      const res = await fetch(`/api/logistics/shipments/${selected.shipmentOrderId}/geocode-pickup`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBcError(body.error ?? `Geocode failed (HTTP ${res.status})`);
        return;
      }
      setCandidateNote(null);
      await openBroadcast();
    } catch (e) {
      setBcError(e instanceof Error ? e.message : 'Geocode failed');
    } finally {
      setGeocoding(false);
    }
  };
  const [bcSelected, setBcSelected] = useState<Set<string>>(new Set());
  const [bcAmount, setBcAmount] = useState('');
  const [bcWindow, setBcWindow] = useState('10');
  const [bcAutoAssign, setBcAutoAssign] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [bcError, setBcError] = useState<string | null>(null);
  const [activeBroadcast, setActiveBroadcast] = useState<{ status: string; amount: number; currency: string; offers: Array<{ id: string; carrierId: string; carrierName: string | null; status: string; distanceKm: number | null }> } | null>(null);

  const selected = useMemo(() => rfqs.find(r => r.id === selectedId) ?? null, [rfqs, selectedId]);

  const loadRfqs = useCallback(async () => {
    setLoadingRfqs(true);
    setListError(null);
    try {
      const qs = statusFilter === 'ALL' ? '' : `?status=${statusFilter}`;
      const res = await fetch(`/api/logistics/rfqs${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const body = await res.json();
      setRfqs(Array.isArray(body.data) ? body.data : []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load RFQs');
    } finally {
      setLoadingRfqs(false);
    }
  }, [statusFilter]);

  useEffect(() => { void loadRfqs(); }, [loadRfqs]);

  const loadBids = useCallback(async (rfqId: string) => {
    setLoadingBids(true);
    setBids([]);
    try {
      const res = await fetch(`/api/logistics/rfqs/${rfqId}/bids`, { cache: 'no-store' });
      if (res.ok) {
        const body = await res.json();
        setBids(Array.isArray(body.data) ? body.data : []);
      }
    } catch { /* non-fatal — empty bid list */ }
    finally { setLoadingBids(false); }
  }, []);

  const select = (rfq: Rfq) => {
    setSelectedId(rfq.id);
    setConfirmBidId(null);
    setAwardError(null);
    setBlockers([]);
    setSuccess(null);
    setInviteCarrierId('');
    setInviteLink(null);
    setShowBroadcast(false);
    setActiveBroadcast(null);
    setBcError(null);
    void loadBids(rfq.id);
  };

  // Lazily load carriers + postable shipments the first time the form opens.
  const ensureFormData = useCallback(async () => {
    if (carriers.length > 0 || shipments.length > 0) return;
    try {
      const [cRes, sRes] = await Promise.all([
        fetch('/api/logistics/carriers', { cache: 'no-store' }),
        fetch('/api/logistics/shipments?postable=1', { cache: 'no-store' }),
      ]);
      if (cRes.ok) { const b = await cRes.json(); setCarriers(Array.isArray(b.data) ? b.data : []); }
      if (sRes.ok) { const b = await sRes.json(); setShipments(Array.isArray(b.data) ? b.data : []); }
    } catch { /* non-fatal — empty pickers */ }
  }, [carriers.length, shipments.length]);

  const openPost = () => { setShowPost(true); setPostError(null); void ensureFormData(); };

  const postLoad = async () => {
    setPostError(null);
    if (!postShipmentId) { setPostError('Pick a shipment to post.'); return; }
    if (postScope === 'SELECTED_CARRIERS' && postCarrierIds.size === 0) {
      setPostError('Select at least one carrier, or post to all active carriers.'); return;
    }
    setPosting(true);
    try {
      // datetime-local inputs emit `YYYY-MM-DDTHH:mm` (no seconds, no tz).
      // Go's RFC3339 parser rejects that — convert to a full UTC ISO string
      // so the backend can persist it as timestamptz. new Date(local) treats
      // the input as the user's local time, which is what the picker meant.
      let bidDeadlineAt: string | null = null;
      if (postDeadline) {
        const d = new Date(postDeadline);
        bidDeadlineAt = Number.isFinite(d.getTime()) ? d.toISOString() : null;
      }
      const res = await fetch('/api/logistics/rfqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentOrderId: postShipmentId,
          inviteScope: postScope,
          invitedCarrierIds: [...postCarrierIds],
          bidDeadlineAt,
        }),
      });
      if (!res.ok) {
        // Surface the server's actual reason (JSON { error | message } first,
        // raw text body next, status code last).
        const text = await res.text().catch(() => '');
        let parsed: { error?: string; message?: string } = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch {}
        const detail = parsed.error || parsed.message || (text && text.length < 200 ? text.trim() : '');
        throw new Error(detail ? `${detail} (HTTP ${res.status})` : `Post failed (HTTP ${res.status})`);
      }
      setShowPost(false);
      setPostShipmentId(''); setPostCarrierIds(new Set()); setPostDeadline('');
      setStatusFilter('OPEN');
      await loadRfqs();
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post the load');
    } finally {
      setPosting(false);
    }
  };

  const loadBroadcast = useCallback(async (rfqId: string) => {
    try {
      const res = await fetch(`/api/logistics/rfqs/${rfqId}/broadcast`, { cache: 'no-store' });
      if (res.ok) { const b = await res.json(); setActiveBroadcast(b.data ?? null); }
    } catch { /* non-fatal */ }
  }, []);

  const openBroadcast = async () => {
    if (!selected) return;
    setShowBroadcast(true);
    setBcError(null);
    setCandidateNote(null);
    setCandidates([]);
    try {
      const res = await fetch(`/api/logistics/rfqs/${selected.id}/broadcast/candidates?limit=3`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not find nearby drivers');
      const list = Array.isArray(body.data) ? body.data : [];
      setCandidates(list);
      setBcSelected(new Set(list.map((c: { carrierId: string }) => c.carrierId))); // pre-select the nearest
      if (body.note) setCandidateNote(body.note);
    } catch (e) {
      setBcError(e instanceof Error ? e.message : 'Could not find nearby drivers');
    }
    void loadBroadcast(selected.id);
  };

  const doBroadcast = async () => {
    if (!selected) return;
    setBcError(null);
    const amt = Number(bcAmount);
    if (!Number.isFinite(amt) || amt <= 0) { setBcError('Enter a fixed offer amount.'); return; }
    if (bcSelected.size === 0) { setBcError('Select at least one driver.'); return; }
    setBroadcasting(true);
    try {
      const res = await fetch(`/api/logistics/rfqs/${selected.id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          carrierIds: [...bcSelected],
          responseDeadlineMin: Number(bcWindow) || 10,
          autoAssign: bcAutoAssign,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Broadcast failed (${res.status})`);
      setSuccess(`Broadcast to ${bcSelected.size} driver(s). Waiting for accepts…`);
      await loadBroadcast(selected.id);
    } catch (e) {
      setBcError(e instanceof Error ? e.message : 'Broadcast failed');
    } finally {
      setBroadcasting(false);
    }
  };

  const assignBroadcastOffer = async (offerId: string) => {
    if (!selected) return;
    setBcError(null);
    setBlockers([]);
    try {
      const res = await fetch(`/api/logistics/rfqs/${selected.id}/broadcast/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(body.blockers) && body.blockers.length > 0) {
          setBlockers(body.blockers);
          throw new Error(body.error || 'Driver compliance blocks this assignment');
        }
        throw new Error(body.error || `Assign failed (${res.status})`);
      }
      setSuccess('Driver assigned — the load is off the board.');
      await loadBroadcast(selected.id);
      await loadRfqs();
    } catch (e) {
      setBcError(e instanceof Error ? e.message : 'Assign failed');
    }
  };

  // Poll the active broadcast while it's live so accepts surface for the operator.
  useEffect(() => {
    if (!selectedId || !activeBroadcast || !['BROADCASTING', 'CONFIRMING'].includes(activeBroadcast.status)) return;
    const t = setInterval(() => void loadBroadcast(selectedId), 5000);
    return () => clearInterval(t);
  }, [selectedId, activeBroadcast, loadBroadcast]);

  const generateInvite = async () => {
    if (!selected || !inviteCarrierId) return;
    setInviting(true);
    setInviteLink(null);
    try {
      await ensureFormData();
      const res = await fetch(`/api/logistics/rfqs/${selected.id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrierId: inviteCarrierId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Invite failed (${res.status})`);
      const path = body.portalPath ?? (body.token ? `/carrier-portal/logistics/invite/${body.token}` : '');
      setInviteLink(path ? `${window.location.origin}${path}` : null);
    } catch (e) {
      setAwardError(e instanceof Error ? e.message : 'Failed to create invite');
    } finally {
      setInviting(false);
    }
  };

  const award = async (rfqId: string, bidId: string) => {
    setAwarding(true);
    setAwardError(null);
    setBlockers([]);
    setSuccess(null);
    try {
      const res = await fetch(`/api/logistics/rfqs/${rfqId}/award`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (Array.isArray(body.blockers) && body.blockers.length > 0) {
          setBlockers(body.blockers);
          throw new Error(body.error || 'Carrier compliance blocks this award');
        }
        throw new Error(body.error || `Award failed (${res.status})`);
      }
      setSuccess('Bid awarded — carrier assigned and the load is off the board.');
      setConfirmBidId(null);
      await loadRfqs();
      await loadBids(rfqId);
    } catch (e) {
      setAwardError(e instanceof Error ? e.message : 'Award failed');
    } finally {
      setAwarding(false);
    }
  };

  const canAward = selected ? !TERMINAL_RFQ.includes(selected.status) : false;
  const cheapestId = bids.length > 0 ? bids[0].id : null; // API returns cheapest-first

  return (
    <div className="space-y-6">
      <PageHeader
        title="Freight marketplace"
        subtitle="Browse open loads, compare carrier bids, and award — the carrier-facing load board."
        icon={Gavel}
        accent="amber"
        actions={
          <>
            <button
              type="button"
              onClick={() => void loadRfqs()}
              aria-label="Refresh"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 text-slate-300 px-3 py-2 text-sm hover:bg-slate-800"
            >
              <RefreshCw className={`w-4 h-4 ${loadingRfqs ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={openPost}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 px-3.5 py-2 text-sm hover:bg-amber-500/25"
            >
              <Plus className="w-4 h-4" /> Post a load
            </button>
          </>
        }
      />

      {/* Post a load */}
      {showPost && (
        <Panel
          title="Post a load to the marketplace"
          subtitle="Open a shipment for carrier bidding"
          icon={Plus}
          accent="amber"
          actions={
            <button type="button" onClick={() => setShowPost(false)} aria-label="Close" className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-500">Shipment *</label>
              <select
                value={postShipmentId}
                onChange={e => setPostShipmentId(e.target.value)}
                className="w-full mt-1.5 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40"
              >
                <option value="">Select a postable shipment…</option>
                {shipments.map(s => (
                  <option key={s.id} value={s.id}>
                    {(s.shipmentNo || s.id.slice(0, 8))} · {s.originName ?? '—'} → {s.destinationName ?? '—'}
                  </option>
                ))}
              </select>
              {shipments.length === 0 && <p className="text-[11px] text-slate-600 mt-1">No postable shipments (all are already on the marketplace or delivered).</p>}
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-500">Bid deadline</label>
              <input
                type="datetime-local"
                value={postDeadline}
                onChange={e => setPostDeadline(e.target.value)}
                className="w-full mt-1.5 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-slate-500">Who can bid</label>
              <div className="flex items-center gap-2 mt-1.5">
                {(['SELECTED_CARRIERS', 'ALL_ACTIVE_CARRIERS'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPostScope(s)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${
                      postScope === s ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'bg-slate-800/40 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {s === 'SELECTED_CARRIERS' ? 'Selected carriers' : 'All active carriers'}
                  </button>
                ))}
              </div>
            </div>
            {postScope === 'SELECTED_CARRIERS' && (
              <div className="md:col-span-2">
                <label className="text-[11px] uppercase tracking-wider text-slate-500">Invite carriers ({postCarrierIds.size} selected)</label>
                <div className="mt-1.5 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-slate-900/40 divide-y divide-white/5">
                  {carriers.length === 0 && <p className="text-xs text-slate-600 px-3 py-2">No active carriers found.</p>}
                  {carriers.map(c => {
                    const on = postCarrierIds.has(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setPostCarrierIds(prev => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800/40"
                      >
                        <span className="text-slate-200 truncate">{c.name || c.id.slice(0, 8)}{c.carrierCode ? ` · ${c.carrierCode}` : ''}</span>
                        {on && <CheckCircle2 className="w-4 h-4 text-amber-300 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {postError && <div className="mt-3"><LogisticsMessage type="error" message={postError} /></div>}

          <div className="flex items-center justify-end gap-2 mt-4">
            <button type="button" onClick={() => setShowPost(false)} className="rounded-xl border border-white/10 text-slate-300 px-4 py-2.5 text-sm hover:bg-slate-800">Cancel</button>
            <button
              type="button"
              onClick={() => void postLoad()}
              disabled={posting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 text-slate-950 font-medium px-4 py-2.5 text-sm hover:bg-amber-400 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> {posting ? 'Posting…' : 'Post load'}
            </button>
          </div>
        </Panel>
      )}

      {/* Status filter */}
      <div className="flex items-center gap-2">
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
              statusFilter === s
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                : 'bg-slate-800/40 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-6">
        {/* Load board */}
        <Panel title="Open loads" icon={Gavel} accent="amber">
          {listError && <LogisticsMessage type="error" message={listError} />}
          {!listError && loadingRfqs && <p className="text-sm text-slate-500">Loading…</p>}
          {!loadingRfqs && rfqs.length === 0 && !listError && (
            <p className="text-sm text-slate-500">
              No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase()} RFQs. Loads posted to the
              marketplace from a shipment appear here.
            </p>
          )}
          <div className="space-y-1.5 max-h-[64vh] overflow-y-auto pr-1">
            {rfqs.map(r => {
              const active = r.id === selectedId;
              const lane = r.shipment
                ? `${r.shipment.origin ?? '—'} → ${r.shipment.destination ?? '—'}`
                : 'Lane unavailable';
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => select(r)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    active ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-800/40 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white truncate">{r.rfqNo}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="text-xs text-slate-300 truncate mt-0.5">{lane}</div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{r.shipment?.customerName || 'Customer n/a'}</span>
                    {r.shipment?.vehicleType && <span className="text-slate-600">· {r.shipment.vehicleType}</span>}
                    <span className="text-amber-300/80">· {r.bidCount} bid{r.bidCount === 1 ? '' : 's'}</span>
                    {r.bidDeadlineAt && <span className="text-slate-600">· due {fmtDate(r.bidDeadlineAt)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Bid comparison */}
        <Panel
          title={selected ? `Bids · ${selected.rfqNo}` : 'Bids'}
          subtitle={selected?.shipment ? `${selected.shipment.origin ?? '—'} → ${selected.shipment.destination ?? '—'}` : 'Select a load to compare bids'}
          icon={Truck}
          accent="amber"
        >
          {!selected ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-600 border border-dashed border-white/10 rounded-2xl">
              Pick a load from the board to compare carrier bids.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Cargo classification — shown above the bid rows so operators
                  see cross-border / hazmat context before they read prices.
                  Renders nothing on legacy loads that carry no metadata. */}
              <CargoClassificationPanel metadata={selected.shipment?.metadata ?? null} />
              {success && <LogisticsMessage type="success" message={success} />}
              {awardError && <LogisticsMessage type="error" message={awardError} />}
              {blockers.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                  <p className="font-semibold mb-1">Award blocked — resolve carrier compliance first:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    {blockers.map((b, i) => <li key={i}>{b.label ?? b.reason ?? b.code ?? 'Compliance issue'}</li>)}
                  </ul>
                </div>
              )}

              {/* Invite a carrier (generate a magic link) */}
              {canAward && (
                <div className="rounded-xl border border-white/10 bg-slate-900/40 px-3.5 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link2 className="w-4 h-4 text-amber-300 shrink-0" />
                    <span className="text-xs text-slate-400">Invite a carrier to bid:</span>
                    <select
                      value={inviteCarrierId}
                      onChange={e => { setInviteCarrierId(e.target.value); setInviteLink(null); }}
                      onFocus={() => void ensureFormData()}
                      className="bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/40"
                    >
                      <option value="">Choose carrier…</option>
                      {carriers.map(c => <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => void generateInvite()}
                      disabled={!inviteCarrierId || inviting}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      {inviting ? 'Generating…' : 'Generate link'}
                    </button>
                  </div>
                  {inviteLink && (
                    <div className="mt-2 flex items-center gap-2">
                      <input readOnly value={inviteLink} className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-300 font-mono" />
                      <button
                        type="button"
                        onClick={() => { void navigator.clipboard?.writeText(inviteLink); }}
                        aria-label="Copy link"
                        className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 px-2 py-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Driver broadcast — fixed-price offer to nearest gig drivers */}
              {canAward && (
                <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-sky-300" />
                      <span className="text-xs font-medium text-sky-200">Or broadcast a fixed price to nearby drivers</span>
                    </div>
                    {!showBroadcast && (
                      <button type="button" onClick={() => void openBroadcast()}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-200 hover:bg-sky-500/25">
                        Broadcast to drivers
                      </button>
                    )}
                  </div>

                  {showBroadcast && (
                    <div className="mt-3 space-y-3">
                      {candidateNote && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 flex items-start gap-2.5">
                          <span className="text-[11px] text-amber-300/80 flex-1">{candidateNote}</span>
                          <button
                            type="button"
                            onClick={() => void geocodePickup()}
                            disabled={geocoding || !selected}
                            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {geocoding ? 'Geocoding…' : 'Geocode pickup'}
                          </button>
                        </div>
                      )}
                      {candidates.length > 0 && (
                        <div className="rounded-lg border border-white/10 bg-slate-900/40 divide-y divide-white/5">
                          {candidates.map(c => {
                            const on = bcSelected.has(c.carrierId);
                            return (
                              <button key={c.carrierId} type="button"
                                onClick={() => setBcSelected(prev => { const n = new Set(prev); if (n.has(c.carrierId)) n.delete(c.carrierId); else n.add(c.carrierId); return n; })}
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800/40">
                                <span className="flex items-center gap-1.5 text-slate-200">
                                  <MapPin className="w-3 h-3 text-sky-300" />
                                  {c.carrierName || c.carrierId.slice(0, 8)}
                                  <span className="text-[11px] text-slate-500">· {c.distanceKm != null ? `${c.distanceKm} km` : '—'}{c.vehicleType ? ` · ${c.vehicleType}` : ''}</span>
                                </span>
                                {on && <CheckCircle2 className="w-4 h-4 text-sky-300 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {candidates.length === 0 && !candidateNote && <p className="text-[11px] text-slate-500">No idle drivers nearby right now.</p>}

                      <div className="flex items-end gap-2 flex-wrap">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-slate-500">Fixed offer</label>
                          <input type="number" min={0} step="0.01" value={bcAmount} onChange={e => setBcAmount(e.target.value)} placeholder="AED 0.00"
                            className="w-28 mt-1 bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/40" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-slate-500">Window (min)</label>
                          <input type="number" min={1} value={bcWindow} onChange={e => setBcWindow(e.target.value)}
                            className="w-20 mt-1 bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/40" />
                        </div>
                        <button type="button" onClick={() => void doBroadcast()} disabled={broadcasting || bcSelected.size === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 text-slate-950 font-medium px-3 py-1.5 text-sm hover:bg-sky-400 disabled:opacity-50">
                          <Radio className="w-4 h-4" /> {broadcasting ? 'Broadcasting…' : `Broadcast to ${bcSelected.size}`}
                        </button>
                        <button type="button" onClick={() => setShowBroadcast(false)} className="text-xs text-slate-400 hover:text-white px-2 py-1.5">Cancel</button>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <input type="checkbox" checked={bcAutoAssign} onChange={e => setBcAutoAssign(e.target.checked)} className="accent-sky-500" />
                        Auto-assign the first driver who accepts (skips manual confirm)
                      </label>
                      {bcError && <p className="text-[11px] text-red-300">{bcError}</p>}
                    </div>
                  )}

                  {/* Live offer responses (Phase 2 adds the Assign action) */}
                  {activeBroadcast && activeBroadcast.offers.length > 0 && (
                    <div className="mt-3 rounded-lg border border-white/10 bg-slate-900/40">
                      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                        Broadcast {activeBroadcast.status.toLowerCase()} · {activeBroadcast.currency} {activeBroadcast.amount.toLocaleString('en-AE')}
                      </div>
                      {activeBroadcast.offers.map(o => {
                        const broadcastAssigned = activeBroadcast.status === 'ASSIGNED';
                        return (
                          <div key={o.id} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-white/5 last:border-b-0 ${o.status === 'ASSIGNED' ? 'bg-emerald-500/10' : ''}`}>
                            <span className="text-slate-200">{o.carrierName || o.carrierId?.slice?.(0, 8)}<span className="text-[11px] text-slate-500">{o.distanceKm != null ? ` · ${o.distanceKm} km` : ''}</span></span>
                            {o.status === 'ASSIGNED' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" /> Assigned</span>
                            ) : o.status === 'ACCEPTED' && !broadcastAssigned ? (
                              <button type="button" onClick={() => void assignBroadcastOffer(o.id)}
                                className="text-xs font-medium px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400">Assign</button>
                            ) : (
                              <span className={`text-xs ${['DECLINED', 'TIMEOUT', 'SUPERSEDED'].includes(o.status) ? 'text-slate-500' : 'text-amber-300'}`}>{o.status.toLowerCase()}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {loadingBids && <p className="text-sm text-slate-500">Loading bids…</p>}
              {!loadingBids && bids.length === 0 && (
                <p className="text-sm text-slate-500">No bids on this load yet.</p>
              )}

              {bids.length > 0 && (
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  <div className="grid grid-cols-[1.4fr_1fr_0.8fr_0.9fr_auto] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                    <div>Carrier</div><div>Bid</div><div>Transit</div><div>Status</div><div />
                  </div>
                  {bids.map(b => {
                    const isAwarded = selected.awardedBidId === b.id || b.status === 'AWARDED';
                    const isCheapest = b.id === cheapestId && !isAwarded;
                    const bidAwardable = canAward && !isAwarded && b.status !== 'REJECTED';
                    return (
                      <div
                        key={b.id}
                        className={`grid grid-cols-[1.4fr_1fr_0.8fr_0.9fr_auto] gap-2 px-3 py-2.5 items-center border-b border-white/5 last:border-b-0 ${
                          isAwarded ? 'bg-emerald-500/10' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-white truncate flex items-center gap-1.5">
                            {isAwarded && <Trophy className="w-3.5 h-3.5 text-emerald-300 shrink-0" />}
                            {b.carrierName || b.carrierId.slice(0, 8)}
                          </div>
                          {isCheapest && <div className="text-[10px] text-emerald-300/80">Best price</div>}
                          {b.bidNo && <div className="text-[10px] text-slate-600 font-mono">{b.bidNo}</div>}
                        </div>
                        <div className="text-sm font-mono text-white">{money(b.amount, b.currency)}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {b.transitTimeHours != null ? `${b.transitTimeHours}h` : '—'}
                        </div>
                        <div><StatusPill status={b.status} /></div>
                        <div className="text-right">
                          {isAwarded ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Awarded
                            </span>
                          ) : bidAwardable ? (
                            confirmBidId === b.id ? (
                              <span className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={awarding}
                                  onClick={() => void award(selected.id, b.id)}
                                  className="text-xs font-medium px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                                >
                                  {awarding ? '…' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmBidId(null)}
                                  className="text-xs text-slate-400 hover:text-white"
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => { setConfirmBidId(b.id); setAwardError(null); setBlockers([]); }}
                                className="text-xs font-medium px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25"
                              >
                                Award
                              </button>
                            )
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!canAward && bids.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  This RFQ is {selected.status.toLowerCase()} — bids can no longer be awarded.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
