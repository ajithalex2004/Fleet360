'use client';

/**
 * /admin/subscription — current tenant's plan + usage + limits + upgrade CTA.
 *
 * Wave 3.B: read-only + upgrade button placeholder. Wave 3.C wires the
 * upgrade button to Stripe Checkout / Customer Portal.
 *
 * Distinct from /admin/billing which is a SUPER_ADMIN platform-wide MRR
 * dashboard for per-module subscriptions.
 */

import { useEffect, useState } from 'react';
import { CreditCard, AlertCircle, CheckCircle2, Users, Car, Calendar, Sparkles } from 'lucide-react';

interface BillingResponse {
  ok: boolean;
  billing: {
    tenantId: string;
    tenantName: string;
    plan: 'TRIAL' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    billingEmail: string | null;
  };
  usage: { users: number; vehicles: number; bookingsThisMonth: number };
  limits: {
    maxUsers: number | null;
    maxVehicles: number | null;
    maxBookingsPerMonth: number | null;
    sso: boolean; apiKeys: boolean; branding: boolean;
  };
}

const PLAN_BADGE: Record<string, string> = {
  TRIAL:        'bg-slate-500/20 text-slate-300 border-slate-500/40',
  STANDARD:     'bg-blue-500/20 text-blue-300 border-blue-500/40',
  PROFESSIONAL: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  ENTERPRISE:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
};

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  trialing:  'bg-blue-500/20 text-blue-300 border-blue-500/40',
  past_due:  'bg-amber-500/20 text-amber-300 border-amber-500/40',
  canceled:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  unpaid:    'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function SubscriptionPage() {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/billing');
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? 'Failed to load');
        setData(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading subscription…</div></div>;
  if (error || !data) return (
    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
      <AlertCircle className="w-4 h-4" /> {error ?? 'Failed to load'}
    </div>
  );

  const { billing, usage, limits } = data;
  const periodEnd = billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd) : null;
  const trialEnd  = billing.trialEndsAt      ? new Date(billing.trialEndsAt)      : null;

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-emerald-400" /> Subscription
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Plan, usage, and Stripe subscription for <strong className="text-white">{billing.tenantName}</strong>.
        </p>
      </div>

      {/* Plan card */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${PLAN_BADGE[billing.plan]}`}>
                {billing.plan}
              </span>
              {billing.subscriptionStatus && (
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[billing.subscriptionStatus] ?? 'bg-slate-700/40 text-slate-300 border-slate-500/40'}`}>
                  {billing.subscriptionStatus}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-white">{planTitle(billing.plan)}</h2>
            <p className="text-sm text-slate-400 max-w-xl">{planDesc(billing.plan)}</p>
          </div>
          <a href="/admin/subscription/upgrade"
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-semibold text-sm inline-flex items-center gap-2 whitespace-nowrap">
            <Sparkles className="w-4 h-4" /> {billing.plan === 'ENTERPRISE' ? 'Manage plan' : 'Upgrade'}
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {trialEnd && billing.subscriptionStatus === 'trialing' && (
            <Row label="Trial ends" value={trialEnd.toLocaleDateString()} highlight={trialEnd.getTime() - Date.now() < 5 * 86_400_000 ? 'amber' : null} />
          )}
          {periodEnd && (
            <Row label="Renews / ends" value={periodEnd.toLocaleDateString()} />
          )}
          {billing.billingEmail && (
            <Row label="Billing email" value={billing.billingEmail} />
          )}
          {billing.stripeCustomerId && (
            <Row label="Stripe customer" value={<code className="font-mono text-xs">{billing.stripeCustomerId}</code>} />
          )}
        </div>
      </div>

      {/* Usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <UsageCard icon={Users}     label="Users"            current={usage.users}             limit={limits.maxUsers} />
        <UsageCard icon={Car}       label="Vehicles"         current={usage.vehicles}          limit={limits.maxVehicles} />
        <UsageCard icon={Calendar}  label="Bookings (month)" current={usage.bookingsThisMonth} limit={limits.maxBookingsPerMonth} />
      </div>

      {/* Feature matrix */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Plan features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <FeatureLine on={limits.sso}      label="Single sign-on (SSO)" />
          <FeatureLine on={limits.apiKeys}  label="Tenant API keys" />
          <FeatureLine on={limits.branding} label="White-label branding" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: 'amber' | null }) {
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${highlight === 'amber' ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-slate-900/40 border border-white/5'}`}>
      <span className="text-slate-400">{label}</span>
      <span className={highlight === 'amber' ? 'text-amber-200 font-semibold' : 'text-white'}>{value}</span>
    </div>
  );
}

function UsageCard({ icon: Icon, label, current, limit }: { icon: React.ComponentType<{ className?: string }>; label: string; current: number; limit: number | null }) {
  const pct  = limit ? Math.min(100, (current / limit) * 100) : 0;
  const tone =
    !limit            ? 'emerald' :
    pct > 95          ? 'rose'    :
    pct > 80          ? 'amber'   :
                        'emerald';
  const colors = {
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-300' },
    amber:   { bar: 'bg-amber-500',   text: 'text-amber-300'   },
    rose:    { bar: 'bg-rose-500',    text: 'text-rose-300'    },
  }[tone];
  return (
    <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="w-4 h-4" />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{current.toLocaleString()}</span>
        <span className="text-sm text-slate-400">/ {limit ? limit.toLocaleString() : '∞'}</span>
      </div>
      {limit && (
        <div className="h-1.5 bg-slate-900/60 rounded-full overflow-hidden">
          <div className={`h-full ${colors.bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {limit && pct > 80 && (
        <p className={`text-xs ${colors.text}`}>{pct >= 95 ? 'At quota — upgrade required for more.' : 'Approaching plan limit.'}</p>
      )}
    </div>
  );
}

function FeatureLine({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {on
        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        : <AlertCircle  className="w-4 h-4 text-slate-500" />}
      <span className={on ? 'text-white' : 'text-slate-500'}>{label}</span>
    </div>
  );
}

function planTitle(p: string): string {
  switch (p) {
    case 'TRIAL':        return '14-day free trial';
    case 'STANDARD':     return 'Standard';
    case 'PROFESSIONAL': return 'Professional';
    case 'ENTERPRISE':   return 'Enterprise';
    default:             return p;
  }
}
function planDesc(p: string): string {
  switch (p) {
    case 'TRIAL':        return 'All features unlocked while you evaluate. Upgrade anytime.';
    case 'STANDARD':     return 'Core fleet + bookings for small operators.';
    case 'PROFESSIONAL': return 'All modules + analytics + SSO + white-label.';
    case 'ENTERPRISE':   return 'Unlimited usage, premium support, custom integrations.';
    default:             return '';
  }
}
