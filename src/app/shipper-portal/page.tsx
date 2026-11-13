'use client';

/**
 * Shipper Portal dashboard — the post-login landing page.
 *
 * Shows:
 *   • Welcome banner with customer name + tracking-visibility chip
 *   • Four stats cards (Total / Active / Delivered / Last 30 days)
 *   • Empty-state CTA when no shipments yet ("Place your first request")
 *   • Recent shipments table once shipments exist (Day 5 fully populates)
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Package, TrendingUp, CheckCircle2, Calendar,
  Plus, ArrowRight, Lock, MapPin, Activity,
} from 'lucide-react';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';

interface Stats {
  total: number;
  active: number;
  delivered: number;
  last30Days: number;
}

interface Me {
  user: { id: string; email: string; fullName: string | null };
  customer: { id: string; nameEn: string | null; portalTrackingLevel: string } | null;
}

const TRACKING_LEVEL_LABEL: Record<string, string> = {
  NONE:           'Notifications only',
  STATUS_ONLY:    'Status updates',
  STATUS_AND_ETA: 'Status + ETA',
  FULL_TRACKING:  'Live tracking',
};
const TRACKING_LEVEL_TONE: Record<string, string> = {
  NONE:           'bg-slate-500/15 text-slate-300 border-slate-500/30',
  STATUS_ONLY:    'bg-blue-500/15 text-blue-300 border-blue-500/30',
  STATUS_AND_ETA: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  FULL_TRACKING:  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

export default function ShipperPortalDashboard() {
  const [me, setMe]       = useState<Me | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [meRes, statsRes] = await Promise.all([
          fetch('/api/shipper-portal/me'),
          fetch('/api/shipper-portal/stats'),
        ]);
        if (!cancelled && meRes.ok)    setMe(await meRes.json());
        if (!cancelled && statsRes.ok) setStats(await statsRes.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 rounded-2xl bg-slate-900/60 animate-pulse" />
        ))}
      </div>
    );
  }

  const customerName = me?.customer?.nameEn ?? 'your organisation';
  const trackingLevel = me?.customer?.portalTrackingLevel ?? 'STATUS_ONLY';
  const trackingPretty = TRACKING_LEVEL_LABEL[trackingLevel] ?? trackingLevel;
  const trackingTone = TRACKING_LEVEL_TONE[trackingLevel] ?? TRACKING_LEVEL_TONE.STATUS_ONLY;

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="bg-gradient-to-br from-emerald-900/40 via-teal-900/30 to-slate-900 border border-emerald-500/20 rounded-2xl p-6">
        <p className="text-[11px] text-emerald-300/70 uppercase tracking-widest">Welcome back</p>
        <h1 className="text-2xl font-bold text-white mt-1">
          {me?.user?.fullName ?? me?.user?.email ?? 'Shipper'}
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Placing shipments on behalf of <strong className="text-white">{customerName}</strong>
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${trackingTone}`}>
            <Activity className="w-3 h-3" /> Tracking: {trackingPretty}
          </span>
          {trackingLevel === 'NONE' && (
            <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
              <Lock className="w-3 h-3" /> Contact your operator to enable status updates.
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <StatGrid cols={4}>
        <KpiCard label="Total shipments" value={(stats?.total ?? 0).toLocaleString()} icon={Package} accent="emerald" />
        <KpiCard label="Active right now" value={(stats?.active ?? 0).toLocaleString()} icon={Activity} accent="amber" />
        <KpiCard label="Delivered" value={(stats?.delivered ?? 0).toLocaleString()} icon={CheckCircle2} accent="cyan" />
        <KpiCard label="Last 30 days" value={(stats?.last30Days ?? 0).toLocaleString()} icon={Calendar} accent="violet" />
      </StatGrid>

      {/* Primary action — when no shipments yet, this is the only thing on the page */}
      {(stats?.total ?? 0) === 0 ? (
        <div className="bg-slate-900 border border-dashed border-emerald-500/40 rounded-2xl p-10 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/15 mb-4">
            <Package className="w-7 h-7 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Place your first shipment request</h2>
          <p className="text-slate-400 text-sm max-w-md mx-auto mb-6">
            Fill in pickup, delivery and cargo details. Your operator will acknowledge and
            assign a carrier — you&apos;ll see status updates here as the shipment progresses.
          </p>
          <Link href="/shipper-portal/shipments/new"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:opacity-90">
            <Plus className="w-4 h-4" /> New Shipment Request
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Quick actions */}
          <div className="lg:col-span-1 space-y-3">
            <Link href="/shipper-portal/shipments/new"
              className="block bg-gradient-to-br from-emerald-600 to-teal-700 hover:opacity-90 rounded-2xl p-5 text-white">
              <Plus className="w-5 h-5 mb-2" />
              <p className="font-bold">New Shipment</p>
              <p className="text-xs opacity-80 mt-0.5">Pickup, delivery, cargo</p>
            </Link>
            <Link href="/shipper-portal/shipments"
              className="block bg-slate-900 hover:bg-slate-800 border border-white/10 rounded-2xl p-5 text-white">
              <MapPin className="w-5 h-5 mb-2 text-emerald-300" />
              <p className="font-bold">All Shipments</p>
              <p className="text-xs text-slate-400 mt-0.5">Track and review history</p>
            </Link>
          </div>

          {/* Recent shipments (skeleton — Day 5 wires the real list) */}
          <div className="lg:col-span-2 bg-slate-900 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center mb-3">
              <h2 className="text-sm font-bold text-white">Recent shipments</h2>
              <Link href="/shipper-portal/shipments"
                className="ml-auto text-xs text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-0.5">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <p className="text-slate-500 text-xs italic">
              Recent shipments will appear here once the list endpoint is wired (Day 5).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
