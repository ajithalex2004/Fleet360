'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Agreement {
  id: string;
  agreementNo: string | null;
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
  fuelIn: number | null;
  fuelOut: number | null;
  signedAt: string | null;
  signedBy: string | null;
  isCorporate: boolean | null;
  insurancePlanCode: string | null;
  createdAt: string | null;
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
    } | null;
    inspections: Array<{ id: string; type: string; mileage: number | null }>;
  } | null;
  payments: Array<{ id: string; amount: number; status: string; paymentDate: string }>;
  extensions: Array<{ id: string; extendedTo: string; dailyRate: number | null; status: string }>;
  charges: Array<{ id: string; description: string; amount: number; status: string }>;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  DRAFT:     { label: 'Draft',     icon: '📝', color: 'text-slate-400',   bg: 'bg-slate-500/10 border-slate-500/20',   badge: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  ACTIVE:    { label: 'Active',    icon: '🟢', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  COMPLETED: { label: 'Completed', icon: '✅', color: 'text-teal-400',    bg: 'bg-teal-500/10 border-teal-500/20',     badge: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  CANCELLED: { label: 'Cancelled', icon: '❌', color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',       badge: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

const DEPOSIT_STATUS = {
  PENDING:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  PAID:     'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  REFUNDED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmt(val: number | null, currency = 'AED') {
  if (val === null || val === undefined) return '—';
  return `${currency} ${Number(val).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rentalDays(start: string, end: string) {
  const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24));
  return d > 0 ? d : 1;
}

// ── Status transition modal ───────────────────────────────────────────────────

function TransitionModal({ agreement, onClose, onDone }: {
  agreement: Agreement;
  onClose: () => void;
  onDone: () => void;
}) {
  const [action,    setAction]    = useState<'activate' | 'sign' | 'complete' | 'cancel' | 'refund_deposit'>('activate');
  const [signedBy,  setSignedBy]  = useState('');
  const [mileageIn, setMileageIn] = useState(String(agreement.mileageIn ?? ''));
  const [fuelIn,    setFuelIn]    = useState(String(agreement.fuelIn ?? ''));
  const [mileageOut,setMileageOut]= useState(String(agreement.mileageOut ?? ''));
  const [fuelOut,   setFuelOut]   = useState(String(agreement.fuelOut ?? ''));
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const status = agreement.status ?? 'DRAFT';

  const actions: Array<{ key: typeof action; label: string; show: boolean; color: string }> = [
    { key: 'activate',      label: '🟢 Activate Agreement',  show: status === 'DRAFT',     color: 'bg-emerald-600 hover:bg-emerald-500' },
    { key: 'sign',          label: '✍️ Mark as Signed',       show: status === 'DRAFT',     color: 'bg-blue-600 hover:bg-blue-500' },
    { key: 'complete',      label: '✅ Complete & Return',    show: status === 'ACTIVE',    color: 'bg-teal-600 hover:bg-teal-500' },
    { key: 'refund_deposit',label: '💰 Refund Security Dep.', show: agreement.depositStatus === 'PAID', color: 'bg-violet-600 hover:bg-violet-500' },
    { key: 'cancel',        label: '❌ Cancel Agreement',     show: ['DRAFT','ACTIVE'].includes(status), color: 'bg-red-700 hover:bg-red-600' },
  ].filter(a => a.show);

  const handle = async () => {
    setSaving(true); setError('');
    try {
      const payload: Record<string, unknown> = {};
      if (action === 'activate')       { payload.status = 'ACTIVE'; if (mileageIn) payload.mileageIn = Number(mileageIn); if (fuelIn) payload.fuelIn = Number(fuelIn); }
      if (action === 'sign')           { payload.signedAt = new Date().toISOString(); payload.signedBy = signedBy || 'Customer'; }
      if (action === 'complete')       { payload.status = 'COMPLETED'; if (mileageOut) payload.mileageOut = Number(mileageOut); if (fuelOut) payload.fuelOut = Number(fuelOut); }
      if (action === 'cancel')         { payload.status = 'CANCELLED'; }
      if (action === 'refund_deposit') { payload.depositStatus = 'REFUNDED'; }

      const res = await fetch(`/api/rental/agreements/${agreement.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-md">
        <div className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-white">Update Agreement</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-400">
            <span className="font-mono text-white">{agreement.agreementNo}</span> ·{' '}
            {agreement.booking?.customer?.fullName ?? '—'}
          </p>

          {/* Action selector */}
          <div className="space-y-1.5">
            {actions.map(a => (
              <label key={a.key} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                action === a.key
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-white/5 bg-slate-800/40 hover:border-white/10'
              }`}>
                <input type="radio" name="action" value={a.key}
                  checked={action === a.key} onChange={() => setAction(a.key as typeof action)}
                  className="accent-amber-500" />
                <span className="text-sm text-white">{a.label}</span>
              </label>
            ))}
          </div>

          {/* Contextual fields */}
          {action === 'sign' && (
            <input value={signedBy} onChange={e => setSignedBy(e.target.value)}
              placeholder="Signed by (name)"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
          )}
          {action === 'activate' && (
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={mileageIn} onChange={e => setMileageIn(e.target.value)} placeholder="Odometer (km)" className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
              <input type="number" value={fuelIn} onChange={e => setFuelIn(e.target.value)} placeholder="Fuel level %" min={0} max={100} className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
          )}
          {action === 'complete' && (
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={mileageOut} onChange={e => setMileageOut(e.target.value)} placeholder="Return odometer" className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
              <input type="number" value={fuelOut} onChange={e => setFuelOut(e.target.value)} placeholder="Return fuel %" min={0} max={100} className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40" />
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button onClick={handle} disabled={saving || actions.length === 0}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
            {saving ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agreement card ────────────────────────────────────────────────────────────

function AgreementCard({ agreement, onAction }: {
  agreement: Agreement;
  onAction: (a: Agreement) => void;
}) {
  const cfg    = STATUS_CONFIG[agreement.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.DRAFT;
  const days   = rentalDays(agreement.startDate, agreement.endDate);
  const kmUsed = agreement.mileageIn != null && agreement.mileageOut != null
    ? agreement.mileageOut - agreement.mileageIn : null;
  const hasInspection = (agreement.booking?.inspections ?? []).length > 0;

  return (
    <div className={`rounded-2xl border p-5 space-y-4 transition-all hover:brightness-110 ${cfg.bg}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-bold text-white">{agreement.agreementNo ?? '—'}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {agreement.booking?.customer?.fullName ?? '—'}
            {agreement.isCorporate && <span className="ml-1.5 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-1.5 py-0.5">Corp</span>}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.badge}`}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      {/* Vehicle + dates */}
      {agreement.booking?.vehicleCategory && (
        <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 inline-block px-2 py-0.5 rounded font-mono">
          {agreement.booking.vehicleCategory}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-900/40 rounded-xl p-2.5">
          <p className="text-slate-500">Pickup</p>
          <p className="text-white font-medium mt-0.5">{fmt(agreement.startDate)}</p>
          {agreement.booking?.pickupLocation && <p className="text-slate-600 truncate">{agreement.booking.pickupLocation}</p>}
        </div>
        <div className="bg-slate-900/40 rounded-xl p-2.5">
          <p className="text-slate-500">Return</p>
          <p className="text-white font-medium mt-0.5">{fmt(agreement.endDate)}</p>
          {agreement.booking?.dropoffLocation && <p className="text-slate-600 truncate">{agreement.booking.dropoffLocation}</p>}
        </div>
      </div>

      {/* Financials */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">{days} days × {fmtAmt(agreement.dailyRate, agreement.currency ?? 'AED')}/day</span>
          <span className="text-white font-semibold">{fmtAmt(agreement.totalAmount, agreement.currency ?? 'AED')}</span>
        </div>
        {agreement.securityDeposit !== null && (
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Security deposit</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-300">{fmtAmt(agreement.securityDeposit, agreement.currency ?? 'AED')}</span>
              <span className={`px-1.5 py-0.5 rounded-full text-xs border ${DEPOSIT_STATUS[agreement.depositStatus as keyof typeof DEPOSIT_STATUS] ?? DEPOSIT_STATUS.PENDING}`}>
                {agreement.depositStatus ?? 'PENDING'}
              </span>
            </div>
          </div>
        )}
        {kmUsed !== null && (
          <div className="flex justify-between">
            <span className="text-slate-500">KM used</span>
            <span className="text-slate-300">{kmUsed.toLocaleString()} km</span>
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
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {['DRAFT','ACTIVE'].includes(agreement.status ?? '') && (
          <button onClick={() => onAction(agreement)}
            className="flex-1 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 py-2 rounded-xl font-medium transition-colors">
            ⚡ Update Status
          </button>
        )}
        {agreement.booking && (
          <Link href={`/rental/bookings/${agreement.booking.id}/inspect`}
            className="text-xs text-slate-500 hover:text-slate-300 border border-white/10 px-3 py-2 rounded-xl transition-colors">
            🔍 Inspect
          </Link>
        )}
        {agreement.booking && (
          <Link href={`/rental/invoices?agreementId=${agreement.id}`}
            className="text-xs text-slate-500 hover:text-slate-300 border border-white/10 px-3 py-2 rounded-xl transition-colors">
            🧾
          </Link>
        )}
        <a
          href={`/api/rental/agreements/${agreement.id}/pdf?lang=en&download=1`}
          className="text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 px-3 py-2 rounded-xl transition-colors"
          title="Download bilingual rental agreement (EN layout)"
        >
          PDF·EN
        </a>
        <a
          href={`/api/rental/agreements/${agreement.id}/pdf?lang=ar&download=1`}
          className="text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 px-3 py-2 rounded-xl transition-colors"
          title="Download bilingual rental agreement (AR layout)"
        >
          PDF·AR
        </a>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const STATUS_TABS = ['ALL', 'DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

export default function RentalAgreementsPage() {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState('ALL');
  const [search,     setSearch]     = useState('');
  const [actionTarget, setActionTarget] = useState<Agreement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = tab === 'ALL' ? '/api/rental/agreements?limit=500' : `/api/rental/agreements?status=${tab}&limit=500`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setAgreements(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const filtered = agreements.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [a.agreementNo, a.booking?.customer?.fullName, a.booking?.bookingRef]
      .some(v => v?.toLowerCase().includes(q));
  });

  const counts = {
    ALL:       agreements.length,
    DRAFT:     agreements.filter(a => a.status === 'DRAFT').length,
    ACTIVE:    agreements.filter(a => a.status === 'ACTIVE').length,
    COMPLETED: agreements.filter(a => a.status === 'COMPLETED').length,
    CANCELLED: agreements.filter(a => a.status === 'CANCELLED').length,
  };

  // Summary stats for active agreements
  const activeTotal = agreements
    .filter(a => a.status === 'ACTIVE')
    .reduce((s, a) => s + (Number(a.totalAmount) || 0), 0);

  const pendingDeposits = agreements.filter(a => a.depositStatus === 'PENDING').length;

  return (
    <>
      {actionTarget && (
        <TransitionModal
          agreement={actionTarget}
          onClose={() => setActionTarget(null)}
          onDone={() => { setActionTarget(null); load(); }}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Rental Agreements</h1>
            <p className="text-slate-400 text-sm mt-0.5">Agreement lifecycle management</p>
          </div>
          <Link href="/rental/bookings"
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
            ➕ New Booking
          </Link>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Active Revenue</p>
            <p className="text-xl font-bold text-emerald-400 mt-1">
              AED {activeTotal.toLocaleString('en-AE', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-slate-600 mt-0.5">{counts.ACTIVE} active agreements</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Pending Deposits</p>
            <p className="text-xl font-bold text-amber-400 mt-1">{pendingDeposits}</p>
            <p className="text-xs text-slate-600 mt-0.5">awaiting payment</p>
          </div>
          <div className="bg-slate-800/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">Draft Agreements</p>
            <p className="text-xl font-bold text-slate-300 mt-1">{counts.DRAFT}</p>
            <p className="text-xs text-slate-600 mt-0.5">need activation</p>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                tab === t
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
              }`}>
              {STATUS_CONFIG[t as keyof typeof STATUS_CONFIG]?.label ?? t}
              <span className="ml-1.5 opacity-60">{counts[t as keyof typeof counts] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by agreement number, customer, booking ref…"
          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40" />

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className="h-72 bg-slate-800/60 rounded-2xl animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-16 text-center space-y-3">
            <div className="text-5xl">📄</div>
            <p className="text-slate-400">No rental agreements found</p>
            <p className="text-slate-600 text-xs">Agreements are created from confirmed bookings</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(a => (
              <AgreementCard key={a.id} agreement={a} onAction={setActionTarget} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
