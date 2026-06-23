'use client';

/**
 * Sticky banner that surfaces subscription state to tenant admins:
 *
 *  - trialing & ends within 5 days → amber "Trial ends in N days"
 *  - past_due / unpaid              → amber "Payment failed"
 *  - canceled                       → rose  "Subscription canceled — upgrade to continue"
 *
 * No-ops in any other state. Mounted in the root layout. Polls
 * /api/admin/billing on first mount only — webhook updates flow on next
 * navigation.
 */

import { useEffect, useState } from 'react';
import { Sparkles, AlertTriangle, X } from 'lucide-react';
import { getClientMe } from '@/lib/client-session';

interface BillingResp {
  billing?: {
    plan: string;
    subscriptionStatus: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  };
}

const DISMISS_KEY = 'xl-sub-banner-dismissed-until';
let billingCache: { ts: number; billing: BillingResp['billing'] | null } | null = null;
let billingPromise: Promise<BillingResp['billing'] | null> | null = null;
const BILLING_CACHE_TTL = 5 * 60 * 1000;

async function loadBillingBanner(): Promise<BillingResp['billing'] | null> {
  if (billingCache && Date.now() - billingCache.ts < BILLING_CACHE_TTL) return billingCache.billing;
  if (billingPromise) return billingPromise;
  billingPromise = getClientMe()
    .then(me => {
      if (!me?.userId || me.isAdmin === false) return null;
      return fetch('/api/admin/billing')
        .then(r => r.ok ? r.json() : null)
        .then((d: BillingResp | null) => d?.billing ?? null);
    })
    .then(billing => {
      billingCache = { ts: Date.now(), billing };
      return billing;
    })
    .catch(() => null)
    .finally(() => {
      billingPromise = null;
    });
  return billingPromise;
}

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
    loadBillingBanner()
      .then(billing => { if (billing) setInfo(billing); })
      .catch(() => {});
  }, []);

  if (dismissed || !info) return null;
  const banner = computeBanner(info);
  if (!banner) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + 4 * 60 * 60 * 1000)); // 4 hours
    setDismissed(true);
  };

  const tone = banner.tone === 'rose'
    ? 'bg-rose-500 text-rose-950'
    : 'bg-amber-500 text-amber-950';

  return (
    <div className={`sticky top-0 z-[99] w-full ${tone} shadow-lg`}>
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 text-sm">
        {banner.tone === 'rose'
          ? <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          : <Sparkles      className="w-4 h-4 flex-shrink-0" />}
        <span className="font-semibold">{banner.title}</span>
        <span className="opacity-80 hidden sm:inline">{banner.message}</span>
        <span className="ml-auto" />
        <a href="/admin/subscription/upgrade"
          className="bg-black/20 hover:bg-black/30 font-semibold rounded-md px-3 py-1 text-xs">
          {banner.cta}
        </a>
        <button onClick={dismiss} className="hover:bg-black/10 rounded p-1" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface Banner { tone: 'amber' | 'rose'; title: string; message: string; cta: string; }

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
      message: 'We couldn’t charge your card. Update payment method to keep your subscription active.',
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
