'use client';

import { useEffect, useState } from 'react';

interface BillingResp {
  billing?: {
    plan: string;
    subscriptionStatus: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  };
}

interface Banner {
  tone: 'amber' | 'rose';
  title: string;
  message: string;
  cta: string;
}

const DISMISS_KEY = 'xl-sub-banner-dismissed-until';
const BILLING_CACHE_KEY = 'fleet360-billing-banner-cache-v1';
const BILLING_CACHE_TTL = 10 * 60 * 1000;

export default function SubscriptionBanner() {
  const [info, setInfo] = useState<BillingResp['billing'] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const until = parseInt(window.localStorage.getItem(DISMISS_KEY) ?? '0', 10);
    if (until && Date.now() < until) {
      setDismissed(true);
      return;
    }

    const cached = readCachedBilling();
    if (cached) setInfo(cached);

    const load = async () => {
      try {
        const r = await fetch('/api/admin/billing', { cache: 'no-store' });
        if (!r.ok) return;
        const d = (await r.json()) as BillingResp;
        if (d?.billing) {
          writeCachedBilling(d.billing);
          setInfo(d.billing);
        }
      } catch {
        // Billing banner is advisory; never block page rendering.
      }
    };

    return runWhenIdle(load);
  }, []);

  if (dismissed || !info) return null;
  const banner = computeBanner(info);
  if (!banner) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + 4 * 60 * 60 * 1000));
    setDismissed(true);
  };

  const tone = banner.tone === 'rose'
    ? 'bg-rose-500 text-rose-950'
    : 'bg-amber-500 text-amber-950';

  return (
    <div className={`sticky top-0 z-[99] w-full ${tone} shadow-lg`}>
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 text-sm">
        <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-black/15 text-[10px] font-bold">
          {banner.tone === 'rose' ? '!' : '*'}
        </span>
        <span className="font-semibold">{banner.title}</span>
        <span className="opacity-80 hidden sm:inline">{banner.message}</span>
        <span className="ml-auto" />
        <a
          href="/admin/subscription/upgrade"
          className="bg-black/20 hover:bg-black/30 font-semibold rounded-md px-3 py-1 text-xs"
        >
          {banner.cta}
        </a>
        <button onClick={dismiss} className="hover:bg-black/10 rounded p-1" aria-label="Dismiss">
          <span className="inline-flex h-4 w-4 items-center justify-center text-xs font-bold leading-none">x</span>
        </button>
      </div>
    </div>
  );
}

function runWhenIdle(fn: () => void) {
  if (typeof window === 'undefined') return () => {};
  const idleGlobal = globalThis as IdleGlobals;
  if (typeof idleGlobal.requestIdleCallback === 'function') {
    const id = idleGlobal.requestIdleCallback(fn, { timeout: 4000 });
    return () => idleGlobal.cancelIdleCallback?.(id);
  }
  const id = globalThis.setTimeout(fn, 1800);
  return () => globalThis.clearTimeout(id);
}

type IdleGlobals = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function readCachedBilling(): BillingResp['billing'] | null {
  try {
    const raw = window.sessionStorage.getItem(BILLING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; billing?: BillingResp['billing'] | null };
    if (!parsed.ts || Date.now() - parsed.ts > BILLING_CACHE_TTL) return null;
    return parsed.billing ?? null;
  } catch {
    return null;
  }
}

function writeCachedBilling(billing: BillingResp['billing']) {
  try {
    window.sessionStorage.setItem(BILLING_CACHE_KEY, JSON.stringify({ ts: Date.now(), billing }));
  } catch {
    // Best-effort cache only.
  }
}

function computeBanner(b: NonNullable<BillingResp['billing']>): Banner | null {
  const status = b.subscriptionStatus;
  const trialEnd = b.trialEndsAt ? new Date(b.trialEndsAt).getTime() : 0;
  const daysToTrialEnd = trialEnd ? Math.max(0, Math.ceil((trialEnd - Date.now()) / 86_400_000)) : null;

  if (status === 'canceled' || (b.plan === 'TRIAL' && trialEnd && trialEnd < Date.now())) {
    return {
      tone: 'rose',
      title: 'Subscription needed',
      message: 'Your trial has ended. Upgrade to continue.',
      cta: 'Upgrade now',
    };
  }
  if (status === 'past_due' || status === 'unpaid') {
    return {
      tone: 'rose',
      title: 'Payment failed',
      message: "We couldn't charge your card. Update payment method to keep your subscription active.",
      cta: 'Update payment',
    };
  }
  if (status === 'trialing' && daysToTrialEnd !== null && daysToTrialEnd <= 5) {
    return {
      tone: 'amber',
      title: `Trial ends in ${daysToTrialEnd} day${daysToTrialEnd === 1 ? '' : 's'}`,
      message: 'Pick a plan to keep your team running without interruption.',
      cta: 'Choose plan',
    };
  }
  return null;
}
