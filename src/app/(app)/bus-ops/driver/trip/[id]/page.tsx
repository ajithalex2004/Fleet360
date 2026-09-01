'use client';

import React, { useEffect, useState, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import GoogleRoutePreviewMap from '@/components/logistics/GoogleRoutePreviewMap';

interface Passenger {
  id: string;
  staffMemberId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  boardingStopName: string | null;
  alightingStopName: string | null;
  boardedAt: string | null;
  status: string | null;
}

interface RouteStopFromApi {
  id: string;
  stopName: string;
  sequence: number;
  gpsLat: number | null;
  gpsLng: number | null;
}
interface Trip {
  id: string;
  tripNumber: string | null;
  departureTime: string;
  status: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  // Populated from tripSchedule row. Required for GPS ingest to know which
  // vehicle is broadcasting the pings — falsy means no tracking possible.
  vehicleId: string | null;
  route?: {
    name?: string;
    origin?: string;
    destination?: string;
    stops?: RouteStopFromApi[];
  };
}

interface EstimateResp {
  totalDistanceKm?: number;
  estimatedDurationMins?: number;
  encodedPolyline?: string | null;
  bounds?: { northeast: { latitude: number; longitude: number }; southwest: { latitude: number; longitude: number } } | null;
  originCoords?: { latitude: number; longitude: number } | null;
  destinationCoords?: { latitude: number; longitude: number } | null;
  stopCoords?: Array<{ latitude: number; longitude: number; label?: string }>;
}

// Minimum seconds between GPS uploads. Anything faster wastes battery + backend
// cycles without meaningfully improving geofence/ETA accuracy (buses don't
// change lane in 10s in any way that matters to arrival prediction).
const GPS_MIN_INTERVAL_MS = 10_000;

// Trip statuses during which GPS tracking is active. Before SCHEDULED becomes
// STARTED the driver is still at the depot; after COMPLETED there's nothing
// to track. Includes the legacy DEPARTED/IN_TRANSIT strings too - a trip row
// still carrying the pre-rename status must keep tracking, not silently stop.
const TRACKED_STATUSES = new Set(['STARTED', 'EN_ROUTE', 'DEPARTED', 'IN_TRANSIT']);

const STATUS_OPTIONS = ['CONFIRMED', 'BOARDED', 'ABSENT', 'NO_SHOW'] as const;
const STATUS_BG: Record<string, string> = {
  CONFIRMED: 'bg-blue-500/20 text-blue-200 border-blue-500/40',
  BOARDED:   'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  ABSENT:    'bg-amber-500/20 text-amber-200 border-amber-500/40',
  NO_SHOW:   'bg-rose-500/20 text-rose-200 border-rose-500/40',
};

export default function DriverTripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending'>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        fetch(`/api/bus-ops/schedules/${id}`),
        fetch(`/api/bus-ops/schedules/${id}/passengers`),
      ]);
      if (tRes.ok) setTrip(await tRes.json());
      if (pRes.ok) setPassengers(await pRes.json());
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /* ── Route preview + Navigate deep-link ──────────────────────────────────
   * Once the trip loads, hit the estimate endpoint to get the driving
   * polyline for origin → stops → destination. Renders as a map at the top
   * of the driver's view. Also unlocks the "Navigate" button which deep-
   * links Google Maps for turn-by-turn.
   *
   * Uses coord strings ("lat,lng") for stops that have coords set, so the
   * server can skip geocoding — same coord-passthrough logic the operator
   * form uses. Stops without coords still get geocoded normally.
   */
  const [estimate, setEstimate] = useState<EstimateResp | null>(null);
  const stopsForEstimate = (trip?.route?.stops ?? [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  const stopsKey = stopsForEstimate
    .map(s => (s.gpsLat != null && s.gpsLng != null ? `${s.gpsLat},${s.gpsLng}` : s.stopName))
    .filter(Boolean)
    .join('||');

  useEffect(() => {
    const origin = trip?.route?.origin?.trim();
    const destination = trip?.route?.destination?.trim();
    if (!origin || !destination) return;
    const waypointsParam = stopsKey ? `&waypoints=${encodeURIComponent(stopsKey.replace(/\|\|/g, '|'))}` : '';
    const url = `/api/bus-ops/routes/estimate?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypointsParam}`;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) return;
        const data = await res.json() as EstimateResp;
        setEstimate(data);
      } catch { /* silent — no route preview, everything else still works */ }
    })();
    return () => ac.abort();
  }, [trip?.route?.origin, trip?.route?.destination, stopsKey]);

  // Turn-by-turn navigation deep link. Google Maps' universal Directions URL
  // opens the native app on mobile (with the ordered waypoints preloaded) and
  // the web fallback on desktop. Uses geocoded coord strings when available so
  // the driver doesn't have to re-search each stop.
  //   https://developers.google.com/maps/documentation/urls/get-started#directions-action
  const navigateUrl = (() => {
    if (!trip?.route) return null;
    const o = estimate?.originCoords;
    const d = estimate?.destinationCoords;
    const origin      = o ? `${o.latitude},${o.longitude}` : trip.route.origin;
    const destination = d ? `${d.latitude},${d.longitude}` : trip.route.destination;
    if (!origin || !destination) return null;
    // Waypoints — prefer coords from the estimate response (already resolved),
    // fall back to per-stop gpsLat/gpsLng, else stop name string.
    const waypointStrings = stopsForEstimate.map((s, i) => {
      const est = estimate?.stopCoords?.[i];
      if (est) return `${est.latitude},${est.longitude}`;
      if (s.gpsLat != null && s.gpsLng != null) return `${s.gpsLat},${s.gpsLng}`;
      return s.stopName;
    }).filter(Boolean);
    const waypointsQP = waypointStrings.length > 0 ? `&waypoints=${encodeURIComponent(waypointStrings.join('|'))}` : '';
    return `https://www.google.com/maps/dir/?api=1&travelmode=driving`
      + `&origin=${encodeURIComponent(origin)}`
      + `&destination=${encodeURIComponent(destination)}`
      + waypointsQP;
  })();

  /* ── GPS tracking ─────────────────────────────────────────────────────────
   * Auto-broadcasts the bus's location to the backend when the trip is active
   * (DEPARTED or IN_TRANSIT). Powers three server-side features at once:
   *   - stop-arrival geofence eval (writes trip_stop_visits)
   *   - approach WhatsApp notifications to boarding-stop passengers
   *   - live ETA for the passenger app
   *
   * Behaviour:
   *   - watchPosition streams updates continuously; we throttle to 1 upload
   *     per GPS_MIN_INTERVAL_MS (10s) to spare battery + the backend.
   *   - permission errors surface as an inline banner — never a crash.
   *   - clears the watcher when the component unmounts OR the trip ends.
   */
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'active' | 'denied' | 'unsupported' | 'error'>('idle');
  const [gpsLastSentAt, setGpsLastSentAt] = useState<number | null>(null);
  const lastSentAtRef = useRef<number>(0);

  const active = trip != null && TRACKED_STATUSES.has((trip.status ?? '').toUpperCase()) && !!trip.vehicleId;

  useEffect(() => {
    if (!active || !trip?.vehicleId) { setGpsStatus('idle'); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('unsupported');
      return;
    }

    setGpsStatus('active');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        // Throttle: skip if the previous POST was less than 10s ago.
        if (now - lastSentAtRef.current < GPS_MIN_INTERVAL_MS) return;
        lastSentAtRef.current = now;

        const body = {
          latitude:   pos.coords.latitude,
          longitude:  pos.coords.longitude,
          scheduleId: trip.id,
          occurredAt: new Date(pos.timestamp).toISOString(),
          speedKmh:   pos.coords.speed != null ? pos.coords.speed * 3.6 : null, // m/s → km/h
          headingDeg: pos.coords.heading,
          accuracyM:  pos.coords.accuracy,
          source:     'DRIVER_APP',
        };
        // Fire-and-forget: a single failed ping is not worth surfacing to the
        // driver. Successive failures will keep the "active" state anyway
        // because watchPosition is still firing.
        fetch(`/api/bus-ops/vehicles/${trip.vehicleId}/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(() => setGpsLastSentAt(now)).catch(() => { /* silent */ });
      },
      (err) => {
        // Distinguish denied (user action) from generic errors so the banner
        // can show a specific fix ("open settings → allow location").
        setGpsStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      setGpsStatus('idle');
    };
  }, [active, trip?.id, trip?.vehicleId]);

  const setStatus = async (passenger: Passenger, newStatus: typeof STATUS_OPTIONS[number]) => {
    setBusy(passenger.id);
    try {
      const res = await fetch(`/api/bus-ops/passengers/${passenger.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          boardedAt: newStatus === 'BOARDED' ? new Date().toISOString() : null,
        }),
      });
      if (!res.ok) {
        alert('Failed to update');
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-slate-500">Loading…</div>;
  if (!trip) return <div className="text-rose-400">Trip not found</div>;

  const visible = filter === 'pending'
    ? passengers.filter(p => (p.status ?? 'CONFIRMED') === 'CONFIRMED')
    : passengers;

  const counts = passengers.reduce<Record<string, number>>((acc, p) => {
    const s = p.status ?? 'CONFIRMED';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/bus-ops/driver" className="text-xs text-violet-400 hover:underline">← Today's trips</Link>
        <div className="flex gap-2">
          <a
            href={`/api/bus-ops/schedules/${id}/manifest/pdf?lang=en&download=1`}
            target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300"
          >
            Manifest · EN
          </a>
          <a
            href={`/api/bus-ops/schedules/${id}/manifest/pdf?lang=ar&download=1`}
            target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300"
          >
            Manifest · AR
          </a>
          <Link href={`/bus-ops/driver/trip/${id}/qr`} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/40 text-violet-300">
            Show QR
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-800/60 border border-white/10 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-violet-300">{trip.tripNumber ?? trip.id.slice(0, 8)}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{trip.status ?? '—'}</span>
        </div>
        <div className="text-lg font-bold mt-1">{trip.route?.name ?? 'Route'}</div>
        <div className="text-xs text-slate-400">
          {trip.route?.origin} → {trip.route?.destination} · depart {new Date(trip.departureTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
        {/* Distance + duration from the estimate — matches what the passenger
            app sees, so driver + passenger agree on the plan. */}
        {estimate?.totalDistanceKm != null && estimate?.estimatedDurationMins != null && (
          <div className="text-xs text-slate-400 mt-1">
            {estimate.totalDistanceKm} km · ~{estimate.estimatedDurationMins} min
            {stopsForEstimate.length > 0 && ` via ${stopsForEstimate.length} stop${stopsForEstimate.length === 1 ? '' : 's'}`}
          </div>
        )}
      </div>

      {/* Route preview + Navigate. The map shows the whole route with
          numbered stops; Navigate deep-links Google Maps for turn-by-turn.
          Both are optional — the trip works without them if the route has
          no polyline (e.g. Directions API unavailable, or dev without a key). */}
      {(estimate?.encodedPolyline || navigateUrl) && (
        <div className="space-y-2">
          {estimate?.encodedPolyline && (
            <GoogleRoutePreviewMap
              encodedPolyline={estimate.encodedPolyline}
              bounds={estimate.bounds ?? null}
              originCoords={estimate.originCoords ?? null}
              destinationCoords={estimate.destinationCoords ?? null}
              stopCoords={estimate.stopCoords ?? []}
              heightPx={220}
            />
          )}
          {navigateUrl && (
            <a
              href={navigateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center py-3 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-90 text-white font-semibold text-sm"
            >
              🧭 Navigate with Google Maps
            </a>
          )}
        </div>
      )}

      {/* GPS-tracking banner. Only rendered when the trip is active OR when
          the permission is denied, so a driver at the depot before departure
          doesn't see anything. Colour-coded so the driver can see at a glance
          whether pings are actually reaching the backend. */}
      {(active || gpsStatus === 'denied') && (
        <div
          className={`rounded-xl px-3 py-2 text-xs flex items-center gap-2 ${
            gpsStatus === 'active' && gpsLastSentAt
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200'
              : gpsStatus === 'active'
                ? 'bg-slate-800/60 border border-white/10 text-slate-300'
                : 'bg-rose-500/10 border border-rose-500/30 text-rose-200'
          }`}
        >
          <span aria-hidden="true">
            {gpsStatus === 'active' && gpsLastSentAt ? '📍' : gpsStatus === 'active' ? '⌛' : '⚠️'}
          </span>
          {gpsStatus === 'active' && gpsLastSentAt && (
            <span>Sharing location · last ping {Math.round((Date.now() - gpsLastSentAt) / 1000)}s ago</span>
          )}
          {gpsStatus === 'active' && !gpsLastSentAt && <span>Waiting for GPS fix…</span>}
          {gpsStatus === 'denied' && <span>Location access denied. Passengers won't see live ETA. Open browser settings → allow location.</span>}
          {gpsStatus === 'unsupported' && <span>This device doesn't support live tracking.</span>}
          {gpsStatus === 'error' && <span>Location error. Retrying…</span>}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="Confirmed" value={counts.CONFIRMED ?? 0} />
        <Stat label="Boarded" value={counts.BOARDED ?? 0} accent="emerald" />
        <Stat label="Absent" value={counts.ABSENT ?? 0} accent="amber" />
        <Stat label="No-show" value={counts.NO_SHOW ?? 0} accent="rose" />
      </div>

      <div className="inline-flex rounded-xl bg-slate-800/60 border border-white/10 p-1 w-full">
        <button
          onClick={() => setFilter('pending')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium ${filter === 'pending' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
        >
          Pending boarding
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium ${filter === 'all' ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
        >
          All ({passengers.length})
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="p-6 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-sm text-slate-400">
          {filter === 'pending' ? '✓ All passengers accounted for.' : 'No passengers on this trip.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(p => {
            const status = p.status ?? 'CONFIRMED';
            const isBusy = busy === p.id;
            return (
              <div key={p.id} className="p-3 rounded-xl bg-slate-800/40 border border-white/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.employeeName ?? '—'}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {p.employeeId ? `#${p.employeeId}` : ''} {p.department ? ` · ${p.department}` : ''}
                    </div>
                    {p.boardingStopName && (
                      <div className="text-[11px] text-slate-500 mt-0.5">📍 {p.boardingStopName}</div>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_BG[status]}`}>{status}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 mt-2">
                  {(['BOARDED', 'ABSENT', 'NO_SHOW'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatus(p, s)}
                      disabled={isBusy || status === s}
                      className={`py-2 rounded-lg text-[11px] font-medium border ${
                        status === s
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-slate-900/40 border-white/10 text-slate-300 hover:bg-slate-900/70'
                      } disabled:opacity-50`}
                    >
                      {s === 'BOARDED' ? '✓ Board' : s === 'ABSENT' ? 'Absent' : 'No-show'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = 'slate' }: { label: string; value: number; accent?: string }) {
  const cls: Record<string, string> = { slate: 'text-white', emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' };
  return (
    <div className="rounded-xl bg-slate-800/60 border border-white/10 p-2">
      <div className={`text-2xl font-bold ${cls[accent]}`}>{value}</div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}
