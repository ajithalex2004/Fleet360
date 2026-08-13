'use client';
/**
 * ThemeProvider — app-wide Light / Dark / Auto theme.
 *
 * The app is authored dark, so DARK is the default and the baseline styling.
 * Choosing Light adds `class="light"` to <html>, which the global light-mode
 * skin in globals.css keys off to remap the dark palette to light. "Auto"
 * follows the OS `prefers-color-scheme`. The choice is persisted in
 * localStorage; a tiny inline script in the root layout applies it before
 * paint to avoid a flash.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'auto';
type Resolved = 'light' | 'dark';

interface ThemeCtxValue {
  choice: ThemeChoice;
  resolved: Resolved;
  setChoice: (c: ThemeChoice) => void;
}

const STORAGE_KEY = 'fleet360-theme';
const ThemeCtx = createContext<ThemeCtxValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveChoice(choice: ThemeChoice): Resolved {
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
  const [choice, setChoiceState] = useState<ThemeChoice>('dark');
  const [resolved, setResolved] = useState<Resolved>('dark');

  // Hydrate from storage (the inline script already applied the class; this
  // just syncs React state to it).
  useEffect(() => {
    let stored: ThemeChoice = 'dark';
    try { stored = (localStorage.getItem(STORAGE_KEY) as ThemeChoice) || 'dark'; } catch { /* ignore */ }
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

  return <ThemeCtx.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeCtxValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) return { choice: 'dark', resolved: 'dark', setChoice: () => {} };
  return ctx;
}
