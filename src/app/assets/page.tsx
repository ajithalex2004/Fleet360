'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Package, DollarSign, AlertTriangle, Ban, Gem, Radio,
} from 'lucide-react';
import { PageHeader, KpiCard as ThemeKpiCard } from '@/components/ui/page-theme';

interface AssetStats {
  totalAssets: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  hvaCount: number;
  bleTagsTotal: number;
  bleTagsOffline: number;
  hvaCalibrationDue: number;
  medicalExpiring: number;
  medicalExpired: number;
  hvaInsuranceExpiring: number;
  pendingDispatches: number;
  pendingReturns: number;
  todayTransactions: number;
  gatewaysOffline: number;
  domainBreakdown: { domain: string; count: number; totalValue: number }[];
}

function Skeleton() {
  return (
    <div className="p-8 space-y-6">
      <div className="h-8 bg-slate-800 rounded w-64 animate-pulse" />
      <div className="grid grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-64 bg-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-slate-800 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}

export default function AssetsDashboard() {
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/assets/stats?tenantId=default')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => { setError('Failed to load dashboard stats'); setLoading(false); });
  }, []);

  if (loading) return <Skeleton />;
  if (error) return (
    <div className="p-8">
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-red-400">
        <p className="font-semibold">Error</p><p className="text-sm mt-1">{error}</p>
      </div>
    </div>
  );

  const s = stats!;
  const bleActive = (s.bleTagsTotal ?? 0) - (s.bleTagsOffline ?? 0);

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        title="Assets & Inventory"
        subtitle="Unified view across all domains"
        icon={Package}
        accent="cyan"
        actions={
          <span className="text-xs text-slate-500">
            {new Date().toLocaleDateString('en-AE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <ThemeKpiCard label="Total assets"      value={s.totalAssets?.toLocaleString() ?? '—'}                icon={Package}        accent="cyan"    />
        <ThemeKpiCard label="Total value AED"   value={`AED ${(s.totalValue ?? 0).toLocaleString()}`}         icon={DollarSign}     accent="amber"   />
        <ThemeKpiCard label="Low stock"         value={s.lowStockCount ?? 0}                                  icon={AlertTriangle}  accent="amber"   />
        <ThemeKpiCard label="Out of stock"      value={s.outOfStockCount ?? 0}                                icon={Ban}            accent="rose"    />
        <ThemeKpiCard label="HVA assets"        value={s.hvaCount ?? 0}                                       icon={Gem}            accent="violet"  />
        <ThemeKpiCard label="BLE tags active"   value={bleActive}                                             icon={Radio}          accent="emerald" />
      </div>

      {/* Row 2: Alert Banners */}
      <div className="space-y-3">
        {(s.hvaCalibrationDue > 0) && (
          <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
            <span className="text-orange-400 text-xl">🔬</span>
            <div>
              <span className="text-orange-300 font-semibold">Calibration Due Soon</span>
              <span className="text-orange-400 text-sm ml-2">{s.hvaCalibrationDue} HVA asset(s) require calibration within 30 days</span>
            </div>
          </div>
        )}
        {((s.medicalExpiring ?? 0) + (s.medicalExpired ?? 0) > 0) && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <span className="text-red-400 text-xl">🏥</span>
            <div>
              <span className="text-red-300 font-semibold">Medical Asset Alert</span>
              <span className="text-red-400 text-sm ml-2">
                {s.medicalExpired > 0 && `${s.medicalExpired} expired`}
                {s.medicalExpired > 0 && s.medicalExpiring > 0 && ', '}
                {s.medicalExpiring > 0 && `${s.medicalExpiring} expiring soon`}
              </span>
            </div>
          </div>
        )}
        {(s.hvaInsuranceExpiring > 0) && (
          <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <span className="text-amber-400 text-xl">🛡️</span>
            <div>
              <span className="text-amber-300 font-semibold">Insurance Expiring</span>
              <span className="text-amber-400 text-sm ml-2">{s.hvaInsuranceExpiring} HVA asset(s) have insurance expiring within 30 days</span>
            </div>
          </div>
        )}
        {s.hvaCalibrationDue === 0 && s.medicalExpiring + s.medicalExpired === 0 && s.hvaInsuranceExpiring === 0 && (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
            <span className="text-emerald-400 text-xl">✅</span>
            <span className="text-emerald-300 font-semibold">No active compliance alerts</span>
          </div>
        )}
      </div>

      {/* Row 3: Domain Breakdown + Operations Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Domain Breakdown */}
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Domain Breakdown</h2>
          {!s.domainBreakdown || s.domainBreakdown.length === 0 ? (
            <p className="text-slate-500 text-sm">No domain data available</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs uppercase border-b border-white/8">
                  <th className="text-left pb-2">Domain</th>
                  <th className="text-right pb-2">Count</th>
                  <th className="text-right pb-2">Value AED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {s.domainBreakdown.map(d => (
                  <tr key={d.domain} className="text-slate-300">
                    <td className="py-2 text-slate-200 font-medium">{d.domain}</td>
                    <td className="py-2 text-right">{d.count}</td>
                    <td className="py-2 text-right text-yellow-300">{(d.totalValue ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Operations Summary */}
        <div className="bg-slate-900 border border-white/8 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Operations Summary</h2>
          <div className="space-y-3">
            {[
              { label: 'Pending Dispatches', value: s.pendingDispatches ?? 0, icon: '🚚', color: 'text-blue-400' },
              { label: 'Pending Returns', value: s.pendingReturns ?? 0, icon: '↩️', color: 'text-amber-400' },
              { label: "Today's Transactions", value: s.todayTransactions ?? 0, icon: '📋', color: 'text-emerald-400' },
              { label: 'BLE Tags Offline', value: s.bleTagsOffline ?? 0, icon: '📡', color: 'text-red-400' },
              { label: 'Gateways Offline', value: s.gatewaysOffline ?? 0, icon: '📶', color: 'text-red-400' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                <span className={`font-bold text-lg ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/assets/registry" className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
          <span>+</span> Add Asset
        </Link>
        <Link href="/assets/dispatch" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
          <span>+</span> New Dispatch
        </Link>
        <Link href="/assets/returns" className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
          <span>+</span> Return Request
        </Link>
        <Link href="/assets/transactions" className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300 font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
          View Ledger
        </Link>
      </div>
    </div>
  );
}
