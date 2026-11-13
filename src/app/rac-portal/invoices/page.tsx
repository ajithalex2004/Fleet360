'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Download,
  Lock,
  Receipt,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { canFinanceRacPortal, useRacPortalSession } from '../rac-portal-shell';

interface InvoiceItem {
  id: string;
  invoiceNo: string;
  agreementId: string | null;
  agreementNo: string | null;
  invoiceType: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: string;
}

interface PreAuthItem {
  id: string;
  bookingId: string | null;
  agreementId: string | null;
  invoiceId: string | null;
  amount: number;
  capturedAmount: number;
  currency: string;
  authorizationCode: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cardholderName: string | null;
  status: string;
  expiresAt: string | null;
  capturedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
}

function tokenizeCardClient(rawPan: string): {
  cardToken: string;
  cardLast4: string;
  cardBrand: string;
} {
  const digits = rawPan.replace(/\D/g, '');
  const cardLast4 = digits.slice(-4).padStart(4, '0');
  const cardBrand = digits.startsWith('4')
    ? 'VISA'
    : /^5[1-5]/.test(digits)
      ? 'MASTERCARD'
      : /^3[47]/.test(digits)
        ? 'AMEX'
        : 'VISA';
  const rand = Math.random().toString(36).slice(2, 12);
  return { cardToken: `tok_inv_${rand}`, cardLast4, cardBrand };
}

function getHoldRemaining(hold: PreAuthItem): number {
  return Math.max(0, Number(hold.amount ?? 0) - Number(hold.capturedAmount ?? 0));
}

function getEligibleHoldsForInvoice(
  inv: InvoiceItem | null,
  holds: PreAuthItem[],
): PreAuthItem[] {
  if (!inv) return [];
  const nowMs = Date.now();
  return holds.filter((p) => {
    if (p.status !== 'AUTHORIZED') return false;
    if (p.expiresAt) {
      const expMs = new Date(p.expiresAt).getTime();
      if (!Number.isNaN(expMs) && expMs <= nowMs) return false;
    }
    if ((p.agreementId && p.agreementId !== inv.agreementId) || (p.bookingId && !p.agreementId)) {
      return false;
    }
    return getHoldRemaining(p) > 0.009;
  });
}

function RacInvoicesContent() {
  const { me, user, refreshMe } = useRacPortalSession();
  const canPayRole = canFinanceRacPortal(user?.role);

  const searchParams = useSearchParams() ?? new URLSearchParams();
  const initialTab = searchParams.get('tab') === 'holds' ? 'holds' : 'invoices';

  const [tab, setTab] = useState<'invoices' | 'holds'>(initialTab);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [preauths, setPreauths] = useState<PreAuthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Pay Online Modal State
  const [payTarget, setPayTarget] = useState<InvoiceItem | null>(null);
  const [payMode, setPayMode] = useState<'card' | 'hold'>('card');
  const [selectedPreauthId, setSelectedPreauthId] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumberInput, setCardNumberInput] = useState('');
  const [expiryMonth, setExpiryMonth] = useState(12);
  const [expiryYear, setExpiryYear] = useState(() => new Date().getFullYear() + 2);
  const [cvvInput, setCvvInput] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/rac-portal/invoices', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error ?? 'Failed to load corporate invoices and card holds.');
        return;
      }
      setInvoices(data?.invoices ?? []);
      setPreauths(data?.preauths ?? []);
    } catch {
      setLoadError('Network error while loading corporate financial ledger.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const eligibleHoldsForTarget = useMemo(
    () => getEligibleHoldsForInvoice(payTarget, preauths),
    [payTarget, preauths],
  );

  const selectedHold = useMemo(
    () => eligibleHoldsForTarget.find((h) => h.id === selectedPreauthId) ?? null,
    [eligibleHoldsForTarget, selectedPreauthId],
  );

  const openPayModal = (inv: InvoiceItem) => {
    setPayTarget(inv);
    setPayError(null);
    setCardholderName(me?.customer.companyName ?? me?.user.fullName ?? '');
    setCardNumberInput('');
    setCvvInput('');
    const eligible = getEligibleHoldsForInvoice(inv, preauths);
    if (eligible.length > 0) {
      setSelectedPreauthId(eligible[0].id);
      setPayMode('hold');
    } else {
      setSelectedPreauthId('');
      setPayMode('card');
    }
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setPayBusy(true);
    setPayError(null);

    try {
      let payload: Record<string, unknown>;
      if (payMode === 'hold') {
        if (!selectedPreauthId) {
          setPayError('Select an eligible AUTHORIZED pre-authorization hold.');
          setPayBusy(false);
          return;
        }
        payload = { preauthId: selectedPreauthId };
      } else {
        const digits = cardNumberInput.replace(/\D/g, '');
        if (digits.length < 13) {
          setPayError('Please enter a valid corporate card number.');
          setPayBusy(false);
          return;
        }
        if (cvvInput.replace(/\D/g, '').length < 3) {
          setPayError('Please enter a valid security code.');
          setPayBusy(false);
          return;
        }
        const { cardToken, cardLast4, cardBrand } = tokenizeCardClient(digits);
        setCardNumberInput(`•••• •••• •••• ${cardLast4}`);
        setCvvInput('');
        payload = {
          cardToken,
          cardLast4,
          cardBrand,
          cardholderName: cardholderName.trim(),
          expiryMonth: Number(expiryMonth),
          expiryYear: Number(expiryYear),
        };
      }

      const res = await fetch(`/api/rac-portal/invoices/${payTarget.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPayError(data?.error ?? 'Online payment declined.');
        return;
      }

      setBanner(
        `Payment receipt ${data.payment?.receiptNo ?? ''} recorded (${payTarget.currency} ${Number(data.payment?.amount ?? 0).toFixed(2)}) for invoice ${payTarget.invoiceNo}.`,
      );
      setPayTarget(null);
      await Promise.all([loadData(), refreshMe()]);
    } catch {
      setPayError('Network error while processing corporate payment.');
    } finally {
      setPayBusy(false);
    }
  };

  const selectedHoldRemaining = selectedHold ? getHoldRemaining(selectedHold) : 0;
  const captureNowAmount = payTarget
    ? Math.min(selectedHoldRemaining, payTarget.balanceDue)
    : 0;
  const remainingAfterHoldAmount = payTarget
    ? Math.max(0, payTarget.balanceDue - captureNowAmount)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-cyan-400" />
            Corporate Billing &amp; Card Pre-Auth Ledger
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Download UAE FTA tax invoices, settle balances online, and audit every AUTHORIZED, CAPTURED, and RELEASED card hold.
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-slate-900 border border-white/10 p-1">
          <button
            type="button"
            onClick={() => setTab('invoices')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              tab === 'invoices'
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Corporate Invoices ({invoices.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('holds')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              tab === 'holds'
                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Card Pre-Auth Ledger ({preauths.length})
          </button>
        </div>
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
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 font-bold shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-12 text-center text-xs text-slate-500">
          Loading corporate financial ledger…
        </div>
      ) : tab === 'invoices' ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/85 overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Receipt className="w-9 h-9 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">No corporate invoices issued yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/60 border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3.5">Invoice #</th>
                    <th className="px-4 py-3.5">Issued / Due</th>
                    <th className="px-4 py-3.5 text-right">Total (incl. VAT)</th>
                    <th className="px-4 py-3.5 text-right">Paid</th>
                    <th className="px-4 py-3.5 text-right">Balance Due</th>
                    <th className="px-4 py-3.5 text-center">Status</th>
                    <th className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {invoices.map((inv) => {
                    const canPay =
                      inv.balanceDue > 0 && !['VOID', 'CANCELLED', 'PAID'].includes(inv.status);
                    return (
                      <tr key={inv.id} className="hover:bg-slate-800/40">
                        <td className="px-4 py-3.5">
                          <div className="font-mono text-xs font-bold text-cyan-300">
                            {inv.invoiceNo}
                          </div>
                          {inv.agreementNo && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              {inv.agreementNo}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-300">
                          <div>Issued: {new Date(inv.invoiceDate).toLocaleDateString('en-GB')}</div>
                          <div className="text-slate-500">
                            Due: {new Date(inv.dueDate).toLocaleDateString('en-GB')}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-white">
                          {inv.currency} {inv.totalAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-emerald-300">
                          {inv.paidAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-rose-300">
                          {inv.balanceDue > 0
                            ? `${inv.currency} ${inv.balanceDue.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              inv.status === 'PAID'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : inv.status === 'OVERDUE'
                                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                  : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <div className="inline-flex items-center rounded-lg bg-slate-950 border border-white/10 overflow-hidden">
                              <a
                                href={`/api/rac-portal/invoices/${encodeURIComponent(inv.id)}/pdf?lang=en&download=1`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800 transition-colors"
                                title="Download English Tax Invoice PDF"
                              >
                                <Download className="w-3 h-3 text-cyan-400" />
                                PDF
                              </a>
                              <a
                                href={`/api/rac-portal/invoices/${encodeURIComponent(inv.id)}/pdf?lang=ar&download=1`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 border-l border-white/10 transition-colors"
                                title="Download Arabic Tax Invoice PDF"
                              >
                                AR
                              </a>
                            </div>

                            {canPay ? (
                              canPayRole ? (
                                <button
                                  type="button"
                                  onClick={() => openPayModal(inv)}
                                  className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 text-white text-xs font-bold shadow"
                                >
                                  Pay Online
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-500">Finance Only</span>
                              )
                            ) : (
                              <span className="text-xs text-slate-500">Settled</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Card Pre-Authorization Ledger */
        <div className="rounded-2xl border border-white/10 bg-slate-900/85 overflow-hidden">
          {preauths.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <ShieldCheck className="w-9 h-9 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">No card pre-authorization holds yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/60 border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3.5">Auth Code</th>
                    <th className="px-4 py-3.5">Card</th>
                    <th className="px-4 py-3.5 text-right">Hold Amount</th>
                    <th className="px-4 py-3.5 text-right">Captured</th>
                    <th className="px-4 py-3.5">Created / Expiry</th>
                    <th className="px-4 py-3.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {preauths.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3.5 font-mono text-xs font-bold text-amber-300">
                        {p.authorizationCode}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-200">
                        <div>
                          {p.cardBrand ?? 'CARD'} •••• {p.cardLast4 ?? '0000'}
                        </div>
                        {p.cardholderName && (
                          <div className="text-[11px] text-slate-500">{p.cardholderName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-white">
                        {p.currency} {p.amount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-emerald-300">
                        {p.capturedAmount > 0
                          ? `${p.currency} ${p.capturedAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-400">
                        <div>Placed: {new Date(p.createdAt).toLocaleDateString('en-GB')}</div>
                        {p.expiresAt && p.status === 'AUTHORIZED' && (
                          <div className="text-amber-300/80">
                            Expires: {new Date(p.expiresAt).toLocaleDateString('en-GB')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            p.status === 'AUTHORIZED'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : p.status === 'CAPTURED'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-700 text-slate-300 border-white/10'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────── PAY ONLINE MODAL ─────────────────── */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handlePaySubmit}
            className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-cyan-400" />
                Pay Invoice {payTarget.invoiceNo}
              </h3>
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-950 border border-white/10 p-3.5 flex items-center justify-between text-xs">
              <span className="text-slate-400">Balance Due:</span>
              <span className="text-lg font-black text-cyan-300 font-mono">
                {payTarget.currency}{' '}
                {payTarget.balanceDue.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
              </span>
            </div>

            {eligibleHoldsForTarget.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayMode('hold')}
                  className={`py-2 rounded-xl text-xs font-bold border ${
                    payMode === 'hold'
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                      : 'bg-slate-800 border-white/10 text-slate-400'
                  }`}
                >
                  Capture Existing Hold
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode('card')}
                  className={`py-2 rounded-xl text-xs font-bold border ${
                    payMode === 'card'
                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                      : 'bg-slate-800 border-white/10 text-slate-400'
                  }`}
                >
                  Pay with Corporate Card
                </button>
              </div>
            )}

            {payError && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{payError}</span>
              </div>
            )}

            {payMode === 'hold' ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Select Eligible AUTHORIZED Pre-Auth Hold
                  </label>
                  <select
                    value={selectedPreauthId}
                    onChange={(e) => setSelectedPreauthId(e.target.value)}
                    className="w-full rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white"
                  >
                    {eligibleHoldsForTarget.map((h) => {
                      const avail = getHoldRemaining(h);
                      return (
                        <option key={h.id} value={h.id}>
                          {h.authorizationCode} · {h.cardBrand} **** {h.cardLast4} (Avail:{' '}
                          {h.currency} {avail.toFixed(2)})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {selectedHold && selectedHoldRemaining < payTarget.balanceDue - 0.009 && (
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-200 text-xs space-y-1">
                    <p className="font-bold text-amber-300">Partial Hold Capture Notice</p>
                    <p>
                      Amount captured now:{' '}
                      <strong className="font-mono text-white">
                        {payTarget.currency} {captureNowAmount.toFixed(2)}
                      </strong>{' '}
                      — Remaining due:{' '}
                      <strong className="font-mono text-amber-200">
                        {payTarget.currency} {remainingAfterHoldAmount.toFixed(2)}
                      </strong>
                      .
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Cardholder Name
                  </label>
                  <input
                    type="text"
                    required
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Card Number (Tokenized Locally)
                  </label>
                  <input
                    type="text"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    value={cardNumberInput}
                    onChange={(e) => setCardNumberInput(e.target.value)}
                    placeholder="4242 •••• •••• 4242"
                    className="w-full rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm font-mono text-white"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={expiryMonth}
                    onChange={(e) => setExpiryMonth(Number(e.target.value))}
                    className="rounded-xl bg-slate-800 border border-white/10 px-2.5 py-2 text-sm text-white"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {String(m).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={expiryYear}
                    onChange={(e) => setExpiryYear(Number(e.target.value))}
                    className="rounded-xl bg-slate-800 border border-white/10 px-2.5 py-2 text-sm text-white"
                  >
                    {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + i).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <input
                    type="password"
                    required
                    maxLength={4}
                    value={cvvInput}
                    onChange={(e) => setCvvInput(e.target.value)}
                    placeholder="CVV"
                    className="rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm font-mono text-white"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={payBusy}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {payBusy ? 'Processing…' : 'Confirm Online Payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function RacPortalInvoicesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Loading…</div>}>
      <RacInvoicesContent />
    </Suspense>
  );
}
