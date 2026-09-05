/**
 * src/app/(driver)/driver-app/menu/page.tsx
 *
 * The driver's central hub. Lands here after login + shift checklist.
 * Every action in the driver app goes through this screen.
 *
 * Card grid:
 *   - Driver Checklist (shift-level)
 *   - Today's Trips
 *   - Fuel Entry
 *   - Expenses
 *   - Navigate
 *   - My score
 *
 * "Sign out" at the bottom closes the active shift, clears the
 * session cookies, and navigates back to the launcher. Without the
 * session-clearing step, the launcher would see the cookie still
 * present and immediately redirect back to /menu — an infinite
 * loop. The user reported this; the fix is to call /api/auth/logout
 * which expires both xl-session and xl-driver-session.
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface ShiftInfo {
  id: string;
  startedAt: string;
  hasChecklist: boolean;
}

interface MenuCard {
  href: string;
  emoji: string;
  title: string;
  subtitle: string;
  accent: 'violet' | 'amber' | 'emerald' | 'sky' | 'slate' | 'rose';
  badge?: string;
}

interface RecentFuel {
  id: string;
  liters: number;
  costMinor: number;
  currency: string;
  locationName: string | null;
  filledAt: string;
}
interface RecentExpense {
  id: string;
  category: string;
  amountMinor: number;
  currency: string;
  description: string | null;
  tripId: string | null;
  incurredAt: string;
}
interface RecentEntries {
  shiftId: string;
  fuel: RecentFuel[];
  expenses: RecentExpense[];
  totals: { fuelMinor: number; expenseMinor: number };
  counts: { fuel: number; expense: number };
}

const ACCENT_CLASSES: Record<MenuCard['accent'], string> = {
  violet:  'border-violet-500/30  bg-violet-600/15  hover:bg-violet-600/25',
  amber:   'border-amber-500/30   bg-amber-600/15   hover:bg-amber-600/25',
  emerald: 'border-emerald-500/30 bg-emerald-600/15 hover:bg-emerald-600/25',
  sky:     'border-sky-500/30     bg-sky-600/15     hover:bg-sky-600/25',
  slate:   'border-white/10       bg-slate-800      hover:bg-slate-700',
  rose:    'border-rose-500/30    bg-rose-600/15    hover:bg-rose-600/25',
};

const ACCENT_TEXT: Record<MenuCard['accent'], string> = {
  violet:  'text-violet-300',
  amber:   'text-amber-300',
  emerald: 'text-emerald-300',
  sky:     'text-sky-300',
  slate:   'text-slate-300',
  rose:    'text-rose-300',
};

export default function MenuPage() {
  const router = useRouter();
  const [shift, setShift] = useState<ShiftInfo | null | undefined>(undefined);
  const [signingOut, setSigningOut] = useState(false);
  const [endingShift, setEndingShift] = useState(false);
  const [recent, setRecent] = useState<RecentEntries | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/driver-app/shift/current', { credentials: 'include' });
        if (!r.ok) {
          if (!cancelled) setShift(null);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        if (data.shift) {
          setShift({
            id: data.shift.id,
            startedAt: data.shift.startedAt,
            hasChecklist: data.shift.checklist != null,
          });
        } else {
          setShift(null);
        }
      } catch {
        if (!cancelled) setShift(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch recent fuel + expense entries for the active shift.
  // Closes the loop on the "During the shift" cards so the driver
  // can verify a fill-up was logged without leaving the menu.
  useEffect(() => {
    if (!shift?.id) {
      setRecent(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/driver-app/shift/${shift.id}/recent-entries?limit=3`, {
          credentials: 'include',
        });
        if (!r.ok) {
          if (!cancelled) setRecent(null);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        setRecent(data);
      } catch {
        if (!cancelled) setRecent(null);
      }
    })();
    return () => { cancelled = true; };
  }, [shift?.id]);

  // End the current shift (but keep the session cookie). The driver
  // lands on /shift-ended which offers "start a new shift" or "sign out".
  const endShift = useCallback(async () => {
    if (endingShift || signingOut) return;
    if (!shift?.id) {
      // No active shift — just route to the shift-ended page.
      router.push('/driver-app/shift-ended');
      return;
    }
    if (!window.confirm(
      'End this shift? Any fuel or expense entries saved after this point will attach to your next shift.',
    )) {
      return;
    }
    setEndingShift(true);
    try {
      const r = await fetch(`/api/driver-app/shift/${shift.id}/end`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`end failed: ${r.status}`);
      router.push('/driver-app/shift-ended');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'end failed');
      setEndingShift(false);
    }
  }, [shift, endingShift, signingOut, router]);

  // Sign out: close the shift AND clear the session cookies. The
  // user goes back to the launcher with a clean state.
  const signOut = useCallback(async () => {
    if (signingOut || endingShift) return;
    if (!window.confirm('Sign out? Your active shift will be closed.')) return;
    setSigningOut(true);
    try {
      // 1. Close the active shift (best-effort).
      if (shift?.id) {
        try {
          await fetch(`/api/driver-app/shift/${shift.id}/end`, {
            method: 'POST',
            credentials: 'include',
          });
        } catch { /* ignore */ }
      }
      // 2. Clear the session cookies.
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch { /* ignore */ }
      // 3. Hard-reload the launcher for a clean state.
      window.location.replace('/driver-app');
    } catch {
      setSigningOut(false);
    }
  }, [shift, signingOut, endingShift]);

  // Primary actions (top row) — high frequency during a shift
  const primaryCards: MenuCard[] = [
    {
      href: '/driver-app/shift-checklist',
      emoji: '🛡️',
      title: 'Driver Checklist',
      subtitle: shift?.hasChecklist
        ? 'Update your shift checklist'
        : 'Complete your shift checklist',
      accent: 'violet',
      badge: shift?.hasChecklist ? 'Done' : 'Required',
    },
    {
      href: '/driver-app/today',
      emoji: '📅',
      title: "Today's Trips",
      subtitle: 'View assigned trips and DVIR history',
      accent: 'sky',
    },
  ];

  // Secondary actions (middle row) — shift-level data capture
  const secondaryCards: MenuCard[] = [
    {
      href: '/driver-app/fuel-entry',
      emoji: '⛽',
      title: 'Fuel Entry',
      subtitle: 'Log a fill-up with bill photo and location',
      accent: 'amber',
    },
    {
      href: '/driver-app/expenses',
      emoji: '🧾',
      title: 'Expenses',
      subtitle: 'Tolls, parking, meals, fines per trip',
      accent: 'emerald',
    },
    {
      href: '/driver-app/report',
      emoji: '🛠️',
      title: 'Report Issue',
      subtitle: 'Maintenance, renewal, washing, accident, breakdown, complaint',
      accent: 'rose',
    },
  ];

  // Tertiary actions (bottom row) — history & tools
  const tertiaryCards: MenuCard[] = [
    {
      href: '/driver-app/shift-history',
      emoji: '📜',
      title: 'Shift History',
      subtitle: 'Past shifts with checklist + fuel + expenses',
      accent: 'slate',
    },
    {
      href: '/driver-app/trip-history',
      emoji: '🛣️',
      title: 'Trip History',
      subtitle: 'Completed trips with DVIR + costs',
      accent: 'slate',
    },
    {
      href: '/driver-app/reports',
      emoji: '📋',
      title: 'My Reports',
      subtitle: 'Requests you filed + incidents you logged',
      accent: 'slate',
    },
  ];

  const renderCard = (c: MenuCard) => (
    <button
      key={c.href}
      type="button"
      onClick={() => router.push(c.href)}
      className={`group relative flex flex-col items-start gap-2 rounded-2xl border px-4 py-4 text-left transition ${ACCENT_CLASSES[c.accent]}`}
    >
      {c.badge && (
        <span className={`absolute right-3 top-3 rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ACCENT_TEXT[c.accent]}`}>
          {c.badge}
        </span>
      )}
      <div className="text-3xl">{c.emoji}</div>
      <div>
        <div className="text-base font-semibold text-white">{c.title}</div>
        <div className="text-xs text-slate-300">{c.subtitle}</div>
      </div>
    </button>
  );

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Driver App</div>
            <div className="text-xl font-bold text-white">Menu</div>
          </div>
          {shift && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Shift started</div>
              <div className="text-xs font-medium text-emerald-300">
                {new Date(shift.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="space-y-3 px-4 py-4">
        {shift === null && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            No active shift. <button
              type="button"
              onClick={() => router.push('/driver-app/shift-checklist')}
              className="underline"
            >
              Start a new shift
            </button>
          </div>
        )}

        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            At shift start
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {primaryCards.map(renderCard)}
          </div>
        </section>

        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            During the shift
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {secondaryCards.map(renderCard)}
          </div>
        </section>

        {/* Recent entries (this shift) — closes the loop on the
            Fuel/Expense cards above so the driver sees their last
            few submissions without leaving the menu. Hidden when
            there's no active shift (the cards above already guide
            them to the start-shift flow). */}
        {shift && recent && (recent.counts.fuel > 0 || recent.counts.expense > 0) && (
          <RecentEntriesCard recent={recent} onJump={router.push} />
        )}

        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            History &amp; tools
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {tertiaryCards.map(renderCard)}
          </div>
        </section>

        <section className="space-y-2 pt-2">
          <button
            type="button"
            onClick={endShift}
            disabled={endingShift || signingOut}
            className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/5 disabled:opacity-50"
          >
            {endingShift ? 'Ending shift…' : 'End shift'}
          </button>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut || endingShift}
            className="w-full rounded-xl border border-rose-500/30 px-4 py-3 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </section>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// RecentEntriesCard — shows the most recent N fuel + expense entries for
// the active shift, plus shift-level totals. Closes the loop on the
// "Fuel Entry" / "Expenses" cards so the driver can confirm a
// submission landed without leaving the menu.
// ────────────────────────────────────────────────────────────────────────

function formatMinor(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  // Compact for big numbers: 12,345.00 → 12.3k
  if (minor >= 100_000) {
    return `${currency} ${(minor / 100_000).toFixed(1)}k`;
  }
  return `${currency} ${major}`;
}

const EXPENSE_EMOJI: Record<string, string> = {
  TOLLS:   '🛣️',
  PARKING: '🅿️',
  MEALS:   '🍽️',
  FINES:   '🚓',
  OTHER:   '🧾',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function RecentEntriesCard({
  recent,
  onJump,
}: {
  recent: RecentEntries;
  onJump: (href: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Recent entries (this shift)
        </div>
        <div className="text-[10px] text-slate-500">
          {recent.counts.fuel} fuel · {recent.counts.expense} expense
        </div>
      </div>
      <div className="space-y-2">
        {recent.fuel.length > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-300">
                <span>⛽</span>
                <span className="text-xs font-semibold uppercase tracking-wider">Fuel</span>
              </div>
              <div className="text-xs font-semibold text-amber-200">
                {formatMinor(recent.totals.fuelMinor, recent.fuel[0].currency)}
              </div>
            </div>
            <div className="space-y-1.5">
              {recent.fuel.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onJump('/driver-app/fuel-entry')}
                  className="flex w-full items-center justify-between rounded-lg bg-black/20 px-2.5 py-1.5 text-left transition hover:bg-black/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">
                      {Number(f.liters ?? 0).toFixed(1)}L · {f.locationName ?? 'Unknown station'}
                    </div>
                    <div className="text-[10px] text-slate-400">{timeAgo(f.filledAt)}</div>
                  </div>
                  <div className="ml-2 text-sm font-medium text-amber-100">
                    {formatMinor(f.costMinor, f.currency)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {recent.expenses.length > 0 && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-300">
                <span>🧾</span>
                <span className="text-xs font-semibold uppercase tracking-wider">Expenses</span>
              </div>
              <div className="text-xs font-semibold text-emerald-200">
                {formatMinor(recent.totals.expenseMinor, recent.expenses[0].currency)}
              </div>
            </div>
            <div className="space-y-1.5">
              {recent.expenses.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onJump('/driver-app/expenses')}
                  className="flex w-full items-center justify-between rounded-lg bg-black/20 px-2.5 py-1.5 text-left transition hover:bg-black/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">
                      {EXPENSE_EMOJI[e.category] ?? '🧾'} {e.description ?? e.category}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {e.category} · {timeAgo(e.incurredAt)}
                      {e.tripId ? ' · trip' : ' · no trip'}
                    </div>
                  </div>
                  <div className="ml-2 text-sm font-medium text-emerald-100">
                    {formatMinor(e.amountMinor, e.currency)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
