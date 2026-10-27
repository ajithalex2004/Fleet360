'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export type DriverTheme = 'light' | 'dark';

interface MobileThemeContextValue {
  theme: DriverTheme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (t: DriverTheme) => void;
}

const MobileThemeContext = createContext<MobileThemeContextValue>({
  theme: 'dark',
  isDark: true,
  toggleTheme: () => {},
  setTheme: () => {},
});

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<DriverTheme>('dark');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('fleet360_driver_theme') as DriverTheme | null;
      if (saved === 'light' || saved === 'dark') {
        setThemeState(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const el = document.documentElement;
      el.classList.remove('light', 'dark');
      el.classList.add(theme);
      el.style.colorScheme = theme;
      localStorage.setItem('fleet360_driver_theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((t: DriverTheme) => {
    setThemeState(t);
  }, []);

  return (
    <MobileThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </MobileThemeContext.Provider>
  );
}

export function useMobileTheme() {
  return useContext(MobileThemeContext);
}
