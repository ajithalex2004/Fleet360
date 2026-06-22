'use client';

/**
 * Shipper Portal — shipment detail page.
 *
 * Renders FOUR distinct layouts depending on the tracking level the server
 * applied (returned in `trackingLevel`). The server has already stripped
 * fields the shipper isn't permitted to see, so we just render what's
 * present without leaking the existence of hidden fields:
 *
 *   NONE             → status pill + minimal timeline (terminal events only)
 *                       + "limited visibility" notice
 *   STATUS_ONLY      → full status timeline + origin/destination + cargo
 *   STATUS_AND_ETA   → above + ETA card + planned route hint
 *   FULL_TRACKING    → above + live location card + driver + vehicle + carrier
 *
 * Polled every 30s so the shipper sees status changes without manual refresh.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, MapPin, ArrowRight, Clock, Truck, Phone, User, Calendar,
  Package, CheckCircle2, Circle, Activity, Lock, RefreshCw, AlertCircle,
  Navigation,
} from 'lucide-react';

interface PortalShipment {
  id: string;
  shipmentNo: string | null;
  status: string;
  submittedAt: string;
  trackingLevel: 'NONE' | 'STATUS_ONLY' | 'STATUS_AND_ETA' | 'FULL_TRACKING';

  origin?: { name: string | null; address: string | null; city: string | null; country: string | null };
  destination?: { name: string | null; address: string | null; city: string | null; country: string | null };
  pickupWindowFrom?: string | null;
  pickupWindowTo?: string | null;
  deliveryWindowFrom?: string | null;
  deliveryWindowTo?: string | null;
  cargoSummary?: string | null;
  totalWeightKg?: number | null;
  totalVolumeCbm?: number | null;
  customerRateAmount?: number | null;
  currency?: string | null;
  timeline?: Array<{ status: string; date: string; note?: string | null }>;
  estimatedDeliveryAt?: string | null;
  liveLocation?: { lat: number; lng: number; capturedAt: string; source: string } | null;
  driver?: { name: string | null; phone: string | null } | null;
  vehicle?: { plate: string | null; type: string | null } | null;
  carrierName?: string | null;
}

const STATUS_TONE: Record<string, string> = {
  PENDING:          'bg-amber-500/20 text-amber-300 border-amber-500/40',
  ACKNOWLEDGED:     'bg-blue-500/20 text-blue-300 border-blue-500/40',
  APPROVED:         'bg-violet-500/20 text-violet-300 border-violet-500/40',
  ASSIGNED:         'bg-violet-500/20 text-violet-300 border-violet-500/40',
  DISPATCHED:       'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  ENROUTE_PICKUP:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  LOADED:           'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  ENROUTE_DELIVERY: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  DELIVERED:        'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  POD_SUBMITTED:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CLOSED:           'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  CANCELLED:        'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:          'Submitted',
  ACKNOWLEDGED:     'Acknowledged by operator',
  APPROVED:         'Approved',
  ASSIGNED:         'Sourcing carrier',
  DISPATCHED:       'Dispatched',
  ENROUTE_PICKUP:   'En route to pickup',
  LOADED:           'Loaded',
  ENROUTE_DELIVERY: 'In transit to delivery',
  DELIVERED:        'Delivered',
  POD_SUBMITTED:    'Proof of delivery received',
  CLOSED:           'Closed',
  CANCELLED:        'Cancelled',
};

const TRACKING_LEVEL_LABEL: Record<string, string> = {
  NONE:           'Notifications only',
  STATUS_ONLY:    'Status updates',
  STATUS_AND_ETA: 'Status + ETA',
  FULL_TRACKING:  'Live tracking',
};

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [shipment, setShipment] = useState<PortalShipment | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/shipper-portal/shipments/${id}`);
      if (res.status === 404) { setError('Shipment not found.'); setShipment(null); return; }
      if (!res.ok) { setError('Failed to load shipment.'); return; }
      const data = await res.json();
      setShipment(data);
      setError(null);
    } catch {
      setError('Network error.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    // Poll every 30 seconds for status updates.
    const t = setInterval(() => { if (!cancelled) void load(); }, 30_000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-32 rounded-2xl bg-slate-900/60 animate-pulse" />)}</div>;
  }
  if (error || !shipment) {
    return (
      <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-8 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-rose-400" />
        <h2 className="text-base font-bold text-white">{error ?? 'Not found'}</h2>
        <Link href="/shipper-portal/shipments"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to shipments
        </Link>
      </div>
    );
  }

  const level = shipment.trackingLevel;
  const statusTone = STATUS_TONE[shipment.status] ?? STATUS_TONE.PENDING;
  const statusLabel = STATUS_LABEL[shipment.status] ?? shipment.status;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/shipper-portal/shipments"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">{shipment.shipmentNo ?? 'Shipment'}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusTone}`}>
              {statusLabel}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Submitted {formatDate(shipment.submittedAt)} · Tracking: {TRACKING_LEVEL_LABEL[level]}
          </p>
        </div>
        <button onClick={() => void load()}
          title="Refresh"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* NONE — minimal layout */}
      {level === 'NONE' && (
        <div className="bg-slate-900 border border-slate-500/30 rounded-2xl p-6">
          <Lock className="w-5 h-5 text-slate-400 mb-3" />
          <h2 className="text-base font-bold text-white mb-2">Limited visibility</h2>
          <p className="text-sm text-slate-400 max-w-lg">
            Your operator has set tracking to <strong>notifications only</strong>. You'll
            see milestone updates here when your shipment is acknowledged and when it's
            delivered. Contact your operator if you need real-time updates.
          </p>
          <div className="mt-5">
            <MiniTimeline events={shipment.timeline ?? []} />
          </div>
        </div>
      )}

      {/* STATUS_ONLY+ — full timeline + origin/destination */}
      {level !== 'NONE' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Origin / Destination */}
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 lg:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
                <LocationCard label="Pickup" data={shipment.origin}
                  windowFrom={shipment.pickupWindowFrom} windowTo={shipment.pickupWindowTo}
                  accent="emerald" />
                <ArrowRight className="hidden md:block w-5 h-5 text-slate-600 mx-auto" />
                <LocationCard label="Delivery" data={shipment.destination}
                  windowFrom={shipment.deliveryWindowFrom} windowTo={shipment.deliveryWindowTo}
                  accent="blue" />
              </div>
            </div>

            {/* Cost card (always visible above NONE) */}
            <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Expected cost</p>
              {shipment.customerRateAmount != null ? (
                <p className="text-2xl font-bold text-emerald-300 mt-1 tabular-nums">
                  {(shipment.currency ?? 'AED')} {shipment.customerRateAmount.toFixed(2)}
                </p>
              ) : (
                <p className="text-sm text-slate-500 italic mt-1">Awaiting operator confirmation</p>
              )}
              {shipment.totalWeightKg != null && (
                <p className="text-xs text-slate-500 mt-2 inline-flex items-center gap-1">
                  <Package className="w-3 h-3" /> {shipment.totalWeightKg.toLocaleString()} kg
                </p>
              )}
            </div>
          </div>

          {/* STATUS_AND_ETA — ETA card */}
          {(level === 'STATUS_AND_ETA' || level === 'FULL_TRACKING') && shipment.estimatedDeliveryAt && (
            <div className="bg-gradient-to-br from-violet-900/30 to-slate-900 border border-violet-500/30 rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                  <Navigation className="w-5 h-5 text-violet-300" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-violet-300/70">Estimated delivery</p>
                  <p className="text-lg font-bold text-white">
                    {formatDate(shipment.estimatedDeliveryAt)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* FULL_TRACKING — live location + driver + vehicle + carrier */}
          {level === 'FULL_TRACKING' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Live location */}
              {shipment.liveLocation ? (
                <div className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-emerald-300" />
                    <p className="text-sm font-bold text-white">Live location</p>
                    <span className="ml-auto text-[10px] text-emerald-300/70">
                      Updated {formatRelative(shipment.liveLocation.capturedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">
                    {shipment.liveLocation.lat.toFixed(5)}, {shipment.liveLocation.lng.toFixed(5)}
                  </p>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${shipment.liveLocation.lat},${shipment.liveLocation.lng}`}
                    target="_blank" rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200">
                    Open in Google Maps <ArrowRight className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
                  <Activity className="w-4 h-4 text-slate-500 mb-2" />
                  <p className="text-sm text-slate-400">
                    Live position will appear here once the vehicle starts reporting.
                  </p>
                </div>
              )}

              {/* Driver + vehicle */}
              <div className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-3">
                <p className="text-sm font-bold text-white inline-flex items-center gap-2">
                  <Truck className="w-4 h-4 text-emerald-300" /> Assignment
                </p>
                {shipment.carrierName && (
                  <Row icon={Truck} label="Carrier" value={shipment.carrierName} />
                )}
                {shipment.driver?.name && (
                  <Row icon={User} label="Driver" value={shipment.driver.name} />
                )}
                {shipment.driver?.phone && (
                  <Row icon={Phone} label="Driver phone"
                    value={
                      <a href={`tel:${shipment.driver.phone}`} className="text-emerald-300 hover:text-emerald-200">
                        {shipment.driver.phone}
                      </a>
                    } />
                )}
                {shipment.vehicle?.plate && (
                  <Row icon={MapPin} label="Vehicle" value={
                    `${shipment.vehicle.plate}${shipment.vehicle.type ? ` (${shipment.vehicle.type})` : ''}`
                  } />
                )}
                {!shipment.carrierName && !shipment.driver?.name && (
                  <p className="text-xs text-slate-500 italic">No carrier assigned yet.</p>
                )}
              </div>
            </div>
          )}

          {/* Timeline — visible at STATUS_ONLY+ */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-white mb-3 inline-flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" /> Status history
            </h2>
            <Timeline events={shipment.timeline ?? []} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function LocationCard({
  label, data, windowFrom, windowTo, accent,
}: {
  label: string;
  data?: { name: string | null; address: string | null; city: string | null; country: string | null };
  windowFrom?: string | null;
  windowTo?: string | null;
  accent: 'emerald' | 'blue';
}) {
  const tone = accent === 'emerald' ? 'text-emerald-300 bg-emerald-500/15' : 'text-blue-300 bg-blue-500/15';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-lg ${tone} flex items-center justify-center`}>
          <MapPin className="w-3.5 h-3.5" />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      </div>
      <p className="text-sm font-semibold text-white">{data?.name ?? '—'}</p>
      <p className="text-xs text-slate-400 leading-relaxed">
        {[data?.address, data?.city, data?.country].filter(Boolean).join(', ') || '—'}
      </p>
      {(windowFrom || windowTo) && (
        <p className="text-[11px] text-slate-500 inline-flex items-center gap-1 mt-1">
          <Calendar className="w-3 h-3" />
          {windowFrom ? formatDate(windowFrom) : '—'}
          {windowTo ? ` → ${formatDate(windowTo)}` : ''}
        </p>
      )}
    </div>
  );
}

function Timeline({ events }: { events: Array<{ status: string; date: string; note?: string | null }> }) {
  if (events.length === 0) {
    return <p className="text-xs text-slate-500 italic">No history yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {events.map((e, i) => {
        const isLast = i === events.length - 1;
        return (
          <li key={i} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                isLast ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/60 text-slate-400'
              }`}>
                {isLast ? <Activity className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
              </div>
              {i < events.length - 1 && <div className="w-px h-6 bg-slate-700/60" />}
            </div>
            <div className="flex-1 -mt-0.5">
              <p className="text-sm text-white font-medium">{STATUS_LABEL[e.status] ?? e.status}</p>
              <p className="text-[11px] text-slate-500">{formatDate(e.date)}</p>
              {e.note && <p className="text-xs text-slate-400 mt-1">{e.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function MiniTimeline({ events }: { events: Array<{ status: string; date: string }> }) {
  if (events.length === 0) {
    return <p className="text-xs text-slate-500 italic">Waiting for first update.</p>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {events.map((e, i) => (
        <div key={i} className="inline-flex items-center gap-1.5">
          <Circle className="w-2 h-2 fill-emerald-400 text-emerald-400" />
          <span className="text-xs text-slate-300">{STATUS_LABEL[e.status] ?? e.status}</span>
          <span className="text-[10px] text-slate-500">{formatRelative(e.date)}</span>
          {i < events.length - 1 && <ArrowRight className="w-3 h-3 text-slate-600 ml-1" />}
        </div>
      ))}
    </div>
  );
}

function Row({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-slate-500 text-xs">{label}:</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}
function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return formatDate(iso);
  } catch { return iso; }
}
