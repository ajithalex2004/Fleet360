'use client';

/**
 * Portal — Leasing Dashboard
 *
 * v1.0: read-only view scoped to a single lessee, identified via ?lesseeId=X.
 * If no lesseeId is given, shows a simple search/picker so STS staff can
 * "view as customer". B2B (corporate) and B2C (individual) get different
 * top-line widgets (fleet view vs single-vehicle view).
 *
 * Lessee-level email auth is deferred to v1.1.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

interface Lessee {
  id: string;
  name: string;
  type: 'corporate' | 'individual' | string;
  tradeLicense?: string | null;
  emiratesId?: string | null;
  nationality?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface PortalContract {
  id: string;
  contractNumber: string;
  leaseType: string;
  status: string;
  vehicleCount: number;
  monthlyRate: number;
  startDate: string;
  endDate: string;
}

interface PortalInvoice {
  id: string;
  invoiceNo: string | null;
  billingPeriod: string | null;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  status: string;
}

export default function LeasingPortalDashboard() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const lesseeId = search.get('lesseeId') ?? '';

  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [lessee, setLessee] = useState<Lessee | null>(null);
  const [contracts, setContracts] = useState<PortalContract[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search_, setSearch_] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // Always load the lessee list for the picker.
      const lRes = await fetch('/api/leasing/lessees');
      const lData = lRes.ok ? await lRes.json() : [];
      setLessees(Array.isArray(lData) ? lData : []);

      if (lesseeId) {
        const me = (Array.isArray(lData) ? lData : []).find((l: Lessee) => l.id === lesseeId) ?? null;
        setLessee(me);

        // Load contracts and filter client-side (the API doesn't take lesseeId yet).
        const cRes = await fetch('/api/leasing/contracts-v2');
        const cData = cRes.ok ? await cRes.json() : [];
        const myContracts = (Array.isArray(cData) ? cData : []).filter(
          (c: any) => c.lesseeId === lesseeId || (typeof c.lessee === 'string' && false), // server uses lessee:string for display
        );
        // Fallback: server may not expose lesseeId in list. If empty, fetch by id.
        if (myContracts.length === 0 && Array.isArray(cData)) {
          // Try matching by lessee.name === lessee.name as a last resort.
          if (me) {
            const matched = (cData as any[]).filter(c => c.lessee === me.name);
            setContracts(matched.map(toPortalContract));
          } else {
            setContracts([]);
          }
        } else {
          setContracts(myContracts.map(toPortalContract));
        }

        // Load invoices — endpoint already supports lesseeId filter.
        const iRes = await fetch(`/api/leasing/invoices?lesseeId=${lesseeId}`);
        const iData = iRes.ok ? await iRes.json() : [];
        setInvoices(Array.isArray(iData) ? iData.map(toPortalInvoice) : []);
      } else {
        setLessee(null);
        setContracts([]);
        setInvoices([]);
      }
    } finally {
      setLoading(false);
    }
  }, [lesseeId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredLessees = useMemo(() => {
    const q = search_.toLowerCase();
    if (!q) return lessees;
    return lessees.filter(
      l =>
        l.name.toLowerCase().includes(q) ||
        (l.email ?? '').toLowerCase().includes(q) ||
        (l.tradeLicense ?? '').toLowerCase().includes(q) ||
        (l.emiratesId ?? '').toLowerCase().includes(q),
    );
  }, [lessees, search_]);

  const aggregates = useMemo(() => {
    const activeContracts = contracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED').length;
    const totalVehicles = contracts.reduce((s, c) => s + (c.vehicleCount ?? 0), 0);
    const monthlySpend = contracts.reduce((s, c) => s + (c.monthlyRate ?? 0), 0);
    const overdueInvoices = invoices.filter(i => i.status === 'OVERDUE').length;
    const overdueAmount = invoices
      .filter(i => i.status === 'OVERDUE')
      .reduce((s, i) => s + i.totalAmount, 0);
    return { activeContracts, totalVehicles, monthlySpend, overdueInvoices, overdueAmount };
  }, [contracts, invoices]);

  const isCorporate = lessee?.type === 'corporate';

  // ── Lessee picker (no lesseeId in URL) ──────────────────────────────────
  if (!lesseeId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Leasing Portal</h1>
          <p className="text-sm text-slate-400 mt-1">
            Pick a lessee to view their contracts, invoices, and documents.
          </p>
        </div>
        <input
          type="text"
          placeholder="Search by name, email, trade license, or Emirates ID…"
          value={search_}
          onChange={e => setSearch_(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white"
        />
        {loading ? (
          <div className="text-slate-500">Loading lessees…</div>
        ) : filteredLessees.length === 0 ? (
          <div className="text-slate-500">No lessees match.</div>
        ) : (
          <div className="space-y-2">
            {filteredLessees.slice(0, 50).map(l => (
              <button
                key={l.id}
                onClick={() => router.push(`/portal/${tenantSlug}/leasing?lesseeId=${l.id}`)}
                className="w-full text-left p-3 rounded-lg bg-slate-800/50 border border-slate-700 hover:bg-slate-700/50 transition flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-slate-400">
                    {l.type === 'corporate'
                      ? `B2B · ${l.tradeLicense ?? 'no TL'}`
                      : `B2C · ${l.emiratesId ?? 'no EID'}${l.nationality ? ` · ${l.nationality}` : ''}`}
                  </div>
                </div>
                <span className="text-slate-600">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Lessee dashboard ────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }
  if (!lessee) {
    return (
      <div className="p-6">
        <p className="text-rose-400">Lessee not found.</p>
        <Link href={`/portal/${tenantSlug}/leasing`} className="text-cyan-400 underline text-sm">
          ← Pick another lessee
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/portal/${tenantSlug}/leasing`}
            className="text-xs text-slate-500 hover:text-cyan-400"
          >
            ← Switch lessee
          </Link>
          <h1 className="text-2xl font-bold mt-1">{lessee.name}</h1>
          <div className="text-sm text-slate-400 mt-1">
            {isCorporate
              ? `B2B Corporate Lessee${lessee.tradeLicense ? ` · TL ${lessee.tradeLicense}` : ''}`
              : `B2C Individual Lessee${lessee.emiratesId ? ` · EID ${lessee.emiratesId}` : ''}${lessee.nationality ? ` · ${lessee.nationality}` : ''}`}
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium border ${
            isCorporate
              ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
              : 'bg-violet-500/20 text-violet-300 border-violet-500/30'
          }`}
        >
          {isCorporate ? 'B2B · Fleet view' : 'B2C · My vehicle view'}
        </span>
      </div>

      {/* KPI cards — content adapts to B2B vs B2C */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={isCorporate ? 'Active Contracts' : 'My Contract'}
          value={aggregates.activeContracts.toString()}
        />
        <KpiCard
          label={isCorporate ? 'Vehicles in Fleet' : 'Vehicle'}
          value={aggregates.totalVehicles.toString()}
        />
        <KpiCard
          label="Monthly Spend"
          value={`AED ${aggregates.monthlySpend.toLocaleString('en-US', { minimumFractionDigits: 0 })}`}
        />
        <KpiCard
          label="Overdue Invoices"
          value={
            aggregates.overdueInvoices > 0
              ? `${aggregates.overdueInvoices} · AED ${aggregates.overdueAmount.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
              : '—'
          }
          tone={aggregates.overdueInvoices > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PortalLink
          href={`/portal/${tenantSlug}/leasing/contracts?lesseeId=${lessee.id}`}
          icon="📜"
          title={isCorporate ? 'Fleet Contracts' : 'My Contract'}
          subtitle={`${contracts.length} contract${contracts.length === 1 ? '' : 's'}`}
        />
        <PortalLink
          href={`/portal/${tenantSlug}/leasing/invoices?lesseeId=${lessee.id}`}
          icon="🧾"
          title="Invoices & Payments"
          subtitle={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'} on record`}
        />
        <PortalLink
          href={`/portal/${tenantSlug}/leasing/documents?lesseeId=${lessee.id}`}
          icon="📄"
          title="Documents"
          subtitle="KYC, insurance, agreements"
        />
      </div>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function toPortalContract(c: any): PortalContract {
  return {
    id: c.id,
    contractNumber: c.contractNumber ?? c.id?.slice(0, 8) ?? '—',
    leaseType: c.leaseType ?? '—',
    status: c.status ?? '—',
    vehicleCount: c.vehicleCount ?? (Array.isArray(c.vehicles) ? c.vehicles.length : 0),
    monthlyRate: Number(c.monthlyRate ?? 0),
    startDate: c.startDate ?? '',
    endDate: c.endDate ?? '',
  };
}

function toPortalInvoice(i: any): PortalInvoice {
  return {
    id: i.id,
    invoiceNo: i.invoiceNo ?? null,
    billingPeriod: i.billingPeriod ?? null,
    issueDate: i.issueDate ?? '',
    dueDate: i.dueDate ?? '',
    totalAmount: Number(i.totalAmount ?? 0),
    status: i.status ?? 'DRAFT',
  };
}

/* ── small UI primitives (kept inline so the file stays self-contained) ──── */

function KpiCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div
      className={`p-4 rounded-xl border ${
        tone === 'danger'
          ? 'bg-rose-900/20 border-rose-700/40'
          : 'bg-slate-800/40 border-slate-700'
      }`}
    >
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === 'danger' ? 'text-rose-300' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}

function PortalLink({ href, icon, title, subtitle }: { href: string; icon: string; title: string; subtitle: string }) {
  return (
    <Link
      href={href}
      className="block p-4 rounded-xl bg-slate-800/40 border border-slate-700 hover:bg-slate-700/40 transition"
    >
      <div className="text-2xl">{icon}</div>
      <div className="font-medium mt-2">{title}</div>
      <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
    </Link>
  );
}
