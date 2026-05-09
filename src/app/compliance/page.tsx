'use client';

import React, { useState, useEffect } from 'react';
import { Scale, CheckCircle2, Clock, AlertTriangle, ClipboardList } from 'lucide-react';
import { PageHeader, KpiCard, Panel } from '@/components/ui/page-theme';

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

  const urgencyClass = (days: number) =>
    days < 7  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    : days < 30 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Dashboard"
        subtitle="Monitor regulatory compliance and document expiration status"
        icon={Scale}
        accent="rose"
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiCard label="Compliant"     value={summary?.compliantCount ?? 0} sub="Documents / vehicles"     icon={CheckCircle2}   accent="emerald" />
            <KpiCard label="Expiring soon" value={summary?.expiringCount ?? 0}  sub="Within 30 days"           icon={Clock}          accent="amber"   />
            <KpiCard label="Expired"       value={summary?.expiredCount ?? 0}   sub="Immediate action needed"  icon={AlertTriangle}  accent="rose"    />
          </div>

          <Panel title="Critical expirations" subtitle="Next 10 documents nearing expiry" icon={ClipboardList} accent="rose">
            {criticalExpirations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider">
                      <th className="text-left py-2 font-medium">Entity</th>
                      <th className="text-left py-2 font-medium">Entity ID</th>
                      <th className="text-left py-2 font-medium">Document</th>
                      <th className="text-left py-2 font-medium">Expiry</th>
                      <th className="text-left py-2 font-medium">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {criticalExpirations.slice(0, 10).map(item => (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 text-white font-medium">{item.entityType}</td>
                        <td className="py-3 text-slate-300 font-mono text-xs">{item.entityId}</td>
                        <td className="py-3 text-slate-300">{item.docType}</td>
                        <td className="py-3 text-slate-400 text-xs">{new Date(item.expiryDate).toLocaleDateString('en-AE')}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${urgencyClass(item.daysRemaining)}`}>
                            {item.daysRemaining} days
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No critical expirations</p>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
