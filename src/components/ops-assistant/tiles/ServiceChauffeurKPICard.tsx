'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface ChauffeurStats {
  luxuryFleetUtil: number;
  vipBookingsToday: number;
  avgTripFare: number;
  guestSatisfaction: number;
  activeChauffeurs: number;
  trips: Array<{ guest: string; vehicle: string; pickup: string; status: string }>;
}

export default function ServiceChauffeurKPICard() {
  const [stats, setStats] = useState<ChauffeurStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (!cancelled) {
          setStats({
            luxuryFleetUtil: 91.2,
            vipBookingsToday: 28,
            avgTripFare: 420,
            guestSatisfaction: 4.96,
            activeChauffeurs: 34,
            trips: [
              { guest: 'Atlantis The Royal VIP Guest', vehicle: 'Mercedes S-Class (DXB 1042)', pickup: 'Dubai Int Airport (DXB T3)', status: 'Chauffeur En Route' },
              { guest: 'Burj Al Arab Executive', vehicle: 'BMW 7 Series (DXB 8891)', pickup: 'DIFC Gate Village', status: 'Passenger On Board' },
              { guest: 'Emirates Palace Abu Dhabi', vehicle: 'Range Rover Autobiography', pickup: 'Al Maktoum Airport (DWC)', status: 'Assigned' },
            ],
          });
        }
      } catch (err) {
        console.error('Failed to load Chauffeur KPI stats:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-5 w-full max-w-2xl animate-pulse space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-4 bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-slate-700 rounded w-1/6" />
        </div>
        <div className="grid grid-cols-4 gap-2 pt-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-700/50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <h3 className="text-base font-bold text-white tracking-tight">Limousine & VIP Chauffeur Service</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
              VIP LUXURY
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Executive guest transfers, luxury fleet allocation, flight tracking & chauffeur dispatch
          </p>
        </div>
        <Link
          href="/booking-portal"
          className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>VIP Desk</span>
          <span>→</span>
        </Link>
      </div>

      {/* 4 KPI Metric Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-rose-400">{s.luxuryFleetUtil}%</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Luxury Utilization</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">{s.vipBookingsToday}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Today&apos;s VIP Trips</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-cyan-400">AED {s.avgTripFare}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Average Trip Fare</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-amber-400">★ {s.guestSatisfaction}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Guest CSAT Score</p>
        </div>
      </div>

      {/* Live VIP Transfers */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live VIP & Corporate Airport Transfers</p>
        <div className="space-y-2">
          {s.trips.map((t, idx) => (
            <div key={idx} className="bg-slate-900/40 rounded-xl p-2.5 text-xs flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white truncate">{t.guest}</p>
                <div className="flex items-center gap-2 text-slate-400 text-[11px] mt-0.5">
                  <span className="text-rose-300 font-medium">{t.vehicle}</span>
                  <span>·</span>
                  <span>{t.pickup}</span>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex-shrink-0">
                {t.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Quick CTAs */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <Link href="/booking-portal" className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 font-semibold">
            + Book VIP Chauffeur
          </Link>
          <Link href="/dispatch" className="px-2.5 py-1 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white font-medium">
            Live Chauffeur Radar
          </Link>
        </div>
        <Link href="/booking-portal" className="text-rose-400 hover:text-rose-300 font-medium">
          Open Booking Portal →
        </Link>
      </div>
    </div>
  );
}
