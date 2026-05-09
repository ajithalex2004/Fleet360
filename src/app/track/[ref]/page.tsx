'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  status: string;
  label: string;
  timestamp: string | null;
  completed: boolean;
  isCurrent: boolean;
  note: string | null;
}

interface PodData {
  deliveredAt: string | null;
  note: string | null;
  hasSignature: boolean;
  gps: { lat: number; lng: number } | null;
}

interface TrackingData {
  bookingRef: string;
  status: string;
  statusLabel: string;
  progress: number;
  isCancelled: boolean;
  isDelivered: boolean;
  customerName: string | null;
  origin: string | null;
  destination: string | null;
  shipmentType: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  weightKg: number | null;
  cargo: string | null;
  scheduledDate: string | null;
  estimatedDelivery: string | null;
  createdAt: string | null;
  timeline: TimelineEvent[];
  pod: PodData | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const STATUS_ICON: Record<string, string> = {
  PENDING:           '📋',
  APPROVED:          '✅',
  ASSIGNED:          '👤',
  DISPATCHED:        '🚦',
  ENROUTE_PICKUP:    '🗺️',
  LOADED:            '📦',
  ENROUTE_DELIVERY:  '🚛',
  DELIVERED:         '📍',
  POD_SUBMITTED:     '📝',
  CLOSED:            '🔒',
};

// ── Search bar ────────────────────────────────────────────────────────────────

function SearchBar({ initial }: { initial?: string }) {
  const [val, setVal] = useState(initial ?? '');

  const go = () => {
    const trimmed = val.trim().toUpperCase();
    if (trimmed) window.location.href = `/track/${encodeURIComponent(trimmed)}`;
  };

  return (
    <div className="flex gap-2">
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && go()}
        placeholder="Enter booking reference…"
        className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500/50"
      />
      <button onClick={go}
        className="bg-amber-500 hover:bg-amber-400 text-white font-semibold px-5 py-3 rounded-xl text-sm transition-colors">
        Track
      </button>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, cancelled }: { value: number; cancelled: boolean }) {
  return (
    <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${cancelled ? 'bg-red-500' : 'bg-gradient-to-r from-amber-500 to-emerald-500'}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="space-y-0">
      {events.map((ev, i) => {
        const isLast = i === events.length - 1;
        return (
          <div key={ev.status} className="flex gap-4">
            {/* Left: connector line + dot */}
            <div className="flex flex-col items-center flex-shrink-0 w-8">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 z-10 flex-shrink-0 transition-all ${
                ev.isCurrent
                  ? 'bg-amber-500 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.6)] text-white'
                  : ev.completed
                  ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-600'
              }`}>
                {ev.completed && !ev.isCurrent ? '✓' : STATUS_ICON[ev.status] ?? '○'}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 my-0.5 min-h-[24px] ${
                  ev.completed ? 'bg-emerald-500/30' : 'bg-slate-800'
                }`} />
              )}
            </div>

            {/* Right: content */}
            <div className={`pb-5 flex-1 pt-1 ${isLast ? 'pb-0' : ''}`}>
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className={`text-sm font-semibold ${
                  ev.isCurrent ? 'text-amber-300'
                  : ev.completed ? 'text-emerald-400'
                  : 'text-slate-600'
                }`}>
                  {ev.label}
                  {ev.isCurrent && (
                    <span className="ml-2 text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full px-2 py-0.5">
                      Current
                    </span>
                  )}
                </span>
                {ev.timestamp && (
                  <span className="text-xs text-slate-500">{fmt(ev.timestamp)}</span>
                )}
              </div>
              {ev.note && (
                <p className="text-xs text-slate-500 mt-1 italic">"{ev.note}"</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, highlight }: { label: string; value: string | null | undefined; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-500 flex-shrink-0 min-w-[120px]">{label}</span>
      <span className={`text-xs text-right ${highlight ? 'text-amber-300 font-semibold' : 'text-slate-300'}`}>{value}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TrackPage() {
  const params  = useParams<{ ref: string }>();
  const refParam = params?.ref ? decodeURIComponent(params.ref).toUpperCase() : '';

  const [data,    setData]    = useState<TrackingData | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(!!refParam);

  const load = useCallback(async () => {
    if (!refParam) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(refParam)}`, { cache: 'no-store' });
      if (res.ok) {
        setData(await res.json());
      } else {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setError(body.error ?? 'Tracking reference not found.');
      }
    } catch {
      setError('Unable to connect. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  }, [refParam]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s for active shipments
  useEffect(() => {
    if (!data || data.isDelivered || data.isCancelled) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [data, load]);

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
  };

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white">
      {/* Top nav bar */}
      <header className="border-b border-white/10 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚛</span>
            <div>
              <p className="text-xs font-bold text-white leading-tight">XL Smart Mobility</p>
              <p className="text-xs text-slate-500">Shipment Tracker</p>
            </div>
          </div>
          {data && (
            <button onClick={copyLink}
              className="text-xs text-slate-400 border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20 hover:text-white transition-colors">
              🔗 Share Link
            </button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Search */}
        <div className="space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Track your shipment</p>
          <SearchBar initial={refParam} />
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-4 animate-pulse">
            <div className="h-32 bg-slate-800/60 rounded-2xl" />
            <div className="h-64 bg-slate-800/60 rounded-2xl" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl p-6 text-center space-y-2">
            <div className="text-4xl">🔍</div>
            <p className="font-semibold">{error}</p>
            <p className="text-xs text-red-400/70">Please check your booking reference and try again.</p>
          </div>
        )}

        {/* Tracking result */}
        {!loading && data && (
          <>
            {/* Status hero card */}
            <div className={`rounded-2xl border p-6 space-y-4 ${
              data.isCancelled
                ? 'bg-red-500/10 border-red-500/20'
                : data.isDelivered
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : 'bg-amber-500/10 border-amber-500/20'
            }`}>
              {/* Ref + status */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Booking Reference</p>
                  <p className="text-2xl font-bold font-mono text-white mt-0.5">{data.bookingRef}</p>
                </div>
                <div className={`px-4 py-2 rounded-full border text-sm font-semibold ${
                  data.isCancelled
                    ? 'bg-red-500/20 border-red-500/30 text-red-300'
                    : data.isDelivered
                    ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                }`}>
                  {data.isCancelled ? '❌ ' : data.isDelivered ? '✅ ' : '🚛 '}
                  {data.statusLabel}
                </div>
              </div>

              {/* Progress bar */}
              {!data.isCancelled && (
                <div className="space-y-1.5">
                  <ProgressBar value={data.progress} cancelled={data.isCancelled} />
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Booking Received</span>
                    <span>{data.progress}% complete</span>
                    <span>Delivered</span>
                  </div>
                </div>
              )}

              {/* Route */}
              {(data.origin || data.destination) && (
                <div className="flex items-center gap-3 text-sm">
                  {data.origin && (
                    <div className="flex-1 bg-slate-900/60 rounded-xl p-3">
                      <p className="text-xs text-slate-500 mb-0.5">From</p>
                      <p className="text-emerald-400 font-medium truncate">{data.origin}</p>
                    </div>
                  )}
                  {data.origin && data.destination && (
                    <span className="text-slate-600 flex-shrink-0">→</span>
                  )}
                  {data.destination && (
                    <div className="flex-1 bg-slate-900/60 rounded-xl p-3">
                      <p className="text-xs text-slate-500 mb-0.5">To</p>
                      <p className="text-red-400 font-medium truncate">{data.destination}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ETA */}
              {data.estimatedDelivery && !data.isDelivered && !data.isCancelled && (
                <div className="flex items-center gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5">
                  <span>⏰</span>
                  <span>Estimated delivery: <strong>{fmtDate(data.estimatedDelivery)}</strong></span>
                </div>
              )}

              {/* Delivered confirmation */}
              {data.isDelivered && data.pod && (
                <div className="flex items-center gap-2 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">
                  <span>✅</span>
                  <span>
                    Delivered
                    {data.pod.deliveredAt ? ` on ${fmtDate(data.pod.deliveredAt)}` : ''}
                    {data.pod.hasSignature ? ' · Signed' : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Shipment details */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-1">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Shipment Details</h3>
              <InfoRow label="Customer"       value={data.customerName} />
              <InfoRow label="Shipment Type"  value={data.shipmentType} highlight />
              <InfoRow label="Cargo"          value={data.cargo} />
              <InfoRow label="Weight"         value={data.weightKg ? `${data.weightKg.toLocaleString()} kg` : null} />
              <InfoRow label="Booked On"      value={fmtDate(data.createdAt)} />
              <InfoRow label="Pickup Date"    value={fmtDate(data.scheduledDate)} />
              <InfoRow label="Expected Delivery" value={fmtDate(data.estimatedDelivery)} />
              {data.vehiclePlate && <InfoRow label="Vehicle"       value={data.vehiclePlate} />}
              {data.driverName   && <InfoRow label="Driver"        value={data.driverName} />}
            </div>

            {/* Status timeline */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-5">Journey Timeline</h3>
              <Timeline events={data.timeline} />
            </div>

            {/* POD details if delivered */}
            {data.isDelivered && data.pod && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 space-y-2">
                <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Proof of Delivery</h3>
                {data.pod.deliveredAt && (
                  <p className="text-sm text-slate-300">Delivered: <span className="text-emerald-300">{fmt(data.pod.deliveredAt)}</span></p>
                )}
                {data.pod.note && (
                  <p className="text-sm text-slate-400 italic">"{data.pod.note}"</p>
                )}
                {data.pod.hasSignature && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <span>✅</span> Recipient signature captured
                  </div>
                )}
                {data.pod.gps && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span>📍</span>
                    GPS: {data.pod.gps.lat.toFixed(5)}, {data.pod.gps.lng.toFixed(5)}
                  </div>
                )}
              </div>
            )}

            {/* Auto-refresh notice */}
            {!data.isDelivered && !data.isCancelled && (
              <p className="text-center text-xs text-slate-600">
                🔄 This page refreshes automatically every 60 seconds
              </p>
            )}

            {/* Share link */}
            <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-400">Share tracking link</p>
                <p className="text-xs text-slate-600 mt-0.5 font-mono truncate max-w-[260px]">
                  {typeof window !== 'undefined' ? window.location.href : `/track/${data.bookingRef}`}
                </p>
              </div>
              <button onClick={copyLink}
                className="flex-shrink-0 text-xs text-amber-400 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-2 rounded-lg transition-colors">
                Copy Link
              </button>
            </div>
          </>
        )}

        {/* Landing state — no ref entered */}
        {!refParam && !loading && (
          <div className="text-center space-y-4 py-12">
            <div className="text-6xl">🚛</div>
            <div>
              <p className="text-lg font-semibold text-white">Track your shipment in real time</p>
              <p className="text-sm text-slate-500 mt-1">Enter your booking reference above to get live status updates</p>
            </div>
            <div className="flex flex-wrap justify-center gap-4 text-sm text-slate-500 pt-4">
              {[
                { icon: '📋', text: 'Live status updates' },
                { icon: '🗺️', text: 'Step-by-step journey' },
                { icon: '📍', text: 'Delivery confirmation' },
                { icon: '🔗', text: 'Shareable link' },
              ].map(f => (
                <div key={f.text} className="flex items-center gap-2 bg-slate-800/40 border border-white/5 rounded-xl px-4 py-2.5">
                  <span>{f.icon}</span> <span>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-16 py-6 text-center text-xs text-slate-700">
        © {new Date().getFullYear()} XL Smart Mobility · All rights reserved
      </footer>
    </div>
  );
}
