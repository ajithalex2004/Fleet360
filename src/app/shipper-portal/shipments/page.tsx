'use client';

/**
 * Shipper Portal — all shipments list.
 *
 * Status pills colour-coded, filterable by status, paginated. Click row →
 * /shipper-portal/shipments/[id] detail page.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Package, Search, Plus, ArrowRight, MapPin, Clock } from 'lucide-react';

interface ShipmentSummary {
  id: string;
  shipmentNo: string | null;
  status: string;
  origin: { name: string | null; city: string | null };
  destination: { name: string | null; city: string | null };
  pickupWindowFrom: string | null;
  deliveryWindowFrom: string | null;
  submittedAt: string;
  customerRateAmount: number | null;
  currency: string | null;
}

const STATUS_TONE: Record<string, string> = {
  DRAFT:            'bg-slate-500/15 text-slate-300 border-slate-500/30',
  PENDING:          'bg-amber-500/15 text-amber-300 border-amber-500/30',
  ACKNOWLEDGED:     'bg-blue-500/15 text-blue-300 border-blue-500/30',
  APPROVED:         'bg-violet-500/15 text-violet-300 border-violet-500/30',
  ASSIGNED:         'bg-violet-500/15 text-violet-300 border-violet-500/30',
  DISPATCHED:       'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  ENROUTE_PICKUP:   'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  LOADED:           'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  ENROUTE_DELIVERY: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  DELIVERED:        'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  POD_SUBMITTED:    'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CLOSED:           'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CANCELLED:        'bg-rose-500/15 text-rose-300 border-rose-500/30',
  REJECTED:         'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

const FILTER_TABS = [
  { key: 'ALL',     label: 'All' },
  { key: 'ACTIVE',  label: 'Active' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'DONE',    label: 'Delivered' },
];

export default function ShipmentsListPage() {
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<'ALL' | 'ACTIVE' | 'PENDING' | 'DONE'>('ALL');
  const [search, setSearch]       = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/shipper-portal/shipments?limit=100');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setShipments(data.shipments ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    let arr = shipments;
    if (filter === 'ACTIVE') {
      arr = arr.filter(s => !['DELIVERED','POD_SUBMITTED','CLOSED','CANCELLED','REJECTED','PENDING','DRAFT'].includes(s.status));
    } else if (filter === 'PENDING') {
      arr = arr.filter(s => ['PENDING','DRAFT'].includes(s.status));
    } else if (filter === 'DONE') {
      arr = arr.filter(s => ['DELIVERED','POD_SUBMITTED','CLOSED'].includes(s.status));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(s =>
        (s.shipmentNo ?? '').toLowerCase().includes(q) ||
        (s.origin.name ?? '').toLowerCase().includes(q) ||
        (s.destination.name ?? '').toLowerCase().includes(q) ||
        (s.origin.city ?? '').toLowerCase().includes(q) ||
        (s.destination.city ?? '').toLowerCase().includes(q),
      );
    }
    return arr;
  }, [shipments, filter, search]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Your Shipments</h1>
          <p className="text-xs text-slate-400 mt-0.5">All shipment requests submitted from your organisation.</p>
        </div>
        <Link href="/shipper-portal/shipments/new"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" /> New Shipment Request
        </Link>
      </div>

      {/* Filter pills + search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-white/10 bg-slate-900 p-0.5">
          {FILTER_TABS.map(t => (
            <button key={t.key}
              onClick={() => setFilter(t.key as typeof filter)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                filter === t.key
                  ? 'bg-emerald-500/20 text-emerald-200'
                  : 'text-slate-400 hover:text-white'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by number or location…"
            className="w-full bg-slate-900 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-slate-900/60 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900 border border-dashed border-white/10 rounded-2xl p-10 text-center">
          <Package className="w-10 h-10 mx-auto mb-3 text-slate-600" />
          <h2 className="text-base font-bold text-white">
            {shipments.length === 0 ? 'No shipments yet' : 'No shipments match this filter'}
          </h2>
          <p className="text-slate-400 text-sm mt-1 mb-5">
            {shipments.length === 0
              ? 'Place your first shipment request to get started.'
              : 'Try a different status tab or clear the search box.'}
          </p>
          {shipments.length === 0 && (
            <Link href="/shipper-portal/shipments/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
              <Plus className="w-4 h-4" /> New Shipment Request
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <Link key={s.id} href={`/shipper-portal/shipments/${s.id}`}
              className="block bg-slate-900 hover:bg-slate-800/80 border border-white/10 hover:border-emerald-500/30 rounded-xl p-4 transition-colors group">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-mono text-white">{s.shipmentNo ?? s.id.slice(0, 8)}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_TONE[s.status] ?? STATUS_TONE.PENDING}`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-300 mt-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">
                      {s.origin.name ?? s.origin.city ?? '—'}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                    <span className="truncate">
                      {s.destination.name ?? s.destination.city ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1.5">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Submitted {formatDate(s.submittedAt)}
                    </span>
                    {s.customerRateAmount != null && (
                      <span className="text-slate-400">
                        {(s.currency ?? 'AED')} {s.customerRateAmount.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}
