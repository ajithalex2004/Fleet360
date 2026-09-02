'use client';
/**
 * /bus-ops/passenger/app — Mobile-first PWA shell for the Staff Rider.
 *
 * Features:
 *   - Bottom tab bar (Today · Trips · Board · Profile)
 *   - 1-Click Boarding, Running Late, Skip Trip actions
 *   - Pickup Location Change Request & "Mark as New Stop Point"
 *   - Ad-Hoc & Overtime On-Demand Transport Booking
 *   - PWA install banner + Push notification reminders
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Bus, Bell, MapPin, CheckCircle2, AlertTriangle, Clock,
  User, ListChecks, Wifi, WifiOff, X, RefreshCw, ChevronRight,
  Play, SkipForward, Hourglass, Navigation, Zap, QrCode, Send, Ticket, Car,
  Crosshair, LocateFixed, CheckSquare, Square,
} from 'lucide-react';
import { useFetchedData, fetchOnce } from '@/hooks/useFetchedData';

type Tab = 'today' | 'trips' | 'board' | 'profile';

interface PassengerTrip {
  passengerId: string; status: string; boardedAt: string | null;
  boardingStop: string | null; alightingStop: string | null;
  trip: {
    id: string; tripNumber: string | null;
    departureTime: string; arrivalTime: string | null;
    shiftType: string | null; direction: string | null;
    status: string | null; vehicleId: string | null;
    route: { name?: string; origin?: string; destination?: string };
  };
}

interface Today {
  staff: { id: string; name: string; employeeId: string; department: string | null; defaultStopName: string | null };
  trips: PassengerTrip[];
  rfidTag: { tagUid: string } | null;
}

function timeOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function relativeOf(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (mins < -5) return `${-mins} min ago`;
  if (mins < 1)   return 'now';
  if (mins < 60)  return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs}h ${mins % 60}m`;
}

export default function MobilePassengerApp() {
  const [tab, setTab] = useState<Tab>('today');
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Stop Change Modal State
  const [showStopModal, setShowStopModal] = useState(false);
  const [stopChangeTargetTripId, setStopChangeTargetTripId] = useState<string | null>(null);

  // Adhoc Request Modal State
  const [showAdhocModal, setShowAdhocModal] = useState(false);

  // Online status
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // PWA: service worker + install prompt
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW register failed', e));
    }
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  // Data: today's trips
  const todayRes = useFetchedData<Today>('/api/bus-ops/passenger/today');
  const today = todayRes.data;

  // Notification reminders
  useEffect(() => {
    if (!today || notificationPermission !== 'granted') return;
    const reminders = today.trips
      .filter((t) => t.status === 'CONFIRMED' && t.trip.status !== 'CANCELLED')
      .map((t) => {
        const dep = new Date(t.trip.departureTime).getTime();
        const fire = dep - 10 * 60_000;
        const delay = fire - Date.now();
        if (delay <= 0 || delay > 6 * 60 * 60_000) return null;
        return { id: t.passengerId, timeout: setTimeout(() => {
          new Notification('Bus in 10 min', {
            body: `${t.trip.route.name ?? 'Your trip'} from ${t.trip.route.origin} — boarding at ${timeOf(t.trip.departureTime)}.`,
            icon: '/icon-192.png',
            tag: t.passengerId,
          });
        }, delay) };
      }).filter(Boolean);
    return () => { reminders.forEach((r: any) => clearTimeout(r.timeout)); };
  }, [today, notificationPermission]);

  const askNotificationPermission = async () => {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setNotificationPermission(p);
  };

  const installApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  // Trip actions
  const tripAction = async (passengerId: string, action: 'late' | 'skip' | 'board', trip: PassengerTrip['trip']) => {
    setActionInFlight(`${action}-${passengerId}`);
    setActionFeedback(null);
    try {
      const url = action === 'board'
        ? `/api/bus-ops/passenger/board`
        : action === 'skip'
        ? `/api/bus-ops/passenger/${passengerId}/skip`
        : `/api/bus-ops/passenger/${passengerId}/running-late`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId: trip.id, note: '' }),
      });
      if (res.ok) {
        setActionFeedback(action === 'late' ? '✓ Driver notified. They\'ll wait 2 min.' :
                         action === 'skip' ? '✓ Marked as skip. Waitlist opened.' :
                                              '✓ Boarded.');
        todayRes.refresh();
      } else {
        setActionFeedback(`✗ Could not ${action} — try again.`);
      }
    } catch (e) {
      setActionFeedback(`✗ ${online ? 'Server error' : 'You\'re offline'}`);
    } finally {
      setActionInFlight(null);
      setTimeout(() => setActionFeedback(null), 3500);
    }
  };

  const openStopChangeModal = (tripPassengerId?: string) => {
    setStopChangeTargetTripId(tripPassengerId || null);
    setShowStopModal(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Top app bar */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Bus className="w-5 h-5 text-cyan-400" /> Fleet360
          </h1>
          <p className="text-[11px] text-slate-400">{today?.staff?.name ?? 'Loading…'} · {today?.staff?.department ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          {online ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-rose-400" />}
          {installPrompt && (
            <button onClick={installApp} className="text-[10px] bg-cyan-500 hover:bg-cyan-400 text-white px-2 py-1 rounded">
              Install app
            </button>
          )}
          {notificationPermission === 'default' && (
            <button onClick={askNotificationPermission} aria-label="Enable trip reminders"
              className="p-1.5 rounded-full bg-amber-500/20 text-amber-300 hover:bg-amber-500/30">
              <Bell className="w-4 h-4" />
            </button>
          )}
          {notificationPermission === 'granted' && (
            <span className="p-1.5 rounded-full bg-emerald-500/20 text-emerald-300">
              <Bell className="w-4 h-4" />
            </span>
          )}
        </div>
      </header>

      {/* Feedback toast */}
      {actionFeedback && (
        <div className="fixed top-16 inset-x-0 z-40 mx-auto w-fit px-4 py-2 rounded-full bg-slate-900 border border-white/20 text-sm text-white shadow-xl">
          {actionFeedback}
        </div>
      )}

      {/* Offline banner */}
      {!online && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-[11px] text-amber-200 flex items-center gap-2">
          <WifiOff className="w-3.5 h-3.5" /> You&apos;re offline. Showing the last cached version of your trips.
        </div>
      )}

      {/* Tab content */}
      <main className="flex-1 p-4 pb-24 max-w-2xl mx-auto w-full">
        {tab === 'today'   && (
          <TodayTab
            today={today ?? null}
            onAction={tripAction}
            actionInFlight={actionInFlight}
            onOpenAdhoc={() => setShowAdhocModal(true)}
            onOpenStopChange={openStopChangeModal}
          />
        )}
        {tab === 'trips'   && <TripsTab today={today ?? null} onOpenStopChange={openStopChangeModal} />}
        {tab === 'board'   && <BoardTab today={today ?? null} onAction={tripAction} actionInFlight={actionInFlight} />}
        {tab === 'profile' && (
          <ProfileTab
            today={today ?? null}
            notificationPermission={notificationPermission}
            onAskPerm={askNotificationPermission}
            onOpenStopChange={openStopChangeModal}
          />
        )}
      </main>

      {/* Modal: Pickup Location & Stop Change */}
      {showStopModal && (
        <PickupStopChangeModal
          staff={today?.staff || null}
          tripPassengerId={stopChangeTargetTripId}
          onClose={() => {
            setShowStopModal(false);
            setStopChangeTargetTripId(null);
          }}
          onSuccess={(msg) => {
            setShowStopModal(false);
            setStopChangeTargetTripId(null);
            setActionFeedback(`✓ ${msg}`);
            todayRes.refresh();
            setTimeout(() => setActionFeedback(null), 4000);
          }}
        />
      )}

      {/* Modal: Ad-Hoc / Overtime Ride Request */}
      {showAdhocModal && (
        <AdhocRideModal
          staff={today?.staff || null}
          onClose={() => setShowAdhocModal(false)}
          onSuccess={(msg) => {
            setShowAdhocModal(false);
            setActionFeedback(`✓ ${msg}`);
            todayRes.refresh();
            setTimeout(() => setActionFeedback(null), 4000);
          }}
        />
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-slate-900/95 backdrop-blur border-t border-white/10">
        <div className="max-w-2xl mx-auto grid grid-cols-4">
          {([
            { id: 'today',   label: 'Today',   icon: ListChecks },
            { id: 'trips',   label: 'Trips',   icon: Clock },
            { id: 'board',   label: 'Board',   icon: Navigation },
            { id: 'profile', label: 'Profile', icon: User },
          ] as const).map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex flex-col items-center justify-center py-2.5 transition-colors ${
                  isActive ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'
                }`}>
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-2' : ''}`} strokeWidth={isActive ? 2.5 : 1.75} />
                <span className="text-[10px] font-semibold mt-0.5">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ── Tab: Today ────────────────────────────────────────────────────────────

function TodayTab({
  today,
  onAction,
  actionInFlight,
  onOpenAdhoc,
  onOpenStopChange,
}: {
  today: Today | null;
  onAction: (id: string, action: 'late' | 'skip' | 'board', trip: PassengerTrip['trip']) => void;
  actionInFlight: string | null;
  onOpenAdhoc: () => void;
  onOpenStopChange: (tripPassengerId?: string) => void;
}) {
  const [adhocRequests, setAdhocRequests] = useState<any[]>([]);

  const loadAdhoc = useCallback(() => {
    if (!today?.staff?.id) return;
    fetch(`/api/bus-ops/adhoc-requests?staffMemberId=${today.staff.id}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setAdhocRequests(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [today?.staff?.id]);

  useEffect(() => {
    loadAdhoc();
  }, [loadAdhoc]);

  if (!today) return <Splash label="Loading today's trips…" />;
  const now = new Date();
  const upcoming = today.trips.filter((t) => new Date(t.trip.departureTime).getTime() > now.getTime() - 30 * 60_000);
  const past    = today.trips.filter((t) => new Date(t.trip.departureTime).getTime() <= now.getTime() - 30 * 60_000);

  const pendingAdhoc = adhocRequests.filter((r) => r.status === 'PENDING');
  const activeAdhoc = adhocRequests.filter((r) => r.status === 'FULFILLED');

  return (
    <div className="space-y-4">
      {/* Today Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-700 p-5 text-white shadow-lg shadow-cyan-500/30">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80">Today</p>
            <h2 className="text-2xl font-bold mt-1">
              {upcoming.length > 0 ? `${upcoming.length} upcoming trip${upcoming.length === 1 ? '' : 's'}` : 'No scheduled trips'}
            </h2>
            {today.staff.defaultStopName && (
              <p className="text-sm opacity-90 mt-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Default stop: {today.staff.defaultStopName}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 items-end">
            <button
              onClick={onOpenAdhoc}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 font-bold text-xs shadow hover:bg-amber-300 transition"
            >
              <Zap className="w-3.5 h-3.5" />
              Ad-Hoc / Overtime
            </button>
            <button
              onClick={() => onOpenStopChange()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white font-medium text-[11px] transition"
            >
              <MapPin className="w-3 h-3" /> Change Stop
            </button>
          </div>
        </div>
      </div>

      {/* Active Ad-Hoc / Overtime Bookings & Boarding Passes */}
      {activeAdhoc.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Confirmed Ad-Hoc Boarding Passes
          </p>
          {activeAdhoc.map((req) => (
            <div
              key={req.id}
              className="rounded-2xl bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/40 p-4 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-[10px] font-bold text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/30">
                    {req.requestNo}
                  </span>
                  <h3 className="text-sm font-bold text-white mt-1">
                    {req.pickupLocation} → {req.dropLocation}
                  </h3>
                  <p className="text-xs text-amber-200 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 text-amber-400" />
                    Pickup at {new Date(req.tripDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="p-2 rounded-xl bg-white text-slate-950 flex flex-col items-center justify-center">
                  <QrCode className="w-8 h-8" />
                  <span className="text-[8px] font-mono font-bold mt-0.5">SCAN TO BOARD</span>
                </div>
              </div>

              {req.notes && (
                <div className="text-[11px] text-slate-300 bg-slate-950/80 p-2 rounded-lg border border-white/5 font-mono">
                  {req.notes.split('\n')[0]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pending Ad-Hoc Requests Notice */}
      {pendingAdhoc.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400 animate-spin" />
            <span className="text-amber-200">
              {pendingAdhoc.length} Ad-Hoc Request pending dispatcher match...
            </span>
          </div>
          <span className="text-[10px] font-mono text-amber-400">{pendingAdhoc[0].requestNo}</span>
        </div>
      )}

      {/* Upcoming Trips */}
      {upcoming.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Upcoming today</h2>
          {upcoming.map((t) => (
            <TripCard
              key={t.passengerId}
              trip={t}
              onAction={onAction}
              actionInFlight={actionInFlight}
              onOpenStopChange={() => onOpenStopChange(t.passengerId)}
            />
          ))}
        </div>
      )}

      {/* Past Trips */}
      {past.length > 0 && (
        <div className="space-y-3 pt-2">
          <h2 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Completed today</h2>
          {past.map((t) => (
            <TripCard
              key={t.passengerId}
              trip={t}
              onAction={onAction}
              actionInFlight={actionInFlight}
              muted
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trip Card ─────────────────────────────────────────────────────────────

function TripCard({
  trip,
  onAction,
  actionInFlight,
  onOpenStopChange,
  muted,
}: {
  trip: PassengerTrip;
  onAction: (id: string, action: 'late' | 'skip' | 'board', trip: PassengerTrip['trip']) => void;
  actionInFlight: string | null;
  onOpenStopChange?: () => void;
  muted?: boolean;
}) {
  const t = trip.trip;
  const status = (trip.status ?? 'PENDING').toUpperCase();
  const STATUS_BG: Record<string, string> = {
    CONFIRMED: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    BOARDED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    ABSENT:    'bg-amber-500/20 text-amber-300 border-amber-500/30',
    NO_SHOW:   'bg-rose-500/20 text-rose-300 border-rose-500/30',
  };
  const isBoarded = status === 'BOARDED';
  const isCancellable = !isBoarded && status !== 'CANCELLED';
  const isFuture = new Date(t.departureTime).getTime() > Date.now();

  return (
    <div className={`rounded-2xl border border-white/10 p-4 ${muted ? 'bg-slate-900/30 opacity-60' : 'bg-slate-900/60'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-slate-400">{t.tripNumber ?? 'Trip'} · {t.shiftType ?? ''}</p>
          <h3 className="text-base font-bold text-white truncate">{t.route.name ?? `${t.route.origin} → ${t.route.destination}`}</h3>
          <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            {timeOf(t.departureTime)}{t.arrivalTime ? ` – ${timeOf(t.arrivalTime)}` : ''} · <span className="text-cyan-300">{relativeOf(t.departureTime)}</span>
          </p>
        </div>
        <span className={`text-[10px] px-2 py-1 rounded-full border ${STATUS_BG[status] ?? 'bg-slate-700 text-slate-200 border-slate-600'}`}>
          {status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
        <div className="rounded-lg bg-slate-950/60 border border-white/5 px-2.5 py-1.5 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-[9px] uppercase tracking-wider">Boarding Stop</p>
            <p className="text-slate-200 truncate max-w-[140px]">{trip.boardingStop ?? 'Default'}</p>
          </div>
          {onOpenStopChange && isFuture && !isBoarded && (
            <button
              onClick={onOpenStopChange}
              title="Change pickup stop for this trip"
              className="text-cyan-400 hover:text-cyan-300 p-1"
            >
              <MapPin className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="rounded-lg bg-slate-950/60 border border-white/5 px-2.5 py-1.5">
          <p className="text-slate-500 text-[9px] uppercase tracking-wider">Alighting</p>
          <p className="text-slate-200 truncate">{trip.alightingStop ?? '—'}</p>
        </div>
      </div>

      {isCancellable && isFuture && (
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => onAction(trip.passengerId, 'late', t)}
            disabled={actionInFlight === `late-${trip.passengerId}`}
            className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] font-semibold active:scale-95 transition-transform disabled:opacity-50">
            <Hourglass className="w-4 h-4" />
            Running late
          </button>
          <button onClick={() => onAction(trip.passengerId, 'board', t)}
            disabled={actionInFlight === `board-${trip.passengerId}`}
            className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-[11px] font-semibold active:scale-95 transition-transform disabled:opacity-50">
            <Play className="w-4 h-4" />
            I boarded
          </button>
          <button onClick={() => onAction(trip.passengerId, 'skip', t)}
            disabled={actionInFlight === `skip-${trip.passengerId}`}
            className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-[11px] font-semibold active:scale-95 transition-transform disabled:opacity-50">
            <SkipForward className="w-4 h-4" />
            Skip
          </button>
        </div>
      )}

      {isBoarded && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-emerald-200 text-[11px] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Boarded at {timeOf(trip.boardedAt)}.
        </div>
      )}
    </div>
  );
}

// ── Tab: Trips ────────────────────────────────────────────────────────────

function TripsTab({ today, onOpenStopChange }: { today: Today | null; onOpenStopChange: (id?: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">Trips & Schedule</h2>
        <button
          onClick={() => onOpenStopChange()}
          className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
        >
          <MapPin className="w-3.5 h-3.5" /> Update Pickup Stop
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Today&apos;s assigned roster.</p>
      {today ? (
        <div className="space-y-2">
          {today.trips.map((t) => (
            <div key={t.passengerId} className="rounded-xl bg-slate-900/40 border border-white/10 px-3 py-2.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-white font-semibold">{t.trip.route.name ?? `${t.trip.route.origin} → ${t.trip.route.destination}`}</span>
                <span className="text-slate-400 font-mono">{timeOf(t.trip.departureTime)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-500 mt-1">
                <span>{relativeOf(t.trip.departureTime)} · {t.trip.shiftType ?? '—'}</span>
                <span className="text-cyan-400">Stop: {t.boardingStop || 'Default'}</span>
              </div>
            </div>
          ))}
        </div>
      ) : <Splash label="Loading trips…" />}
    </div>
  );
}

// ── Tab: Board ────────────────────────────────────────────────────────────

function BoardTab({ today, onAction, actionInFlight }: {
  today: Today | null;
  onAction: (id: string, action: 'late' | 'skip' | 'board', trip: PassengerTrip['trip']) => void;
  actionInFlight: string | null;
}) {
  if (!today) return <Splash label="Loading…" />;
  const next = today.trips.find((t) => (t.status ?? '').toUpperCase() === 'CONFIRMED' && new Date(t.trip.departureTime).getTime() > Date.now() - 30 * 60_000);

  if (!next) {
    return (
      <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-6 text-center">
        <Navigation className="w-10 h-10 text-slate-500 mx-auto mb-2" />
        <p className="text-sm text-slate-300">No upcoming trip to board.</p>
      </div>
    );
  }

  const mins = Math.round((new Date(next.trip.departureTime).getTime() - Date.now()) / 60000);
  const boarding = next.boardingStop ?? 'your default stop';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-lg shadow-emerald-500/30">
        <p className="text-xs uppercase tracking-wider opacity-80">Next trip</p>
        <h2 className="text-xl font-bold mt-1">{next.trip.route.name ?? `${next.trip.route.origin} → ${next.trip.route.destination}`}</h2>
        <p className="text-sm opacity-90 mt-2 flex items-center gap-1.5">
          <Clock className="w-4 h-4" /> {timeOf(next.trip.departureTime)} · in {mins} min
        </p>
        <p className="text-sm opacity-90 mt-1 flex items-center gap-1.5">
          <MapPin className="w-4 h-4" /> Board at {boarding}
        </p>
        <button onClick={() => onAction(next.passengerId, 'board', next.trip)}
          disabled={actionInFlight === `board-${next.passengerId}`}
          className="w-full mt-4 py-3 rounded-xl bg-white text-emerald-700 font-bold text-base active:scale-95 transition-transform disabled:opacity-50 shadow-md">
          {actionInFlight === `board-${next.passengerId}` ? 'Boarding…' : 'I boarded this trip'}
        </button>
      </div>
    </div>
  );
}

// ── Tab: Profile ────────────────────────────────────────────────────────

function ProfileTab({
  today,
  notificationPermission,
  onAskPerm,
  onOpenStopChange,
}: {
  today: Today | null;
  notificationPermission: NotificationPermission;
  onAskPerm: () => void;
  onOpenStopChange: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-2xl font-bold">
            {today?.staff?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <h3 className="text-base font-bold text-white">{today?.staff?.name ?? '—'}</h3>
            <p className="text-[11px] text-slate-400">ID: {today?.staff?.employeeId ?? '—'}</p>
            <p className="text-[11px] text-slate-400">{today?.staff?.department ?? '—'}</p>
          </div>
        </div>

        {/* Pickup Stop Management */}
        <div className="rounded-xl bg-slate-950/80 border border-white/10 p-3 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-[10px] uppercase tracking-wider">Default Pickup Stop</p>
            <p className="text-slate-100 font-semibold text-xs mt-0.5">
              {today?.staff?.defaultStopName || 'Not Set'}
            </p>
          </div>
          <button
            onClick={onOpenStopChange}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center gap-1 transition"
          >
            <MapPin className="w-3.5 h-3.5" /> Change
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-5">
        <h3 className="text-sm font-bold text-white mb-3">Notifications</h3>
        {notificationPermission === 'granted' ? (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center gap-2 text-emerald-200 text-[11px]">
            <CheckCircle2 className="w-4 h-4" /> Trip reminders enabled — you&apos;ll be notified 10 min before each trip.
          </div>
        ) : notificationPermission === 'denied' ? (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 flex items-center gap-2 text-rose-200 text-[11px]">
            <AlertTriangle className="w-4 h-4" /> Notifications blocked. Enable them in your browser settings.
          </div>
        ) : (
          <button onClick={onAskPerm} className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-sm">
            Enable trip reminders
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-5">
        <h3 className="text-sm font-bold text-white mb-3">App info</h3>
        <div className="space-y-2 text-[11px] text-slate-300">
          <Row label="Version" value="Fleet360 Passenger v2.0" />
          <Row label="Features" value="Live Boarding · Stop Change · Ad-Hoc" />
          <Row label="Build" value="PWA & Mobile Native" />
        </div>
      </div>
    </div>
  );
}

// ── Modal: Pickup Location & Stop Change ──────────────────────────────────

function PickupStopChangeModal({
  staff,
  tripPassengerId,
  onClose,
  onSuccess,
}: {
  staff: Today['staff'] | null;
  tripPassengerId: string | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [address, setAddress] = useState(staff?.defaultStopName || '');
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);
  const [markPermanent, setMarkPermanent] = useState(true);
  const [reason, setReason] = useState('Home relocation / Preferred stop update');
  const [detectingGps, setDetectingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleGpsDetect = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    setDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setAddress(`GPS (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`);
        setDetectingGps(false);
      },
      (err) => {
        alert('Could not detect GPS location: ' + err.message);
        setDetectingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/bus-ops/passenger/change-pickup-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffMemberId: staff?.id,
          employeeId: staff?.employeeId,
          newLocationAddress: address.trim(),
          latitude: lat,
          longitude: lng,
          markAsPermanentNewStop: markPermanent,
          tripPassengerId: tripPassengerId || undefined,
          reason,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update pickup stop');
      }

      const json = await res.json();
      onSuccess(json.message || 'Pickup stop updated successfully');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error updating pickup stop');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-300">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Change Pickup Location</h3>
              <p className="text-[11px] text-slate-400">Request stop update or mark as new stop</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">New Pickup Location Address *</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Dubai Marina Mall / Building 4"
                required
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleGpsDetect}
                disabled={detectingGps}
                title="Use Current GPS Location"
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition"
              >
                <LocateFixed className={`w-4 h-4 ${detectingGps ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Mark as Permanent New Stop Point Toggle */}
          <div
            onClick={() => setMarkPermanent(!markPermanent)}
            className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-2.5 cursor-pointer hover:border-cyan-500/50 transition"
          >
            <div className="mt-0.5 text-cyan-400">
              {markPermanent ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
            </div>
            <div>
              <div className="font-semibold text-white text-xs">
                Mark this location as my permanent new Stop Point
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Automatically sets this as your default stop for all upcoming shifts.
              </div>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Reason for Change</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="Home relocation / Preferred stop update">Home relocation / Preferred stop update</option>
              <option value="Temporary project / site deployment">Temporary project / site deployment</option>
              <option value="Traffic avoidance / Walking distance">Traffic avoidance / Walking distance</option>
              <option value="Emergency shift coverage">Emergency shift coverage</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-2 text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Update Stop'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal: Ad-Hoc / Overtime Ride Request ──────────────────────────────────

function AdhocRideModal({
  staff,
  onClose,
  onSuccess,
}: {
  staff: Today['staff'] | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [pickupLoc, setPickupLoc] = useState(staff?.defaultStopName || '');
  const [dropLoc, setDropLoc] = useState('Factory HQ / Main Depot');
  const [tripDateTime, setTripDateTime] = useState('');
  const [reason, setReason] = useState('Production Overtime');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff?.id || !tripDateTime || !pickupLoc || !dropLoc) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/bus-ops/adhoc-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffMemberId: staff.id,
          tripDate: new Date(tripDateTime).toISOString(),
          pickupLocation: pickupLoc,
          dropLocation: dropLoc,
          reason,
          notes,
          department: staff.department || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to submit ad-hoc transport request');
      }

      onSuccess('Ad-Hoc transport request submitted. Evaluating optimal dispatch match.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting ad-hoc request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Ad-Hoc / Overtime Ride</h3>
              <p className="text-[11px] text-slate-400">On-demand transport & route fit</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Required Date & Time *</label>
            <input
              type="datetime-local"
              value={tripDateTime}
              onChange={(e) => setTripDateTime(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Pickup Location *</label>
            <input
              type="text"
              placeholder="e.g. Al Quoz Gate 4"
              value={pickupLoc}
              onChange={(e) => setPickupLoc(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Destination / Drop Location *</label>
            <input
              type="text"
              placeholder="e.g. DIP Staff Accommodation"
              value={dropLoc}
              onChange={(e) => setDropLoc(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            >
              <option value="Production Overtime">Production Overtime</option>
              <option value="Emergency Maintenance">Emergency Maintenance</option>
              <option value="Shift Extension">Shift Extension</option>
              <option value="Urgent Project Delivery">Urgent Project Delivery</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Special Notes</label>
            <input
              type="text"
              placeholder="e.g. Traveling with 2 heavy toolboxes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-2 text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow transition disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {submitting ? 'Submitting...' : 'Request Ride'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 pb-1.5 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <div className="rounded-2xl bg-slate-900/40 border border-white/10 p-6 text-center text-sm text-slate-400">
      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-cyan-400" />
      {label}
    </div>
  );
}
