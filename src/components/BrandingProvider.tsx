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

// Default brand colours (royal-maritime palette). Tenant overrides take precedence.
const DEFAULT_BRAND_PRIMARY = '#D4AF37'; // gold
const DEFAULT_BRAND_ACCENT  = '#3B82F6'; // royal blue

function applyBranding(b: Branding | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // --brand-primary / --brand-accent always have a value: tenant override or
  // the platform-wide default. Components reading these never see "unset".
  root.style.setProperty('--brand-primary', b?.primaryColor ?? DEFAULT_BRAND_PRIMARY);
  root.style.setProperty('--brand-accent',  b?.accentColor  ?? DEFAULT_BRAND_ACCENT);

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
