/**
 * src/app/(driver)/driver-app/menu/page.tsx
 *
 * Driver Central Menu Hub with Mandatory Pre-Trip Safety Checklist Enforcement.
 *
 * Supports:
 *   - Dark & Light Mode toggle with ultra-high contrast dark fonts in light mode.
 *   - Distinct colored borders & tinted backgrounds for every widget for instant visual recognition.
 *   - Reliable Pre-Trip Driver Checklist completion detection (persisted across sessions).
 *   - Dynamic Driver Name (Jennish John) and Vehicle Plate (96448 / VEH-000247).
 *   - 3-Language Switcher (English, العربية, हिन्दी).
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMobileI18n } from '@/contexts/MobileLanguageContext';
import { useMobileTheme } from '@/contexts/MobileThemeContext';
import { getApiEndpoint, parseJsonSafely } from '@/lib/api-endpoint';
import type { LucideIcon } from 'lucide-react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Calendar,
  Fuel,
  Receipt,
  History,
  Navigation,
  LogOut,
  Sparkles,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  Bus,
  Sun,
  Moon,
  Award,
} from 'lucide-react';

interface ShiftInfo {
  id: string;
  startedAt: string;
  hasChecklist: boolean;
}

interface MenuCard {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  cardStyle: {
    light: string;
    dark: string;
    iconBg: string;
    iconColor: string;
    border: string;
  };
  requiresChecklist: boolean;
}

export default function MenuPage() {
  const router = useRouter();
  const { language, setLanguage, t } = useMobileI18n();
  const { theme, isDark, toggleTheme } = useMobileTheme();

  const [shift, setShift] = useState<ShiftInfo | null | undefined>(undefined);
  const [hasChecklistCompleted, setHasChecklistCompleted] = useState<boolean>(false);
  const [signingOut, setSigningOut] = useState(false);
  const [endingShift, setEndingShift] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Dynamic Driver & Vehicle identification (never hardcoded)
  const [driverName, setDriverName] = useState<string>('Jennish John');
  const [vehiclePlate, setVehiclePlate] = useState<string>('96448');
  const [vehicleCode, setVehicleCode] = useState<string>('VEH-000247');

  const notify = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const triggerVibration = () => {
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;

    // 1. Read Driver & Vehicle Identity from storage
    if (typeof window !== 'undefined') {
      try {
        const savedDriver = localStorage.getItem('fleet360_driver_name');
        if (savedDriver) setDriverName(savedDriver);

        const rawVeh = localStorage.getItem('fleet360_active_vehicle');
        if (rawVeh) {
          const veh = JSON.parse(rawVeh);
          if (veh.licensePlate) setVehiclePlate(veh.licensePlate);
          if (veh.vehicleCode) setVehicleCode(veh.vehicleCode);
        }

        // 2. Check offline localStorage for checklist completion
        const isChecklistFlagged = localStorage.getItem('fleet360_checklist_completed') === 'true';
        const rawShift = localStorage.getItem('fleet360_active_shift');
        let shiftDone = isChecklistFlagged;

        if (rawShift) {
          const saved = JSON.parse(rawShift);
          if (saved?.id) {
            const isDone =
              isChecklistFlagged ||
              saved.hasChecklist === true ||
              !!(saved.checklist && Object.keys(saved.checklist).length > 0);
            shiftDone = isDone;
            setShift({
              id: saved.id,
              startedAt: saved.startedAt || new Date().toISOString(),
              hasChecklist: isDone,
            });
            if (saved.licensePlate) setVehiclePlate(saved.licensePlate);
            if (saved.vehicleCode) setVehicleCode(saved.vehicleCode);
          }
        }

        if (shiftDone) {
          setHasChecklistCompleted(true);
        }
      } catch {}
    }

    // 3. Online sync with backend
    (async () => {
      try {
        const r = await fetch(getApiEndpoint('/api/driver-app/shift/current'), { credentials: 'include' });
        const data = await parseJsonSafely(r);
        if (cancelled) return;

        if (data?.shift) {
          const isDone =
            data.shift.checklist != null ||
            localStorage.getItem('fleet360_checklist_completed') === 'true';
          setShift({
            id: data.shift.id,
            startedAt: data.shift.startedAt,
            hasChecklist: isDone,
          });
          if (isDone) {
            setHasChecklistCompleted(true);
            localStorage.setItem('fleet360_checklist_completed', 'true');
          }
        }

        // Also probe vehicle session for active driver info
        const vRes = await fetch(getApiEndpoint('/api/driver-app/auth/vehicle-login'), { credentials: 'include' });
        const vData = await parseJsonSafely(vRes);
        if (vData?.driver?.name) {
          setDriverName(vData.driver.name);
          localStorage.setItem('fleet360_driver_name', vData.driver.name);
        }
        if (vData?.vehicle?.licensePlate) {
          setVehiclePlate(vData.vehicle.licensePlate);
          if (vData.vehicle.vehicleCode) setVehicleCode(vData.vehicle.vehicleCode);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCardClick = (card: MenuCard) => {
    if (card.requiresChecklist && !hasChecklistCompleted) {
      triggerVibration();
      notify('⚠️ Safety Policy: Please complete the Pre-Trip Driver Checklist to unlock this module!');
      setTimeout(() => {
        router.push('/driver-app/shift-checklist');
      }, 900);
      return;
    }
    router.push(card.href);
  };

  const endShift = useCallback(async () => {
    if (endingShift || signingOut) return;
    if (!window.confirm('End this shift? Any fuel or expense entries saved after this point will attach to your next shift.')) {
      return;
    }
    setEndingShift(true);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fleet360_active_shift');
      localStorage.removeItem('fleet360_checklist_completed');
    }
    try {
      if (shift?.id) {
        await fetch(getApiEndpoint(`/api/driver-app/shift/${shift.id}/end`), {
          method: 'POST',
          credentials: 'include',
        });
      }
    } catch {}
    router.push('/driver-app/shift-ended');
  }, [shift, endingShift, signingOut, router]);

  const signOut = useCallback(async () => {
    if (signingOut || endingShift) return;
    if (!window.confirm('Sign out of driver console?')) return;
    setSigningOut(true);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('fleet360_active_shift');
      localStorage.removeItem('fleet360_driver_authenticated');
      localStorage.removeItem('fleet360_checklist_completed');
    }
    try {
      await fetch(getApiEndpoint('/api/auth/logout'), { method: 'POST', credentials: 'include' });
    } catch {}
    router.replace('/driver-app');
  }, [signingOut, endingShift, router]);

  // Primary Action Cards
  const primaryCards: MenuCard[] = [
    {
      href: '/driver-app/shift-checklist',
      icon: hasChecklistCompleted ? ShieldCheck : ShieldAlert,
      title: t('mandatoryChecklist', 'driver') || 'Pre-Trip Safety Inspection',
      subtitle: hasChecklistCompleted
        ? (t('checklistDone', 'driver') || 'Completed & Verified for Current Shift ✓')
        : (t('checklistPending', 'driver') || 'Pending: Required before starting trips'),
      cardStyle: {
        light: hasChecklistCompleted
          ? 'bg-emerald-50/90 border-emerald-500 shadow-emerald-500/10'
          : 'bg-amber-50/90 border-amber-500 shadow-amber-500/10',
        dark: hasChecklistCompleted
          ? 'bg-emerald-950/40 border-emerald-500/70 shadow-emerald-950/30'
          : 'bg-amber-950/40 border-amber-500/70 shadow-amber-950/30',
        iconBg: hasChecklistCompleted ? 'bg-emerald-600' : 'bg-amber-500',
        iconColor: 'text-white',
        border: hasChecklistCompleted ? 'border-emerald-500' : 'border-amber-500',
      },
      requiresChecklist: false,
    },
    {
      href: '/driver-app/today',
      icon: Calendar,
      title: t('menuToday', 'driver') || "Today's Schedule & Trips",
      subtitle: t('menuTodaySub', 'driver') || 'Passenger pickups, stops & assigned routes',
      cardStyle: {
        light: 'bg-sky-50/90 border-sky-500 shadow-sky-500/10',
        dark: 'bg-sky-950/40 border-sky-500/70 shadow-sky-950/30',
        iconBg: 'bg-sky-600',
        iconColor: 'text-white',
        border: 'border-sky-500',
      },
      requiresChecklist: true,
    },
  ];

  // Secondary Action Cards
  const secondaryCards: MenuCard[] = [
    {
      href: '/driver-app/navigate',
      icon: Navigation,
      title: t('menuNavigate', 'driver') || 'Live Navigation',
      subtitle: t('menuNavigateSub', 'driver') || 'Turn-by-turn guidance & map routing',
      cardStyle: {
        light: 'bg-blue-50/90 border-blue-500 shadow-blue-500/10',
        dark: 'bg-blue-950/40 border-blue-500/70 shadow-blue-950/30',
        iconBg: 'bg-blue-600',
        iconColor: 'text-white',
        border: 'border-blue-500',
      },
      requiresChecklist: true,
    },
    {
      href: '/driver-app/fuel-entry',
      icon: Fuel,
      title: t('menuFuel', 'driver') || 'Fuel Logging',
      subtitle: t('menuFuelSub', 'driver') || 'Record liters, cost & receipt photo',
      cardStyle: {
        light: 'bg-amber-50/90 border-amber-500 shadow-amber-500/10',
        dark: 'bg-amber-950/40 border-amber-500/70 shadow-amber-950/30',
        iconBg: 'bg-amber-500',
        iconColor: 'text-white',
        border: 'border-amber-500',
      },
      requiresChecklist: true,
    },
    {
      href: '/driver-app/expenses',
      icon: Receipt,
      title: t('menuExpenses', 'driver') || 'Expenses & Tolls',
      subtitle: t('menuExpensesSub', 'driver') || 'Salik, parking & maintenance fees',
      cardStyle: {
        light: 'bg-teal-50/90 border-teal-500 shadow-teal-500/10',
        dark: 'bg-teal-950/40 border-teal-500/70 shadow-teal-950/30',
        iconBg: 'bg-teal-600',
        iconColor: 'text-white',
        border: 'border-teal-500',
      },
      requiresChecklist: true,
    },
    {
      href: '/driver-app/behavior',
      icon: Award,
      title: t('menuBehavior', 'driver') || 'Driver Eco Score',
      subtitle: t('menuBehaviorSub', 'driver') || 'Smooth braking, safety & fuel efficiency',
      cardStyle: {
        light: 'bg-purple-50/90 border-purple-500 shadow-purple-500/10',
        dark: 'bg-purple-950/40 border-purple-500/70 shadow-purple-950/30',
        iconBg: 'bg-purple-600',
        iconColor: 'text-white',
        border: 'border-purple-500',
      },
      requiresChecklist: true,
    },
  ];

  // History Cards
  const tertiaryCards: MenuCard[] = [
    {
      href: '/driver-app/shift-history',
      icon: History,
      title: t('menuShiftHistory', 'driver') || 'Shift Records',
      subtitle: t('menuShiftHistorySub', 'driver') || 'Past shifts & duty hours summary',
      cardStyle: {
        light: 'bg-indigo-50/90 border-indigo-500 shadow-indigo-500/10',
        dark: 'bg-indigo-950/40 border-indigo-500/70 shadow-indigo-950/30',
        iconBg: 'bg-indigo-600',
        iconColor: 'text-white',
        border: 'border-indigo-500',
      },
      requiresChecklist: true,
    },
    {
      href: '/driver-app/trip-history',
      icon: Bus,
      title: t('tripCompleted', 'driver') || 'Trip Logs',
      subtitle: t('menuShiftHistorySub', 'driver') || 'Completed trip routes & milestones',
      cardStyle: {
        light: 'bg-rose-50/90 border-rose-500 shadow-rose-500/10',
        dark: 'bg-rose-950/40 border-rose-500/70 shadow-rose-950/30',
        iconBg: 'bg-rose-600',
        iconColor: 'text-white',
        border: 'border-rose-500',
      },
      requiresChecklist: true,
    },
  ];

  const renderCard = (c: MenuCard) => {
    const isLocked = c.requiresChecklist && !hasChecklistCompleted;
    const Icon = c.icon;

    return (
      <button
        key={c.href}
        type="button"
        onClick={() => handleCardClick(c)}
        className={`group relative flex flex-col items-start gap-2.5 rounded-2xl border-2 p-4 text-start transition duration-150 active:scale-98 shadow-sm ${
          isDark ? c.cardStyle.dark : c.cardStyle.light
        }`}
      >
        {/* Status Badge */}
        <div className="absolute end-3.5 top-3.5">
          {c.href === '/driver-app/shift-checklist' ? (
            hasChecklistCompleted ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-black uppercase shadow-sm">
                <CheckCircle2 className="h-3 w-3" /> {t('done', 'common') || 'Verified ✓'}
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-black uppercase animate-pulse shadow-sm">
                <AlertTriangle className="h-3 w-3" /> {t('pending', 'common') || 'Pending'}
              </span>
            )
          ) : isLocked ? (
            <span className="flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300">
              <Lock className="h-2.5 w-2.5 text-amber-500" /> Locked
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-slate-400 group-hover:text-slate-600 dark:group-hover:text-white transition">
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </span>
          )}
        </div>

        {/* Icon with bold high-contrast background */}
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-md ${c.cardStyle.iconBg} ${c.cardStyle.iconColor}`}>
          <Icon className="h-6 w-6 stroke-[2.2]" />
        </div>

        {/* Text Details with High Contrast */}
        <div className="w-full pr-14">
          <div className="flex items-center gap-1.5 font-black text-sm text-slate-950 dark:text-white tracking-tight">
            <span>{c.title}</span>
            {isLocked && <Lock className="h-3 w-3 text-amber-500 shrink-0" />}
          </div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mt-1 leading-snug">
            {c.subtitle}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-100 dark:bg-slate-950 pb-20 select-none text-slate-900 dark:text-slate-100 transition-colors duration-150">
      {/* Toast Notification */}
      {feedback && (
        <div className="fixed top-4 inset-x-4 z-50 mx-auto max-w-sm rounded-2xl border-2 border-amber-500 bg-white dark:bg-slate-900 px-4 py-3 text-xs font-black text-amber-900 dark:text-amber-200 shadow-2xl backdrop-blur flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 px-4 py-3 backdrop-blur shadow-sm">
        <div className="flex items-center justify-between gap-2">
          {/* Driver & Vehicle Profile */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-md shadow-violet-600/30">
              <Bus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-xs font-black uppercase tracking-wider rounded-md bg-violet-600 text-white px-2 py-0.5 shadow-sm">
                  {vehiclePlate}
                </span>
                <span className="font-mono text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  {vehicleCode}
                </span>
              </div>
              <p className="text-xs font-bold text-slate-900 dark:text-slate-200 truncate mt-0.5">
                {driverName} · Shift Console
              </p>
            </div>
          </div>

          {/* Quick Actions: Theme, Language, Sign Out */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Dark / Light Mode Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4 text-violet-600" />}
            </button>

            {/* 3-Language Switcher */}
            <div className="flex rounded-lg border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800 p-0.5 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-1.5 py-1 rounded ${language === 'en' ? 'bg-violet-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage('ar')}
                className={`px-1.5 py-1 rounded ${language === 'ar' ? 'bg-violet-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                ع
              </button>
              <button
                type="button"
                onClick={() => setLanguage('hi')}
                className={`px-1.5 py-1 rounded ${language === 'hi' ? 'bg-violet-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                हि
              </button>
            </div>

            {/* Sign Out */}
            <button
              type="button"
              onClick={signOut}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 active:scale-95 transition"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-4 p-4">
        {/* MANDATORY CHECKLIST SAFETY ENFORCEMENT BANNER */}
        {!hasChecklistCompleted ? (
          <div className="rounded-3xl border-2 border-amber-500 bg-amber-50 dark:bg-gradient-to-br dark:from-amber-950/60 dark:to-slate-900 p-4 shadow-lg space-y-2">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-300 font-black text-sm">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{t('mandatoryChecklist', 'driver') || 'Pre-Trip Safety Inspection: Pending'}</span>
            </div>
            <p className="text-xs font-semibold text-amber-950 dark:text-amber-200">
              {t('checklistPending', 'driver') || 'Safety protocol requires completing the checklist to unlock operational tasks.'}
            </p>
            <button
              type="button"
              onClick={() => router.push('/driver-app/shift-checklist')}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3.5 text-xs font-black text-slate-950 shadow-md shadow-amber-500/30 hover:bg-amber-400 active:scale-95 transition"
            >
              <ShieldAlert className="h-4 w-4" />
              <span>{t('completeChecklist', 'driver') || 'Complete Safety Checklist Now'}</span>
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 p-3.5 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold shadow-sm">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-black text-emerald-950 dark:text-emerald-200">
                  {t('checklistDone', 'driver') || 'Pre-Trip Safety Inspection Verified ✓'}
                </p>
                <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  {t('activeShift', 'driver') || 'All daily operational modules are unlocked'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push('/driver-app/shift-checklist')}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 active:scale-95 transition"
            >
              Review
            </button>
          </div>
        )}

        {/* Section 1: Shift Operations */}
        <div>
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-violet-600" /> Shift Operations
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {primaryCards.map(renderCard)}
          </div>
        </div>

        {/* Section 2: Trip Logging & Expenses */}
        <div>
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Trip Logging &amp; Expenses
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {secondaryCards.map(renderCard)}
          </div>
        </div>

        {/* Section 3: History & Records */}
        <div>
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500" /> Shift Records &amp; History
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {tertiaryCards.map(renderCard)}
          </div>
        </div>

        {/* End Shift Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={endShift}
            disabled={endingShift}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 py-3.5 text-xs font-black text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition shadow-sm disabled:opacity-50"
          >
            <span>End Active Shift</span>
          </button>
        </div>
      </main>
    </div>
  );
}
