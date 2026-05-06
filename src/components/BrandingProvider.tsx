'use client';

/**
 * BrandingProvider — fetches the current tenant's branding (via /api/auth/me)
 * and injects it as CSS variables on document.documentElement, plus updates
 * the document title and favicon.
 *
 * Components and Tailwind utilities can read these vars via:
 *   style={{ background: 'var(--brand-primary, #2563eb)' }}
 *   className="bg-[var(--brand-primary)]"
 *
 * Mounted in the root layout. No-ops cleanly when no branding is set.
 */

import { useEffect } from 'react';

interface Branding {
  productName:  string | null;
  tagline:      string | null;
  logoUrl:      string | null;
  faviconUrl:   string | null;
  primaryColor: string | null;
  accentColor:  string | null;
}

export default function BrandingProvider() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        applyBranding(data?.branding ?? null);
      } catch { /* swallow — branding is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return null;
}

function applyBranding(b: Branding | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (b?.primaryColor) root.style.setProperty('--brand-primary', b.primaryColor);
  else                 root.style.removeProperty('--brand-primary');

  if (b?.accentColor)  root.style.setProperty('--brand-accent', b.accentColor);
  else                 root.style.removeProperty('--brand-accent');

  if (b?.productName) {
    document.title = b.productName + (b.tagline ? ` — ${b.tagline}` : '');
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
