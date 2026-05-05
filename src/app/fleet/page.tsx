'use client';

import React, { useState, useEffect } from 'react';

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

export default function FleetDashboard() {
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [expiringDocs, setExpiringDocs] = useState<DocumentExpiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');
        const [statsRes, docsRes] = await Promise.all([
          fetch('/api/fleet/stats'),
          fetch('/api/fleet/documents/expiring?days=30&limit=5'),
        ]);
        if (!statsRes.ok) throw new Error('Failed to fetch stats');
        if (!docsRes.ok) throw new Error('Failed to fetch documents');
        const [statsData, docsData] = await Promise.all([statsRes.json(), docsRes.json()]);
        setStats(statsData);
        setExpiringDocs(docsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-orange-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-medium">Error loading dashboard</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Fleet Dashboard</h1>
        <p className="text-slate-400">Overview of your fleet operations</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">Total Fleet Size</p>
              <p className="text-3xl font-bold text-white">{stats?.totalVehicles || 0}</p>
            </div>
            <div className="text-4xl">🚗</div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">Active Vehicles</p>
              <p className="text-3xl font-bold text-emerald-400">{stats?.available || 0}</p>
            </div>
            <div className="text-4xl">✓</div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">In Maintenance</p>
              <p className="text-3xl font-bold text-amber-400">{stats?.inMaintenance || 0}</p>
            </div>
            <div className="text-4xl">🔧</div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">Expiring Docs (30d)</p>
              <p className="text-3xl font-bold text-red-400">{stats?.expiringDocs || 0}</p>
            </div>
            <div className="text-4xl">⚠️</div>
          </div>
        </div>
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
