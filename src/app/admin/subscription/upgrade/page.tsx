'use client';

/**
 * /admin/subscription/upgrade — pick a plan, redirect to Stripe Checkout.
 * If a Stripe customer already exists, also offers a "Manage in Stripe"
 * link to the Customer Portal (update card, view invoices, downgrade).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowLeft, Check, AlertCircle, ExternalLink } from 'lucide-react';

interface BillingResp {
  billing: { plan: string; stripeCustomerId: string | null };
}

const PLANS = [
  {
    code: 'STANDARD' as const,
    title: 'Standard',
    priceUsd: 249,
    priceAed: 915,
    blurb: 'Core fleet + bookings for small operators.',
    bullets: [
      'Up to 25 users · 100 vehicles · 5,000 bookings/month',
      'API keys for ERP integrations',
      'Standard email support',
    ],
  },
  {
    code: 'PROFESSIONAL' as const,
    title: 'Professional',
    priceUsd: 799,
    priceAed: 2_930,
    blurb: 'All modules + analytics + SSO + white-label.',
    bullets: [
      'Up to 200 users · 1,000 vehicles · 50,000 bookings/month',
      'OIDC single sign-on',
      'White-label branding',
      'Priority email + chat support',
    ],
    featured: true,
  },
  {
    code: 'ENTERPRISE' as const,
    title: 'Enterprise',
    priceUsd: 2_499,
    priceAed: 9_170,
    blurb: 'Unlimited usage, premium support, custom integrations.',
    bullets: [
      'Unlimited users · vehicles · bookings',
      'Dedicated success manager',
      'Custom SLAs and integrations',
    ],
  },
];

export default function UpgradePage() {
  const [currency, setCurrency] = useState<'usd' | 'aed'>('usd');
  const [currentPlan, setCurrentPlan]    = useState<string>('TRIAL');
  const [hasCustomer, setHasCustomer]    = useState(false);
  const [loadingPlan, setLoadingPlan]    = useState<string | null>(null);
  const [error, setError]                = useState<string | null>(null);
  const [canceledFlash, setCanceledFlash] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled')) {
      setCanceledFlash(true);
      const clean = new URL(window.location.href);
      clean.searchParams.delete('canceled');
      window.history.replaceState({}, '', clean.toString());
    }
  }, []);

  useEffect(() => {
    fetch('/api/admin/billing')
      .then(r => r.json())
      .then((d: BillingResp) => {
        if (d?.billing) {
          setCurrentPlan(d.billing.plan);
          setHasCustomer(!!d.billing.stripeCustomerId);
        }
      }).catch(() => {});
  }, []);

  const checkout = async (plan: 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE') => {
    setLoadingPlan(plan); setError(null);
    try {
      const r = await fetch('/api/admin/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, currency }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.error ?? 'Checkout failed'); return; }
      window.location.href = d.url;
    } catch {
      setError('Network error.');
    } finally {
      setLoadingPlan(null);
    }
  };

  const portal = async () => {
    setLoadingPlan('portal'); setError(null);
    try {
      const r = await fetch('/api/admin/billing/portal', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) { setError(d?.error ?? 'Portal failed'); return; }
      window.location.href = d.url;
    } catch {
      setError('Network error.');
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <Link href="/admin/subscription" className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3 h-3" /> Back to subscription
        </Link>
        <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-400" /> Upgrade your plan
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Currently on <strong className="text-white">{currentPlan}</strong>. Pick a plan to continue.
        </p>
      </div>

      {canceledFlash && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-200 text-sm">
          Checkout was canceled. No changes were made — pick a plan again when you’re ready.
        </div>
      )}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between bg-slate-800/30 border border-white/5 rounded-xl px-4 py-2">
        <div className="text-sm text-slate-400">Currency</div>
        <div className="flex gap-1">
          {(['usd', 'aed'] as const).map(c => (
            <button key={c} onClick={() => setCurrency(c)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                currency === c
                  ? 'bg-emerald-500/30 text-emerald-200 border-emerald-500/60'
                  : 'bg-slate-800/50 text-slate-400 border-white/10 hover:border-white/30'
              }`}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {PLANS.map(p => {
          const isCurrent = p.code === currentPlan;
          const price = currency === 'usd' ? p.priceUsd : p.priceAed;
          const symbol = currency === 'usd' ? '$' : 'AED ';
          return (
            <div key={p.code}
              className={`bg-slate-800/50 border rounded-2xl p-6 space-y-4 ${
                p.featured ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/10' : 'border-white/10'
              }`}>
              {p.featured && (
                <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">Most popular</div>
              )}
              <div>
                <h2 className="text-xl font-bold text-white">{p.title}</h2>
                <p className="text-sm text-slate-400 mt-1">{p.blurb}</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white">{symbol}{price.toLocaleString()}</span>
                <span className="text-sm text-slate-400">/ month</span>
              </div>
              <ul className="space-y-2 text-sm">
                {p.bullets.map(b => (
                  <li key={b} className="flex items-start gap-2 text-slate-300">
                    <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> <span>{b}</span>
                  </li>
                ))}
              </ul>
              <button
                disabled={isCurrent || loadingPlan !== null}
                onClick={() => checkout(p.code)}
                className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-all ${
                  isCurrent
                    ? 'bg-slate-700/50 text-slate-400 cursor-default'
                    : p.featured
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                } disabled:opacity-50`}>
                {isCurrent ? 'Current plan' : loadingPlan === p.code ? 'Redirecting…' : `Choose ${p.title}`}
              </button>
            </div>
          );
        })}
      </div>

      {hasCustomer && (
        <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Need to update payment method or view invoices?</h3>
          <button onClick={portal} disabled={loadingPlan === 'portal'}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-white text-sm inline-flex items-center gap-2">
            <ExternalLink className="w-4 h-4" /> {loadingPlan === 'portal' ? 'Opening…' : 'Manage in Stripe'}
          </button>
          <p className="text-xs text-slate-500">
            Stripe&rsquo;s hosted Customer Portal — update card, download VAT invoices, change plan, or cancel.
          </p>
        </div>
      )}

      <p className="text-xs text-slate-500 text-center">
        VAT (5% UAE) is calculated automatically at checkout. Cancel anytime; you keep access through the period you&rsquo;ve paid for.
      </p>
    </div>
  );
}
