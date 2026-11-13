'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Download,
  FileSignature,
  Fuel,
  Gauge,
  PenTool,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  canBookRacPortal,
  canFinanceRacPortal,
  useRacPortalSession,
} from '../rac-portal-shell';

interface ExtensionItem {
  id: string;
  renewalNo: string;
  originalEndDate: string;
  newEndDate: string;
  extensionDays: number;
  totalAmount: number;
  status: string;
  reason: string | null;
}

interface AgreementItem {
  id: string;
  agreementNo: string;
  bookingRef: string | null;
  startDate: string;
  endDate: string;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  dailyRate: number;
  totalAmount: number;
  currency: string;
  securityDeposit: number;
  depositStatus: string;
  status: string;
  signedByCustomer: boolean;
  signedAt: string | null;
  signedBy: string | null;
  fuelOutDisplay?: string | null;
  fuelInDisplay?: string | null;
  odometerOutKm?: number | null;
  odometerInKm?: number | null;
  distanceDrivenKm?: number | null;
  vehicle: {
    id: string;
    make: string;
    model: string;
    category: string;
    plateNumber: string;
  } | null;
  preauth: {
    authorizationCode: string | null;
    amount: number;
    status: string;
    cardBrand: string;
    cardLast4: string;
  } | null;
  extensions: ExtensionItem[];
}

function toLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function RacAgreementsContent() {
  const { me, user } = useRacPortalSession();
  const canExtend = canBookRacPortal(user?.role);
  const canSign = canFinanceRacPortal(user?.role);

  const searchParams = useSearchParams() ?? new URLSearchParams();
  const autoExtendId = searchParams.get('extend');

  const [agreements, setAgreements] = useState<AgreementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Extension modal state
  const [extendTarget, setExtendTarget] = useState<AgreementItem | null>(null);
  const [newEndDate, setNewEndDate] = useState('');
  const [extendReason, setExtendReason] = useState('Corporate project extension');
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);

  // Digital E-Sign modal state
  const [signTarget, setSignTarget] = useState<AgreementItem | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('Authorized Corporate Representative');
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const openExtendModal = useCallback((ag: AgreementItem) => {
    const currentEnd = new Date(ag.endDate);
    const baseMs = Number.isNaN(currentEnd.getTime()) ? Date.now() : currentEnd.getTime();
    const nextDate = new Date(baseMs + 3 * 86_400_000);
    setExtendTarget(ag);
    setNewEndDate(toLocalDateTimeInput(nextDate));
    setExtendError(null);
  }, []);

  const loadAgreements = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/rac-portal/agreements', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error ?? 'Failed to load corporate rental agreements.');
        return;
      }
      const list = (data?.agreements ?? []) as AgreementItem[];
      setAgreements(list);
      if (autoExtendId && canExtend) {
        const found = list.find((a) => a.id === autoExtendId);
        if (found && ['ACTIVE', 'DRAFT', 'CONFIRMED'].includes(found.status)) {
          openExtendModal(found);
        }
      }
    } catch {
      setLoadError('Network error while loading corporate rental agreements.');
    } finally {
      setLoading(false);
    }
  }, [autoExtendId, canExtend, openExtendModal]);

  useEffect(() => {
    void loadAgreements();
  }, [loadAgreements]);

  const openSignModal = (ag: AgreementItem) => {
    setSignTarget(ag);
    setSignerName(me?.user.fullName ?? me?.customer.fullName ?? '');
    setSignError(null);
    setHasDrawn(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    drawingRef.current = true;
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
    setHasDrawn(true);
  };

  const endDraw = () => {
    drawingRef.current = false;
  };

  const submitExtension = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendTarget) return;

    const parsedEnd = new Date(newEndDate);
    if (!newEndDate || Number.isNaN(parsedEnd.getTime())) {
      setExtendError('Please select a valid new return date and time.');
      return;
    }

    const currentEnd = new Date(extendTarget.endDate);
    if (!Number.isNaN(currentEnd.getTime()) && parsedEnd.getTime() <= currentEnd.getTime()) {
      setExtendError('Requested return date must be after the current agreement return date.');
      return;
    }

    setExtendBusy(true);
    setExtendError(null);
    try {
      const res = await fetch(`/api/rac-portal/agreements/${extendTarget.id}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newEndDate: parsedEnd.toISOString(),
          reason: extendReason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExtendError(data?.error ?? 'Failed to submit extension request.');
        return;
      }
      setBanner(
        `Extension request ${data.extension?.renewalNo ?? ''} submitted for RAC Manager approval (AED ${Number(data.extension?.totalAmount ?? 0).toFixed(2)} incl. VAT).`,
      );
      setExtendTarget(null);
      await loadAgreements();
    } catch {
      setExtendError('Network error while submitting extension request.');
    } finally {
      setExtendBusy(false);
    }
  };

  const submitSignature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signTarget) return;
    setSignBusy(true);
    setSignError(null);
    try {
      const dataUrl =
        hasDrawn && canvasRef.current ? canvasRef.current.toDataURL('image/png') : undefined;
      const res = await fetch(`/api/rac-portal/agreements/${signTarget.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim(),
          signatureDataUrl: dataUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSignError(data?.error ?? 'Failed to record corporate e-signature.');
        return;
      }
      setBanner(
        `Agreement ${signTarget.agreementNo} digitally signed (${data.agreement?.signatureRef ?? 'Verified'}).`,
      );
      setSignTarget(null);
      await loadAgreements();
    } catch {
      setSignError('Network error while recording corporate e-signature.');
    } finally {
      setSignBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <FileSignature className="w-6 h-6 text-emerald-400" />
          Corporate Rental Agreements
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Execute corporate digital e-signatures, download official contracts, inspect fuel &amp; odometer telemetry, and request extensions.
        </p>
      </div>

      {banner && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-emerald-200 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            {banner}
          </span>
          <button type="button" onClick={() => setBanner(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadError && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 text-rose-200 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            {loadError}
          </span>
          <button
            type="button"
            onClick={() => void loadAgreements()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 font-bold shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-12 text-center text-xs text-slate-500">
          Loading corporate agreements…
        </div>
      ) : agreements.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-12 text-center space-y-2">
          <p className="text-sm font-semibold text-slate-300">No rental agreements on record yet</p>
          <p className="text-xs text-slate-500">
            Agreements appear here once a confirmed corporate reservation is handed over at the branch counter.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {agreements.map((ag) => (
            <div
              key={ag.id}
              className="rounded-2xl border border-white/10 bg-slate-900/85 p-5 space-y-4"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-sm font-bold text-cyan-300">
                      {ag.agreementNo}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                        ag.status === 'ACTIVE'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-700/50 text-slate-300 border-white/10'
                      }`}
                    >
                      {ag.status}
                    </span>
                    {ag.signedByCustomer ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-semibold text-emerald-300">
                        <CheckCircle2 className="w-3 h-3" /> E-Signed ({ag.signedBy})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-[10px] font-semibold text-amber-300">
                        Corporate E-Signature Pending
                      </span>
                    )}
                  </div>

                  <p className="text-base font-bold text-white">
                    {ag.vehicle
                      ? `${ag.vehicle.make} ${ag.vehicle.model} · Plate ${ag.vehicle.plateNumber}`
                      : 'Corporate Fleet Vehicle'}
                  </p>
                  <p className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    {new Date(ag.startDate).toLocaleDateString('en-GB')} →{' '}
                    {new Date(ag.endDate).toLocaleDateString('en-GB')} · Daily Rate:{' '}
                    {ag.currency} {ag.dailyRate.toLocaleString('en-AE')} · Total:{' '}
                    <strong className="text-white">
                      {ag.currency} {ag.totalAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                    </strong>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {ag.preauth && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-white/10 text-xs text-slate-300">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Hold {ag.preauth.authorizationCode} · AED {ag.preauth.amount.toLocaleString('en-AE')}
                    </span>
                  )}

                  <div className="inline-flex items-center rounded-xl bg-slate-950 border border-white/10 overflow-hidden">
                    <a
                      href={`/api/rac-portal/agreements/${encodeURIComponent(ag.id)}/pdf?lang=en&download=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition-colors"
                      title="Download English Rental Agreement PDF"
                    >
                      <Download className="w-3.5 h-3.5 text-cyan-400" />
                      PDF (EN)
                    </a>
                    <a
                      href={`/api/rac-portal/agreements/${encodeURIComponent(ag.id)}/pdf?lang=ar&download=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 border-l border-white/10 transition-colors"
                      title="Download Arabic Rental Agreement PDF"
                    >
                      AR
                    </a>
                  </div>

                  {!ag.signedByCustomer && canSign && (
                    <button
                      type="button"
                      onClick={() => openSignModal(ag)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold transition-colors"
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Digital E-Sign
                    </button>
                  )}

                  {canExtend && ['ACTIVE', 'DRAFT', 'CONFIRMED'].includes(ag.status) && (
                    <button
                      type="button"
                      onClick={() => openExtendModal(ag)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-bold transition-colors"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      Request Extension
                    </button>
                  )}
                </div>
              </div>

              {/* Handover & Return Fuel / Odometer Telemetry */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 pt-3 border-t border-white/10 text-xs">
                <div className="rounded-xl bg-slate-950/70 border border-white/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Fuel className="w-3 h-3 text-cyan-400" /> Fuel Out
                  </div>
                  <div className="font-mono font-semibold text-slate-200 mt-0.5">
                    {ag.fuelOutDisplay || '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-950/70 border border-white/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Fuel className="w-3 h-3 text-emerald-400" /> Fuel In
                  </div>
                  <div className="font-mono font-semibold text-slate-200 mt-0.5">
                    {ag.fuelInDisplay || '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-950/70 border border-white/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Gauge className="w-3 h-3 text-cyan-400" /> Odometer Out
                  </div>
                  <div className="font-mono font-semibold text-slate-200 mt-0.5">
                    {ag.odometerOutKm != null ? `${ag.odometerOutKm.toLocaleString('en-AE')} km` : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-950/70 border border-white/5 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Gauge className="w-3 h-3 text-emerald-400" /> Odometer In
                  </div>
                  <div className="font-mono font-semibold text-slate-200 mt-0.5">
                    {ag.odometerInKm != null ? `${ag.odometerInKm.toLocaleString('en-AE')} km` : '—'}
                  </div>
                </div>
                {ag.distanceDrivenKm != null && (
                  <div className="rounded-xl bg-slate-950/70 border border-white/5 px-3 py-2 col-span-2 sm:col-span-4 lg:col-span-1">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      Distance Driven
                    </div>
                    <div className="font-mono font-bold text-cyan-300 mt-0.5">
                      {ag.distanceDrivenKm.toLocaleString('en-AE')} km
                    </div>
                  </div>
                )}
              </div>

              {ag.extensions.length > 0 && (
                <div className="pt-3 border-t border-white/10 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Extension Requests ({ag.extensions.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {ag.extensions.map((ext) => (
                      <div
                        key={ext.id}
                        className="rounded-xl bg-slate-950/70 border border-white/5 px-3 py-2 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-mono text-cyan-300 font-semibold">
                            {ext.renewalNo}
                          </span>{' '}
                          <span className="text-slate-400">
                            (+{ext.extensionDays}d → {new Date(ext.newEndDate).toLocaleDateString('en-GB')})
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            ext.status === 'APPROVED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : ext.status === 'REJECTED'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {ext.status} · AED {ext.totalAmount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─────────────────── EXTENSION MODAL ─────────────────── */}
      {extendTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={submitExtension}
            className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Extend Agreement {extendTarget.agreementNo}
              </h3>
              <button
                type="button"
                onClick={() => setExtendTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Current return date:{' '}
              <strong className="text-white">
                {new Date(extendTarget.endDate).toLocaleString('en-AE')}
              </strong>
              . Extension rates are calculated automatically from your contracted Master Price List (+5% UAE VAT) and checked for physical vehicle conflicts.
            </p>

            {extendError && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{extendError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Requested New Return Date &amp; Time
              </label>
              <input
                type="datetime-local"
                required
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Business Reason / Cost Center Note
              </label>
              <input
                type="text"
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setExtendTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={extendBusy}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {extendBusy ? 'Checking Availability…' : 'Submit Extension Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─────────────────── DIGITAL E-SIGN MODAL ─────────────────── */}
      {signTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={submitSignature}
            className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <PenTool className="w-4 h-4 text-amber-400" />
                Corporate Digital E-Signature · {signTarget.agreementNo}
              </h3>
              <button
                type="button"
                onClick={() => setSignTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {signError && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-rose-300 text-xs">
                {signError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Authorized Signatory Name
                </label>
                <input
                  type="text"
                  required
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Corporate Title
                </label>
                <input
                  type="text"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Draw Signature Below (or sign via typed name above)
                </label>
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="text-[11px] text-cyan-400 hover:underline"
                >
                  Clear Pad
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={440}
                height={130}
                onPointerDown={startDraw}
                onPointerMove={moveDraw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
                className="w-full h-32 rounded-xl bg-slate-950 border border-white/15 cursor-crosshair touch-none"
              />
            </div>

            <p className="text-[11px] text-slate-400">
              By signing electronically, you confirm acceptance of the UAE Master Corporate Rental Terms &amp; Conditions on behalf of{' '}
              <strong className="text-slate-200">
                {me?.customer.companyName ?? me?.customer.fullName}
              </strong>
              .
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSignTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={signBusy || !signerName.trim()}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {signBusy ? 'Recording E-Signature…' : 'Execute Corporate E-Signature'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function RacPortalAgreementsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Loading…</div>}>
      <RacAgreementsContent />
    </Suspense>
  );
}
