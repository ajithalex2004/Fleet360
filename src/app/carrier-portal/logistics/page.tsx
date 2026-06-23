'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useLogisticsPolling } from '@/components/logistics/master-data-fields';

type CarrierPortalRfq = {
  id: string;
  rfqNo: string | null;
  status: string;
  inviteScope: string | null;
  bidDeadlineAt: string | null;
  negotiationRound: number | null;
  bidCount: number;
  shipmentOrderId: string;
  customerMarketplacePolicy?: {
    rfqEnabled: boolean;
    bidSubmissionEnabled: boolean;
    defaultProcurementMode: 'DIRECT_ONLY' | 'RFQ_NO_BIDS' | 'RFQ_BIDDING' | string;
    configured: boolean;
  } | null;
  carrier: {
    id: string;
    name: string;
    carrierCode: string | null;
    status: string;
  };
  shipment: {
    id: string;
    shipmentNo: string | null;
    cargoOwnerName: string | null;
    shipmentType: string | null;
    status: string | null;
    priority: string | null;
    originName: string | null;
    originAddress: string | null;
    destinationName: string | null;
    destinationAddress: string | null;
    pickupWindowFrom: string | null;
    pickupWindowTo: string | null;
    deliveryWindowFrom: string | null;
    deliveryWindowTo: string | null;
    requestedVehicleType: string | null;
    totalWeightKg: number | null;
    customerRateAmount: number | null;
    currency: string | null;
  };
  carrierBid: null | {
    id: string;
    bidNo: string | null;
    amount: number;
    currency: string | null;
    transitTimeHours: number | null;
    validityUntil: string | null;
    status: string | null;
    notes: string | null;
    createdAt: string | null;
  };
};

type PortalTimeline = {
  events: Array<{ id: string; type: string; status: string | null; occurredAt: string | null; notes: string | null }>;
  pods: Array<{ id: string; status: string; deliveredAt: string | null; recipientName: string | null }>;
};

type CarrierDocument = {
  id: string;
  documentType: string;
  documentName: string;
  documentUrl: string;
  status: string;
  expiryDate: string | null;
};

type CarrierVehicle = {
  id: string;
  plateNo: string;
  vehicleType: string;
  availabilityStatus: string;
  complianceStatus: string;
};

type ComplianceBlocker = {
  code: string;
  label: string;
  severity: 'ERROR' | 'WARNING';
};

const emptyBid = {
  amount: '',
  transitTimeHours: '',
  validityUntil: '',
  notes: '',
};

const emptyDocumentForm = {
  documentType: 'TRADE_LICENSE',
  documentName: '',
  documentUrl: '',
  issueDate: '',
  expiryDate: '',
};

function currency(value?: number | null, code = 'AED') {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${code} ${Number(value).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

function dateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-AE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function routeLabel(rfq: CarrierPortalRfq) {
  const origin = rfq.shipment.originName ?? rfq.shipment.originAddress ?? 'Origin';
  const destination = rfq.shipment.destinationName ?? rfq.shipment.destinationAddress ?? 'Destination';
  return `${origin} -> ${destination}`;
}

function statusClass(status?: string | null) {
  switch ((status ?? '').toUpperCase()) {
    case 'OPEN':
    case 'SUBMITTED':
      return 'border-cyan-300 bg-cyan-100 text-cyan-950';
    case 'AWARDED':
    case 'APPROVED':
      return 'border-emerald-300 bg-emerald-100 text-emerald-950';
    case 'REJECTED':
    case 'CANCELLED':
      return 'border-rose-300 bg-rose-100 text-rose-950';
    case 'CLOSED':
      return 'border-slate-300 bg-slate-100 text-slate-800';
    default:
      return 'border-amber-300 bg-amber-100 text-amber-950';
  }
}

function Pill({ status, label }: { status?: string | null; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${statusClass(status)}`}>
      {label ?? status ?? '-'}
    </span>
  );
}

export default function LogisticsCarrierPortalPage() {
  const [inviteToken, setInviteToken] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [rfqs, setRfqs] = useState<CarrierPortalRfq[]>([]);
  const [timeline, setTimeline] = useState<PortalTimeline | null>(null);
  const [documents, setDocuments] = useState<CarrierDocument[]>([]);
  const [vehicles, setVehicles] = useState<CarrierVehicle[]>([]);
  const [complianceBlockers, setComplianceBlockers] = useState<ComplianceBlocker[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bidForm, setBidForm] = useState(emptyBid);
  const [documentForm, setDocumentForm] = useState(emptyDocumentForm);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteMatch = window.location.pathname.match(/\/carrier-portal\/logistics\/invite\/([^/]+)/);
    const token = inviteMatch?.[1] ? decodeURIComponent(inviteMatch[1]) : params.get('token') ?? '';
    setInviteToken(token);
  }, []);

  const selected = rfqs.find(rfq => rfq.id === selectedId) ?? rfqs[0] ?? null;
  const canSubmitBid = !selected?.customerMarketplacePolicy
    || (
      selected.customerMarketplacePolicy.rfqEnabled
      && selected.customerMarketplacePolicy.bidSubmissionEnabled
      && selected.customerMarketplacePolicy.defaultProcurementMode !== 'DIRECT_ONLY'
      && selected.customerMarketplacePolicy.defaultProcurementMode !== 'RFQ_NO_BIDS'
    );

  const filteredRfqs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rfqs.filter(rfq => !q || [
      rfq.rfqNo,
      rfq.shipment.shipmentNo,
      rfq.shipment.cargoOwnerName,
      rfq.shipment.originName,
      rfq.shipment.destinationName,
      rfq.status,
    ].some(value => value?.toLowerCase().includes(q)));
  }, [rfqs, search]);

  const openCount = rfqs.filter(rfq => rfq.status === 'OPEN').length;
  const submittedCount = rfqs.filter(rfq => rfq.carrierBid).length;
  const awardedCount = rfqs.filter(rfq => rfq.carrierBid?.status === 'AWARDED').length;

  const loadRfqs = useCallback(async () => {
    if (!inviteToken) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/logistics/carrier-portal/invites/${encodeURIComponent(inviteToken)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const nextRfqs = Array.isArray(data.rfqs) ? data.rfqs : data.rfq ? [data.rfq] : [];
      setRfqs(nextRfqs);
      setTimeline(data.timeline ?? null);
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setVehicles(Array.isArray(data.vehicles) ? data.vehicles : []);
      setComplianceBlockers(Array.isArray(data.compliance?.blockers) ? data.compliance.blockers : []);
      if (data.carrier?.name) setCarrierName(data.carrier.name);
      setSelectedId(current => current || nextRfqs[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load invited RFQs');
    } finally {
      setLoading(false);
    }
  }, [inviteToken]);

  useEffect(() => {
    if (inviteToken) loadRfqs();
  }, [inviteToken, loadRfqs]);

  useLogisticsPolling(loadRfqs, Boolean(inviteToken), 20000);

  const submitBid = async () => {
    if (!selected) return;
    if (!canSubmitBid) {
      setError('Carrier bid submission is disabled for this cargo owner.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const bidUrl = `/api/logistics/carrier-portal/invites/${encodeURIComponent(inviteToken)}/bid`;
      const res = await fetch(bidUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(bidForm.amount),
          transitTimeHours: bidForm.transitTimeHours ? Number(bidForm.transitTimeHours) : null,
          validityUntil: bidForm.validityUntil || null,
          notes: bidForm.notes || null,
          currency: selected.shipment.currency ?? 'AED',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotice('Bid submitted successfully. Your latest offer is now visible to the shipper.');
      setBidForm(emptyBid);
      await loadRfqs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bid submission failed');
    } finally {
      setSaving(false);
    }
  };

  const uploadDocument = async () => {
    if (!inviteToken) return;
    setUploadingDocument(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/logistics/carrier-portal/invites/${encodeURIComponent(inviteToken)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: documentForm.documentType,
          documentName: documentForm.documentName,
          documentUrl: documentForm.documentUrl,
          issueDate: documentForm.issueDate || null,
          expiryDate: documentForm.expiryDate || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
      setComplianceBlockers(Array.isArray(data.compliance?.blockers) ? data.compliance.blockers : []);
      setNotice('Document uploaded for compliance review.');
      setDocumentForm(emptyDocumentForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document upload failed');
    } finally {
      setUploadingDocument(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.22),transparent_32%),linear-gradient(135deg,#020617,#111827_55%,#1f2937)] px-5 py-6 text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-white/8 p-5 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/30">
              <Truck className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Fleet360 Carrier Portal</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight">Freight RFQ Inbox</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
                {inviteToken
                  ? `Secure invite${carrierName ? ` for ${carrierName}` : ''}. Review the RFQ and submit your carrier bid directly.`
                  : 'Review invited RFQs, compare shipment requirements, and submit your carrier bid directly.'}
              </p>
            </div>
          </div>
          <button
            onClick={loadRfqs}
            disabled={loading || !inviteToken}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-100 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </button>
        </header>

        {!inviteToken && (
          <section className="rounded-3xl border border-amber-300/30 bg-amber-400/10 p-5 text-sm font-semibold text-amber-100 backdrop-blur">
            Open this portal from a secure Fleet360 carrier invite link. Raw tenant and carrier ID access is disabled.
          </section>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-950">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-950">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {inviteToken && (
          <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-4 backdrop-blur">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Compliance Documents</h2>
                  <p className="text-xs text-slate-400">Upload missing or renewed documents for review before award/dispatch.</p>
                </div>
                <Pill status={complianceBlockers.length ? 'PENDING' : 'APPROVED'} label={complianceBlockers.length ? `${complianceBlockers.length} blockers` : 'Ready'} />
              </div>
              {complianceBlockers.length > 0 && (
                <div className="mb-4 space-y-1 rounded-2xl border border-rose-300 bg-rose-100 p-3 text-xs font-semibold text-rose-950">
                  {complianceBlockers.slice(0, 4).map(blocker => (
                    <p key={blocker.code}>- {blocker.label}</p>
                  ))}
                </div>
              )}
              <div className="grid gap-2 md:grid-cols-[150px_1fr_1fr_140px_140px_auto]">
                <select
                  value={documentForm.documentType}
                  onChange={e => setDocumentForm(form => ({ ...form, documentType: e.target.value }))}
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-bold text-white outline-none"
                >
                  {['TRADE_LICENSE', 'INSURANCE', 'DRIVER_LICENSE', 'DRIVER_ID', 'DRIVER_PERMIT', 'BANK_DETAILS'].map(type => (
                    <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <input
                  value={documentForm.documentName}
                  onChange={e => setDocumentForm(form => ({ ...form, documentName: e.target.value }))}
                  placeholder="Document name"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-white placeholder-slate-500 outline-none"
                />
                <input
                  value={documentForm.documentUrl}
                  onChange={e => setDocumentForm(form => ({ ...form, documentUrl: e.target.value }))}
                  placeholder="Document URL"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-white placeholder-slate-500 outline-none"
                />
                <input
                  value={documentForm.issueDate}
                  onChange={e => setDocumentForm(form => ({ ...form, issueDate: e.target.value }))}
                  type="date"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-white outline-none"
                />
                <input
                  value={documentForm.expiryDate}
                  onChange={e => setDocumentForm(form => ({ ...form, expiryDate: e.target.value }))}
                  type="date"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-white outline-none"
                />
                <button
                  onClick={uploadDocument}
                  disabled={uploadingDocument || !documentForm.documentType || !documentForm.documentName || !documentForm.documentUrl}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 transition hover:bg-amber-300 disabled:opacity-50"
                >
                  {uploadingDocument ? 'Uploading...' : 'Upload'}
                </button>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {documents.slice(0, 6).map(doc => (
                  <a key={doc.id} href={doc.documentUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-slate-900 p-3 transition hover:border-amber-300/40">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-bold text-white">{doc.documentName}</p>
                      <Pill status={doc.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{doc.documentType.replace(/_/g, ' ')} - Expires {dateTime(doc.expiryDate)}</p>
                  </a>
                ))}
                {documents.length === 0 && (
                  <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400">No compliance documents uploaded yet.</p>
                )}
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-4 backdrop-blur">
              <h2 className="text-lg font-bold">Carrier Fleet</h2>
              <p className="text-xs text-slate-400">Verified and available trucks can be assigned after award.</p>
              <div className="mt-4 space-y-2">
                {vehicles.slice(0, 5).map(vehicle => (
                  <div key={vehicle.id} className="rounded-xl border border-white/10 bg-slate-900 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-sm font-black text-white">{vehicle.plateNo}</p>
                      <Pill status={vehicle.complianceStatus} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{vehicle.vehicleType} - {vehicle.availabilityStatus}</p>
                  </div>
                ))}
                {vehicles.length === 0 && (
                  <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400">No trucks visible for this carrier yet.</p>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { label: 'Open RFQs', value: openCount, icon: Clock, tone: 'from-amber-500 to-orange-600' },
            { label: 'Bids Submitted', value: submittedCount, icon: Send, tone: 'from-cyan-500 to-blue-600' },
            { label: 'Awarded Loads', value: awardedCount, icon: ShieldCheck, tone: 'from-emerald-500 to-teal-600' },
          ].map(card => {
            const Icon = card.icon;
            return (
              <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.tone} p-4 shadow-xl shadow-black/20`}>
                <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/15" />
                <div className="relative flex items-start justify-between">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/85">{card.label}</p>
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <p className="relative mt-5 text-4xl font-black">{card.value}</p>
              </div>
            );
          })}
        </section>

        <section className="grid gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-white/10 bg-slate-950/75 p-4 backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Invited RFQs</h2>
                <p className="text-xs text-slate-400">{filteredRfqs.length} visible to this carrier</p>
              </div>
              {rfqs[0]?.carrier && <Pill status="ACTIVE" label={rfqs[0].carrier.name} />}
            </div>
            <label className="relative mb-4 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search RFQ, route, customer..."
                className="w-full rounded-xl border border-white/10 bg-slate-900 py-2.5 pl-9 pr-3 text-sm font-semibold text-white placeholder-slate-500 outline-none transition focus:border-amber-300"
              />
            </label>
            <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-800" />
                ))
              ) : filteredRfqs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
                  No invited RFQs found for this carrier.
                </div>
              ) : filteredRfqs.map(rfq => {
                const active = selected?.id === rfq.id;
                return (
                  <button
                    key={rfq.id}
                    onClick={() => setSelectedId(rfq.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      active
                        ? 'border-amber-300 bg-amber-400/10'
                        : 'border-white/10 bg-slate-900/70 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-black text-white">{rfq.rfqNo ?? rfq.id.slice(0, 8)}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-200">{rfq.shipment.shipmentNo ?? 'Shipment'} - {rfq.shipment.cargoOwnerName ?? 'Customer'}</p>
                      </div>
                      <Pill status={rfq.carrierBid?.status ?? rfq.status} label={rfq.carrierBid ? 'Bid sent' : rfq.status} />
                    </div>
                    <p className="mt-2 line-clamp-1 text-xs text-slate-400">{routeLabel(rfq)}</p>
                    <p className="mt-2 text-xs text-slate-500">Deadline: {dateTime(rfq.bidDeadlineAt)}</p>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="rounded-3xl border border-white/10 bg-slate-950/75 backdrop-blur">
            {!selected ? (
              <div className="flex min-h-[520px] items-center justify-center p-8 text-center text-slate-400">
                Select an RFQ to review shipment details and submit a bid.
              </div>
            ) : (
              <div className="space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill status={selected.status} />
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                        Round {selected.negotiationRound ?? 1}
                      </span>
                    </div>
                    <h2 className="mt-3 text-2xl font-black">{selected.rfqNo ?? selected.id.slice(0, 8)}</h2>
                    <p className="mt-1 text-sm text-slate-400">{routeLabel(selected)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-900 p-4 text-right">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Customer guide rate</p>
                    <p className="mt-1 text-xl font-black text-amber-200">
                      {currency(selected.shipment.customerRateAmount, selected.shipment.currency ?? 'AED')}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <Info label="Cargo owner" value={selected.shipment.cargoOwnerName ?? '-'} />
                  <Info label="Shipment type" value={selected.shipment.shipmentType ?? '-'} />
                  <Info label="Vehicle needed" value={selected.shipment.requestedVehicleType ?? '-'} />
                  <Info label="Pickup window" value={`${dateTime(selected.shipment.pickupWindowFrom)} - ${dateTime(selected.shipment.pickupWindowTo)}`} />
                  <Info label="Delivery window" value={`${dateTime(selected.shipment.deliveryWindowFrom)} - ${dateTime(selected.shipment.deliveryWindowTo)}`} />
                  <Info label="Weight" value={selected.shipment.totalWeightKg ? `${selected.shipment.totalWeightKg.toLocaleString()} kg` : '-'} />
                </div>

                {selected.carrierBid && (
                  <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-200">Your latest submitted bid</p>
                        <p className="mt-1 text-2xl font-black text-emerald-100">
                          {currency(selected.carrierBid.amount, selected.carrierBid.currency ?? 'AED')}
                        </p>
                      </div>
                      <Pill status={selected.carrierBid.status} />
                    </div>
                    <p className="mt-2 text-sm text-emerald-100/75">
                      Transit: {selected.carrierBid.transitTimeHours ?? '-'} hrs · Validity: {dateTime(selected.carrierBid.validityUntil)}
                    </p>
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">Submit Carrier Bid</h3>
                      <p className="text-sm text-slate-400">
                        {canSubmitBid
                          ? 'You can submit a revised bid while the RFQ is open.'
                          : 'Bid submission is disabled for this cargo owner.'}
                      </p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-amber-200" />
                  </div>
                  {!canSubmitBid && (
                    <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-100">
                      This RFQ is visible for coordination, but carrier bid entry is blocked by the customer marketplace policy.
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                    <input
                      value={bidForm.amount}
                      onChange={e => setBidForm(form => ({ ...form, amount: e.target.value }))}
                      type="number"
                      placeholder="Bid amount"
                      className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none transition focus:border-amber-300"
                    />
                    <input
                      value={bidForm.transitTimeHours}
                      onChange={e => setBidForm(form => ({ ...form, transitTimeHours: e.target.value }))}
                      type="number"
                      placeholder="Transit hours"
                      className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none transition focus:border-amber-300"
                    />
                    <input
                      value={bidForm.validityUntil}
                      onChange={e => setBidForm(form => ({ ...form, validityUntil: e.target.value }))}
                      type="datetime-local"
                      className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white outline-none transition focus:border-amber-300"
                    />
                    <button
                      onClick={submitBid}
                      disabled={saving || selected.status !== 'OPEN' || !bidForm.amount || !canSubmitBid}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Submit
                    </button>
                  </div>
                  <textarea
                    value={bidForm.notes}
                    onChange={e => setBidForm(form => ({ ...form, notes: e.target.value }))}
                    placeholder="Notes, inclusions, exclusions, equipment constraints..."
                    className="mt-3 min-h-24 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none transition focus:border-amber-300"
                  />
                </div>

                {timeline && (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">Shipment Timeline</h3>
                        <p className="text-sm text-slate-400">Award, execution, POD, and visibility updates for this RFQ.</p>
                      </div>
                      <Pill status={timeline.pods.length ? 'POD_SUBMITTED' : selected.shipment.status} label={`${timeline.events.length} events`} />
                    </div>
                    <div className="space-y-2">
                      {timeline.events.slice(0, 5).map(event => (
                        <div key={event.id} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-bold text-white">{event.type.replace(/_/g, ' ')}</p>
                            <span className="text-[11px] font-semibold text-slate-500">{dateTime(event.occurredAt)}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{event.notes ?? event.status ?? '-'}</p>
                        </div>
                      ))}
                      {timeline.events.length === 0 && (
                        <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400">No execution events yet.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-bold leading-6 text-white">{value}</p>
    </div>
  );
}
