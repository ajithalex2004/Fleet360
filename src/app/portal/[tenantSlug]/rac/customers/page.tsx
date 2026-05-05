'use client';

/**
 * Portal — RAC Customer Portal entry. Pick a customer or view the
 * customer-scoped dashboard. Mirror of the leasing portal pattern.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Calendar, FileText, Receipt, Car } from 'lucide-react';

interface Customer {
  id: string;
  fullName: string;
  companyName: string | null;
  customerType: string | null;
  email: string | null;
  phone: string | null;
  drivingLicenseNo: string | null;
  loyaltyPoints?: number | null;
  totalRentals?: number | null;
}

interface Booking {
  id: string; bookingRef: string | null; vehicleCategory: string | null;
  pickupDate: string; dropoffDate: string; totalAmount: number | null; status: string;
}

interface Agreement {
  id: string; agreementNo: string | null; startDate: string; endDate: string;
  status: string | null; totalAmount: number | null;
}

interface Invoice {
  id: string; invoiceNo: string | null; totalAmount: number;
  paidAmount: number; balanceDue: number | null; status: string;
}

const STATUS_BG: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CONFIRMED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  COMPLETED: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  PENDING: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function RacCustomerPortalPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';

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
      const cRes = await fetch('/api/rental/customers');
      const cData = cRes.ok ? await cRes.json() : [];
      setCustomers(Array.isArray(cData) ? cData : []);

      if (customerId) {
        const me = (Array.isArray(cData) ? cData : []).find((x: Customer) => x.id === customerId) ?? null;
        setCustomer(me);

        const [bRes, aRes, iRes] = await Promise.all([
          fetch('/api/rental/bookings'),
          fetch('/api/rental/agreements'),
          fetch('/api/rental/invoices'),
        ]);
        const [bData, aData, iData] = await Promise.all([
          bRes.ok ? bRes.json() : [],
          aRes.ok ? aRes.json() : [],
          iRes.ok ? iRes.json() : [],
        ]);
        setBookings((Array.isArray(bData) ? bData : []).filter((b: any) => b.customerId === customerId));
        setAgreements((Array.isArray(aData) ? aData : []).filter((a: any) => a.customerId === customerId));
        setInvoices((Array.isArray(iData) ? iData : []).filter((i: any) => i.customerId === customerId));
      } else {
        setCustomer(null);
        setBookings([]);
        setAgreements([]);
        setInvoices([]);
      }
    } finally { setLoading(false); }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const filteredCustomers = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      c.fullName.toLowerCase().includes(q) ||
      (c.companyName ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.drivingLicenseNo ?? '').toLowerCase().includes(q));
  }, [customers, filter]);

  const aggregates = useMemo(() => {
    const activeBookings = bookings.filter((b) => ['CONFIRMED', 'ACTIVE'].includes(b.status)).length;
    const activeAgreements = agreements.filter((a) => a.status === 'ACTIVE').length;
    const totalSpend = invoices.filter((i) => i.status === 'PAID')
      .reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);
    const outstanding = invoices.filter((i) => !['PAID', 'CANCELLED', 'VOID'].includes(i.status))
      .reduce((s, i) => s + Number(i.balanceDue ?? i.totalAmount ?? 0), 0);
    return { activeBookings, activeAgreements, totalSpend, outstanding };
  }, [bookings, agreements, invoices]);

  if (!customerId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <Link href={`/portal/${tenantSlug}/rac`} className="text-xs text-slate-500 hover:text-cyan-400">
            ← Back to fleet view
          </Link>
          <h1 className="text-2xl font-bold mt-1">RAC Customer Portal</h1>
          <p className="text-sm text-slate-400 mt-1">
            Pick a customer to view their bookings, agreements, and invoices.
          </p>
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
            {filteredCustomers.slice(0, 50).map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/portal/${tenantSlug}/rac/customers?customerId=${c.id}`)}
                className="w-full text-left p-3 rounded-lg bg-slate-800/50 border border-slate-700 hover:bg-slate-700/50 transition flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">{c.companyName ?? c.fullName}</div>
                  <div className="text-xs text-slate-400">
                    {c.customerType === 'CORPORATE' ? 'B2B Corporate' : 'B2C Individual'}
                    {c.totalRentals != null ? ` · ${c.totalRentals} prior rentals` : ''}
                    {c.loyaltyPoints != null && c.loyaltyPoints > 0 ? ` · ${c.loyaltyPoints} loyalty pts` : ''}
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

  const isCorporate = customer.customerType === 'CORPORATE';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href={`/portal/${tenantSlug}/rac/customers`} className="text-xs text-slate-500 hover:text-cyan-400">
            ← Switch customer
          </Link>
          <h1 className="text-2xl font-bold mt-1">{customer.companyName ?? customer.fullName}</h1>
          <div className="text-sm text-slate-400 mt-1">
            {isCorporate ? `B2B Corporate Customer` : `B2C Individual Customer`}
            {customer.email ? ` · ${customer.email}` : ''}
            {customer.drivingLicenseNo ? ` · DL ${customer.drivingLicenseNo}` : ''}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Active Bookings" value={aggregates.activeBookings.toString()} />
        <Kpi label="Active Agreements" value={aggregates.activeAgreements.toString()} />
        <Kpi label="Total Spend (paid)" value={`AED ${aggregates.totalSpend.toLocaleString('en-US', { minimumFractionDigits: 0 })}`} />
        <Kpi
          label="Outstanding"
          value={aggregates.outstanding > 0
            ? `AED ${aggregates.outstanding.toLocaleString('en-US', { minimumFractionDigits: 0 })}`
            : '—'}
          tone={aggregates.outstanding > 0 ? 'danger' : 'neutral'}
        />
      </div>

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
            {bookings.slice(0, 5).map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm py-2 border-t border-slate-800 first:border-t-0">
                <div>
                  <div className="font-mono text-xs text-cyan-300">{b.bookingRef ?? b.id.slice(0, 8)}</div>
                  <div className="text-white">{b.vehicleCategory ?? '—'}</div>
                  <div className="text-xs text-slate-400">
                    {new Date(b.pickupDate).toLocaleDateString('en-GB')} → {new Date(b.dropoffDate).toLocaleDateString('en-GB')}
                  </div>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_BG[b.status] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                    {b.status}
                  </span>
                  {b.totalAmount != null && (
                    <div className="text-xs text-slate-400 mt-1">AED {Number(b.totalAmount).toLocaleString()}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`p-4 rounded-xl border ${tone === 'danger' ? 'bg-rose-900/20 border-rose-700/40' : 'bg-slate-800/40 border-slate-700'}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === 'danger' ? 'text-rose-300' : 'text-white'}`}>{value}</div>
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
