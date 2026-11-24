'use client';
/**
 * ThemeProvider — app-wide Light / Dark / Auto theme.
 *
 * The app is authored dark (the baseline styling), but LIGHT is the default
 * choice for anyone who hasn't picked a theme. Light adds `class="light"` to
 * <html>, which the global light-mode skin in globals.css keys off to remap
 * the dark palette to light. The driver app (/driver-app/*) is always dark. "Auto"
 * follows the OS `prefers-color-scheme`. The choice is persisted in
 * localStorage; a tiny inline script in the root layout applies it before
 * paint to avoid a flash.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'auto';
type Resolved = 'light' | 'dark';

export interface ThemeCtxValue {
  choice: ThemeChoice;
  resolved: Resolved;
  setChoice: (c: ThemeChoice) => void;
  theme: Resolved;
  setTheme: (c: ThemeChoice) => void;
}

const STORAGE_KEY = 'fleet360-theme';
/** Theme used when the user has never picked one. Keep in sync with
 *  THEME_NO_FLASH in src/app/layout.tsx. */
export const DEFAULT_THEME: ThemeChoice = 'light';
const ThemeCtx = createContext<ThemeCtxValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function isDriverApp(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/driver-app');
}

function resolveChoice(choice: ThemeChoice): Resolved {
  // Drivers need high contrast in the field; the driver UI is dark-only.
  if (isDriverApp()) return 'dark';
  if (choice === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

function applyResolved(resolved: Resolved) {
  const el = document.documentElement;
  el.classList.toggle('light', resolved === 'light');
  el.classList.toggle('dark', resolved === 'dark');
  el.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(DEFAULT_THEME);
  const [resolved, setResolved] = useState<Resolved>(DEFAULT_THEME === 'dark' ? 'dark' : 'light');

  // Hydrate from storage (the inline script already applied the class; this
  // just syncs React state to it).
  useEffect(() => {
    let stored: ThemeChoice = DEFAULT_THEME;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'auto') stored = raw;
    } catch { /* ignore */ }
    const r = resolveChoice(stored);
    setChoiceState(stored);
    setResolved(r);
    applyResolved(r);
  }, []);

  // Re-resolve when the OS theme changes and we're in Auto.
  useEffect(() => {
    if (choice !== 'auto' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { const r = resolveChoice('auto'); setResolved(r); applyResolved(r); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => {
    try { localStorage.setItem(STORAGE_KEY, c); } catch { /* ignore */ }
    const r = resolveChoice(c);
    setChoiceState(c);
    setResolved(r);
    applyResolved(r);
  }, []);

  return (
    <ThemeCtx.Provider value={{ choice, resolved, setChoice, theme: resolved, setTheme: setChoice }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): ThemeCtxValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) return { choice: DEFAULT_THEME, resolved: 'light', setChoice: () => {}, theme: 'light', setTheme: () => {} };
  return {
    ...ctx,
    theme: ctx.theme ?? ctx.resolved,
    setTheme: ctx.setTheme ?? ctx.setChoice,
  };
}
