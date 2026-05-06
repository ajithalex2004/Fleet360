'use client';

import React, { useEffect, useState, useCallback } from 'react';

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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">BLE Gateways</h1>
          <p className="text-sm text-slate-400 mt-1">
            In-bus presence detection — auto-refreshes every 30s.
          </p>
        </div>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-slate-700 border border-white/10 text-white text-sm hover:bg-slate-600">
          Refresh
        </button>
      </div>

      {!secretConfigured && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-sm">
          ⚠ <code>BLE_GATEWAY_SHARED_SECRET</code> is not set on this environment. Gateway
          ingest will reject all requests until you configure it.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total" value={gateways.length} />
        <Stat label="Online" value={onlineCount} accent="emerald" />
        <Stat label="Offline" value={offlineCount} accent="rose" />
        <Stat label="Disabled" value={gateways.filter(g => g.health === 'DISABLED').length} accent="slate" />
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : gateways.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No gateways registered yet. Use{' '}
          <code className="text-slate-300">PUT /api/bus-ops/vehicles/{'{id}'}/gateway</code>{' '}
          with{' '}
          <code className="text-slate-300">{'{ gatewayId, model? }'}</code>{' '}
          to register a device.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Gateway ID</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">RSSI / Grace</th>
                <th className="px-4 py-3">Last heartbeat</th>
                <th className="px-4 py-3">Last event</th>
                <th className="px-4 py-3">Health</th>
              </tr>
            </thead>
            <tbody>
              {gateways.map(g => (
                <tr key={g.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-cyan-300 text-xs">{g.gatewayId}</td>
                  <td className="px-4 py-3 font-mono text-slate-300 text-xs">{g.vehicleId.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-slate-300">{g.model ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {g.rssiThresholdDbm} dBm · {g.presenceGraceSeconds}s
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {fmtSecondsAgo(g.lastSeenSecondsAgo)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    {fmtSecondsAgo(g.lastEventSecondsAgo)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] border ${HEALTH_PILL[g.health]}`}>
                      {g.health}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-5 text-xs text-slate-400 space-y-2">
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

function Stat({ label, value, accent = 'slate' }: { label: string; value: number; accent?: string }) {
  const cls: Record<string, string> = { slate: 'text-white', emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' };
  return (
    <div className="rounded-xl bg-slate-800/60 border border-white/10 p-4">
      <div className={`text-3xl font-bold ${cls[accent]}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}
