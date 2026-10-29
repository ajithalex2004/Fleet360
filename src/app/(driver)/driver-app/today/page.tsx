/**
 * src/app/(driver)/driver-app/today/page.tsx
 *
 * Driver's home screen — the first thing they see after login.
 *
 * Features:
 *   - Current trip assignments and roster (server-live, with an
 *     offline-cache fallback when the network is unavailable)
 *   - Continuous driving CBA compliance watcher
 *   - 🚨 SOS Emergency Panic Button (Critical dispatch to operations)
 *   - 📡 Real-Time Live Location Sharing (10s telemetry pings)
 *   - 🚚 Non-Revenue Movement (NRM / Deadhead) Toggle & Ops Notification
 *   - ⚡ Geofence auto-lifecycle: auto-starts/ends a trip when the
 *     vehicle leaves the origin / enters the destination geofence,
 *     for the "driver forgot to tap Start/End" case
 *   - Timing-aware Start/End button + per-trip driving score badge
 */

'use client';

import React, { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getAllTrips, putTrips, type OfflineTrip } from '@/lib/driver-offline/db';
import { syncSummary, forceDrain } from '@/lib/driver-offline/sync';
import { BackButton } from '@/components/driver-app/BackButton';
import { ALERT_LEVEL_META } from '@/lib/driver-offline/continuous-driving-watcher';
import { useContinuousDriving } from '@/hooks/useContinuousDriving';
import { getCurrentShift } from '@/lib/driver-session-client';
import {
  startButtonState,
  timingChipClass,
  type TripStatus,
  type StartButtonState,
} from '@/lib/trip-state';
import {
  createAutoLifecycle,
  type AutoLifecycleHandle,
  type LatLng,
  haversineMeters,
} from '@/lib/driver-offline/auto-lifecycle';
import {
  AlertTriangle,
  Radio,
  Truck,
  RotateCcw,
  X,
  CheckCircle2,
  MapPin,
  Clock,
  Zap,
  Flame,
  Camera,
  Check,
  ArrowRight,
  Anchor,
  Timer,
} from 'lucide-react';

export interface DrayageGeofenceBoundary {
  name: string;
  type: 'CIRCLE' | 'POLYGON';
  lat: number;
  lng: number;
  radiusMeters: number;
  coordinates?: Array<{ lat: number; lng: number }>;
}

export interface DriverDrayageJob {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2' | string;
  shipmentType: 'IMPORT' | 'EXPORT' | string;
  status: string;
  priority: 'STANDARD' | 'HIGH' | 'URGENT' | string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  warehouseName: string;
  terminalName: string;
  assignedVehiclePlate: string | null;
  assignedTrailerPlate: string | null;
  placementLocation: 'RAMP' | 'YARD' | null;
  trailerDetached: boolean;
  etcTime: string | null;
  etcAlertStatus: string;
  rateAmountAed: number;
  driverAllowanceAed: number;
  notes: string | null;
  terminalGeofence?: DrayageGeofenceBoundary | null;
  warehouseGeofence?: DrayageGeofenceBoundary | null;
}

function isPointInsideGeofence(
  pos: LatLng,
  gf?: DrayageGeofenceBoundary | null,
): boolean {
  if (!pos || !gf) return false;

  // Polygon check using ray-casting algorithm
  if (gf.type === 'POLYGON' && gf.coordinates && gf.coordinates.length >= 3) {
    const x = pos.lng, y = pos.lat;
    let inside = false;
    const vs = gf.coordinates;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i].lng, yi = vs[i].lat;
      const xj = vs[j].lng, yj = vs[j].lat;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }

  // Radial / Circle check (using Haversine)
  const dist = haversineMeters(pos, { lat: gf.lat, lng: gf.lng });
  return dist <= (gf.radiusMeters || 1000);
}

interface ServerTrip {
  id: string;
  status: string;
  departureTime: string;
  arrivalTime: string;
  direction: string | null;
  tripNumber: string | null;
  routeId: string;
  routeName: string | null;
  vehiclePlate: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  startedByDriverId: string | null;
  endedByDriverId: string | null;
  lateMinutes: number | null;
  durationMinutes: number | null;
  score: {
    score: number;
    harshBrake: number;
    harshAccel: number;
    speeding: number;
    idleMinutes: number;
  };
  eventCount: number;
}

/** A single geocoded stop, as returned by /api/driver-app/trips/[id]/geofences. */
interface GeofencePoint extends LatLng {
  radiusM: number;
  name: string | null;
}

interface GeofenceInfo {
  origin: GeofencePoint;
  destination: GeofencePoint;
}

const KNOWN_OFFLINE_STATUSES: readonly OfflineTrip['status'][] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
function isKnownTripStatus(s: string): s is OfflineTrip['status'] {
  return (KNOWN_OFFLINE_STATUSES as readonly string[]).includes(s);
}

function scoreColor(score: number | null): { bg: string; text: string; ring: string; label: string } {
  if (score == null) {
    return { bg: 'bg-slate-500/15', text: 'text-slate-300', ring: 'ring-slate-500/30', label: '—' };
  }
  if (score >= 80) return { bg: 'bg-emerald-500/15', text: 'text-emerald-300', ring: 'ring-emerald-500/30', label: String(score) };
  if (score >= 60) return { bg: 'bg-amber-500/15',   text: 'text-amber-300',   ring: 'ring-amber-500/30',   label: String(score) };
  return                     { bg: 'bg-rose-500/15',   text: 'text-rose-300',    ring: 'ring-rose-500/30',    label: String(score) };
}

function statusBadge(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case 'COMPLETED':   return { bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Completed' };
    case 'IN_PROGRESS': return { bg: 'bg-amber-500/15',   text: 'text-amber-300',   label: 'In progress' };
    case 'CANCELLED':   return { bg: 'bg-rose-500/15',    text: 'text-rose-300',    label: 'Cancelled' };
    case 'AUTO_CLOSED': return { bg: 'bg-slate-500/15',   text: 'text-slate-300',   label: 'Auto-closed' };
    case 'SCHEDULED':   return { bg: 'bg-sky-500/15',     text: 'text-sky-300',     label: 'Scheduled' };
    default:            return { bg: 'bg-slate-500/15',   text: 'text-slate-300',   label: status };
  }
}

/** Best-effort one-shot GPS. Returns null silently on failure. */
function captureLocationAsync(timeoutMs: number): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
      }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 5000, enableHighAccuracy: true },
    );
  });
}

function formatH(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function DriverTodayPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 p-6 text-white">Loading today...</div>}>
      <DriverTodayContent />
    </Suspense>
  );
}

function DriverTodayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [offlineTrips, setOfflineTrips] = useState<OfflineTrip[] | null>(null);
  const [serverTrips, setServerTrips] = useState<ServerTrip[] | null>(null);
  const [drayageJobs, setDrayageJobs] = useState<DriverDrayageJob[] | null>(null);
  const [selectedRampJob, setSelectedRampJob] = useState<DriverDrayageJob | null>(null);
  const [submittingRamp, setSubmittingRamp] = useState<boolean>(false);
  const [rampBanner, setRampBanner] = useState<string | null>(null);
  const [driverGps, setDriverGps] = useState<LatLng | null>(null);
  const firedTerminalGfRef = useRef<Set<string>>(new Set());
  const firedWarehouseGfRef = useRef<Set<string>>(new Set());
  const [sync, setSync] = useState<{ queued: number; failed: number } | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [autoToasts, setAutoToasts] = useState<Array<{ id: string; tripId: string; text: string; at: number }>>([]);
  const [geofenceMeta, setGeofenceMeta] = useState<Record<string, { armed: boolean; destinationName: string | null }>>({});
  const [dvirBanner, setDvirBanner] = useState<string | null>(null);

  // 1. Live Location Sharing State
  const [liveLocationActive, setLiveLocationActive] = useState<boolean>(true);
  const [lastLocationPing, setLastLocationPing] = useState<string | null>(null);

  // 2. SOS Emergency State
  const [showSosModal, setShowSosModal] = useState<boolean>(false);
  const [sosSending, setSosSending] = useState<boolean>(false);
  const [sosSentNotice, setSosSentNotice] = useState<string | null>(null);

  // 3. NRM (Non-Revenue Movement) State
  const [showNrmModal, setShowNrmModal] = useState<boolean>(false);
  const [activeNrm, setActiveNrm] = useState<{ reason: string; startedAt: string } | null>(null);
  const [nrmFeedback, setNrmFeedback] = useState<string | null>(null);

  // 4. Geofence auto-lifecycle watchers, one per SCHEDULED/IN_PROGRESS trip
  const autoWatchersRef = useRef<Map<string, AutoLifecycleHandle>>(new Map());
  const geofenceCacheRef = useRef<Map<string, GeofenceInfo>>(new Map());
  const geofenceCheckedRef = useRef<Set<string>>(new Set());
  const tenantIdRef = useRef<string | null>(null);

  // Continuous-driving watcher
  const driving = useContinuousDriving();

  // Load offline DB
  const refresh = useCallback(async () => {
    try {
      const [trips, s] = await Promise.all([getAllTrips(), syncSummary()]);
      setOfflineTrips(trips);
      setSync(s);
    } catch {
      // IndexedDB unavailable in SSR/private browsing
    }
  }, []);

  // Fetch online roster
  const fetchRoster = useCallback(async () => {
    try {
      const r = await fetch('/api/driver-app/today/assignments', { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.trips)) {
        setServerTrips(data.trips);
      }
      if (Array.isArray(data.drayageJobs)) {
        setDrayageJobs(data.drayageJobs);
      }
    } catch {
      // Offline
    }
  }, []);

  useEffect(() => {
    void refresh();
    void fetchRoster();
  }, [refresh, fetchRoster]);

  // A DVIR submission deep-links back here as ?dvir=<id> (see dvirs/new/page.tsx).
  // Surface a confirmation banner once, then strip the query param.
  useEffect(() => {
    const dvirId = searchParams?.get('dvir');
    if (!dvirId) return;
    setDvirBanner('Pre/post-trip inspection submitted — queued for sync.');
    router.replace('/driver-app/today');
    const t = setTimeout(() => setDvirBanner(null), 6000);
    return () => clearTimeout(t);
  }, [searchParams, router]);

  // Keep "now" fresh
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Periodic Background Live Location Broadcaster (every 12 seconds when active)
  useEffect(() => {
    if (!liveLocationActive) return;

    const streamLocation = async () => {
      const loc = await captureLocationAsync(4000);
      if (!loc) return;

      const activeTrip = serverTrips?.find((t) => t.status === 'IN_PROGRESS');
      const plate = activeTrip?.vehiclePlate || 'Fleet Bus';

      try {
        await fetch('/api/driver-app/telematics/live-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: loc.lat,
            lng: loc.lng,
            accuracy: loc.accuracyM,
            vehiclePlate: plate,
          }),
        });
        setLastLocationPing(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        void evaluateDrayageGeofences({ lat: loc.lat, lng: loc.lng });
      } catch {
        // Silent
      }
    };

    void streamLocation();
    const interval = setInterval(streamLocation, 12_000);
    return () => clearInterval(interval);
  }, [liveLocationActive, serverTrips]);

  // Lifecycle action: tap Start or End on a trip (also called by the
  // geofence auto-lifecycle watcher below when it detects the vehicle
  // has left the origin / entered the destination).
  const handleLifecycle = useCallback(async (tripId: string, action: 'START' | 'END') => {
    if (pending.has(tripId)) return;
    setPending((p) => new Set(p).add(tripId));
    try {
      const loc = await captureLocationAsync(3000).catch(() => null);
      const r = await fetch(`/api/driver-app/trips/${tripId}/${action.toLowerCase()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loc ?? {}),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const reason = body.reason ?? body.error ?? `Failed (${r.status})`;
        window.alert(reason);
        return;
      }
      await fetchRoster();
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(tripId);
        return n;
      });
    }
  }, [pending, fetchRoster]);

  // Best-effort: mirror today's server roster into the offline IndexedDB
  // cache so the page still has something useful to show if the driver
  // loses connectivity later in the shift. Never blocks the online UI.
  const cacheTripsOffline = useCallback(async (trips: ServerTrip[]) => {
    try {
      if (!tenantIdRef.current) {
        const ctx = await getCurrentShift();
        tenantIdRef.current = ctx?.tenantId ?? null;
      }
      if (!tenantIdRef.current) return;

      const toCache: OfflineTrip[] = trips
        .filter((t) => isKnownTripStatus((t.status || '').toUpperCase()))
        .map((t) => {
          const status = (t.status || '').toUpperCase();
          const geo = geofenceCacheRef.current.get(t.id);
          return {
            id: t.id,
            tenantId: tenantIdRef.current as string,
            routeName: t.routeName || 'Assigned Route',
            origin: geo?.origin.name || 'Origin',
            destination: geo?.destination.name || 'Destination',
            scheduledDeparture: t.departureTime,
            scheduledArrival: t.arrivalTime,
            vehicleId: null,
            vehiclePlate: t.vehiclePlate,
            status: (isKnownTripStatus(status) ? status : 'SCHEDULED'),
            stops: geo ? [
              { id: 'origin', sequence: 0, name: geo.origin.name || 'Origin', lat: geo.origin.lat, lng: geo.origin.lng, estimatedArrival: null, arrivedAt: null },
              { id: 'destination', sequence: 1, name: geo.destination.name || 'Destination', lat: geo.destination.lat, lng: geo.destination.lng, estimatedArrival: null, arrivedAt: null },
            ] : [],
            cachedAt: Date.now(),
          };
        });
      if (toCache.length > 0) {
        await putTrips(toCache);
        await refresh();
      }
    } catch {
      // Offline caching is best-effort — never blocks the online UI.
    }
  }, [refresh]);

  // Arm the geofence auto-lifecycle watcher for one trip: fetches the
  // route's origin/destination geofence, then starts a watcher that
  // fires handleLifecycle('START'/'END') the moment the vehicle leaves
  // the origin radius / enters the destination radius. Silently leaves
  // the trip un-armed (manual Start/End still works) if the route has
  // no geocoded stops or the fetch fails.
  const armAutoLifecycle = useCallback(async (trip: ServerTrip) => {
    if (autoWatchersRef.current.has(trip.id) || geofenceCheckedRef.current.has(trip.id)) return;
    geofenceCheckedRef.current.add(trip.id);
    try {
      const res = await fetch(`/api/driver-app/trips/${trip.id}/geofences`, { credentials: 'include' });
      if (!res.ok) return;
      const data: GeofenceInfo = await res.json();
      if (data.origin.lat == null || data.origin.lng == null || data.destination.lat == null || data.destination.lng == null) return;

      geofenceCacheRef.current.set(trip.id, data);

      const handle = createAutoLifecycle({
        tripId: trip.id,
        origin: { lat: data.origin.lat, lng: data.origin.lng, radiusM: data.origin.radiusM, name: data.origin.name },
        destination: { lat: data.destination.lat, lng: data.destination.lng, radiusM: data.destination.radiusM, name: data.destination.name },
        onShouldStart: () => {
          setAutoToasts((prev) => [...prev, {
            id: `${trip.id}-start-${Date.now()}`,
            tripId: trip.id,
            text: `Left ${data.origin.name || 'the origin'} — trip auto-started`,
            at: Date.now(),
          }]);
          void handleLifecycle(trip.id, 'START');
        },
        onShouldEnd: () => {
          setAutoToasts((prev) => [...prev, {
            id: `${trip.id}-end-${Date.now()}`,
            tripId: trip.id,
            text: `Arrived at ${data.destination.name || 'the destination'} — trip auto-ended`,
            at: Date.now(),
          }]);
          void handleLifecycle(trip.id, 'END');
        },
      });
      handle.start();
      autoWatchersRef.current.set(trip.id, handle);
      setGeofenceMeta((prev) => ({ ...prev, [trip.id]: { armed: true, destinationName: data.destination.name } }));
    } catch {
      // Offline, or the API rejected the request — auto-lifecycle stays unavailable for this trip.
    }
  }, [handleLifecycle]);

  const disarmAutoLifecycle = useCallback((tripId: string) => {
    const handle = autoWatchersRef.current.get(tripId);
    if (handle) {
      handle.stop();
      autoWatchersRef.current.delete(tripId);
    }
    setGeofenceMeta((prev) => {
      if (!(tripId in prev)) return prev;
      const next = { ...prev };
      delete next[tripId];
      return next;
    });
  }, []);

  // Keep the set of armed watchers in sync with the current roster, and
  // best-effort mirror the roster into the offline cache.
  useEffect(() => {
    if (!serverTrips) return;
    const activeIds = new Set(
      serverTrips
        .filter((t) => ['SCHEDULED', 'IN_PROGRESS'].includes((t.status || '').toUpperCase()))
        .map((t) => t.id),
    );
    for (const t of serverTrips) {
      if (activeIds.has(t.id)) void armAutoLifecycle(t);
    }
    for (const id of Array.from(autoWatchersRef.current.keys())) {
      if (!activeIds.has(id)) disarmAutoLifecycle(id);
    }
    void cacheTripsOffline(serverTrips);
  }, [serverTrips, armAutoLifecycle, disarmAutoLifecycle, cacheTripsOffline]);

  // Stop every watcher when the page unmounts. Reading `.current` inside
  // the cleanup is intentional here (not the stale-DOM-ref case the rule
  // guards against): we want whatever watchers are armed at unmount time,
  // not a snapshot from when the effect was set up.
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const handle of autoWatchersRef.current.values()) handle.stop();
      autoWatchersRef.current.clear();
    };
  }, []);

  // Auto-expire toast notifications.
  useEffect(() => {
    if (autoToasts.length === 0) return;
    const t = setInterval(() => {
      setAutoToasts((prev) => prev.filter((x) => Date.now() - x.at < 8000));
    }, 1000);
    return () => clearInterval(t);
  }, [autoToasts.length]);

  const handleRetrySync = useCallback(async () => {
    setSyncingNow(true);
    try {
      await forceDrain();
    } finally {
      await refresh();
      setSyncingNow(false);
    }
  }, [refresh]);

  // Emergency SOS Trigger
  const handleTriggerSos = async (emergencyType: string, notes?: string) => {
    setSosSending(true);
    try {
      const loc = await captureLocationAsync(4000);
      const activeTrip = serverTrips?.find((t) => t.status === 'IN_PROGRESS');

      const res = await fetch('/api/driver-app/emergency-sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: loc?.lat ?? null,
          lng: loc?.lng ?? null,
          vehiclePlate: activeTrip?.vehiclePlate || 'Fleet Bus',
          emergencyType,
          notes,
        }),
      });

      if (!res.ok) throw new Error('Failed to dispatch SOS alert');
      const json = await res.json();
      setShowSosModal(false);
      setSosSentNotice(json.message || '🚨 Emergency SOS Dispatched to Control Tower');
      setTimeout(() => setSosSentNotice(null), 8000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'SOS Dispatch Failed');
    } finally {
      setSosSending(false);
    }
  };

  // NRM (Non-Revenue Movement) Toggle
  const handleToggleNrm = async (reason: string, destination?: string) => {
    const isStarting = !activeNrm;
    try {
      const activeTrip = serverTrips?.find((t) => t.status === 'IN_PROGRESS');
      const res = await fetch('/api/driver-app/nrm-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isStarting ? 'START' : 'END',
          reason,
          destination,
          vehiclePlate: activeTrip?.vehiclePlate || 'Fleet Bus',
        }),
      });

      if (!res.ok) throw new Error('Failed to toggle NRM');
      const json = await res.json();
      setShowNrmModal(false);
      if (isStarting) {
        setActiveNrm({ reason, startedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        setNrmFeedback(json.message || `✓ NRM started: ${reason}. Ops team notified.`);
      } else {
        setActiveNrm(null);
        setNrmFeedback(json.message || '✓ NRM run completed. Returned to standard roster.');
      }
      setTimeout(() => setNrmFeedback(null), 4000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'NRM Toggle Failed');
    }
  };

  // Drayage Status & Ramp Placement submit directly to /api/driver/jobs/[id]/status
  const handleUpdateDrayageStatus = async (
    jobId: string,
    payload: {
      status: string;
      placementLocation?: string;
      detachTrailer?: boolean;
      etc?: string | null;
      notes?: string;
      driverName?: string;
      photo?: string | null;
    },
  ) => {
    try {
      setSubmittingRamp(true);
      const res = await fetch(`/api/driver/jobs/${jobId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed with status ${res.status}`);
      }
      setSelectedRampJob(null);
      setRampBanner(`✓ Job status updated: ${payload.status.replace(/_/g, ' ')}`);
      setTimeout(() => setRampBanner(null), 5000);
      await fetchRoster();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setSubmittingRamp(false);
    }
  };

  // ⚡ Geofence Auto-Trigger for Port Terminal (-> AT_PORT) & Consignee Warehouse (-> Auto-Prompt Ramp Placement Modal)
  const evaluateDrayageGeofences = useCallback(
    async (pos: LatLng) => {
      setDriverGps(pos);
      if (!drayageJobs || drayageJobs.length === 0) return;

      for (const job of drayageJobs) {
        // 1. Port Terminal Geofence entrance: Auto-advance to AT_PORT
        if (
          job.terminalGeofence &&
          !firedTerminalGfRef.current.has(job.id) &&
          (job.status === 'PENDING' || job.status === 'ACCEPTED' || (job.jobPhase === 'L2' && job.status === 'IN_TRANSIT'))
        ) {
          if (isPointInsideGeofence(pos, job.terminalGeofence)) {
            firedTerminalGfRef.current.add(job.id);
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate([150, 80, 150]);
            }
            setAutoToasts((prev) => [
              ...prev,
              {
                id: `gf-term-${job.id}-${Date.now()}`,
                tripId: job.id,
                text: `⚓ Entered ${job.terminalGeofence?.name || 'Port Terminal'} — Auto-advanced to AT_PORT`,
                at: Date.now(),
              },
            ]);
            void handleUpdateDrayageStatus(job.id, {
              status: 'AT_PORT',
              notes: `Auto-advanced to AT_PORT upon entering ${job.terminalGeofence?.name || 'Port Terminal'}`,
            });
          }
        }

        // 2. Warehouse Geofence boundary entrance: Auto-popup Ramp Placement & Destuffing ETC prompt
        if (
          job.warehouseGeofence &&
          !firedWarehouseGfRef.current.has(job.id) &&
          (job.status === 'IN_TRANSIT' || job.status === 'LOADED')
        ) {
          if (isPointInsideGeofence(pos, job.warehouseGeofence)) {
            firedWarehouseGfRef.current.add(job.id);
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate([200, 100, 200]);
            }
            setAutoToasts((prev) => [
              ...prev,
              {
                id: `gf-wh-${job.id}-${Date.now()}`,
                tripId: job.id,
                text: `📍 Arrived at ${job.warehouseGeofence?.name || job.warehouseName} — Confirm Ramp Placement & Destuffing ETC`,
                at: Date.now(),
              },
            ]);
            // Automatically open Ramp Placement & Destuffing ETC Modal on driver's mobile device!
            setSelectedRampJob(job);
          }
        }
      }
    },
    [drayageJobs, handleUpdateDrayageStatus],
  );

  // Active continuous GPS watching for drayage geofence auto-triggers
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    if (!drayageJobs || drayageJobs.length === 0) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        void evaluateDrayageGeofences({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [drayageJobs, evaluateDrayageGeofences]);

  const headerDate = useMemo(() => {
    return now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }, [now]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      {/* Top App Header */}
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3 sticky top-0 z-30 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BackButton />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Driver Shift</div>
              <div className="text-lg font-bold text-white truncate">{headerDate}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 1. SOS Emergency Button */}
            <button
              onClick={() => setShowSosModal(true)}
              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/40 flex items-center gap-1.5 animate-pulse transition active:scale-95"
            >
              <Flame className="w-4 h-4 fill-white" />
              <span>SOS</span>
            </button>

            {/* 2. Live Location Toggle */}
            <button
              onClick={() => setLiveLocationActive(!liveLocationActive)}
              title={liveLocationActive ? `Live GPS streaming (Last: ${lastLocationPing || 'Active'})` : 'Live GPS paused'}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 transition active:scale-95 ${
                liveLocationActive
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${liveLocationActive ? 'animate-pulse text-emerald-400' : ''}`} />
              <span>{liveLocationActive ? 'Live' : 'GPS Off'}</span>
            </button>

            {/* Continuous-driving CBA chip */}
            {driving.state && (
              <button
                type="button"
                data-testid="continuous-driving-chip"
                onClick={() => router.push('/driver-app/behavior')}
                className={`rounded-xl px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1 transition active:scale-95 ${
                  driving.state.level === 'ok' ? 'bg-emerald-500/15 text-emerald-200' :
                  driving.state.level === 'warning' ? 'bg-amber-500/15 text-amber-200' :
                  'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40 animate-pulse'
                }`}
              >
                <span>{ALERT_LEVEL_META[driving.state.level].emoji}</span>
                <span>{driving.state.levelLabel}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* SOS Sent Banner */}
      {sosSentNotice && (
        <div className="bg-rose-950/90 border-b border-rose-500/50 p-3.5 text-center text-xs text-rose-200 font-bold flex items-center justify-center gap-2 animate-bounce">
          <AlertTriangle className="w-4 h-4 text-rose-400" />
          <span>{sosSentNotice}</span>
        </div>
      )}

      {/* DVIR Submitted Confirmation (deep-linked from dvirs/new) */}
      {dvirBanner && (
        <div className="bg-emerald-950/80 border-b border-emerald-500/40 p-2.5 text-center text-xs text-emerald-200 font-semibold flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{dvirBanner}</span>
        </div>
      )}

      {/* Drayage Ramp Placement Confirmation */}
      {rampBanner && (
        <div className="bg-sky-950/90 border-b border-sky-500/40 p-2.5 text-center text-xs text-sky-200 font-semibold flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-sky-400" />
          <span>{rampBanner}</span>
        </div>
      )}

      {/* Offline sync status */}
      {sync && (sync.queued > 0 || sync.failed > 0) && (
        <div className="bg-slate-800/80 border-b border-white/10 px-4 py-2 flex items-center justify-between gap-2 text-[11px]">
          <span className="text-slate-300">
            {sync.failed > 0
              ? `${sync.failed} item${sync.failed === 1 ? '' : 's'} failed to sync · ${sync.queued} queued`
              : `${sync.queued} item${sync.queued === 1 ? '' : 's'} waiting to sync`}
          </span>
          <button
            onClick={handleRetrySync}
            disabled={syncingNow}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold transition disabled:opacity-50 shrink-0"
          >
            <RotateCcw className={`w-3 h-3 ${syncingNow ? 'animate-spin' : ''}`} />
            {syncingNow ? 'Syncing…' : 'Retry sync'}
          </button>
        </div>
      )}

      {/* NRM Feedback Toast */}
      {nrmFeedback && (
        <div className="bg-amber-500/20 border-b border-amber-500/40 p-2.5 text-center text-xs text-amber-200 font-semibold">
          {nrmFeedback}
        </div>
      )}

      {/* 3. Sticky Active NRM (Non-Revenue Movement) Banner */}
      {activeNrm && (
        <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border-b border-amber-500/40 p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-300">NRM (Non-Revenue Movement) Active</div>
              <div className="text-[11px] text-slate-300">{activeNrm.reason} · Started {activeNrm.startedAt}</div>
            </div>
          </div>
          <button
            onClick={() => handleToggleNrm('', '')}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition active:scale-95"
          >
            ⏹️ End NRM
          </button>
        </div>
      )}

      <main className="px-4 py-4 space-y-4">
        {/* Container Drayage Assignments Section */}
        {drayageJobs && drayageJobs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400">
                  <Truck className="w-4 h-4" />
                </div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Port Drayage Assignments ({drayageJobs.length})
                </h2>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                Port & Yard
              </span>
            </div>

            {drayageJobs.map((job) => (
              <DrayageJobCard
                key={job.id}
                job={job}
                now={now}
                currentPosition={driverGps}
                onOpenRampModal={() => setSelectedRampJob(job)}
                onUpdateStatus={(newStatus) =>
                  handleUpdateDrayageStatus(job.id, { status: newStatus })
                }
                onSimulateGeofence={(simPos) => evaluateDrayageGeofences(simPos)}
              />
            ))}
          </div>
        )}

        {/* Quick Operations Bar: NRM Trigger */}
        {!activeNrm && (
          <div className="p-3 rounded-2xl bg-slate-900/60 border border-white/10 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <Truck className="w-4 h-4 text-amber-400" />
              <span>Starting a deadhead or workshop run?</span>
            </div>
            <button
              onClick={() => setShowNrmModal(true)}
              className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-semibold text-[11px] transition"
            >
              🚚 Toggle NRM
            </button>
          </div>
        )}

        {/* Trips Roster: server-live, offline-cache fallback, or empty state */}
        {serverTrips && serverTrips.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Assigned Trips Today</h2>
            {serverTrips.map((t) => {
              const status = (t.status || 'SCHEDULED').toUpperCase();
              const badge = statusBadge(status);
              const isProgress = status === 'IN_PROGRESS';
              const meta = geofenceMeta[t.id];
              const sc = scoreColor(t.eventCount > 0 ? t.score.score : null);
              const btnState: StartButtonState | null = (status === 'SCHEDULED' || isProgress)
                ? startButtonState({
                    status: status as TripStatus,
                    scheduledDeparture: t.departureTime,
                    actualDeparture: t.actualDepartureAt,
                    actualArrival: t.actualArrivalAt,
                    durationMinutes: t.durationMinutes,
                  })
                : null;
              const action = btnState?.action ?? null;
              const msUntilDeparture = status === 'SCHEDULED' ? new Date(t.departureTime).getTime() - now.getTime() : null;

              return (
                <div
                  key={t.id}
                  className={`rounded-2xl border p-4 space-y-3 transition ${
                    isProgress
                      ? 'bg-slate-900 border-amber-500/50 shadow-lg shadow-amber-500/10'
                      : 'bg-slate-900/60 border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-[10px] text-cyan-400 font-bold">{t.tripNumber || t.id.slice(0, 8)}</span>
                      <h3 className="text-base font-bold text-white mt-0.5">{t.routeName || 'Assigned Route'}</h3>
                      <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>{new Date(t.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {t.vehiclePlate && <span className="font-mono text-emerald-400 ml-2">[{t.vehiclePlate}]</span>}
                        {msUntilDeparture != null && msUntilDeparture > 0 && (
                          <span className="text-slate-500 ml-2">· in {formatH(msUntilDeparture)}</span>
                        )}
                      </div>
                      {meta?.destinationName && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3" />
                          <span>→ {meta.destinationName}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {meta?.armed && (
                        <span
                          title="Automatic start/end detection is active for this trip"
                          className="text-[9px] px-1.5 py-1 rounded-full font-bold bg-emerald-500/15 text-emerald-300 flex items-center gap-0.5"
                        >
                          <Zap className="w-2.5 h-2.5" /> Auto
                        </span>
                      )}
                      <span
                        title={`Driving score ${sc.label} · ${t.score.harshBrake} harsh brakes · ${t.score.harshAccel} harsh accel · ${t.score.speeding} speeding events · ${t.score.idleMinutes}m idle`}
                        className={`text-[10px] px-2 py-1 rounded-full font-bold ring-1 ${sc.bg} ${sc.text} ${sc.ring}`}
                      >
                        {sc.label}
                      </span>
                      <span className={`text-[10px] px-2 py-1 rounded-full font-bold border ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  {/* Timing-aware lifecycle control */}
                  {action && btnState && (
                    <div>
                      <button
                        onClick={() => handleLifecycle(t.id, action)}
                        disabled={pending.has(t.id)}
                        className={`w-full py-2.5 rounded-xl font-bold text-xs shadow-md transition disabled:opacity-50 ${
                          action === 'START'
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        }`}
                      >
                        {btnState.label}
                      </button>
                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        {btnState.helperLine && (
                          <p className="text-[10px] text-slate-500">{btnState.helperLine}</p>
                        )}
                        {btnState.timing !== 'unknown' && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${timingChipClass(btnState.timing)}`}>
                            {btnState.timing === 'late'
                              ? `${btnState.deltaMinutes}m late`
                              : btnState.timing === 'early'
                              ? `${Math.abs(btnState.deltaMinutes)}m early`
                              : 'On time'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : offlineTrips && offlineTrips.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
              <Radio className="w-3.5 h-3.5" />
              <span>Offline — showing your last synced roster ({offlineTrips.length} trip{offlineTrips.length === 1 ? '' : 's'})</span>
            </div>
            {offlineTrips.map((t) => {
              const badge = statusBadge(t.status);
              return (
                <div key={t.id} className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white">{t.routeName}</h3>
                      <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>{new Date(t.scheduledDeparture).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {t.vehiclePlate && <span className="font-mono text-emerald-400 ml-2">[{t.vehiclePlate}]</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3" />
                        <span>{t.origin} → {t.destination}</span>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold border ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Cached {new Date(t.cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — reconnect to start/end trips.
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          (!drayageJobs || drayageJobs.length === 0) ? (
            <div className="rounded-2xl bg-slate-900/40 border border-white/10 p-6 text-center text-xs text-slate-400">
              No scheduled trips found for today.
            </div>
          ) : null
        )}
      </main>

      {/* Auto-lifecycle toasts */}
      {autoToasts.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md space-y-2">
          {autoToasts.map((t) => (
            <div
              key={t.id}
              className="bg-slate-900/95 border border-emerald-500/40 rounded-xl px-3 py-2 text-[11px] text-emerald-200 shadow-lg flex items-center justify-between gap-2 backdrop-blur"
            >
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {t.text}
              </span>
              <button
                onClick={() => setAutoToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 🚨 SOS Emergency Modal */}
      {showSosModal && (
        <SosEmergencyModal
          sending={sosSending}
          onClose={() => setShowSosModal(false)}
          onTrigger={handleTriggerSos}
        />
      )}

      {/* 🚚 NRM (Non-Revenue Movement) Modal */}
      {showNrmModal && (
        <NrmMovementModal
          onClose={() => setShowNrmModal(false)}
          onStart={handleToggleNrm}
        />
      )}

      {/* 📦 Ramp Placement & Destuffing ETC Modal */}
      {selectedRampJob && (
        <RampPlacementModal
          job={selectedRampJob}
          submitting={submittingRamp}
          onClose={() => setSelectedRampJob(null)}
          onSubmit={(payload) => handleUpdateDrayageStatus(selectedRampJob.id, payload)}
        />
      )}
    </div>
  );
}

// ── SOS Emergency Confirmation Modal ──────────────────────────────────────

function SosEmergencyModal({
  sending,
  onClose,
  onTrigger,
}: {
  sending: boolean;
  onClose: () => void;
  onTrigger: (emergencyType: string, notes?: string) => void;
}) {
  const [emergencyType, setEmergencyType] = useState('GENERAL_BREAKDOWN');
  const [notes, setNotes] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border-2 border-rose-500/80 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl shadow-rose-900/50 text-xs">
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-rose-600/50 animate-pulse">
            <Flame className="w-7 h-7 fill-white" />
          </div>
          <h2 className="text-base font-bold text-white mt-2">Emergency SOS Alert</h2>
          <p className="text-[11px] text-rose-300">
            This immediately flags your vehicle on the Operations Control Tower with live GPS and vehicle status.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Emergency Nature *</label>
            <select
              value={emergencyType}
              onChange={(e) => setEmergencyType(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-rose-500"
            >
              <option value="GENERAL_BREAKDOWN">🚨 Major Mechanical Breakdown / Smoke</option>
              <option value="ACCIDENT_COLLISION">💥 Road Accident / Collision</option>
              <option value="MEDICAL_EMERGENCY">🚑 Medical Emergency / Passenger Illness</option>
              <option value="SECURITY_THREAT">⚠️ Security / Passenger Disorder</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Brief Description / Landmark</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Near Exit 36 hard shoulder, flat tire & smoke"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onTrigger(emergencyType, notes)}
            disabled={sending}
            className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-lg shadow-rose-600/40 transition disabled:opacity-50"
          >
            {sending ? 'Dispatching...' : '🚨 SEND SOS'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── NRM (Non-Revenue Movement) Modal ──────────────────────────────────────

function NrmMovementModal({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (reason: string, destination?: string) => void;
}) {
  const [reason, setReason] = useState('Depot Repositioning / Deadhead Run');
  const [destination, setDestination] = useState('Main Depot / Al Quoz');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Start Non-Revenue Run</h3>
              <p className="text-[11px] text-slate-400">Notify operations of deadheading / repositioning</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">NRM Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            >
              <option value="Depot Repositioning / Deadhead Run">🔄 Depot Repositioning / Deadhead Run</option>
              <option value="Garage / Workshop Maintenance Run">🔧 Garage / Workshop Maintenance Run</option>
              <option value="Fuel Station Run">⛽ Fuel Station Run</option>
              <option value="Driver Changeover / Staging">⏱️ Driver Changeover / Staging</option>
              <option value="Emergency Standby Staging">🚨 Emergency Standby Staging</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Destination</label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. DIP Workshop Gate 2"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onStart(reason, destination)}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-lg shadow-amber-500/20 transition"
          >
            Start NRM
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Port Container Drayage Job Card ─────────────────────────────────────────

function DrayageJobCard({
  job,
  now,
  currentPosition,
  onOpenRampModal,
  onUpdateStatus,
  onSimulateGeofence,
}: {
  job: DriverDrayageJob;
  now: Date;
  currentPosition: LatLng | null;
  onOpenRampModal: () => void;
  onUpdateStatus: (status: string) => void;
  onSimulateGeofence: (pos: LatLng) => void;
}) {
  const isL1 = job.jobPhase === 'L1';
  const isAtPort = job.status === 'AT_PORT';
  const isPlacedAtRamp = job.status === 'PLACED_AT_RAMP';
  const isDetached = job.status === 'CONTAINER_DETACHED' || job.trailerDetached;
  const isInTransit = job.status === 'IN_TRANSIT' || job.status === 'LOADED';
  const isPending = job.status === 'PENDING' || job.status === 'ACCEPTED';
  const isCompleted = job.status === 'COMPLETED';

  // Distance calculations to configured geofences
  const distToPortM = useMemo(() => {
    if (!currentPosition || !job.terminalGeofence) return null;
    return Math.round(haversineMeters(currentPosition, { lat: job.terminalGeofence.lat, lng: job.terminalGeofence.lng }));
  }, [currentPosition, job.terminalGeofence]);

  const distToRampM = useMemo(() => {
    if (!currentPosition || !job.warehouseGeofence) return null;
    return Math.round(haversineMeters(currentPosition, { lat: job.warehouseGeofence.lat, lng: job.warehouseGeofence.lng }));
  }, [currentPosition, job.warehouseGeofence]);

  // Calculate ETC countdown
  const etcRemainingMs = useMemo(() => {
    if (!job.etcTime) return null;
    return new Date(job.etcTime).getTime() - now.getTime();
  }, [job.etcTime, now]);

  const etcFormatted = useMemo(() => {
    if (!job.etcTime) return null;
    const target = new Date(job.etcTime);
    const timeStr = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (etcRemainingMs == null) return timeStr;
    if (etcRemainingMs <= 0) return `Elapsed (${timeStr})`;
    const mins = Math.floor(etcRemainingMs / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h > 0 ? `${h}h ` : ''}${m}m left · Target ${timeStr}`;
  }, [job.etcTime, etcRemainingMs]);

  return (
    <div
      className={`rounded-2xl border p-4 space-y-3 transition ${
        isPlacedAtRamp
          ? 'bg-slate-900 border-sky-500/50 shadow-lg shadow-sky-500/10'
          : isInTransit
          ? 'bg-slate-900 border-amber-500/50 shadow-lg shadow-amber-500/10'
          : 'bg-slate-900/60 border-white/10'
      }`}
    >
      {/* Top Header: Phase, Job Code, Container & Priority */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                isL1 ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
              }`}
            >
              {isL1 ? 'L1 Import Haul' : 'L2 Empty Return'}
            </span>
            <span className="font-mono text-[10px] text-slate-400 font-bold">{job.jobCode}</span>
            {job.priority === 'HIGH' || job.priority === 'URGENT' ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                {job.priority}
              </span>
            ) : null}
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-mono text-base font-extrabold text-white tracking-wide">{job.containerNumber}</span>
            <span className="text-[11px] font-mono text-cyan-400 font-semibold">
              [{job.containerSize} {job.containerType}]
            </span>
          </div>
        </div>

        {/* Status Pill */}
        <div className="shrink-0 text-right">
          <span
            className={`text-[10px] px-2.5 py-1 rounded-full font-bold border ${
              isCompleted
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : isPlacedAtRamp
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/40 animate-pulse'
                : isInTransit
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            {job.status.replace(/_/g, ' ')}
          </span>
          {job.driverAllowanceAed > 0 && (
            <div className="text-[10px] text-emerald-400 font-semibold mt-1">
              +AED {job.driverAllowanceAed} Allowance
            </div>
          )}
        </div>
      </div>

      {/* Origin / Destination Path with Configured Geofence Badges */}
      <div className="rounded-xl bg-slate-950/60 p-2.5 border border-white/5 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2 text-slate-300 min-w-0">
            <Anchor className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="text-[11px] truncate text-slate-300">
              <strong className="text-white">Port Terminal:</strong> {job.terminalName}
            </span>
          </div>
          {job.terminalGeofence && (
            <span
              title={`Terminal Geofence: ${job.terminalGeofence.name} (${job.terminalGeofence.radiusMeters}m radius)`}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0"
            >
              ⚓ {distToPortM != null ? `${distToPortM}m` : 'Port GF'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 pl-4 text-slate-500">
          <ArrowRight className="w-3 h-3 text-slate-600" />
          <span className="text-[10px]">Direct Drayage Corridor · Automated Geofence Auto-Trigger Armed</span>
        </div>

        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2 text-slate-300 min-w-0">
            <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] truncate text-slate-300">
              <strong className="text-white">Consignee Ramp:</strong> {job.warehouseName}
            </span>
          </div>
          {job.warehouseGeofence && (
            <span
              title={`Ramp Geofence: ${job.warehouseGeofence.name} (${job.warehouseGeofence.type === 'POLYGON' ? 'Polygon' : `${job.warehouseGeofence.radiusMeters}m`})`}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0"
            >
              📍 {distToRampM != null ? `${distToRampM}m` : (job.warehouseGeofence.type === 'POLYGON' ? 'Polygon Ramp' : 'Ramp GF')}
            </span>
          )}
        </div>
      </div>

      {/* Equipment details */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
        <div className="flex items-center gap-2">
          <span>Tractor: <strong className="text-slate-200 font-mono">{job.assignedVehiclePlate || 'Attached'}</strong></span>
          <span>·</span>
          <span>Chassis: <strong className="text-slate-200 font-mono">{job.assignedTrailerPlate || 'Standard'}</strong></span>
        </div>
        {isDetached && (
          <span className="text-[10px] font-semibold text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md border border-purple-500/30">
            Chassis Detached
          </span>
        )}
      </div>

      {/* Active Destuffing Countdown Banner (if Placed at Ramp or has ETC) */}
      {job.etcTime && (
        <div
          className={`rounded-xl p-2.5 border flex items-center justify-between gap-2 text-xs ${
            etcRemainingMs != null && etcRemainingMs <= 0
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Timer className={`w-4 h-4 shrink-0 ${etcRemainingMs != null && etcRemainingMs > 0 ? 'animate-spin' : ''}`} />
            <div className="truncate">
              <span className="font-semibold text-[11px]">
                {etcRemainingMs != null && etcRemainingMs <= 0 ? 'Destuffing Window Expired' : 'Destuffing Countdown'}
              </span>
              <div className="text-[10px] font-mono opacity-90">{etcFormatted}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenRampModal}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 shrink-0 transition"
          >
            Extend
          </button>
        </div>
      )}

      {/* Lifecycle Action Buttons */}
      <div className="pt-1 space-y-2">
        {isPending && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => onUpdateStatus('IN_TRANSIT')}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition flex items-center justify-center gap-1.5"
            >
              <Truck className="w-4 h-4" />
              <span>Start Drayage Trip (Gate Out Port)</span>
            </button>
            {job.terminalGeofence && (
              <button
                type="button"
                onClick={() => job.terminalGeofence && onSimulateGeofence({ lat: job.terminalGeofence.lat, lng: job.terminalGeofence.lng })}
                className="w-full py-1.5 px-2 rounded-xl text-[10px] font-semibold bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 transition flex items-center justify-center gap-1"
              >
                <span>⚡ Simulate Entering Port Geofence (Auto-advance to AT_PORT)</span>
              </button>
            )}
          </div>
        )}

        {isAtPort && (
          <div className="space-y-1.5">
            <div className="p-2.5 rounded-xl bg-sky-950/80 border border-sky-500/40 text-center text-xs text-sky-200 font-semibold flex items-center justify-center gap-1.5">
              <Anchor className="w-4 h-4 text-sky-400 animate-pulse" />
              <span>At Port Berth/Gate · Container Loading in Progress</span>
            </div>
            <button
              type="button"
              onClick={() => onUpdateStatus('IN_TRANSIT')}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition flex items-center justify-center gap-1.5"
            >
              <Truck className="w-4 h-4" />
              <span>Gate Out & Start Transit to Consignee Ramp</span>
            </button>
          </div>
        )}

        {isInTransit && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onOpenRampModal}
                className="py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white shadow-lg shadow-sky-600/30 transition flex items-center justify-center gap-1.5"
              >
                <MapPin className="w-4 h-4" />
                <span>Placed at Ramp</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateStatus('CONTAINER_DETACHED')}
                className="py-2.5 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 transition flex items-center justify-center gap-1.5"
              >
                <span>Detach at Yard</span>
              </button>
            </div>
            {job.warehouseGeofence && (
              <button
                type="button"
                onClick={() => job.warehouseGeofence && onSimulateGeofence({ lat: job.warehouseGeofence.lat, lng: job.warehouseGeofence.lng })}
                className="w-full py-1.5 px-2 rounded-xl text-[10px] font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition flex items-center justify-center gap-1"
              >
                <span>⚡ Simulate Arriving at Ramp Geofence (Auto-pop Prompt)</span>
              </button>
            )}
          </div>
        )}

        {isPlacedAtRamp && !job.etcTime && (
          <button
            type="button"
            onClick={onOpenRampModal}
            className="w-full py-2.5 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md transition flex items-center justify-center gap-1.5"
          >
            <Timer className="w-4 h-4" />
            <span>Set Destuffing ETC & Placement Photo</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Ramp Placement & Destuffing ETC Modal ───────────────────────────────────

function RampPlacementModal({
  job,
  submitting,
  onClose,
  onSubmit,
}: {
  job: DriverDrayageJob;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    status: string;
    placementLocation: string;
    detachTrailer: boolean;
    etc: string;
    notes: string;
    photo: string | null;
  }) => void;
}) {
  const [hoursPreset, setHoursPreset] = useState<number | 'custom'>(2);
  const [customDateTime, setCustomDateTime] = useState<string>(() => {
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [placementLocation, setPlacementLocation] = useState<'RAMP' | 'YARD'>('RAMP');
  const [detachTrailer, setDetachTrailer] = useState<boolean>(true);
  const [rampNotes, setRampNotes] = useState<string>('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const calculatedEtc = useMemo(() => {
    if (hoursPreset === 'custom') {
      const parsed = new Date(customDateTime);
      return isNaN(parsed.getTime()) ? new Date(Date.now() + 2 * 60 * 60 * 1000) : parsed;
    }
    return new Date(Date.now() + hoursPreset * 60 * 60 * 1000);
  }, [hoursPreset, customDateTime]);

  const etcLabel = useMemo(() => {
    return (
      calculatedEtc.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ' (' +
      calculatedEtc.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ')'
    );
  }, [calculatedEtc]);

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = () => {
    const notesSummary = [
      rampNotes.trim(),
      photoName ? `Photo: ${photoName}` : '',
      detachTrailer ? 'Chassis detached' : 'Chassis kept coupled',
    ]
      .filter(Boolean)
      .join(' · ');

    onSubmit({
      status: placementLocation === 'RAMP' ? 'PLACED_AT_RAMP' : 'PLACED_AT_YARD',
      placementLocation,
      detachTrailer,
      etc: calculatedEtc.toISOString(),
      notes: notesSummary || (placementLocation === 'RAMP' ? 'Placed at warehouse ramp' : 'Placed at yard'),
      photo: photoPreview,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="bg-slate-950 border border-sky-500/40 rounded-3xl p-5 max-w-md w-full space-y-4 shadow-2xl text-xs my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400">
              <Anchor className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-sky-400 tracking-wider">Container Drayage</div>
              <h3 className="text-sm font-bold text-white">Placed at Ramp & Destuffing ETC</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Container Badge Card */}
        <div className="rounded-2xl bg-slate-900 border border-white/10 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-sm text-cyan-300">{job.containerNumber}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {job.containerSize} {job.containerType}
            </span>
          </div>
          <div className="text-slate-300 flex items-center gap-1.5 text-[11px]">
            <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate">{job.warehouseName}</span>
          </div>
          <div className="text-[10px] text-slate-400 flex items-center gap-2 pt-1 border-t border-white/5">
            <span>Chassis: <strong className="text-white font-mono">{job.assignedTrailerPlate || 'Standard Chassis'}</strong></span>
            <span>·</span>
            <span>Tractor: <strong className="text-white font-mono">{job.assignedVehiclePlate || 'Assigned'}</strong></span>
          </div>
        </div>

        {/* Placement Location Selector */}
        <div className="space-y-1.5">
          <label className="block text-slate-300 font-semibold">Placement Location *</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPlacementLocation('RAMP')}
              className={`p-2.5 rounded-xl border text-center transition font-semibold ${
                placementLocation === 'RAMP'
                  ? 'bg-sky-500/20 border-sky-500 text-sky-200'
                  : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              📍 Loading Dock / Ramp
            </button>
            <button
              type="button"
              onClick={() => setPlacementLocation('YARD')}
              className={`p-2.5 rounded-xl border text-center transition font-semibold ${
                placementLocation === 'YARD'
                  ? 'bg-sky-500/20 border-sky-500 text-sky-200'
                  : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
              }`}
            >
              🅿️ Staging Yard
            </button>
          </div>
        </div>

        {/* ETC Duration Presets */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-slate-300 font-semibold">Destuffing Duration (ETC) *</label>
            <span className="text-[11px] font-mono font-bold text-amber-300">ETA: {etcLabel}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { val: 1, label: '+1h', sub: 'Express' },
              { val: 2, label: '+2h', sub: 'Pallet' },
              { val: 3, label: '+3h', sub: 'Standard' },
              { val: 4, label: '+4h', sub: 'Floor' },
            ].map((p) => (
              <button
                key={p.val}
                type="button"
                onClick={() => setHoursPreset(p.val)}
                className={`py-2 px-1 rounded-xl border text-center transition ${
                  hoursPreset === p.val
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                    : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                <div className="text-xs">{p.label}</div>
                <div className="text-[9px] opacity-75">{p.sub}</div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setHoursPreset('custom')}
            className={`w-full py-1.5 px-2 rounded-xl border text-[11px] text-center transition ${
              hoursPreset === 'custom'
                ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'
            }`}
          >
            Custom Target Date / Time
          </button>

          {hoursPreset === 'custom' && (
            <input
              type="datetime-local"
              value={customDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-white text-xs focus:outline-none focus:border-amber-500"
            />
          )}
        </div>

        {/* Detach Trailer Checkbox */}
        <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900/80 border border-white/10 cursor-pointer">
          <input
            type="checkbox"
            checked={detachTrailer}
            onChange={(e) => setDetachTrailer(e.target.checked)}
            className="w-4 h-4 rounded border-slate-700 text-sky-500 focus:ring-0"
          />
          <div className="text-[11px]">
            <span className="text-white font-semibold">Detach Trailer / Chassis</span>
            <p className="text-[10px] text-slate-400">Frees your tractor for next assignment while container is destuffed</p>
          </div>
        </label>

        {/* Photo Evidence Capture */}
        <div className="space-y-1.5">
          <label className="block text-slate-300 font-semibold">Placement Proof / Evidence Photo</label>
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoCapture}
          />
          {photoPreview ? (
            <div className="relative rounded-xl overflow-hidden border border-emerald-500/50 bg-slate-900 p-2 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Placement preview" className="w-12 h-12 rounded-lg object-cover" />
                <div className="truncate text-[11px]">
                  <div className="text-emerald-300 font-bold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Photo Captured
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{photoName}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhotoPreview(null);
                  setPhotoName(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-rose-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 rounded-xl border border-dashed border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 font-semibold flex items-center justify-center gap-2 transition"
            >
              <Camera className="w-4 h-4" />
              <span>Take Container Placement Photo</span>
            </button>
          )}
        </div>

        {/* Bay / Notes */}
        <div>
          <label className="block text-slate-300 font-semibold mb-1">Ramp Bay / Warehouse Notes</label>
          <input
            type="text"
            value={rampNotes}
            onChange={(e) => setRampNotes(e.target.value)}
            placeholder="e.g. Ramp Bay 04 - Forklift unloading active"
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white text-xs focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white font-bold shadow-lg shadow-sky-600/30 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {submitting ? (
              <span>Submitting...</span>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Confirm Placement</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
