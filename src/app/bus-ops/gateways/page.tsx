'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Bluetooth, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

interface Gateway {
  id: string;
  vehicleId: string;
  gatewayId: string;
  model: string | null;
  rssiThresholdDbm: number | null;
  presenceGraceSeconds: number | null;
  isActive: boolean | null;
  lastSeenAt: string | null;
  lastEventAt: string | null;
  notes: string | null;
  health: 'ONLINE' | 'OFFLINE' | 'DISABLED' | 'NEVER_SEEN';
  lastSeenSecondsAgo: number | null;
  lastEventSecondsAgo: number | null;
}

const HEALTH_PILL: Record<string, string> = {
  ONLINE:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  OFFLINE:    'bg-rose-500/20 text-rose-300 border-rose-500/40',
  DISABLED:   'bg-slate-500/20 text-slate-400 border-slate-500/40',
  NEVER_SEEN: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
};

function fmtSecondsAgo(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function GatewaysAdminPage() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bus-ops/gateways');
      const data = res.ok ? await res.json() : { gateways: [], sharedSecretConfigured: false };
      setGateways(data.gateways ?? []);
      setSecretConfigured(data.sharedSecretConfigured ?? false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const onlineCount = gateways.filter(g => g.health === 'ONLINE').length;
  const offlineCount = gateways.filter(g => g.health === 'OFFLINE').length;

  if (loading && gateways.length === 0) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading gateways...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="BLE Gateways"
        subtitle={`${gateways.length} registered · ${onlineCount} online · ${offlineCount} offline · ${gateways.filter(g => g.health === 'DISABLED').length} disabled · auto-refreshes every 30s`}
        icon={Bluetooth}
        accent="violet"
        actions={
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      {!secretConfigured && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
          ⚠ <code>BLE_GATEWAY_SHARED_SECRET</code> is not set on this environment. Gateway ingest will reject all requests until you configure it.
        </div>
      )}

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {gateways.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            No gateways registered yet. Use{' '}
            <code className="text-slate-300">PUT /api/bus-ops/vehicles/{'{id}'}/gateway</code>{' '}
            with{' '}
            <code className="text-slate-300">{'{ gatewayId, model? }'}</code>{' '}
            to register a device.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Gateway ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Vehicle</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Model</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">RSSI / Grace</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Last heartbeat</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Last event</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Health</th>
              </tr>
            </thead>
            <tbody>
              {gateways.map(g => (
                <tr key={g.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-white">{g.gatewayId}</td>
                  <td className="px-4 py-3 text-sm font-mono text-white">{g.vehicleId.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-white">{g.model ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-white">
                    {g.rssiThresholdDbm} dBm · {g.presenceGraceSeconds}s
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{fmtSecondsAgo(g.lastSeenSecondsAgo)}</td>
                  <td className="px-4 py-3 text-sm text-white">{fmtSecondsAgo(g.lastEventSecondsAgo)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${HEALTH_PILL[g.health]}`}>
                      {g.health}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-5 text-xs text-slate-400 space-y-2">
        <h3 className="text-white font-semibold">Integration contract</h3>
        <p>POST <code className="text-slate-300">/api/bus-ops/gateway/events</code> with:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Header <code className="text-slate-300">x-gateway-signature</code> = HMAC-SHA256 hex of raw body using <code>BLE_GATEWAY_SHARED_SECRET</code></li>
          <li>Body shape A (preferred): <code className="text-slate-300">{'{ gatewayId, events:[{kind:BOARD|ALIGHT, tagId, occurredAt, rssiDbm?}] }'}</code></li>
          <li>Body shape B (fallback): <code className="text-slate-300">{'{ gatewayId, scanWindow:{startedAt, endedAt, observations:[...]} }'}</code> — server runs hysteresis</li>
          <li>Idempotent on (scheduleId, passengerId, occurredAt ±5s, direction)</li>
          <li>Active trip auto-resolved as the SCHEDULED|DEPARTED|IN_TRANSIT trip on the gateway's vehicle within ±2h</li>
        </ul>
      </div>
    </div>
  );
}

