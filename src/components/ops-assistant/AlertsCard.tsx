'use client';
import React, { useEffect, useState } from 'react';

interface Alert {
  id: string; type: string; title: string; description: string;
  severity: string; status: string; dateCreated: string;
}

interface Props { severity?: string; title?: string; }

const severityConfig: Record<string, { icon: string; color: string; bg: string; ring: string }> = {
  CRITICAL: { icon: '🚨', color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/40',     ring: 'ring-red-500/30' },
  HIGH:     { icon: '⚠️', color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30', ring: 'ring-orange-500/20' },
  MEDIUM:   { icon: '⚡', color: 'text-amber-400',  bg: 'bg-amber-500/15 border-amber-500/30',  ring: 'ring-amber-500/20' },
  LOW:      { icon: 'ℹ️', color: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/20',   ring: '' },
};

const statusBadge: Record<string, string> = {
  PENDING:     'bg-amber-500/20 text-amber-400',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-400',
  RESOLVED:    'bg-emerald-500/20 text-emerald-400',
  CLOSED:      'bg-slate-500/20 text-slate-400',
};

export default function AlertsCard({ severity, title }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts', { cache: 'no-store' });
      let data = await res.json();
      if (!Array.isArray(data)) data = data.data ?? data.alerts ?? [];
      if (severity) data = data.filter((a: Alert) => a.severity?.toUpperCase() === severity.toUpperCase());
      setAlerts(data.slice(0, 12));
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAlerts(); const t = setInterval(fetchAlerts, 30000); return () => clearInterval(t); }, []);

  const critCount = alerts.filter(a => a.severity === 'CRITICAL').length;
  const highCount = alerts.filter(a => a.severity === 'HIGH').length;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 backdrop-blur-sm p-5 w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <h3 className="text-sm font-semibold text-white">{title ?? 'System Alerts'}</h3>
          {critCount > 0 && <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />}
        </div>
        <button onClick={fetchAlerts} className="text-xs text-slate-400 hover:text-white bg-slate-700/60 px-2 py-1 rounded-lg">↻</button>
      </div>

      {!loading && alerts.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs bg-slate-800 border border-white/10 text-slate-300 px-2.5 py-1 rounded-full">{alerts.length} alerts</span>
          {critCount > 0 && <span className="text-xs bg-red-500/15 border border-red-500/30 text-red-400 px-2.5 py-1 rounded-full">🚨 {critCount} Critical</span>}
          {highCount > 0 && <span className="text-xs bg-orange-500/15 border border-orange-500/30 text-orange-400 px-2.5 py-1 rounded-full">⚠️ {highCount} High</span>}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-700/40 rounded-xl animate-pulse" />)}</div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-8">
          <span className="text-2xl">✅</span>
          <p className="text-sm text-slate-400 mt-2">No active alerts — all clear!</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {alerts.map(alert => {
            const cfg = severityConfig[alert.severity?.toUpperCase()] ?? severityConfig.LOW;
            const time = new Date(alert.dateCreated);
            return (
              <div key={alert.id} className={`rounded-xl border p-3 ${cfg.bg}`}>
                <div className="flex items-start gap-2">
                  <span className="text-base flex-shrink-0 mt-0.5">{cfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold ${cfg.color} truncate`}>{alert.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${statusBadge[alert.status] ?? 'bg-slate-700 text-slate-300'}`}>{alert.status}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{alert.description}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-600">
                      <span>{alert.type?.replace(/_/g, ' ')}</span>
                      <span className="ml-auto">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="text-xs text-slate-600 text-right">Live · Updated {lastUpdated.toLocaleTimeString()}</div>
    </div>
  );
}
