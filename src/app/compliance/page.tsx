'use client';

import React, { useState, useEffect } from 'react';

interface ComplianceSummary {
  compliantCount: number;
  expiringCount: number;
  expiredCount: number;
}

interface CriticalExpiration {
  id: string;
  entityType: string;
  entityId: string;
  docType: string;
  expiryDate: string;
  daysRemaining: number;
}

export default function ComplianceDashboard() {
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [criticalExpirations, setCriticalExpirations] = useState<CriticalExpiration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/compliance/dashboard');
        if (res.ok) {
          const data = await res.json();
          setSummary(data.summary);
          setCriticalExpirations(data.criticalExpirations || []);
        }
      } catch (error) {
        console.error('Error fetching compliance data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getUrgencyColor = (daysRemaining: number) => {
    if (daysRemaining < 7) return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    if (daysRemaining < 30) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Compliance Dashboard</h1>
        <p className="text-slate-400">Monitor regulatory compliance and document expiration status</p>
      </div>

      {/* Traffic Light Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center">
          <p className="text-slate-400 text-sm font-medium mb-2">Compliant</p>
          <p className="text-5xl font-bold text-emerald-400">{summary?.compliantCount || 0}</p>
          <p className="text-slate-500 text-xs mt-2">Documents/Vehicles</p>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center">
          <p className="text-slate-400 text-sm font-medium mb-2">Expiring Soon</p>
          <p className="text-5xl font-bold text-amber-400">{summary?.expiringCount || 0}</p>
          <p className="text-slate-500 text-xs mt-2">Within 30 days</p>
        </div>

        <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center">
          <p className="text-slate-400 text-sm font-medium mb-2">Expired</p>
          <p className="text-5xl font-bold text-rose-400">{summary?.expiredCount || 0}</p>
          <p className="text-slate-500 text-xs mt-2">Immediate action required</p>
        </div>
      </div>

      {/* Critical Expirations */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white">Critical Expirations (Next 10)</h2>
        <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800/50 border-b border-white/5">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Entity Type</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Entity ID</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Document Type</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Expiry Date</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Days Remaining</th>
              </tr>
            </thead>
            <tbody>
              {criticalExpirations.length > 0 ? (
                criticalExpirations.slice(0, 10).map((item) => (
                  <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-6 py-4 text-sm text-white font-medium">{item.entityType}</td>
                    <td className="px-6 py-4 text-sm text-white">{item.entityId}</td>
                    <td className="px-6 py-4 text-sm text-white">{item.docType}</td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {new Date(item.expiryDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getUrgencyColor(item.daysRemaining)}`}>
                        {item.daysRemaining} days
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-200">
                    No critical expirations
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
