'use client';
import React, { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ShieldAlert,
  CornerDownLeft,
  RefreshCw,
  CheckCircle2,
  Receipt,
  Send,
  Copy,
  Check,
  AlertTriangle,
  X,
  ArrowLeftRight,
  ShieldCheck,
  Lock,
  Loader,
} from 'lucide-react';
import SlideOverDrawer from '@/components/ui/SlideOverDrawer';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import { formatCanonicalFuelDisplay, resolveStoredFuelPct } from '@/lib/rental/fuel-odometer';
import { formatRentalCategoryLabel } from '@/lib/rental/categories';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Agreement {
  id: string;
  agreementNo: string | null;
  customerName?: string | null;
  status: string | null;
  startDate: string;
  endDate: string;
  dailyRate: number | null;
  totalAmount: number | null;
  securityDeposit: number | null;
  depositStatus: string | null;
  currency: string | null;
  mileageIn: number | null;
  mileageOut: number | null;
  fuelIn: number | string | null;
  fuelOut: number | string | null;
  pickupFuelLevel?: number | null;
  returnFuelLevel?: number | null;
  signedAt: string | null;
  signedBy: string | null;
  isCorporate: boolean | null;
  insurancePlanCode: string | null;
  createdAt: string | null;
  vehicleId?: string | null;
  vehicle?: {
    id: string;
    plateNumber: string | null;
    make: string | null;
    model: string | null;
    status: string | null;
  } | null;
  exchangeCount?: number;
  regulatoryReport?: {
    authority: string;
    eventType: string;
    status: string;
    externalRef: string | null;
    submittedAt?: string | null;
  } | null;
  booking: {
    id: string;
    bookingRef: string | null;
    pickupDate: string;
    dropoffDate: string;
    pickupLocation: string | null;
    dropoffLocation: string | null;
    vehicleCategory: string | null;
    customer: {
      id: string;
      fullName: string;
      phone: string | null;
      email?: string | null;
      companyName?: string | null;
    } | null;
    inspections: Array<{ id: string; type: string; mileage: number | null }>;
  } | null;
  payments?: Array<{ id: string; amount: number; status: string; paymentDate: string }>;
  extensions: Array<{ id: string; extendedTo: string; dailyRate: number | null; status: string }>;
  charges?: Array<{ id: string; description: string; amount: number; status: string }>;
}

interface AgreementSummaryCounts {
  ALL: number;
  DRAFT: number;
  ACTIVE: number;
  COMPLETED: number;
  CANCELLED: number;
  activeRevenue: number;
  pendingDeposits: number;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  DRAFT:     { label: 'Draft',     icon: '📝', color: 'text-[var(--text-muted)]', bg: 'bg-slate-500/10 border-slate-500/20',   badge: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30' },
  ACTIVE:    { label: 'Active',    icon: '🟢', color: 'text-emerald-400',         bg: 'bg-emerald-500/10 border-emerald-500/20', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  COMPLETED: { label: 'Completed', icon: '✅', color: 'text-teal-400',            bg: 'bg-teal-500/10 border-teal-500/20',     badge: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  CANCELLED: { label: 'Cancelled', icon: '❌', color: 'text-red-400',             bg: 'bg-red-500/10 border-red-500/20',       badge: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const DEPOSIT_STATUS = {
  PENDING:          'bg-amber-500/20 text-amber-400 border-amber-500/30',
  PAID:             'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REFUND_REQUESTED: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  REFUNDED:         'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmt(val: number | null, currency = 'AED') {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return `${currency} ${Number(val).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rentalDays(start: string, end: string) {
  const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24));
  return d > 0 ? d : 1;
}

function resolveAgreementCustomerName(a: Agreement): string {
  return (
    a.customerName?.trim() ||
    a.booking?.customer?.companyName?.trim() ||
    a.booking?.customer?.fullName?.trim() ||
    '—'
  );
}

// ── OTP E-Sign Modal ──────────────────────────────────────────────────────────

function ESignModal({
  agreement,
  onClose,
  onSent,
  onRbacForbidden,
}: {
  agreement: Agreement;
  onClose: () => void;
  onSent: (notice: string) => void;
  onRbacForbidden: (msg: string) => void;
}) {
  const cust = agreement.booking?.customer;
  const [signerName, setSignerName] = useState(
    cust?.fullName || cust?.companyName || agreement.customerName || ''
  );
  const [signerPhone, setSignerPhone] = useState(cust?.phone ?? '');
  const [signerEmail, setSignerEmail] = useState(cust?.email ?? '');
  const [sentVia, setSentVia] = useState<'EMAIL' | 'SMS' | 'WHATSAPP' | 'LINK'>('EMAIL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signUrl, setSignUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signerName.trim()) {
      setError('Signer name is required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const ref = agreement.agreementNo ?? agreement.id.slice(0, 8);
      const res = await fetch('/api/esign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractType: 'RENTAL_AGREEMENT',
          contractId: agreement.id,
          contractRef: ref,
          documentTitle: `Rental Agreement ${ref}`,
          signerName: signerName.trim(),
          signerPhone: signerPhone.trim() || undefined,
          signerEmail: signerEmail.trim() || undefined,
          sentVia,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = data.error ?? 'Requires RAC permission to send OTP E-Sign invitations.';
        onRbacForbidden(msg);
        setError(msg);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Failed to send E-Sign request (HTTP ${res.status})`);
      }

      const rawUrl =
        data.signUrl ??
        data.signingUrl ??
        data.url ??
        (data.token
          ? `${typeof window !== 'undefined' ? window.location.origin : ''}/sign/${data.token}`
          : data.request?.token
            ? `${typeof window !== 'undefined' ? window.location.origin : ''}/sign/${data.request.token}`
            : '');
      const fullUrl =
        rawUrl && rawUrl.startsWith('/') && typeof window !== 'undefined'
          ? `${window.location.origin}${rawUrl}`
          : String(rawUrl || '');
      setSignUrl(fullUrl);
      onSent(`OTP E-Sign link generated for ${ref}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP E-Sign');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!signUrl) return;
    try {
      await navigator.clipboard.writeText(signUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="border-b border-[var(--border-subtle)] px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-[var(--text-main)] flex items-center gap-2">
            <Send className="w-4 h-4 text-blue-400" />
            Send OTP E-Sign — {agreement.agreementNo ?? agreement.id.slice(0, 8)}
          </h2>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-main)]">
            ✕
          </button>
        </div>

        <form onSubmit={handleSend} className="p-5 space-y-4">
          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          {signUrl ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 text-xs text-emerald-200 space-y-2">
                <p className="font-semibold text-emerald-300">
                  ✅ OTP E-Sign Invitation Created
                </p>
                <p className="text-[var(--text-muted)]">
                  Share this signing link with {signerName} to complete OTP verification and digital signature:
                </p>
                <div className="flex items-center gap-2 bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg p-2">
                  <input
                    type="text"
                    readOnly
                    value={signUrl}
                    className="flex-1 bg-transparent text-xs font-mono text-cyan-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={copyLink}
                    className="px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-[var(--bg-surface-hover)] text-[var(--text-main)] text-xs font-semibold"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Signer Full Name *</label>
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  required
                  placeholder="Customer full name"
                  className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-blue-500/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Mobile Phone</label>
                  <input
                    value={signerPhone}
                    onChange={(e) => setSignerPhone(e.target.value)}
                    placeholder="+971 50 000 0000"
                    className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500/40"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Email</label>
                  <input
                    type="email"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                    placeholder="customer@example.com"
                    className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500/40"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Delivery Channel</label>
                <select
                  value={sentVia}
                  onChange={(e) => setSentVia(e.target.value as typeof sentVia)}
                  className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500/40"
                >
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS OTP</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="LINK">Direct Link Only</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {busy ? 'Generating Signing Link…' : 'Send OTP E-Sign'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

// ── Status transition modal ───────────────────────────────────────────────────

function TransitionModal({
  agreement,
  onClose,
  onDone,
  onRbacForbidden,
}: {
  agreement: Agreement;
  onClose: () => void;
  onDone: (notice?: string) => void;
  onRbacForbidden: (msg: string) => void;
}) {
  const status = agreement.status ?? 'DRAFT';
  const defaultAction =
    status === 'DRAFT'
      ? 'activate'
      : status === 'ACTIVE'
        ? 'complete'
        : agreement.depositStatus === 'PAID'
          ? 'refund_deposit'
          : 'cancel';

  const [action, setAction] = useState<'activate' | 'sign' | 'complete' | 'cancel' | 'refund_deposit'>(
    defaultAction
  );
  const [signedBy, setSignedBy] = useState('');
  const initialFuelOutPct = resolveStoredFuelPct(agreement.pickupFuelLevel, agreement.fuelOut);
  const initialFuelInPct = resolveStoredFuelPct(agreement.returnFuelLevel, agreement.fuelIn);
  const [mileageOut, setMileageOut] = useState(String(agreement.mileageOut ?? ''));
  const [fuelOut, setFuelOut] = useState(initialFuelOutPct != null ? String(initialFuelOutPct) : '');
  const [mileageIn, setMileageIn] = useState(
    String(agreement.mileageIn ?? agreement.mileageOut ?? '')
  );
  const [fuelIn, setFuelIn] = useState(
    initialFuelInPct != null
      ? String(initialFuelInPct)
      : initialFuelOutPct != null
        ? String(initialFuelOutPct)
        : '100'
  );
  const [refundAmount, setRefundAmount] = useState(String(agreement.securityDeposit ?? ''));
  const [refundMethod, setRefundMethod] = useState('BANK_TRANSFER');
  const [refundRef, setRefundRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [forbiddenMsg, setForbiddenMsg] = useState('');

  const actions: Array<{ key: typeof action; label: string; show: boolean; color: string }> = [
    { key: 'activate'       as const, label: '🟢 Activate Agreement (Pick-Up Out)', show: status === 'DRAFT',  color: 'bg-emerald-600 hover:bg-emerald-500' },
    { key: 'sign'           as const, label: '✍️ Mark as Signed',                    show: status === 'DRAFT',  color: 'bg-blue-600 hover:bg-blue-500' },
    { key: 'complete'       as const, label: '✅ Complete & Return (Check-In)',     show: status === 'ACTIVE', color: 'bg-teal-600 hover:bg-teal-500' },
    { key: 'refund_deposit' as const, label: '💰 Refund Security Deposit',          show: agreement.depositStatus === 'PAID', color: 'bg-violet-600 hover:bg-violet-500' },
    { key: 'cancel'         as const, label: '❌ Cancel Agreement',                  show: status === 'DRAFT',  color: 'bg-red-700 hover:bg-red-600' },
  ].filter(a => a.show);

  const handle = async () => {
    setSaving(true);
    setError('');
    setForbiddenMsg('');
    try {
      // Complete & Return MUST call POST /api/rental/agreements/${id}/close
      // so vehicle status/mileage/fuel, late/km/fuel fees, unbilled fines/tolls,
      // closing RINV- Tax Invoice, and GL entries are all executed atomically!
      if (action === 'complete') {
        const closeBody: Record<string, unknown> = {
          returnFuelUnit: 'PCT',
        };
        if (mileageIn !== '') {
          const parsedOdo = Number(mileageIn);
          if (!Number.isFinite(parsedOdo) || parsedOdo < 0) {
            throw new Error('Please enter a valid non-negative return odometer reading.');
          }
          closeBody.returnOdometer = Math.round(parsedOdo);
        }
        if (fuelIn !== '') {
          const parsedFuel = Number(fuelIn);
          if (!Number.isFinite(parsedFuel) || parsedFuel < 0 || parsedFuel > 100) {
            throw new Error('Return fuel level must be between 0 and 100%.');
          }
          closeBody.returnFuelLevel = Math.round(parsedFuel);
        }

        const res = await fetch(`/api/rental/agreements/${agreement.id}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(closeBody),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
          const msg =
            data.error ?? 'Requires RAC Counter Operator or Manager permission to close agreements.';
          setForbiddenMsg(msg);
          onRbacForbidden(msg);
          setSaving(false);
          return;
        }
        if (!res.ok) {
          throw new Error(data.error ?? `Failed to complete & close agreement (HTTP ${res.status})`);
        }
        const invNo =
          data.invoice?.invoiceNo ??
          data.invoice?.invoice_no ??
          data.invoiceNo ??
          data.invoiceNumber;
        onDone(
          invNo
            ? `Agreement ${agreement.agreementNo ?? ''} closed & returned. Closing Tax Invoice ${invNo} generated.`
            : `Agreement ${agreement.agreementNo ?? ''} completed & returned.`
        );
        return;
      }

      if (action === 'refund_deposit') {
        const res = await fetch(`/api/rental/agreements/${agreement.id}/refund-deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refund_amount: refundAmount,
            refund_method: refundMethod,
            refund_reference: refundRef || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
          const msg =
            data.error ??
            'Requires RAC Manager permission — Counter Operators cannot issue security deposit refunds.';
          setForbiddenMsg(msg);
          onRbacForbidden(msg);
          setSaving(false);
          return;
        }
        if (!res.ok) throw new Error(data.error ?? 'Refund request failed');
        const wf = data.workflow;
        const notice =
          wf?.status === 'IN_PROGRESS'
            ? `Refund requested (${data.deposit?.deposit_no ?? 'deposit'}) and sent for approval through "${wf.name}"${wf.level ? `, waiting for "${wf.level}"` : ''}.`
            : data.agreement?.depositStatus === 'REFUNDED'
              ? 'Security deposit refunded.'
              : `Refund requested (${data.deposit?.deposit_no ?? 'deposit'}): Finance pays it from Security Deposits.`;
        onDone(notice);
        return;
      }

      const payload: Record<string, unknown> = {};
      if (action === 'activate') {
        payload.status = 'ACTIVE';
        if (mileageOut !== '') payload.mileageOut = Math.max(0, Math.round(Number(mileageOut)));
        if (fuelOut !== '') {
          const pct = Math.min(100, Math.max(0, Math.round(Number(fuelOut))));
          payload.fuelOut = pct;
          payload.fuelOutPct = pct;
          payload.fuelUnit = 'PCT';
        }
      }
      if (action === 'sign') {
        payload.signedAt = new Date().toISOString();
        payload.signedBy = signedBy || 'Customer';
      }
      if (action === 'cancel') {
        payload.status = 'CANCELLED';
      }

      const res = await fetch(`/api/rental/agreements/${agreement.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        const msg =
          data.error ?? 'Requires RAC Manager permission for this agreement action.';
        setForbiddenMsg(msg);
        onRbacForbidden(msg);
        setSaving(false);
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? 'Failed to update agreement');
      }
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="border-b border-[var(--border-subtle)] px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-[var(--text-main)]">Update Agreement</h2>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-main)]">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            <span className="font-mono text-[var(--text-main)]">{agreement.agreementNo}</span> ·{' '}
            {resolveAgreementCustomerName(agreement)}
          </p>

          {forbiddenMsg && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/40 p-3.5 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold text-amber-300">Requires RAC Manager Permission (403)</p>
                <p className="text-amber-200/85 mt-0.5">{forbiddenMsg}</p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {actions.map(a => (
              <label key={a.key} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                action === a.key
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 hover:border-[var(--border-subtle)]'
              }`}>
                <input
                  type="radio"
                  name="action"
                  value={a.key}
                  checked={action === a.key}
                  onChange={() => {
                    setAction(a.key as typeof action);
                    setError('');
                    setForbiddenMsg('');
                  }}
                  className="accent-amber-500"
                />
                <span className="text-sm text-[var(--text-main)]">{a.label}</span>
              </label>
            ))}
          </div>

          {action === 'sign' && (
            <input
              value={signedBy}
              onChange={e => setSignedBy(e.target.value)}
              placeholder="Signed by (name)"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500/40"
            />
          )}
          {action === 'activate' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={mileageOut}
                onChange={e => setMileageOut(e.target.value)}
                placeholder="Pick-up odometer out (km)"
                className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500/40"
              />
              <input
                type="number"
                value={fuelOut}
                onChange={e => setFuelOut(e.target.value)}
                placeholder="Pick-up fuel out %"
                min={0}
                max={100}
                className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500/40"
              />
            </div>
          )}
          {action === 'complete' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={mileageIn}
                  onChange={e => setMileageIn(e.target.value)}
                  placeholder="Return odometer in (km)"
                  className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500/40"
                />
                <input
                  type="number"
                  value={fuelIn}
                  onChange={e => setFuelIn(e.target.value)}
                  placeholder="Return fuel in %"
                  min={0}
                  max={100}
                  className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500/40"
                />
              </div>
              <Link
                href={`/rental/counter?mode=return&agreementId=${agreement.id}`}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300 hover:bg-teal-500/25 text-xs font-semibold transition-colors"
              >
                Counter Return Wizard →
              </Link>
            </div>
          )}

          {action === 'refund_deposit' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={refundAmount}
                  onChange={e => setRefundAmount(e.target.value)}
                  placeholder="Refund amount"
                  min={0}
                  className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500/40"
                />
                <select
                  value={refundMethod}
                  onChange={e => setRefundMethod(e.target.value)}
                  className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-amber-500/40"
                >
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="CARD">Card reversal</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>
              <input
                value={refundRef}
                onChange={e => setRefundRef(e.target.value)}
                placeholder="Reference (optional)"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-amber-500/40"
              />
              <p className="text-xs text-[var(--text-faint)]">
                Raises a refund request in Finance › Security Deposits; it goes through the Refund Approval workflow when one is set up.
              </p>
            </div>
          )}
          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            onClick={handle}
            disabled={saving || actions.length === 0}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-[var(--text-main)] font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            {saving ? 'Saving…' : action === 'complete' ? 'Complete & Close Agreement' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mid-Rental Swap Vehicle Modal ─────────────────────────────────────────────

interface ExchangeHistoryItem {
  id: string;
  exchangeNo: string | null;
  exchangeDate: string | null;
  reason: string | null;
  fromPlateNumber?: string | null;
  fromMileageIn: number | null;
  fromFuelIn: number | null;
  toPlateNumber?: string | null;
  toMileageOut: number | null;
  toFuelOut: number | null;
  rateDifference: number;
}

interface SwapFleetVehicle {
  id: string;
  plateNo: string;
  make: string;
  model: string;
  category?: string;
  currentMileage?: number;
}

function SwapVehicleModal({
  agreement,
  onClose,
  onDone,
  onRbacForbidden,
}: {
  agreement: Agreement;
  onClose: () => void;
  onDone: (notice: string) => void;
  onRbacForbidden: (msg: string) => void;
}) {
  const [history, setHistory] = useState<ExchangeHistoryItem[]>([]);
  const [fleetVehicles, setFleetVehicles] = useState<SwapFleetVehicle[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);

  const [reason, setReason] = useState<'BREAKDOWN' | 'UPGRADE' | 'CUSTOMER_REQUEST' | 'MAINTENANCE' | 'OTHER'>('BREAKDOWN');
  const [fromMileageIn, setFromMileageIn] = useState(String(agreement.mileageOut ?? ''));
  const [fromFuelIn, setFromFuelIn] = useState(
    String(resolveStoredFuelPct(agreement.pickupFuelLevel, agreement.fuelOut) ?? 100),
  );
  const [fromVehicleStatusAfter, setFromVehicleStatusAfter] = useState<'AVAILABLE' | 'MAINTENANCE'>('MAINTENANCE');
  const [toVehicleId, setToVehicleId] = useState('');
  const [toMileageOut, setToMileageOut] = useState('');
  const [toFuelOut, setToFuelOut] = useState('100');
  const [rateDifference, setRateDifference] = useState('0');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoadingInit(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const end = agreement.endDate ? agreement.endDate.slice(0, 10) : today;
        const [exRes, avRes] = await Promise.all([
          fetch(`/api/rental/agreements/${agreement.id}/exchange`, { cache: 'no-store' }),
          fetch(`/api/rental/availability?startDate=${today}&endDate=${end}&pickupDate=${today}&dropoffDate=${end}`, {
            cache: 'no-store',
          }),
        ]);
        if (!cancelled && exRes.ok) {
          const exJson = await exRes.json();
          const exList = Array.isArray(exJson?.exchanges)
            ? exJson.exchanges
            : Array.isArray(exJson?.data)
              ? exJson.data
              : [];
          setHistory(exList);
          if (exList.length > 0) {
            const last = exList[exList.length - 1];
            if (last?.toMileageOut != null) setFromMileageIn(String(last.toMileageOut));
            if (last?.toFuelOut != null) setFromFuelIn(String(last.toFuelOut));
          }
        }
        if (!cancelled && avRes.ok) {
          const avJson = await avRes.json();
          const rawV = Array.isArray(avJson) ? avJson : (avJson?.vehicles ?? avJson?.data ?? []);
          const currentVehId = agreement.vehicleId ?? agreement.vehicle?.id ?? '';
          const mapped: SwapFleetVehicle[] = (Array.isArray(rawV) ? rawV : [])
            .map((v: Record<string, unknown>) => ({
              id: String(v.id ?? ''),
              plateNo: String(v.plateNo ?? v.plateNumber ?? v.plate_no ?? v.registrationNo ?? 'NO-PLATE'),
              make: String(v.make ?? ''),
              model: String(v.model ?? ''),
              category: v.category ? String(v.category) : undefined,
              currentMileage:
                v.currentMileage != null
                  ? Number(v.currentMileage)
                  : v.mileage != null
                    ? Number(v.mileage)
                    : undefined,
            }))
            .filter((v: SwapFleetVehicle) => v.id && v.id !== currentVehId);
          setFleetVehicles(mapped);
          if (mapped.length > 0) {
            setToVehicleId(mapped[0].id);
            if (mapped[0].currentMileage != null) {
              setToMileageOut(String(mapped[0].currentMileage));
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [agreement.id, agreement.endDate, agreement.vehicleId, agreement.vehicle?.id]);

  const submitSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toVehicleId) {
      setError('Please select an AVAILABLE replacement vehicle.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/rental/agreements/${agreement.id}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toVehicleId,
          reason,
          fromMileageIn: fromMileageIn !== '' ? Math.max(0, Math.round(Number(fromMileageIn))) : undefined,
          fromFuelIn: fromFuelIn !== '' ? Math.min(100, Math.max(0, Math.round(Number(fromFuelIn)))) : undefined,
          fromFuelUnit: 'PCT',
          fromVehicleStatusAfter,
          toMileageOut: toMileageOut !== '' ? Math.max(0, Math.round(Number(toMileageOut))) : undefined,
          toFuelOut: toFuelOut !== '' ? Math.min(100, Math.max(0, Math.round(Number(toFuelOut)))) : 100,
          toFuelUnit: 'PCT',
          rateDifference: parseFloat(rateDifference) || 0,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = data.error ?? 'Requires RAC Counter Operator or Manager permission to swap vehicles.';
        onRbacForbidden(msg);
        setError(msg);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Vehicle swap failed (HTTP ${res.status})`);
      }
      const exNo = data.exchange?.exchangeNo ?? data.exchangeNo ?? 'VEX';
      const chosen = fleetVehicles.find((v) => v.id === toVehicleId);
      onDone(
        `Mid-rental swap ${exNo} completed for ${agreement.agreementNo ?? agreement.id.slice(0, 8)} → ${
          chosen ? `${chosen.plateNo} (${chosen.make} ${chosen.model})` : 'replacement vehicle'
        }.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vehicle swap failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="border-b border-[var(--border-subtle)] px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-[var(--text-main)] flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-violet-400" />
            Mid-Rental Vehicle Swap — {agreement.agreementNo ?? agreement.id.slice(0, 8)}
          </h2>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-main)]">
            ✕
          </button>
        </div>

        <form onSubmit={submitSwap} className="p-5 space-y-4">
          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          {history.length > 0 && (
            <div className="rounded-xl bg-violet-500/10 border border-violet-500/25 p-3 space-y-1.5">
              <div className="text-[11px] font-bold uppercase text-violet-300">
                Prior Swap Segments ({history.length})
              </div>
              {history.map((h) => (
                <div key={h.id} className="text-xs font-mono text-[var(--text-muted)] flex justify-between">
                  <span>
                    {h.exchangeNo ?? h.id.slice(0, 7)}: {h.fromPlateNumber ?? 'Old'} → {h.toPlateNumber ?? 'New'}
                  </span>
                  <span>{h.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Swap Reason *</label>
              <select
                value={reason}
                onChange={(e) => {
                  const r = e.target.value as typeof reason;
                  setReason(r);
                  setFromVehicleStatusAfter(
                    r === 'BREAKDOWN' || r === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE',
                  );
                }}
                className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
              >
                <option value="BREAKDOWN">Breakdown / Roadside</option>
                <option value="MAINTENANCE">Scheduled Maintenance</option>
                <option value="UPGRADE">Customer Upgrade</option>
                <option value="CUSTOMER_REQUEST">Customer Request</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Returned Car Post-Status</label>
              <select
                value={fromVehicleStatusAfter}
                onChange={(e) => setFromVehicleStatusAfter(e.target.value as 'AVAILABLE' | 'MAINTENANCE')}
                className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
              >
                <option value="MAINTENANCE">MAINTENANCE (Ground Car)</option>
                <option value="AVAILABLE">AVAILABLE (Ready to Rent)</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-[var(--border-subtle)] p-3.5 space-y-2.5">
            <div className="text-xs font-semibold text-amber-300">
              1. Returned Vehicle Check-In ({agreement.vehicle?.plateNumber ?? 'Current Assigned Car'})
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Odometer In (km) *</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={fromMileageIn}
                  onChange={(e) => setFromMileageIn(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Fuel In (%) *</label>
                <input
                  type="number"
                  required
                  min={0}
                  max={100}
                  value={fromFuelIn}
                  onChange={(e) => setFromFuelIn(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-main)]"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[var(--bg-canvas)]/70 border border-emerald-500/30 p-3.5 space-y-2.5">
            <div className="text-xs font-semibold text-emerald-300">
              2. Replacement Vehicle Check-Out
            </div>
            {loadingInit ? (
              <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 py-2">
                <Loader className="w-3.5 h-3.5 animate-spin" /> Loading available replacement fleet…
              </div>
            ) : fleetVehicles.length === 0 ? (
              <div className="text-xs text-amber-300 py-1">
                No AVAILABLE vehicles found for the remaining agreement window.
              </div>
            ) : (
              <select
                value={toVehicleId}
                onChange={(e) => {
                  const vid = e.target.value;
                  setToVehicleId(vid);
                  const found = fleetVehicles.find((v) => v.id === vid);
                  if (found?.currentMileage != null) setToMileageOut(String(found.currentMileage));
                }}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--text-main)]"
              >
                {fleetVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plateNo} — {v.make} {v.model}
                    {v.category ? ` (${v.category})` : ''}
                    {v.currentMileage != null ? ` · ${v.currentMileage.toLocaleString()} km` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Odometer Out (km)</label>
                <input
                  type="number"
                  min={0}
                  value={toMileageOut}
                  onChange={(e) => setToMileageOut(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Fuel Out (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={toFuelOut}
                  onChange={(e) => setToFuelOut(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Rate Diff (AED/d)</label>
                <input
                  type="number"
                  step="10"
                  value={rateDifference}
                  onChange={(e) => setRateDifference(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--text-main)]"
                />
              </div>
            </div>
          </div>

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Roadside recovery ref, tyre blowout note, upgrade remarks…"
            className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
          />

          <button
            type="submit"
            disabled={saving || !toVehicleId}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            {saving ? 'Executing Atomic Swap & Tarrashud Manifest…' : 'Confirm Vehicle Swap'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Safe Telematics Immobilizer Modal ─────────────────────────────────────────

function SafeImmobilizerModal({
  agreement,
  onClose,
  onDone,
  onRbacForbidden,
}: {
  agreement: Agreement;
  onClose: () => void;
  onDone: (notice: string) => void;
  onRbacForbidden: (msg: string) => void;
}) {
  const [action, setAction] = useState<'IMMOBILIZE' | 'RESTORE'>('IMMOBILIZE');
  const [reason, setReason] = useState('Overdue agreement — ignition-off starter inhibit authorized');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const vehicleId = agreement.vehicleId ?? agreement.vehicle?.id ?? '';

  const submitCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) {
      setError('No concrete vehicle assigned to this agreement.');
      return;
    }
    if (!reason.trim()) {
      setError('An audit reason is required for telematics starter commands.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/rental/counter/telematics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          agreementId: agreement.id,
          action,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = data.error ?? 'Requires RAC Manager permission to send telematics immobilizer commands.';
        onRbacForbidden(msg);
        setError(msg);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? `Telematics command refused (HTTP ${res.status})`);
      }
      onDone(
        `Telematics ${action} command queued safely (${agreement.vehicle?.plateNumber ?? 'Vehicle'} · Ignition-Off Interlock Verified).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Telematics command failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-[var(--bg-surface)] border border-rose-500/30 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="border-b border-[var(--border-subtle)] px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-[var(--text-main)] flex items-center gap-2">
            <Lock className="w-4 h-4 text-rose-400" />
            Safe Telematics Immobilizer — {agreement.vehicle?.plateNumber ?? agreement.agreementNo}
          </h2>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text-main)]">
            ✕
          </button>
        </div>
        <form onSubmit={submitCommand} className="p-5 space-y-4">
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200">
            <strong>Safety Interlock:</strong> Starter inhibit only arms once CAN-Bus confirms{' '}
            <code className="font-mono">0 km/h</code> &amp; ignition OFF. Active moving vehicles are never cut off.
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAction('IMMOBILIZE')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition ${
                action === 'IMMOBILIZE'
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                  : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}
            >
              🔒 Immobilize Starter
            </button>
            <button
              type="button"
              onClick={() => {
                setAction('RESTORE');
                if (reason.startsWith('Overdue')) {
                  setReason('Payment settled — restore vehicle starter');
                }
              }}
              className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition ${
                action === 'RESTORE'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}
            >
              🔓 Restore Starter
            </button>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Audit Reason *</label>
            <textarea
              rows={2}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)] resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !vehicleId}
            className={`w-full font-semibold py-2.5 rounded-xl text-sm text-white transition-colors disabled:opacity-40 ${
              action === 'IMMOBILIZE' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {busy ? 'Verifying CAN-Bus Speed & Sending…' : action === 'IMMOBILIZE' ? 'Send Safe Starter Inhibit' : 'Restore Vehicle Starter'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Agreement card ────────────────────────────────────────────────────────────

function AgreementCard({
  agreement,
  onSelect,
  onAction,
  onESign,
  onSwap,
  onImmobilize,
  onReportTarrashud,
  reportingTarrashudId,
  onGenerateInvoice,
  generatingInvId,
}: {
  agreement: Agreement;
  onSelect: (a: Agreement) => void;
  onAction: (a: Agreement) => void;
  onESign: (a: Agreement) => void;
  onSwap: (a: Agreement) => void;
  onImmobilize: (a: Agreement) => void;
  onReportTarrashud: (a: Agreement) => void;
  reportingTarrashudId: string | null;
  onGenerateInvoice: (a: Agreement) => void;
  generatingInvId: string | null;
}) {
  const cfg = STATUS_CONFIG[agreement.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.DRAFT;
  const days = rentalDays(agreement.startDate, agreement.endDate);
  const kmUsed =
    agreement.mileageIn != null && agreement.mileageOut != null
      ? Math.max(0, Number(agreement.mileageIn) - Number(agreement.mileageOut))
      : null;
  const hasInspection = (agreement.booking?.inspections ?? []).length > 0;
  const isActive = agreement.status === 'ACTIVE';
  const isOverdue = isActive && Boolean(agreement.endDate) && new Date(agreement.endDate).getTime() < Date.now();

  return (
    <div
      onClick={() => onSelect(agreement)}
      className={`rounded-2xl border p-5 space-y-4 transition-all hover:brightness-110 cursor-pointer ${cfg.bg}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-bold text-[var(--text-main)]">{agreement.agreementNo ?? '—'}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {resolveAgreementCustomerName(agreement)}
            {agreement.isCorporate && (
              <span className="ml-1.5 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-1.5 py-0.5">
                Corp
              </span>
            )}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.badge}`}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      {/* Vehicle + dates */}
      <div className="flex flex-wrap items-center gap-1.5">
        {agreement.vehicle?.plateNumber && (
          <span className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded font-mono font-semibold">
            🚗 {agreement.vehicle.plateNumber}
            {agreement.vehicle.make ? ` · ${agreement.vehicle.make} ${agreement.vehicle.model ?? ''}`.trimEnd() : ''}
          </span>
        )}
        {agreement.booking?.vehicleCategory && (
          <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded font-mono">
            {formatRentalCategoryLabel(agreement.booking.vehicleCategory)}
          </span>
        )}
        {isOverdue && (
          <span className="text-[10px] font-bold uppercase bg-rose-500/20 border border-rose-500/40 text-rose-300 px-2 py-0.5 rounded-full">
            Overdue
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[var(--bg-surface)]/40 rounded-xl p-2.5">
          <p className="text-[var(--text-faint)]">Pick-Up</p>
          <p className="text-[var(--text-main)] font-medium mt-0.5">{fmt(agreement.startDate)}</p>
          {agreement.booking?.pickupLocation && (
            <p className="text-[var(--text-faint)] truncate">{agreement.booking.pickupLocation}</p>
          )}
          {agreement.mileageOut != null && (
            <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">
              Out: {Number(agreement.mileageOut).toLocaleString()} km
              {resolveStoredFuelPct(agreement.pickupFuelLevel, agreement.fuelOut) != null
                ? ` · ${formatCanonicalFuelDisplay(agreement.fuelOut, { pctColumn: agreement.pickupFuelLevel })}`
                : ''}
            </p>
          )}
        </div>
        <div className="bg-[var(--bg-surface)]/40 rounded-xl p-2.5">
          <p className="text-[var(--text-faint)]">Return</p>
          <p className="text-[var(--text-main)] font-medium mt-0.5">{fmt(agreement.endDate)}</p>
          {agreement.booking?.dropoffLocation && (
            <p className="text-[var(--text-faint)] truncate">{agreement.booking.dropoffLocation}</p>
          )}
          {agreement.mileageIn != null && (
            <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">
              In: {Number(agreement.mileageIn).toLocaleString()} km
              {resolveStoredFuelPct(agreement.returnFuelLevel, agreement.fuelIn) != null
                ? ` · ${formatCanonicalFuelDisplay(agreement.fuelIn, { pctColumn: agreement.returnFuelLevel })}`
                : ''}
            </p>
          )}
        </div>
      </div>

      {/* Financials */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-[var(--text-faint)]">
            {days} days × {fmtAmt(agreement.dailyRate, agreement.currency ?? 'AED')}/day
          </span>
          <span className="text-[var(--text-main)] font-semibold">
            {fmtAmt(agreement.totalAmount, agreement.currency ?? 'AED')}
          </span>
        </div>
        {agreement.securityDeposit !== null && (
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-faint)]">Security deposit</span>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">
                {fmtAmt(agreement.securityDeposit, agreement.currency ?? 'AED')}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs border ${
                  DEPOSIT_STATUS[agreement.depositStatus as keyof typeof DEPOSIT_STATUS] ??
                  DEPOSIT_STATUS.PENDING
                }`}
              >
                {agreement.depositStatus ?? 'PENDING'}
              </span>
            </div>
          </div>
        )}
        {kmUsed !== null && (
          <div className="flex justify-between">
            <span className="text-[var(--text-faint)]">KM driven</span>
            <span className="text-[var(--text-muted)] font-mono">{kmUsed.toLocaleString()} km</span>
          </div>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {agreement.signedAt && (
          <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-full px-2 py-0.5">
            ✍️ Signed {fmt(agreement.signedAt)}
          </span>
        )}
        {agreement.insurancePlanCode && (
          <span className="text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-full px-2 py-0.5">
            🛡 {agreement.insurancePlanCode}
          </span>
        )}
        {hasInspection && (
          <span className="text-xs text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded-full px-2 py-0.5">
            🔍 Inspected
          </span>
        )}
        {(agreement.extensions?.length ?? 0) > 0 && (
          <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
            ⏰ Extended ×{agreement.extensions.length}
          </span>
        )}
        {(agreement.exchangeCount ?? 0) > 0 && (
          <span className="text-xs text-violet-300 bg-violet-500/15 border border-violet-500/30 rounded-full px-2 py-0.5">
            🔄 Swapped ×{agreement.exchangeCount}
          </span>
        )}
        {agreement.regulatoryReport ? (
          <span
            className={`text-xs rounded-full px-2 py-0.5 border font-mono ${
              agreement.regulatoryReport.status === 'SUBMITTED' || agreement.regulatoryReport.status === 'ACKNOWLEDGED'
                ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
                : 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30'
            }`}
          >
            🏛 Tarrashud: {agreement.regulatoryReport.status}
          </span>
        ) : (
          isActive && (
            <span className="text-xs text-slate-300 bg-slate-500/15 border border-slate-500/30 rounded-full px-2 py-0.5">
              🏛 Tarrashud Pending
            </span>
          )
        )}
      </div>

      {/* Quick Counter Return, Swap, Extend & Immobilizer Actions for ACTIVE Agreements */}
      {isActive && (
        <div className="space-y-2 pt-1" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={`/rental/counter?mode=return&agreementId=${agreement.id}`}
              className="inline-flex items-center justify-center gap-1.5 text-xs bg-teal-500/15 border border-teal-500/30 text-teal-300 hover:bg-teal-500/25 py-2 px-3 rounded-xl font-semibold transition-colors"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
              Counter Return →
            </Link>
            <button
              type="button"
              onClick={() => onSwap(agreement)}
              className="inline-flex items-center justify-center gap-1.5 text-xs bg-violet-500/15 border border-violet-500/35 text-violet-300 hover:bg-violet-500/25 py-2 px-3 rounded-xl font-semibold transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Swap Vehicle
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={`/rental/renewals?agreementId=${agreement.id}`}
              className="inline-flex items-center justify-center gap-1.5 text-xs bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 py-1.5 px-3 rounded-xl font-semibold transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Extend
            </Link>
            {(agreement.vehicleId || agreement.vehicle?.id) && (
              <button
                type="button"
                onClick={() => onImmobilize(agreement)}
                className={`inline-flex items-center justify-center gap-1.5 text-xs py-1.5 px-3 rounded-xl font-semibold border transition-colors ${
                  isOverdue
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                    : 'bg-slate-500/15 border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-rose-300 hover:border-rose-500/35'
                }`}
                title="Safe Ignition-Off Telematics Immobilizer"
              >
                <Lock className="w-3.5 h-3.5" />
                Safe Immobilizer
              </button>
            )}
          </div>
        </div>
      )}

      {/* Secondary Actions */}
      <div className="flex gap-2 pt-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {(['DRAFT', 'ACTIVE'].includes(agreement.status ?? '') || agreement.depositStatus === 'PAID') && (
          <button
            onClick={() => onAction(agreement)}
            className="flex-1 min-w-[110px] text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 py-2 px-2.5 rounded-xl font-medium transition-colors"
          >
            ⚡ {agreement.depositStatus === 'PAID' && !['DRAFT', 'ACTIVE'].includes(agreement.status ?? '')
              ? 'Refund Deposit'
              : agreement.status === 'ACTIVE'
                ? 'Complete & Return'
                : 'Update Status'}
          </button>
        )}
        {agreement.status !== 'CANCELLED' && agreement.status !== 'DRAFT' && (
          <button
            type="button"
            onClick={() => onReportTarrashud(agreement)}
            disabled={reportingTarrashudId === agreement.id}
            className="text-xs bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 px-2.5 py-2 rounded-xl font-medium transition-colors disabled:opacity-40 inline-flex items-center gap-1"
            title="Dispatch UAE Tarrashud / ITC Regulatory Manifest"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {reportingTarrashudId === agreement.id ? 'Reporting…' : 'Report to Tarrashud'}
          </button>
        )}
        {agreement.status !== 'CANCELLED' && (
          <button
            onClick={() => onGenerateInvoice(agreement)}
            disabled={generatingInvId === agreement.id}
            className="text-xs bg-blue-500/10 border border-blue-500/25 text-blue-300 hover:bg-blue-500/20 px-2.5 py-2 rounded-xl font-medium transition-colors disabled:opacity-40"
            title="Generate Agreement Tax Invoice"
          >
            {generatingInvId === agreement.id ? 'Invoicing…' : '🧾 Generate Invoice'}
          </button>
        )}
        {!agreement.signedAt && agreement.status !== 'CANCELLED' && (
          <button
            onClick={() => onESign(agreement)}
            className="text-xs bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/20 px-2.5 py-2 rounded-xl font-medium transition-colors"
            title="Send OTP E-Sign link"
          >
            ✍️ Send OTP E-Sign
          </button>
        )}
        {agreement.booking && (
          <Link
            href={`/rental/bookings/${agreement.booking.id}/inspect`}
            className="text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] border border-[var(--border-subtle)] px-2.5 py-2 rounded-xl transition-colors"
          >
            🔍 Inspect
          </Link>
        )}
        <Link
          href={`/rental/invoices?agreementId=${agreement.id}`}
          className="text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] border border-[var(--border-subtle)] px-2.5 py-2 rounded-xl transition-colors"
          title="View Agreement Invoices"
        >
          Invoices
        </Link>
        <a
          href={`/api/rental/agreements/${agreement.id}/pdf?lang=en&download=1`}
          className="text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 px-2.5 py-2 rounded-xl transition-colors"
          title="Download bilingual rental agreement (EN layout)"
        >
          PDF·EN
        </a>
        <a
          href={`/api/rental/agreements/${agreement.id}/pdf?lang=ar&download=1`}
          className="text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 px-2.5 py-2 rounded-xl transition-colors"
          title="Download bilingual rental agreement (AR layout)"
        >
          PDF·AR
        </a>
      </div>
    </div>
  );
}

// ── Inner Main Page ───────────────────────────────────────────────────────────

const STATUS_TABS = ['ALL', 'DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

function RentalAgreementsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const deepLinkId = searchParams.get('id') || searchParams.get('agreementId') || '';

  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('ALL');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<AgreementSummaryCounts>({
    ALL: 0,
    DRAFT: 0,
    ACTIVE: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    activeRevenue: 0,
    pendingDeposits: 0,
  });
  const [search, setSearch] = useState('');
  const [selectedAgreement, setSelectedAgreement] = useState<Agreement | null>(null);
  const [actionTarget, setActionTarget] = useState<Agreement | null>(null);
  const [esignTarget, setEsignTarget] = useState<Agreement | null>(null);
  const [swapTarget, setSwapTarget] = useState<Agreement | null>(null);
  const [immobilizeTarget, setImmobilizeTarget] = useState<Agreement | null>(null);
  const [reportingTarrashudId, setReportingTarrashudId] = useState<string | null>(null);
  const [generatingInvId, setGeneratingInvId] = useState<string | null>(null);
  const [rbacBanner, setRbacBanner] = useState('');
  const [noticeBanner, setNoticeBanner] = useState('');
  const [errorBanner, setErrorBanner] = useState('');

  const limit = 18;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (tab !== 'ALL') sp.set('status', tab);
      if (deepLinkId) sp.set('id', deepLinkId);

      const res = await fetch(`/api/rental/agreements?${sp.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const rows: Agreement[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.agreements)
              ? data.agreements
              : [];
        setAgreements(rows);
        const tot = typeof data?.total === 'number' ? data.total : rows.length;
        setTotal(tot);
        setTotalPages(
          typeof data?.totalPages === 'number'
            ? Math.max(1, data.totalPages)
            : Math.max(1, Math.ceil(tot / limit))
        );
        if (data?.summary && typeof data.summary === 'object') {
          setSummary({
            ALL: Number(data.summary.ALL ?? tot),
            DRAFT: Number(data.summary.DRAFT ?? 0),
            ACTIVE: Number(data.summary.ACTIVE ?? 0),
            COMPLETED: Number(data.summary.COMPLETED ?? 0),
            CANCELLED: Number(data.summary.CANCELLED ?? 0),
            activeRevenue: Number(data.summary.activeRevenue ?? 0),
            pendingDeposits: Number(data.summary.pendingDeposits ?? 0),
          });
        } else {
          setSummary({
            ALL: tot,
            DRAFT: rows.filter((a) => a.status === 'DRAFT').length,
            ACTIVE: rows.filter((a) => a.status === 'ACTIVE').length,
            COMPLETED: rows.filter((a) => a.status === 'COMPLETED').length,
            CANCELLED: rows.filter((a) => a.status === 'CANCELLED').length,
            activeRevenue: rows
              .filter((a) => a.status === 'ACTIVE')
              .reduce((s, a) => s + (Number(a.totalAmount) || 0), 0),
            pendingDeposits: rows.filter((a) => a.depositStatus === 'PENDING').length,
          });
        }

        if (deepLinkId) {
          const found = rows.find(
            (a) => a.id === deepLinkId || a.agreementNo === deepLinkId
          );
          if (found) {
            setSelectedAgreement(found);
          } else {
            const singleRes = await fetch(`/api/rental/agreements/${encodeURIComponent(deepLinkId)}`, {
              cache: 'no-store',
            });
            if (singleRes.ok) {
              const singleJson = await singleRes.json();
              const agrObj = (singleJson?.agreement ?? singleJson) as Agreement;
              if (agrObj?.id) setSelectedAgreement(agrObj);
            }
          }
        }
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [tab, page, deepLinkId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerateInvoice = async (agreement: Agreement) => {
    setGeneratingInvId(agreement.id);
    setErrorBanner('');
    setRbacBanner('');
    try {
      const res = await fetch(`/api/rental/agreements/${agreement.id}/generate-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacBanner(data.error ?? 'Requires RAC permission to generate agreement invoices.');
        return;
      }
      if (!res.ok) {
        setErrorBanner(data.error ?? `Failed to generate invoice (HTTP ${res.status})`);
        return;
      }
      const invNo =
        data.invoice?.invoiceNo ??
        data.invoice?.invoice_no ??
        data.invoiceNo ??
        data.invoiceNumber ??
        'Tax Invoice';
      setNoticeBanner(
        `Invoice ${invNo} generated for ${agreement.agreementNo ?? agreement.id.slice(0, 8)}.`
      );
      load();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to generate invoice');
    } finally {
      setGeneratingInvId(null);
    }
  };

  const handleReportTarrashud = async (agreement: Agreement) => {
    setReportingTarrashudId(agreement.id);
    setErrorBanner('');
    setRbacBanner('');
    try {
      const eventType = agreement.status === 'COMPLETED' ? 'RETURN' : 'HANDOVER';
      const res = await fetch('/api/rental/agreements/tarrashud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementId: agreement.id,
          eventType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacBanner(data.error ?? 'Requires RAC permission to dispatch UAE Tarrashud reports.');
        return;
      }
      if (!res.ok) {
        setErrorBanner(data.error ?? `UAE Tarrashud report failed (HTTP ${res.status})`);
        return;
      }
      const st = data.report?.status ?? data.status ?? 'SUBMITTED';
      const extRef = data.report?.externalRef ?? data.externalRef;
      setNoticeBanner(
        `UAE Tarrashud / ITC (${eventType}) manifest ${st}${extRef ? ` · Ref ${extRef}` : ''} for ${
          agreement.agreementNo ?? agreement.id.slice(0, 8)
        }.`,
      );
      load();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to dispatch UAE Tarrashud report');
    } finally {
      setReportingTarrashudId(null);
    }
  };

  const filtered = agreements.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [
      a.agreementNo,
      a.customerName,
      a.booking?.customer?.fullName,
      a.booking?.customer?.companyName,
      a.booking?.bookingRef,
      a.vehicle?.plateNumber,
    ].some(v => v?.toLowerCase().includes(q));
  });

  return (
    <>
      {actionTarget && (
        <TransitionModal
          agreement={actionTarget}
          onClose={() => setActionTarget(null)}
          onDone={(notice) => {
            setActionTarget(null);
            if (notice) setNoticeBanner(notice);
            load();
          }}
          onRbacForbidden={(msg) => setRbacBanner(msg)}
        />
      )}

      {esignTarget && (
        <ESignModal
          agreement={esignTarget}
          onClose={() => setEsignTarget(null)}
          onSent={(notice) => {
            setNoticeBanner(notice);
            load();
          }}
          onRbacForbidden={(msg) => setRbacBanner(msg)}
        />
      )}

      {swapTarget && (
        <SwapVehicleModal
          agreement={swapTarget}
          onClose={() => setSwapTarget(null)}
          onDone={(notice) => {
            setSwapTarget(null);
            setNoticeBanner(notice);
            load();
          }}
          onRbacForbidden={(msg) => setRbacBanner(msg)}
        />
      )}

      {immobilizeTarget && (
        <SafeImmobilizerModal
          agreement={immobilizeTarget}
          onClose={() => setImmobilizeTarget(null)}
          onDone={(notice) => {
            setImmobilizeTarget(null);
            setNoticeBanner(notice);
            load();
          }}
          onRbacForbidden={(msg) => setRbacBanner(msg)}
        />
      )}

      {selectedAgreement && (
        <SlideOverDrawer
          isOpen={!!selectedAgreement}
          onClose={() => setSelectedAgreement(null)}
          title={`Agreement ${selectedAgreement.agreementNo ?? selectedAgreement.id.slice(0, 8)}`}
          subtitle={`Customer: ${resolveAgreementCustomerName(selectedAgreement)}`}
          badge={{
            text: (selectedAgreement.status ?? 'DRAFT').toUpperCase(),
            variant:
              selectedAgreement.status === 'ACTIVE'
                ? 'emerald'
                : selectedAgreement.status === 'COMPLETED'
                  ? 'blue'
                  : 'slate',
          }}
          width="xl"
        >
          <div className="space-y-6">
            {/* Quick Workflow Bar */}
            <div className="flex flex-wrap gap-2">
              {selectedAgreement.status === 'ACTIVE' && (
                <>
                  <Link
                    href={`/rental/counter?mode=return&agreementId=${selectedAgreement.id}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500/20 border border-teal-500/35 text-teal-300 hover:bg-teal-500/30 text-xs font-semibold"
                  >
                    <CornerDownLeft className="w-3.5 h-3.5" />
                    Counter Return Wizard →
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSwapTarget(selectedAgreement)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-500/20 border border-violet-500/35 text-violet-300 hover:bg-violet-500/30 text-xs font-semibold"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Swap Vehicle
                  </button>
                  {(selectedAgreement.vehicleId || selectedAgreement.vehicle?.id) && (
                    <button
                      type="button"
                      onClick={() => setImmobilizeTarget(selectedAgreement)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 border border-rose-500/35 text-rose-300 hover:bg-rose-500/30 text-xs font-semibold"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Safe Immobilizer
                    </button>
                  )}
                </>
              )}
              {(['DRAFT', 'ACTIVE'].includes(selectedAgreement.status ?? '') ||
                selectedAgreement.depositStatus === 'PAID') && (
                <button
                  onClick={() => setActionTarget(selectedAgreement)}
                  className="px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-500/35 text-amber-300 hover:bg-amber-500/30 text-xs font-semibold"
                >
                  ⚡ {selectedAgreement.status === 'ACTIVE' ? 'Complete & Return' : 'Update Status'}
                </button>
              )}
              {selectedAgreement.status !== 'CANCELLED' && selectedAgreement.status !== 'DRAFT' && (
                <button
                  type="button"
                  onClick={() => handleReportTarrashud(selectedAgreement)}
                  disabled={reportingTarrashudId === selectedAgreement.id}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/35 text-indigo-300 hover:bg-indigo-500/30 text-xs font-semibold disabled:opacity-40"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {reportingTarrashudId === selectedAgreement.id ? 'Reporting…' : 'Report to Tarrashud'}
                </button>
              )}
              {selectedAgreement.status !== 'CANCELLED' && (
                <button
                  onClick={() => handleGenerateInvoice(selectedAgreement)}
                  disabled={generatingInvId === selectedAgreement.id}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-500/20 border border-blue-500/35 text-blue-300 hover:bg-blue-500/30 text-xs font-semibold disabled:opacity-40"
                >
                  <Receipt className="w-3.5 h-3.5" />
                  {generatingInvId === selectedAgreement.id ? 'Generating…' : 'Generate Invoice'}
                </button>
              )}
              {selectedAgreement.status !== 'CANCELLED' && (
                <button
                  onClick={() => setEsignTarget(selectedAgreement)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/35 text-indigo-300 hover:bg-indigo-500/30 text-xs font-semibold"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send OTP E-Sign
                </button>
              )}
              <Link
                href={`/rental/invoices?agreementId=${selectedAgreement.id}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-semibold"
              >
                View Invoices →
              </Link>
            </div>

            {/* Financial Highlights */}
            <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
              <div>
                <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Total Amount</div>
                <div className="text-lg font-bold text-emerald-400 mt-0.5">
                  {fmtAmt(selectedAgreement.totalAmount, selectedAgreement.currency ?? 'AED')}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Daily Rate</div>
                <div className="text-lg font-bold text-[var(--text-main)] mt-0.5">
                  {fmtAmt(selectedAgreement.dailyRate, selectedAgreement.currency ?? 'AED')}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Deposit</div>
                <div className="text-sm font-bold text-[var(--text-main)] mt-1">
                  {fmtAmt(selectedAgreement.securityDeposit, selectedAgreement.currency ?? 'AED')}{' '}
                  <span className="text-xs text-amber-400">({selectedAgreement.depositStatus ?? 'PENDING'})</span>
                </div>
              </div>
            </div>

            {/* Schedule & Telemetry */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-1">
                <div className="text-[var(--text-muted)] font-semibold uppercase">Pick-Up (Out)</div>
                <div className="text-sm font-bold text-[var(--text-main)]">{fmt(selectedAgreement.startDate)}</div>
                <div className="text-[var(--text-faint)]">{selectedAgreement.booking?.pickupLocation ?? 'Main Counter'}</div>
                <div className="font-mono text-[var(--text-muted)] pt-1">
                  Odometer: {selectedAgreement.mileageOut != null ? `${Number(selectedAgreement.mileageOut).toLocaleString()} km` : '—'}
                </div>
                <div className="font-mono text-[var(--text-muted)]">
                  Fuel:{' '}
                  {resolveStoredFuelPct(selectedAgreement.pickupFuelLevel, selectedAgreement.fuelOut) != null
                    ? formatCanonicalFuelDisplay(selectedAgreement.fuelOut, { pctColumn: selectedAgreement.pickupFuelLevel })
                    : '—'}
                </div>
              </div>
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-1">
                <div className="text-[var(--text-muted)] font-semibold uppercase">Return (In)</div>
                <div className="text-sm font-bold text-[var(--text-main)]">{fmt(selectedAgreement.endDate)}</div>
                <div className="text-[var(--text-faint)]">{selectedAgreement.booking?.dropoffLocation ?? 'Main Counter'}</div>
                <div className="font-mono text-[var(--text-muted)] pt-1">
                  Odometer: {selectedAgreement.mileageIn != null ? `${Number(selectedAgreement.mileageIn).toLocaleString()} km` : '—'}
                </div>
                <div className="font-mono text-[var(--text-muted)]">
                  Fuel:{' '}
                  {resolveStoredFuelPct(selectedAgreement.returnFuelLevel, selectedAgreement.fuelIn) != null
                    ? formatCanonicalFuelDisplay(selectedAgreement.fuelIn, { pctColumn: selectedAgreement.returnFuelLevel })
                    : '—'}
                </div>
              </div>
            </div>

            {/* PDF Links */}
            <div className="flex gap-2.5 pt-2 border-t border-[var(--border-subtle)]">
              <a
                href={`/api/rental/agreements/${selectedAgreement.id}/pdf?lang=en&download=1`}
                className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25"
              >
                Download Agreement PDF (EN)
              </a>
              <a
                href={`/api/rental/agreements/${selectedAgreement.id}/pdf?lang=ar&download=1`}
                className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25"
              >
                Download Agreement PDF (AR)
              </a>
            </div>
          </div>
        </SlideOverDrawer>
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-main)]">Rental Agreements</h1>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">
              Agreement lifecycle, odometer baseline &amp; counter settlement links
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {deepLinkId && (
              <button
                onClick={() => router.push('/rental/agreements')}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25"
              >
                <span>Filtered by Agreement</span>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <Link
              href="/rental/counter"
              className="border border-teal-500/30 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
            >
              Counter Desk
            </Link>
            <Link
              href="/rental/bookings"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
            >
              ➕ New Booking
            </Link>
          </div>
        </div>

        {/* 403 RBAC Error Banner */}
        {rbacBanner && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3.5 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  Requires RAC Manager Permission (403)
                </p>
                <p className="text-xs text-amber-200/80 mt-0.5">{rbacBanner}</p>
              </div>
            </div>
            <button
              onClick={() => setRbacBanner('')}
              className="text-amber-300/70 hover:text-amber-200 text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error Banner */}
        {errorBanner && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorBanner}</span>
            </div>
            <button
              onClick={() => setErrorBanner('')}
              className="text-rose-300/70 hover:text-rose-200 text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* Refund / Update Notice Banner */}
        {noticeBanner && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{noticeBanner}</span>
            </div>
            <button
              onClick={() => setNoticeBanner('')}
              className="text-emerald-300/70 hover:text-emerald-200 text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* Summary stats driven by tenant-wide server summary */}
        <StatGrid cols={3}>
          <KpiCard
            label="Active Revenue"
            value={`AED ${summary.activeRevenue.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`}
            sub={`${summary.ACTIVE} active agreements`}
            accent="emerald"
          />
          <KpiCard
            label="Pending Deposits"
            value={summary.pendingDeposits}
            sub="awaiting payment"
            accent="amber"
          />
          <KpiCard
            label="Draft / Completed"
            value={`${summary.DRAFT} Draft · ${summary.COMPLETED} Done`}
            sub={`${summary.ALL} total agreements`}
            accent="cyan"
          />
        </StatGrid>

        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map(t => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                tab === t
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'text-[var(--text-muted)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]'
              }`}
            >
              {STATUS_CONFIG[t as keyof typeof STATUS_CONFIG]?.label ?? t}
              <span className="ml-1.5 opacity-60">{summary[t as keyof AgreementSummaryCounts] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by agreement number, customer, booking ref…"
          className="w-full bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-emerald-500/40"
        />

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-72 bg-[var(--bg-surface)]/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-16 text-center space-y-3">
            <div className="text-5xl">📄</div>
            <p className="text-[var(--text-muted)]">No rental agreements found</p>
            <p className="text-[var(--text-faint)] text-xs">
              Agreements are created at Pick-Up Handover from confirmed bookings
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(a => (
              <AgreementCard
                key={a.id}
                agreement={a}
                onSelect={setSelectedAgreement}
                onAction={setActionTarget}
                onESign={setEsignTarget}
                onSwap={setSwapTarget}
                onImmobilize={setImmobilizeTarget}
                onReportTarrashud={handleReportTarrashud}
                reportingTarrashudId={reportingTarrashudId}
                onGenerateInvoice={handleGenerateInvoice}
                generatingInvId={generatingInvId}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-medium hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs text-[var(--text-muted)]">
              Page {page} of {totalPages} ({total} agreements)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-xs font-medium hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function RentalAgreementsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-[var(--text-muted)] animate-pulse">
          Loading rental agreements…
        </div>
      }
    >
      <RentalAgreementsInner />
    </Suspense>
  );
}
