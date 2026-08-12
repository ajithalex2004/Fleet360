'use client';
/**
 * /bus-ops/passenger/app — Mobile-first PWA shell for the Staff Rider.
 *
 * The "mobile app" lives here as a single-page experience with bottom
 * navigation. It uses the same data endpoints as the desktop passenger
 * page, but the layout is touch-first:
 *   - Large hit targets (≥ 44 px)
 *   - Bottom tab bar (Today · Trips · Board · Profile)
 *   - Trip cards with quick actions
 *   - PWA install banner when the browser fires `beforeinstallprompt`
 *   - Browser Notification API for trip reminders (when permission granted)
 *
 * PWA bits:
 *   - manifest.json at /manifest.json
 *   - service worker at /sw.js (registered once on mount)
 *   - this page is the start_url, so the OS opens here when launched
 *     from the home screen
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Bus, Bell, MapPin, CheckCircle2, AlertTriangle, Clock,
  User, ListChecks, Wifi, WifiOff, X, RefreshCw, ChevronRight,
  Play, SkipForward, Hourglass, Navigation,
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

  // Data: today's trips + week-ahead
  const todayRes = useFetchedData<Today>('/api/bus-ops/passenger/today');
  const today = todayRes.data;

  // PWA: subscribe to push once permission is granted + we know the staff employeeId.
  // The PWA does NOT have its own login — the admin tenant supplies the
  // employeeId via URL search params (?employeeId=EMP-001) or via the
  // /api/bus-ops/passenger/today response. We store it in sessionStorage.
  const [pushSubscribed, setPushSubscribed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (notificationPermission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    const employeeId =
      sessionStorage.getItem('fleet360.employeeId') ||
      new URL(window.location.href).searchParams.get('employeeId') ||
      today?.staff?.employeeId;
    if (!employeeId) return;
    sessionStorage.setItem('fleet360.employeeId', employeeId);

    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const keyRes = await fetch('/api/push/public-key');
          if (!keyRes.ok) return;
          const { publicKey } = await keyRes.json();
          if (!publicKey) return;
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }
        const j = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
        if (!j.keys?.p256dh || !j.keys?.auth) return;
        const r = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
            userAgent: navigator.userAgent,
            employeeId,
          }),
        });
        if (r.ok) setPushSubscribed(true);
      } catch (e) {
        console.warn('Push subscribe failed', e);
      }
    })();
  }, [notificationPermission, today?.staff?.employeeId]);

  // Notification reminders — fire a browser notification 10 min before
  // each of today's SCHEDULED trips.
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
        ? `/api/bus-ops/passenger/board` // existing endpoint
        : action === 'skip'
        ? `/api/bus-ops/passenger/${passengerId}/skip` // new
        : `/api/bus-ops/passenger/${passengerId}/running-late`; // new
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
        {tab === 'today'   && <TodayTab today={today ?? null} onAction={tripAction} actionInFlight={actionInFlight} />}
        {tab === 'trips'   && <TripsTab today={today ?? null} />}
        {tab === 'board'   && <BoardTab today={today ?? null} onAction={tripAction} actionInFlight={actionInFlight} />}
        {tab === 'profile' && <ProfileTab today={today ?? null} notificationPermission={notificationPermission} onAskPerm={askNotificationPermission} />}
      </main>

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

function TodayTab({ today, onAction, actionInFlight }: {
  today: Today | null;
  onAction: (id: string, action: 'late' | 'skip' | 'board', trip: PassengerTrip['trip']) => void;
  actionInFlight: string | null;
}) {
  if (!today) return <Splash label="Loading today's trips…" />;
  const now = new Date();
  const upcoming = today.trips.filter((t) => new Date(t.trip.departureTime).getTime() > now.getTime() - 30 * 60_000);
  const past    = today.trips.filter((t) => new Date(t.trip.departureTime).getTime() <= now.getTime() - 30 * 60_000);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-700 p-5 text-white shadow-lg shadow-cyan-500/30">
        <p className="text-xs uppercase tracking-wider opacity-80">Today</p>
        <h2 className="text-2xl font-bold mt-1">
          {upcoming.length > 0 ? `${upcoming.length} upcoming trip${upcoming.length === 1 ? '' : 's'}` : 'No more trips today'}
        </h2>
        {today.staff.defaultStopName && (
          <p className="text-sm opacity-90 mt-1 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" /> Default stop: {today.staff.defaultStopName}
          </p>
        )}
      </div>

      {upcoming.length === 0 ? (
        <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-slate-200">All trips done for today.</p>
        </div>
      ) : (
        upcoming.map((t) => <TripCard key={t.passengerId} trip={t} onAction={onAction} actionInFlight={actionInFlight} />)
      )}

      {past.length > 0 && (
        <details className="rounded-2xl bg-slate-900/40 border border-white/10 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-400">Past trips ({past.length})</summary>
          <div className="p-3 space-y-2">
            {past.map((t) => <TripCard key={t.passengerId} trip={t} onAction={onAction} actionInFlight={actionInFlight} muted />)}
          </div>
        </details>
      )}
    </div>
  );
}

function TripCard({ trip, onAction, actionInFlight, muted }: {
  trip: PassengerTrip; onAction: (id: string, action: 'late' | 'skip' | 'board', trip: PassengerTrip['trip']) => void;
  actionInFlight: string | null; muted?: boolean;
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
        <div className="rounded-lg bg-slate-950/60 border border-white/5 px-2.5 py-1.5">
          <p className="text-slate-500 text-[9px] uppercase tracking-wider">Boarding</p>
          <p className="text-slate-200">{trip.boardingStop ?? '—'}</p>
        </div>
        <div className="rounded-lg bg-slate-950/60 border border-white/5 px-2.5 py-1.5">
          <p className="text-slate-500 text-[9px] uppercase tracking-wider">Alighting</p>
          <p className="text-slate-200">{trip.alightingStop ?? '—'}</p>
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

// ── Tab: Trips (week ahead placeholder) ──────────────────────────────────

function TripsTab({ today }: { today: Today | null }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-white">Trips</h2>
      <p className="text-[11px] text-slate-400">Today&apos;s roster. Multi-day view is on the roadmap.</p>
      {today ? (
        <div className="space-y-2">
          {today.trips.map((t) => (
            <div key={t.passengerId} className="rounded-xl bg-slate-900/40 border border-white/10 px-3 py-2.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-white font-semibold">{t.trip.route.name ?? `${t.trip.route.origin} → ${t.trip.route.destination}`}</span>
                <span className="text-slate-400 font-mono">{timeOf(t.trip.departureTime)}</span>
              </div>
              <p className="text-slate-500 mt-0.5">{relativeOf(t.trip.departureTime)} · {t.trip.shiftType ?? '—'}</p>
            </div>
          ))}
        </div>
      ) : <Splash label="Loading trips…" />}
    </div>
  );
}

// ── Tab: Board (live + self-board) ────────────────────────────────────────

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

function ProfileTab({ today, notificationPermission, onAskPerm }: {
  today: Today | null; notificationPermission: NotificationPermission;
  onAskPerm: () => void;
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
        <div className="rounded-lg bg-slate-950/60 border border-white/5 px-3 py-2 text-[11px]">
          <p className="text-slate-500 text-[10px] uppercase tracking-wider">Default stop</p>
          <p className="text-slate-200">{today?.staff?.defaultStopName ?? '—'}</p>
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
          <Row label="Version" value="Fleet360 Passenger v1.0" />
          <Row label="Build" value="PWA · standalone" />
          <Row label="Support" value="support@fleet360.example" />
        </div>
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

// Convert a base64url VAPID public key to a Uint8Array for
// PushManager.subscribe({ applicationServerKey: ... }).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}
