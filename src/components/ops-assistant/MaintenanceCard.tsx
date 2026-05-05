'use client';
import React, { useEffect, useState } from 'react';

interface MaintenanceRequest {
  id: string; status: string; priority: string;
  description: string; dateCreated: string;
  vehicle?: { id: string; plateNumber: string };
  garage?: { name: string };
  issueSettings?: { issue: { name: string } }[];
}

interface Props { priority?: string; status?: string; title?: string; }

const priorityConfig: Record<string, { color: string; bg: string; dot: string }> = {
  Critical: { color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30',     dot: 'bg-red-400' },
  High:     { color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30', dot: 'bg-orange-400' },
  Medium:   { color: 'text-amber-400',  bg: 'bg-amber-500/15 border-amber-500/30',  dot: 'bg-amber-400' },
  Low:      { color: 'text-slate-400',  bg: 'bg-slate-500/15 border-slate-500/30',  dot: 'bg-slate-400' },
};

const statusColor: Record<string, string> = {
  Open:          'bg-blue-500/20 text-blue-400',
  In_Progress:   'bg-purple-500/20 text-purple-400',
  Pending_Parts: 'bg-amber-500/20 text-amber-400',
  Completed:     'bg-emerald-500/20 text-emerald-400',
};

export default function MaintenanceCard({ priority, status, title }: Props) {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/maintenance-requests', { cache: 'no-store' });
      let data = await res.json();
      if (!Array.isArray(data)) data = data.data ?? data.requests ?? [];
      // Client-side filter
      if (priority) data = data.filter((r: MaintenanceRequest) => r.priority?.toLowerCase() === priority.toLowerCase());
      if (status)   data = data.filter((r: MaintenanceRequest) => r.status?.toLowerCase().includes(status.toLowerCase()));
      setRequests(data.slice(0, 10));
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const criticalCount  = requests.filter(r => r.priority === 'Critical').length;
  const highCount      = requests.filter(r => r.priority === 'High').length;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 backdrop-blur-sm p-5 w-full max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔧</span>
          <h3 className="text-sm font-semibold text-white">{title ?? 'Maintenance Requests'}</h3>
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        </div>
        <button onClick={fetchData} className="text-xs text-slate-400 hover:text-white bg-slate-700/60 px-2 py-1 rounded-lg">↻</button>
      </div>

      {/* Summary pills */}
      {!loading && requests.length > 0 && (
        <div className="flex gap-2">
          <span className="text-xs bg-slate-800 border border-white/10 text-slate-300 px-3 py-1 rounded-full">{requests.length} total</span>
          {criticalCount > 0  && <span className="text-xs bg-red-500/15 border border-red-500/30 text-red-400 px-3 py-1 rounded-full">⚡ {criticalCount} Critical</span>}
          {highCount > 0      && <span className="text-xs bg-orange-500/15 border border-orange-500/30 text-orange-400 px-3 py-1 rounded-full">🔺 {highCount} High</span>}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-700/40 rounded-xl animate-pulse" />)}
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-8">
          <span className="text-2xl">✅</span>
          <p className="text-sm text-slate-400 mt-2">No maintenance requests found</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {requests.map(req => {
            const pCfg = priorityConfig[req.priority] ?? priorityConfig.Medium;
            const daysAgo = Math.floor((Date.now() - new Date(req.dateCreated).getTime()) / 86400000);
            return (
              <div key={req.id} className={`rounded-xl border p-3 ${pCfg.bg}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pCfg.dot}`} />
                    <span className="font-mono text-xs text-orange-400 flex-shrink-0">{req.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${pCfg.color}`}>{req.priority}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor[req.status] ?? 'bg-slate-700 text-slate-300'}`}>{req.status?.replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <p className="text-xs text-slate-300 mt-1.5 line-clamp-2">{req.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                  {req.vehicle && <span>🚗 {req.vehicle.plateNumber || req.vehicle.id}</span>}
                  {req.garage  && <span>🏭 {req.garage.name}</span>}
                  <span className="ml-auto">{daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-slate-600 text-right">Updated {lastUpdated.toLocaleTimeString()}</div>
    </div>
  );
}
