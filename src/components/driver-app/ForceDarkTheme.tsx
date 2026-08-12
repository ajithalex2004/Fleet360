/**
 * components/driver-app/ForceDarkTheme.tsx
 *
 * Forces `<html>` to the dark theme for the driver app. The admin
 * app's `ThemeProvider` (in the root layout) respects the user's
 * saved `light` / `dark` / `auto` preference. The driver app is
 * permanently dark — drivers in the desert need the highest
 * contrast and the dark theme is what the mobile UI was designed
 * around.
 *
 * The root layout's no-flash inline script already checks the URL
 * path and forces dark for `/driver-app/*`. This component is a
 * belt-and-braces second pass in case the script was disabled
 * (extensions, CSP, edge cases) — it runs after React hydration
 * and re-applies dark.
 *
 * We deliberately do NOT write to `localStorage` here — the user's
 * saved theme preference is preserved for when they return to the
 * admin app. The driver app's dark theme is session-scoped.
 */

'use client';

import { useEffect } from 'react';

export function ForceDarkTheme() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('light');
    html.classList.add('dark');
    html.style.colorScheme = 'dark';
  }, []);

  return null;
}
