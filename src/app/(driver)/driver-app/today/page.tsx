/**
 * src/app/(driver)/driver-app/today/page.tsx
 *
 * Driver's home screen — the first thing they see after login.
 *
 * Features:
 *   - Current trip assignments and roster
 *   - Continuous driving CBA compliance watcher
 *   - 🚨 SOS Emergency Panic Button (Critical dispatch to operations)
 *   - 📡 Real-Time Live Location Sharing (10s telemetry pings)
 *   - 🚚 Non-Revenue Movement (NRM / Deadhead) Toggle & Ops Notification
 */

'use client';

import React, { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getAllTrips, type OfflineTrip } from '@/lib/driver-offline/db';
import { syncSummary, forceDrain } from '@/lib/driver-offline/sync';
import { BackButton } from '@/components/driver-app/BackButton';
import { ALERT_LEVEL_META } from '@/lib/driver-offline/continuous-driving-watcher';
import { useContinuousDriving } from '@/hooks/useContinuousDriving';
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
} from '@/lib/driver-offline/auto-lifecycle';
import {
  AlertTriangle,
  Radio,
  Truck,
  RotateCcw,
  X,
  Phone,
  CheckCircle2,
  MapPin,
  Clock,
  Zap,
  Flame,
} from 'lucide-react';

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
  const [sync, setSync] = useState<{ queued: number; failed: number } | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [autoToasts, setAutoToasts] = useState<Array<{ id: string; tripId: string; text: string; at: number }>>([]);

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

  const autoWatchersRef = useRef<Map<string, AutoLifecycleHandle>>(new Map());

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
    } catch {
      // Offline
    }
  }, []);

  useEffect(() => {
    void refresh();
    void fetchRoster();
  }, [refresh, fetchRoster]);

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
      } catch {
        // Silent
      }
    };

    void streamLocation();
    const interval = setInterval(streamLocation, 12_000);
    return () => clearInterval(interval);
  }, [liveLocationActive, serverTrips]);

  // Lifecycle action: tap Start or End on a trip
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
          lat: loc?.lat || 25.2048,
          lng: loc?.lng || 55.2708,
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
        setNrmFeedback(`✓ NRM started: ${reason}. Ops team notified.`);
      } else {
        setActiveNrm(null);
        setNrmFeedback('✓ NRM run completed. Returned to standard roster.');
      }
      setTimeout(() => setNrmFeedback(null), 4000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'NRM Toggle Failed');
    }
  };

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
                className={`rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                  driving.state.level === 'ok' ? 'bg-emerald-500/15 text-emerald-200' :
                  driving.state.level === 'warning' ? 'bg-amber-500/15 text-amber-200' :
                  'bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40 animate-pulse'
                }`}
              >
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

        {/* Trips Roster */}
        {serverTrips && serverTrips.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Assigned Trips Today</h2>
            {serverTrips.map((t) => {
              const status = (t.status || 'SCHEDULED').toUpperCase();
              const badge = statusBadge(status);
              const isProgress = status === 'IN_PROGRESS';

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
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold border ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Lifecycle Controls */}
                  {status === 'SCHEDULED' && (
                    <button
                      onClick={() => handleLifecycle(t.id, 'START')}
                      disabled={pending.has(t.id)}
                      className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition disabled:opacity-50"
                    >
                      ▶️ Start Trip
                    </button>
                  )}

                  {isProgress && (
                    <button
                      onClick={() => handleLifecycle(t.id, 'END')}
                      disabled={pending.has(t.id)}
                      className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition disabled:opacity-50"
                    >
                      ⏹️ Complete / End Trip
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-900/40 border border-white/10 p-6 text-center text-xs text-slate-400">
            No scheduled trips found for today.
          </div>
        )}
      </main>

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
