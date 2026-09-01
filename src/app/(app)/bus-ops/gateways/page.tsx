'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Bluetooth, RefreshCw, Key, Copy, Check, X } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

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
  secretRotatedAt?: string | null;
}

interface RotateResult {
  gatewayId: string;
  secret: string;
  rotatedAt: string;
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
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotateResult, setRotateResult] = useState<RotateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const rotate = async (id: string, gatewayId: string) => {
    if (!confirm(
      `Rotate secret for gateway ${gatewayId}?\n\n` +
      `The current secret will stop working immediately. ` +
      `You must copy the new secret and paste it into the gateway hardware config.`,
    )) return;
    setRotating(id); setRotateResult(null);
    try {
      const res = await fetch(`/api/bus-ops/gateways/${id}/rotate-secret`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as RotateResult;
      setRotateResult(data);
      setCopied(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Rotate failed');
    } finally { setRotating(null); }
  };

  const copySecret = async () => {
    if (!rotateResult) return;
    try {
      await navigator.clipboard.writeText(rotateResult.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied — user reads the field manually */ }
  };

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

  const gatewayColumns: DataGridColumn<Gateway>[] = [
    { key: 'gatewayId', header: 'Gateway ID', accessor: g => g.gatewayId,
      render: g => <span className="font-mono text-white">{g.gatewayId}</span> },
    { key: 'vehicleId', header: 'Vehicle', accessor: g => g.vehicleId,
      render: g => <span className="font-mono text-white">{g.vehicleId.slice(0, 8)}</span> },
    { key: 'model', header: 'Model', accessor: g => g.model },
    { key: 'rssi', header: 'RSSI / Grace', accessor: g => g.rssiThresholdDbm, filter: false,
      render: g => <span className="text-white">{g.rssiThresholdDbm} dBm · {g.presenceGraceSeconds}s</span> },
    { key: 'lastSeen', header: 'Last heartbeat', accessor: g => g.lastSeenSecondsAgo,
      render: g => <span className="text-white">{fmtSecondsAgo(g.lastSeenSecondsAgo)}</span> },
    { key: 'lastEvent', header: 'Last event', accessor: g => g.lastEventSecondsAgo,
      render: g => <span className="text-white">{fmtSecondsAgo(g.lastEventSecondsAgo)}</span> },
    { key: 'health', header: 'Health', accessor: g => g.health, filter: 'select',
      render: g => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${HEALTH_PILL[g.health]}`}>
          {g.health}
        </span>
      ) },
    { key: 'secret', header: 'Secret', filter: false,
      render: g => g.secretRotatedAt
        ? <span className="text-emerald-300 text-xs">rotated {new Date(g.secretRotatedAt).toLocaleDateString('en-AE')}</span>
        : <span className="text-amber-300 text-xs">using env fallback</span> },
    { key: 'actions', header: 'Actions', align: 'right', filter: false, sortable: false,
      render: g => (
        <button onClick={() => rotate(g.id, g.gatewayId)} disabled={rotating === g.id}
          title="Rotate HMAC secret"
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
          <Key className="w-3 h-3" />
          {rotating === g.id ? 'Rotating…' : 'Rotate'}
        </button>
      ) },
  ];

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

      <FleetDataGrid
        gridName="Gateways"
        rows={gateways}
        getRowId={g => g.id}
        loading={false}
        emptyMessage="No gateways registered yet. Use PUT /api/bus-ops/vehicles/{id}/gateway with { gatewayId, model? } to register a device."
        columns={gatewayColumns}
        numbered
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbar={{
          exportName: 'gateways',
          title: 'BLE Gateways',
          actions: selectedIds.size > 0 ? (
            <span className="inline-flex items-center gap-2 text-xs text-violet-300">
              {selectedIds.size} selected
              <button type="button" onClick={() => setSelectedIds(new Set())}
                className="text-slate-400 hover:text-white underline underline-offset-2">
                Clear
              </button>
            </span>
          ) : undefined,
        }}
      />

      {/* One-time reveal modal for rotate result */}
      {rotateResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-800/95 border border-violet-500/40 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-violet-300" />
                New secret for {rotateResult.gatewayId}
              </h2>
              <button onClick={() => setRotateResult(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-200 text-xs mb-4">
              ⚠ This secret is shown ONCE. Copy it now — closing this dialog
              means re-running rotation to get a new value. The old secret
              stopped working the moment this rotation ran.
            </div>
            <div className="mb-4">
              <label className="block text-xs text-slate-400 mb-1">HMAC secret</label>
              <div className="flex gap-2">
                <input readOnly value={rotateResult.secret}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-white font-mono text-xs" />
                <button onClick={copySecret}
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-500/20 border border-violet-500/40 px-3 py-2 text-xs text-violet-200 hover:bg-violet-500/30 whitespace-nowrap">
                  {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
              </div>
            </div>
            <div className="text-[11px] text-slate-500">
              Rotated at {new Date(rotateResult.rotatedAt).toLocaleString('en-AE')}. Paste into
              your gateway's <code>BLE_HMAC_SECRET</code> config and restart it.
            </div>
            <div className="flex justify-end pt-4">
              <button onClick={() => setRotateResult(null)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 text-sm">
                Done (I've copied the secret)
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-5 text-xs text-slate-400 space-y-2">
        <h3 className="text-white font-semibold">Integration contract</h3>
        <p>POST <code className="text-slate-300">/api/bus-ops/gateway/events</code> with:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Header <code className="text-slate-300">x-gateway-signature</code> = HMAC-SHA256 hex of raw body using <code>BLE_GATEWAY_SHARED_SECRET</code></li>
          <li>Body shape A (preferred): <code className="text-slate-300">{'{ gatewayId, events:[{kind:BOARD|ALIGHT, tagId, occurredAt, rssiDbm?}] }'}</code></li>
          <li>Body shape B (fallback): <code className="text-slate-300">{'{ gatewayId, scanWindow:{startedAt, endedAt, observations:[...]} }'}</code> — server runs hysteresis</li>
          <li>Idempotent on (scheduleId, passengerId, occurredAt ±5s, direction)</li>
          <li>Active trip auto-resolved as the SCHEDULED|STARTED|EN_ROUTE trip on the gateway's vehicle within ±2h</li>
        </ul>
      </div>
    </div>
  );
}

