'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { CarFront, CheckCircle2, Wrench, AlertTriangle, Gauge, ArrowRight } from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/ui/page-theme';
import { useFetchedData, invalidate, invalidatePrefix } from '@/hooks/useFetchedData';
import type { MaintenanceRiskScore } from '@/types/maintenance';

interface FleetStats {
  totalVehicles: number;
  available: number;
  inMaintenance: number;
  expiringDocs: number;
}

interface DocumentExpiry {
  id: string;
  vehicle: string;
  licensePlate: string;
  docType: string;
  expiryDate: string;
  daysRemaining: number;
}

const EMPTY_STATS: FleetStats = {
  totalVehicles: 0,
  available: 0,
  inMaintenance: 0,
  expiringDocs: 0,
};

interface RiskApiResponse { scores: MaintenanceRiskScore[] }

export default function FleetDashboard() {
  // Session-scoped fetch cache — 1st visit hits the cached server endpoint
  // (unstable_cache + private s-maxage), 2nd visit in the same tab is
  // instant from the in-memory Map. `refresh` busts the session cache
  // after a write (e.g. adding a vehicle, marking a document renewed).
  const { data: statsRaw, loading: statsLoading, error: statsError,
          refresh: refreshStats } =
    useFetchedData<FleetStats>('/api/fleet/stats');
  const { data: docsRaw,   loading: docsLoading,  error: docsError,
          refresh: refreshDocs } =
    useFetchedData<DocumentExpiry[]>('/api/fleet/documents/expiring?days=30&limit=5');
  const { data: riskRaw, loading: riskLoading } =
    useFetchedData<RiskApiResponse>('/api/maintenance/risk-scores');

  const stats: FleetStats = statsRaw ?? EMPTY_STATS;
  const expiringDocs: DocumentExpiry[] = Array.isArray(docsRaw) ? docsRaw : [];
  const top5Risk: MaintenanceRiskScore[] = (riskRaw?.scores ?? []).slice(0, 5);
  const loading = statsLoading || docsLoading;

  // Combine per-endpoint errors into one banner; keep the page rendering
  // with the safe fallback values if either endpoint failed.
  const error = [statsError, docsError].filter(Boolean).length
    ? 'Fleet dashboard data is temporarily unavailable. Showing safe fallback values.'
    : '';

  // Expose a manual refresh trigger so other parts of the app (e.g. the
  // Hub workspace tabs) can call window.fleet360.refreshFleet() after
  // a write. Keeping the surface tiny avoids leaking the full hook.
  useEffect(() => {
    const w = window as unknown as { fleet360?: Record<string, () => void> };
    w.fleet360 = w.fleet360 ?? {};
    w.fleet360.refreshFleet = () => { refreshStats(); refreshDocs(); };
    return () => { delete w.fleet360?.refreshFleet; };
  }, [refreshStats, refreshDocs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-orange-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Dashboard"
        subtitle="Overview of your fleet operations"
        icon={CarFront}
        accent="amber"
      />

      {error && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KpiCard label="Total fleet size" value={stats.totalVehicles}  icon={CarFront}      accent="default" />
        <KpiCard label="Active vehicles"  value={stats.available}      icon={CheckCircle2}  accent="emerald" />
        <KpiCard label="In maintenance"   value={stats.inMaintenance}  icon={Wrench}        accent="amber"   />
        <KpiCard label="Expiring docs (30d)" value={stats.expiringDocs} icon={AlertTriangle} accent={stats.expiringDocs > 0 ? 'rose' : 'slate'} />
      </div>

      {/* Fleet Health Summary */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white mb-6">Fleet Health Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm">Vehicle Availability</p>
              <span className="text-white font-medium">92%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-gradient-to-r from-emerald-500 to-green-500 h-2 rounded-full" style={{ width: '92%' }}></div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm">Maintenance Status</p>
              <span className="text-white font-medium">88%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full" style={{ width: '88%' }}></div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm">Compliance Status</p>
              <span className="text-white font-medium">85%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 h-2 rounded-full" style={{ width: '85%' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Heat — top 5 highest-risk vehicles */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Gauge className="w-5 h-5 text-orange-400" />
              Risk Heat
            </h2>
            <p className="text-slate-400 text-sm mt-0.5">Top 5 highest-risk vehicles — maintenance score 0–100</p>
          </div>
          <Link
            href="/maintenance/risk"
            className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {riskLoading ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-slate-600 border-t-orange-500 rounded-full animate-spin" />
          </div>
        ) : top5Risk.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-6">No vehicle risk data available</p>
        ) : (
          <div className="space-y-2">
            {top5Risk.map((rs, i) => {
              const barColor =
                rs.band === 'CRITICAL' ? 'bg-red-500' :
                rs.band === 'HIGH'     ? 'bg-orange-500' :
                rs.band === 'MEDIUM'   ? 'bg-amber-400' :
                'bg-emerald-500';
              return (
                <div key={rs.vehicleId} className="flex items-center gap-3">
                  <span className="text-slate-600 text-xs w-4 text-right">{i + 1}</span>
                  <span className="text-white text-sm font-medium w-24 truncate">
                    {rs.vehicleCode}
                  </span>
                  <div className="flex-1 bg-slate-700 rounded-full h-2">
                    <div
                      className={`${barColor} h-2 rounded-full transition-all`}
                      style={{ width: `${rs.score}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-white w-12 text-right">
                    {rs.emoji} {rs.score}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Document Expiry Alert Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">Document Expiry Alert</h2>
          <p className="text-slate-400 text-sm mt-1">Top 5 upcoming expirations in the next 30 days</p>
        </div>

        {expiringDocs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-slate-400">No expiring documents in the next 30 days</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Vehicle</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">License Plate</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Document Type</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Expiry Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-400">Days Remaining</th>
                </tr>
              </thead>
              <tbody>
                {expiringDocs.map((doc) => (
                  <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-sm text-white">{doc.vehicle}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{doc.licensePlate}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">{doc.docType}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {new Date(doc.expiryDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          doc.daysRemaining < 7
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : doc.daysRemaining < 14
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {doc.daysRemaining} days
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
