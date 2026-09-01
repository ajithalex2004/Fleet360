'use client';

import { useEffect } from 'react';

interface Branding {
  productName: string | null;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

const DEFAULT_BRAND_PRIMARY = '#D4AF37';
const DEFAULT_BRAND_ACCENT = '#3B82F6';
const BRANDING_CACHE_KEY = 'fleet360-branding-cache-v1';
const BRANDING_CACHE_TTL = 15 * 60 * 1000;

export default function BrandingProvider() {
  useEffect(() => {
    let cancelled = false;
    const cached = readCachedBranding();
    if (cached) applyBranding(cached);

    const load = async () => {
      try {
        const r = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const branding = data?.branding ?? null;
        writeCachedBranding(branding);
        applyBranding(branding);
      } catch {
        // Branding should never block app rendering.
      }
    };

    const cancelIdle = runWhenIdle(load);
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  return null;
}

function runWhenIdle(fn: () => void) {
  if (typeof window === 'undefined') return () => {};
  const idleGlobal = globalThis as IdleGlobals;
  if (typeof idleGlobal.requestIdleCallback === 'function') {
    const id = idleGlobal.requestIdleCallback(fn, { timeout: 2500 });
    return () => idleGlobal.cancelIdleCallback?.(id);
  }
  const id = globalThis.setTimeout(fn, 1200);
  return () => globalThis.clearTimeout(id);
}

type IdleGlobals = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function readCachedBranding(): Branding | null {
  try {
    const raw = window.sessionStorage.getItem(BRANDING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; branding?: Branding | null };
    if (!parsed.ts || Date.now() - parsed.ts > BRANDING_CACHE_TTL) return null;
    return parsed.branding ?? null;
  } catch {
    return null;
  }
}

function writeCachedBranding(branding: Branding | null) {
  try {
    window.sessionStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify({ ts: Date.now(), branding }));
  } catch {
    // Best-effort cache only.
  }
}

function applyBranding(b: Branding | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.style.setProperty('--brand-primary', b?.primaryColor ?? DEFAULT_BRAND_PRIMARY);
  root.style.setProperty('--brand-accent', b?.accentColor ?? DEFAULT_BRAND_ACCENT);

  if (b?.productName) {
    document.title = b.productName + (b.tagline ? ` - ${b.tagline}` : '');
  }

  if (b?.faviconUrl) {
    let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = b.faviconUrl;
  }
}
