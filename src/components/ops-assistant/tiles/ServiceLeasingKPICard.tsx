'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface LeasingStats {
  activeLeases: number;
  renewalsNext30d: number;
  monthlyLeaseRunRate: number;
  onTimePaymentRate: number;
  avgContractTenure: string;
  contracts: Array<{ client: string; units: number; monthlyBill: number; renewal: string }>;
}

export default function ServiceLeasingKPICard() {
  const [stats, setStats] = useState<LeasingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (!cancelled) {
          setStats({
            activeLeases: 412,
            renewalsNext30d: 18,
            monthlyLeaseRunRate: 642000,
            onTimePaymentRate: 97.8,
            avgContractTenure: '24 Months',
            contracts: [
              { client: 'Al Habtoor Contracting LLC', units: 48, monthlyBill: 84000, renewal: 'In 14 Days' },
              { client: 'Emirates Global Aluminum', units: 32, monthlyBill: 58000, renewal: 'In 28 Days' },
              { client: 'Dubai Silicon Oasis Corp', units: 20, monthlyBill: 36000, renewal: 'In 45 Days' },
            ],
          });
        }
      } catch (err) {
        console.error('Failed to load Leasing KPI stats:', err);
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
            <span className="text-xl">📄</span>
            <h3 className="text-base font-bold text-white tracking-tight">Corporate Long-Term Leasing</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
              B2B CONTRACTS
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Master lease agreements, automated monthly billing schedules & contract renewals
          </p>
        </div>
        <Link
          href="/leasing"
          className="px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>Leasing Hub</span>
          <span>→</span>
        </Link>
      </div>

      {/* 4 KPI Metric Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-purple-400">{s.activeLeases}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Active Leases</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">AED {Math.round(s.monthlyLeaseRunRate / 1000)}k</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Monthly Billing</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-amber-400">{s.renewalsNext30d}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Renewals (30d)</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-cyan-400">{s.onTimePaymentRate}%</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Collection Rate</p>
        </div>
      </div>

      {/* Corporate Clients Due for Renewal */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Upcoming Contract Renewals & Key Accounts</p>
        <div className="space-y-2">
          {s.contracts.map((c, idx) => (
            <div key={idx} className="bg-slate-900/40 rounded-xl p-2.5 text-xs flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white truncate">{c.client}</p>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  {c.units} Fleet Units · Monthly: <span className="text-purple-300 font-medium">AED {c.monthlyBill.toLocaleString()}</span>
                </p>
              </div>
              <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full flex-shrink-0">
                {c.renewal}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Quick CTAs */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <Link href="/leasing" className="px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-400 border border-purple-500/30 hover:bg-purple-500/25 font-semibold">
            + New Lease Agreement
          </Link>
          <Link href="/leasing" className="px-2.5 py-1 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white font-medium">
            Vehicle Return Inspection
          </Link>
        </div>
        <Link href="/reports/revenue" className="text-purple-400 hover:text-purple-300 font-medium">
          View Leasing Revenue BI →
        </Link>
      </div>
    </div>
  );
}
