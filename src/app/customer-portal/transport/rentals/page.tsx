'use client';

/**
 * Customer Portal — Rent-a-Car: the company's rental bookings, rental
 * agreements and rental invoices, with agreement and invoice PDFs. The data
 * comes from the Rental-car APIs (/api/rac-portal/*), which accept the
 * Customer Portal session for companies linked to a rental customer.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarCheck, FileText, Receipt, Download } from 'lucide-react';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import { FormAlert } from '@/components/ui/form-kit';
import { fmtDateTime } from '../transport-shared';
import { fmtMoney, shipmentStatusLabel as statusLabel } from '../shipments/shipments-shared';

interface Booking {
  id: string; bookingRef: string; vehicleCategory: string; pickupDate: string; dropoffDate: string;
  pickupLocation: string | null; dropoffLocation: string | null; totalDays: number; totalAmount: number; currency: string;
  status: string; vehicle: { make: string; model: string; plateNumber: string } | null;
  preauth: { cardBrand: string; status: string } | null;
}
interface Agreement {
  id: string; agreementNo: string; bookingRef: string | null; startDate: string; endDate: string; actualReturnDate: string | null;
  totalAmount: number; currency: string; securityDeposit?: number | null; status: string; signedByCustomer: boolean;
  signedAt: string | null; vehicle: { make: string; model: string } | null;
}
interface Invoice {
  id: string; invoiceNo: string; agreementNo: string | null; invoiceType: string | null; invoiceDate: string | null; dueDate: string | null;
  totalAmount: number; paidAmount: number; balanceDue: number; currency: string; status: string;
}

type View = 'bookings' | 'agreements' | 'invoices';
const VIEWS: Array<{ key: View; label: string; icon: typeof CalendarCheck }> = [
  { key: 'bookings', label: 'Bookings', icon: CalendarCheck },
  { key: 'agreements', label: 'Agreements', icon: FileText },
  { key: 'invoices', label: 'Invoices', icon: Receipt },
];

function tone(s: string): string {
  if (['PAID', 'CLOSED', 'COMPLETED', 'RETURNED'].includes(s)) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30';
  if (['CANCELLED', 'VOID', 'OVERDUE', 'NO_SHOW'].includes(s)) return 'bg-rose-500/10 text-rose-600 border-rose-500/30';
  if (['PENDING', 'DRAFT', 'PARTIALLY_PAID', 'UNPAID', 'ISSUED'].includes(s)) return 'bg-amber-500/10 text-amber-600 border-amber-500/30';
  return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
}
const Pill = ({ s }: { s: string }) => <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${tone(s)}`}>{statusLabel(s)}</span>;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const Pdf = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"><Download className="w-3 h-3" /> PDF</a>
);

async function load<T>(url: string, key: string): Promise<{ rows: T[] } | { error: string }> {
  const res = await fetch(url, { cache: 'no-store' });
  const d = await res.json().catch(() => null);
  if (!res.ok) return { error: d?.error ?? 'Could not load your rentals' };
  return { rows: (d?.[key] ?? []) as T[] };
}

function RentalsView() {
  const router = useRouter();
  const params = useSearchParams();
  const view = (VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'bookings') as View;
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    void (async () => {
      if (view === 'bookings' && !bookings) {
        const r = await load<Booking>('/api/rac-portal/bookings', 'bookings');
        if ('error' in r) { setErr(r.error); setBookings([]); } else setBookings(r.rows);
      }
      if (view === 'agreements' && !agreements) {
        const r = await load<Agreement>('/api/rac-portal/agreements', 'agreements');
        if ('error' in r) { setErr(r.error); setAgreements([]); } else setAgreements(r.rows);
      }
      if (view === 'invoices' && !invoices) {
        const r = await load<Invoice>('/api/rac-portal/invoices', 'invoices');
        if ('error' in r) { setErr(r.error); setInvoices([]); } else setInvoices(r.rows);
      }
    })();
  }, [view, bookings, agreements, invoices]);

  const bookingCols = useMemo<SmartDataGridColumn<Booking>[]>(() => [
    { key: 'ref', header: 'Booking', accessor: (b) => b.bookingRef, render: (b) => <span className="font-mono text-[11px]">{b.bookingRef}</span> },
    { key: 'vehicle', header: 'Vehicle', accessor: (b) => (b.vehicle ? `${b.vehicle.make} ${b.vehicle.model} · ${b.vehicle.plateNumber}` : b.vehicleCategory) },
    { key: 'from', header: 'Pickup', filter: false, accessor: (b) => b.pickupDate, render: (b) => <span className="text-xs whitespace-nowrap">{fmtDateTime(b.pickupDate)}</span> },
    { key: 'to', header: 'Return', filter: false, accessor: (b) => b.dropoffDate, render: (b) => <span className="text-xs whitespace-nowrap">{fmtDateTime(b.dropoffDate)}</span> },
    { key: 'where', header: 'Location', accessor: (b) => b.pickupLocation ?? '—' },
    { key: 'days', header: 'Days', align: 'right', filter: false, accessor: (b) => b.totalDays },
    { key: 'total', header: 'Total', align: 'right', filter: false, accessor: (b) => b.totalAmount, render: (b) => <span className="text-xs tabular-nums">{fmtMoney(b.totalAmount, b.currency)}</span> },
    { key: 'status', header: 'Status', filter: 'select', accessor: (b) => statusLabel(b.status), render: (b) => <Pill s={b.status} /> },
  ], []);

  const agreementCols = useMemo<SmartDataGridColumn<Agreement>[]>(() => [
    { key: 'no', header: 'Agreement', accessor: (a) => a.agreementNo, render: (a) => <span className="font-mono text-[11px]">{a.agreementNo}</span> },
    { key: 'vehicle', header: 'Vehicle', accessor: (a) => (a.vehicle ? `${a.vehicle.make} ${a.vehicle.model}` : '—') },
    { key: 'period', header: 'Period', filter: false, accessor: (a) => a.startDate, render: (a) => <span className="text-xs whitespace-nowrap">{day(a.startDate)} – {day(a.actualReturnDate ?? a.endDate)}</span> },
    { key: 'total', header: 'Total', align: 'right', filter: false, accessor: (a) => a.totalAmount, render: (a) => <span className="text-xs tabular-nums">{fmtMoney(a.totalAmount, a.currency)}</span> },
    { key: 'signed', header: 'Signed', filter: 'select', accessor: (a) => (a.signedByCustomer ? 'Signed' : 'Not signed'), render: (a) => <span className="text-xs">{a.signedByCustomer ? `Signed ${day(a.signedAt)}` : 'Not signed'}</span> },
    { key: 'status', header: 'Status', filter: 'select', accessor: (a) => statusLabel(a.status), render: (a) => <Pill s={a.status} /> },
    { key: 'pdf', header: '', filter: false, sortable: false, render: (a) => <Pdf href={`/api/rac-portal/agreements/${a.id}/pdf`} /> },
  ], []);

  const invoiceCols = useMemo<SmartDataGridColumn<Invoice>[]>(() => [
    { key: 'no', header: 'Invoice', accessor: (i) => i.invoiceNo, render: (i) => <span className="font-mono text-[11px]">{i.invoiceNo}</span> },
    { key: 'agr', header: 'Agreement', accessor: (i) => i.agreementNo ?? '—' },
    { key: 'date', header: 'Date', filter: false, accessor: (i) => i.invoiceDate ?? '', render: (i) => <span className="text-xs whitespace-nowrap">{day(i.invoiceDate)}</span> },
    { key: 'due', header: 'Due', filter: false, accessor: (i) => i.dueDate ?? '', render: (i) => <span className="text-xs whitespace-nowrap">{day(i.dueDate)}</span> },
    { key: 'total', header: 'Total', align: 'right', filter: false, accessor: (i) => i.totalAmount, render: (i) => <span className="text-xs tabular-nums">{fmtMoney(i.totalAmount, i.currency)}</span> },
    { key: 'balance', header: 'Balance due', align: 'right', filter: false, accessor: (i) => i.balanceDue, render: (i) => <span className={`text-xs tabular-nums ${i.balanceDue > 0 ? 'font-semibold text-amber-600' : ''}`}>{fmtMoney(i.balanceDue, i.currency)}</span> },
    { key: 'status', header: 'Status', filter: 'select', accessor: (i) => statusLabel(i.status), render: (i) => <Pill s={i.status} /> },
    { key: 'pdf', header: '', filter: false, sortable: false, render: (i) => <Pdf href={`/api/rac-portal/invoices/${i.id}/pdf`} /> },
  ], []);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1" role="tablist" aria-label="Rentals">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
            onClick={() => router.replace(`/customer-portal/transport/rentals?view=${v.key}`)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${view === v.key ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
            <v.icon className="w-3.5 h-3.5" /> {v.label}
          </button>
        ))}
      </div>
      {err && <FormAlert>{err}</FormAlert>}
      {view === 'bookings' && (
        <SmartDataGrid<Booking> rows={bookings ?? []} columns={bookingCols} getRowId={(b) => b.id} loading={!bookings}
          emptyMessage="No rental bookings yet." toolbar={{ title: 'Rental bookings', exportName: 'rental-bookings' }} />
      )}
      {view === 'agreements' && (
        <SmartDataGrid<Agreement> rows={agreements ?? []} columns={agreementCols} getRowId={(a) => a.id} loading={!agreements}
          emptyMessage="No rental agreements yet." toolbar={{ title: 'Rental agreements', exportName: 'rental-agreements' }} />
      )}
      {view === 'invoices' && (
        <SmartDataGrid<Invoice> rows={invoices ?? []} columns={invoiceCols} getRowId={(i) => i.id} loading={!invoices}
          emptyMessage="No rental invoices yet." toolbar={{ title: 'Rental invoices', exportName: 'rental-invoices' }} />
      )}
    </div>
  );
}

export default function RentalsPage() {
  return <Suspense fallback={null}><RentalsView /></Suspense>;
}
