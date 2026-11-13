'use client';

/**
 * Portal — RAC Customer Portal entry. Pick a customer or view the
 * customer-scoped dashboard. Mirror of the leasing portal pattern.
 */

import React, { Suspense, useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Calendar, FileText, Receipt, Car } from 'lucide-react';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import { BACK_BUTTON } from '@/lib/ui/toggle';
import { useVerifiedPortalTenant } from '../_use-verified-portal-tenant';

interface Customer {
  id: string;
  fullName: string;
  full_name?: string;
  companyName: string | null;
  company_name?: string | null;
  customerType: string | null;
  customer_type?: string | null;
  email: string | null;
  phone: string | null;
  drivingLicenseNo: string | null;
  driving_license_no?: string | null;
  loyaltyPoints?: number | null;
  totalRentals?: number | null;
}

interface Booking {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  bookingRef: string | null;
  booking_ref?: string | null;
  vehicleCategory: string | null;
  vehicle_category?: string | null;
  pickupDate: string;
  pickup_date?: string;
  dropoffDate: string;
  dropoff_date?: string;
  totalAmount: number | null;
  total_amount?: number | null;
  status: string;
}

interface Agreement {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  agreementNo: string | null;
  agreement_no?: string | null;
  startDate: string;
  endDate: string;
  status: string | null;
  totalAmount: number | null;
}

interface Invoice {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  invoiceNo: string | null;
  totalAmount: number;
  total_amount?: number;
  paidAmount: number;
  balanceDue: number | null;
  balance_due?: number | null;
  status: string;
}

function unwrapList<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const k of keys) {
      if (Array.isArray(rec[k])) return rec[k] as T[];
    }
  }
  return [];
}

const STATUS_BG: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CONFIRMED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  COMPLETED: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  PENDING: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

function RacCustomerPortalInner() {
  const params = useParams() ?? {};
  const search = useSearchParams() ?? new URLSearchParams();
  const router = useRouter();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';
  const guard = useVerifiedPortalTenant(tenantSlug);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cRes = await fetch('/api/rental/customers?limit=200', { cache: 'no-store' });
      const cRaw = cRes.ok ? await cRes.json() : [];
      const cList = unwrapList<Customer>(cRaw, ['data', 'customers', 'items', 'rows']);
      setCustomers(cList);

      if (customerId) {
        const me = cList.find((x) => x.id === customerId) ?? null;
        setCustomer(me);

        const qs = `?customerId=${encodeURIComponent(customerId)}&limit=200`;
        const [bRes, aRes, iRes] = await Promise.all([
          fetch(`/api/rental/bookings${qs}`, { cache: 'no-store' }),
          fetch(`/api/rental/agreements${qs}`, { cache: 'no-store' }),
          fetch(`/api/rental/invoices${qs}`, { cache: 'no-store' }),
        ]);
        const [bRaw, aRaw, iRaw] = await Promise.all([
          bRes.ok ? bRes.json() : [],
          aRes.ok ? aRes.json() : [],
          iRes.ok ? iRes.json() : [],
        ]);
        const bList = unwrapList<Booking>(bRaw, ['data', 'bookings', 'items', 'rows']);
        const aList = unwrapList<Agreement>(aRaw, ['data', 'agreements', 'items', 'rows']);
        const iList = unwrapList<Invoice>(iRaw, ['data', 'invoices', 'items', 'rows']);

        setBookings(bList.filter((b) => (b.customerId ?? b.customer_id) === customerId));
        setAgreements(aList.filter((a) => (a.customerId ?? a.customer_id) === customerId));
        setInvoices(iList.filter((i) => (i.customerId ?? i.customer_id) === customerId));
      } else {
        setCustomer(null);
        setBookings([]);
        setAgreements([]);
        setInvoices([]);
      }
    } finally { setLoading(false); }
  }, [customerId]);

  useEffect(() => {
    if (guard.status !== 'verified') return;
    load();
  }, [guard.status, load]);

  const filteredCustomers = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      (c.fullName ?? c.full_name ?? '').toLowerCase().includes(q) ||
      (c.companyName ?? c.company_name ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.drivingLicenseNo ?? c.driving_license_no ?? '').toLowerCase().includes(q));
  }, [customers, filter]);

  const aggregates = useMemo(() => {
    const activeBookings = bookings.filter((b) => ['CONFIRMED', 'ACTIVE'].includes(b.status)).length;
    const activeAgreements = agreements.filter((a) => a.status === 'ACTIVE').length;
    const totalSpend = invoices.filter((i) => i.status === 'PAID')
      .reduce((s, i) => s + Number(i.totalAmount ?? i.total_amount ?? 0), 0);
    const outstanding = invoices.filter((i) => !['PAID', 'CANCELLED', 'VOID'].includes(i.status))
      .reduce((s, i) => s + Number(i.balanceDue ?? i.balance_due ?? i.totalAmount ?? i.total_amount ?? 0), 0);
    return { activeBookings, activeAgreements, totalSpend, outstanding };
  }, [bookings, agreements, invoices]);

  if (guard.status === 'checking') {
    return <div className="p-6 text-slate-500">Verifying tenant access…</div>;
  }

  if (guard.status === 'mismatch') {
    const targetPath = guard.expectedSlug
      ? `/portal/${guard.expectedSlug}/rac/customers${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`
      : null;
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 space-y-3">
          <p className="text-rose-300 font-semibold text-base">Tenant Access Mismatch</p>
          <p className="text-slate-300 text-sm">
            Your signed-in session belongs to <span className="font-semibold text-white">{guard.tenant.name}</span>
            {guard.tenant.slug ? ` (${guard.tenant.slug})` : ''}, which does not match{' '}
            <span className="font-mono text-rose-200">/portal/{tenantSlug}/rac/customers</span>. Cross-tenant customer data display has been blocked.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {targetPath && (
              <Link
                href={targetPath}
                className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 transition-colors"
              >
                Switch to /portal/{guard.expectedSlug}/rac/customers →
              </Link>
            )}
            <Link
              href="/platform"
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 border border-white/10 text-xs font-semibold hover:bg-slate-700 transition-colors"
            >
              Back to Platform
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (guard.status === 'unauthorized') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 space-y-3">
          <p className="text-amber-300 font-semibold text-base">Authentication Required</p>
          <p className="text-slate-300 text-sm">
            Unable to verify your tenant session for <span className="font-mono text-amber-200">/portal/{tenantSlug}/rac/customers</span>.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
          >
            Go to Staff Sign In →
          </Link>
        </div>
      </div>
    );
  }

  if (!customerId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <Link href={`/portal/${tenantSlug}/rac`} className={BACK_BUTTON}>
              ← Back to fleet view
            </Link>
            <h1 className="text-2xl font-bold mt-1">RAC Customer Portal</h1>
            <p className="text-sm text-slate-400 mt-1">
              Pick a customer to view their bookings, agreements, and invoices.
            </p>
          </div>
          <a
            href="/rac-portal"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors"
          >
            🏢 Customer B2B Portal ↗
          </a>
        </div>
        <input
          type="text"
          placeholder="Search by name, email, company, or driving license…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white"
        />
        {loading ? (
          <div className="text-slate-500">Loading…</div>
        ) : filteredCustomers.length === 0 ? (
          <div className="text-slate-500">No customers match.</div>
        ) : (
          <div className="space-y-2">
            {filteredCustomers.slice(0, 50).map((c) => {
              const display = c.companyName ?? c.company_name ?? c.fullName ?? c.full_name ?? 'Customer';
              const cType = c.customerType ?? c.customer_type;
              return (
                <button
                  key={c.id}
                  onClick={() => router.push(`/portal/${tenantSlug}/rac/customers?customerId=${c.id}`)}
                  className="w-full text-left p-3 rounded-lg bg-slate-800/50 border border-slate-700 hover:bg-slate-700/50 transition flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{display}</div>
                    <div className="text-xs text-slate-400">
                      {cType === 'CORPORATE' ? 'B2B Corporate' : 'B2C Individual'}
                      {c.totalRentals != null ? ` · ${c.totalRentals} prior rentals` : ''}
                      {c.loyaltyPoints != null && c.loyaltyPoints > 0 ? ` · ${c.loyaltyPoints} loyalty pts` : ''}
                    </div>
                  </div>
                  <span className="text-slate-600">→</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (!customer) {
    return (
      <div className="p-6">
        <p className="text-rose-400">Customer not found.</p>
        <Link href={`/portal/${tenantSlug}/rac/customers`} className="text-cyan-400 underline text-sm">
          ← Pick another customer
        </Link>
      </div>
    );
  }

  const cType = customer.customerType ?? customer.customer_type;
  const isCorporate = cType === 'CORPORATE';
  const displayTitle = customer.companyName ?? customer.company_name ?? customer.fullName ?? customer.full_name;
  const dlNo = customer.drivingLicenseNo ?? customer.driving_license_no;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href={`/portal/${tenantSlug}/rac/customers`} className="text-xs text-slate-500 hover:text-cyan-400">
            ← Switch customer
          </Link>
          <h1 className="text-2xl font-bold mt-1">{displayTitle}</h1>
          <div className="text-sm text-slate-400 mt-1">
            {isCorporate ? `B2B Corporate Customer` : `B2C Individual Customer`}
            {customer.email ? ` · ${customer.email}` : ''}
            {dlNo ? ` · DL ${dlNo}` : ''}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {isCorporate && (
            <a
              href="/rac-portal"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors"
            >
              🏢 Customer B2B Portal ↗
            </a>
          )}
          {customer.loyaltyPoints != null && customer.loyaltyPoints > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-medium border bg-amber-500/20 text-amber-300 border-amber-500/30">
              {customer.loyaltyPoints} loyalty pts
            </span>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
            isCorporate
              ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
              : 'bg-violet-500/20 text-violet-300 border-violet-500/30'
          }`}>
            {isCorporate ? 'B2B · Fleet view' : 'B2C · My rentals'}
          </span>
        </div>
      </div>

      <StatGrid cols={4}>
        <KpiCard label="Active Bookings" value={aggregates.activeBookings.toString()} icon={Calendar} accent="cyan" />
        <KpiCard label="Active Agreements" value={aggregates.activeAgreements.toString()} icon={FileText} accent="emerald" />
        <KpiCard label="Total Spend (paid)" value={`AED ${aggregates.totalSpend.toLocaleString('en-US', { minimumFractionDigits: 0 })}`} icon={Receipt} accent="violet" />
        <KpiCard
          label="Outstanding"
          value={aggregates.outstanding > 0
            ? `AED ${aggregates.outstanding.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
            : '—'}
          accent={aggregates.outstanding > 0 ? 'rose' : 'slate'}
        />
      </StatGrid>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PortalLink
          href={`/portal/${tenantSlug}/rac/bookings?customerId=${customer.id}`}
          icon={<Calendar className="h-6 w-6" />}
          title={isCorporate ? 'Fleet Bookings' : 'My Bookings'}
          subtitle={`${bookings.length} booking${bookings.length === 1 ? '' : 's'} on record`}
        />
        <PortalLink
          href={`/portal/${tenantSlug}/rac/agreements?customerId=${customer.id}`}
          icon={<FileText className="h-6 w-6" />}
          title="Rental Agreements"
          subtitle={`${agreements.length} agreement${agreements.length === 1 ? '' : 's'}`}
        />
        <PortalLink
          href={`/portal/${tenantSlug}/rac/invoices?customerId=${customer.id}`}
          icon={<Receipt className="h-6 w-6" />}
          title="Invoices & Payments"
          subtitle={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
        />
      </div>

      {bookings.length > 0 && (
        <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Car className="h-4 w-4 text-slate-400" />
            <div className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Recent bookings</div>
          </div>
          <div className="space-y-2">
            {bookings.slice(0, 5).map((b) => {
              const ref = b.bookingRef ?? b.booking_ref ?? b.id.slice(0, 8);
              const cat = b.vehicleCategory ?? b.vehicle_category ?? '—';
              const pickup = b.pickupDate ?? b.pickup_date ?? '';
              const dropoff = b.dropoffDate ?? b.dropoff_date ?? '';
              const amt = b.totalAmount ?? b.total_amount;
              return (
                <div key={b.id} className="flex items-center justify-between text-sm py-2 border-t border-slate-800 first:border-t-0">
                  <div>
                    <div className="font-mono text-xs text-cyan-300">{ref}</div>
                    <div className="text-white">{cat}</div>
                    <div className="text-xs text-slate-400">
                      {pickup ? new Date(pickup).toLocaleDateString('en-GB') : '—'} → {dropoff ? new Date(dropoff).toLocaleDateString('en-GB') : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_BG[b.status] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                      {b.status}
                    </span>
                    {amt != null && (
                      <div className="text-xs text-slate-400 mt-1">AED {Number(amt).toLocaleString()}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PortalLink({ href, icon, title, subtitle }: { href: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <Link href={href} className="block p-4 rounded-xl bg-slate-800/40 border border-slate-700 hover:bg-slate-700/40 transition">
      <div className="text-cyan-400">{icon}</div>
      <div className="font-medium mt-2">{title}</div>
      <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
    </Link>
  );
}

export default function RacCustomerPortalPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500">Loading customer portal…</div>}>
      <RacCustomerPortalInner />
    </Suspense>
  );
}
