'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

interface Movement {
  id: string;
  movement_type: string;
  from_location?: string;
  to_location?: string;
  from_custodian?: string;
  to_custodian?: string;
  performed_by?: string;
  performed_at: string;
  reference_no?: string;
  notes?: string;
  asset_name?: string;
  asset_no?: string;
}

interface AssetOption {
  id: string;
  name: string;
  asset_no: string;
}

const MOVEMENT_ICONS: Record<string, string> = {
  INBOUND: '📥',
  OUTBOUND: '📤',
  TRANSFER: '🔄',
  DISPATCH: '🚚',
  RETURN: '↩️',
  CUSTODY_CHANGE: '👤',
  CALIBRATION: '🔬',
  SEAL_CHANGE: '🔒',
  LOST: '⚠️',
  FOUND: '✅',
};

const MOVEMENT_COLORS: Record<string, string> = {
  INBOUND: 'border-emerald-500 bg-emerald-500/10',
  OUTBOUND: 'border-red-500 bg-red-500/10',
  TRANSFER: 'border-blue-500 bg-blue-500/10',
  DISPATCH: 'border-purple-500 bg-purple-500/10',
  RETURN: 'border-cyan-500 bg-cyan-500/10',
  CUSTODY_CHANGE: 'border-amber-500 bg-amber-500/10',
  CALIBRATION: 'border-indigo-500 bg-indigo-500/10',
  SEAL_CHANGE: 'border-slate-500 bg-slate-500/10',
  LOST: 'border-red-500 bg-red-500/10',
  FOUND: 'border-emerald-500 bg-emerald-500/10',
};

export default function AssetTimelinePage() {
  const searchParams = useSearchParams();
  const initAssetId = searchParams.get('asset_id') ?? '';

  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AssetOption | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetch('/api/assets/registry?tenantId=default')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : d.data ?? [];
        setAssets(list);
        if (initAssetId) {
          const found = list.find((a: AssetOption) => a.id === initAssetId);
          if (found) { setSelectedAsset(found); setSearch(found.name); }
        }
        setAssetsLoading(false);
      })
      .catch(() => setAssetsLoading(false));
  }, [initAssetId]);

  const loadTimeline = useCallback(async (assetId: string) => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/assets/movements?asset_id=${assetId}&tenantId=default`);
      const d = await r.json();
      setMovements(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load timeline'); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedAsset) loadTimeline(selectedAsset.id);
  }, [selectedAsset, loadTimeline]);

  const filteredAssets = assets.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.asset_no.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 10);

  const selectAsset = (a: AssetOption) => {
    setSelectedAsset(a);
    setSearch(a.name);
    setShowDropdown(false);
  };

  return (
    <div className="p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Asset Timeline</h1>
        <p className="text-slate-400 text-sm">Full movement and event history for any asset</p>
      </div>

      {/* Asset Search */}
      <div className="relative max-w-lg">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setShowDropdown(true); if (!e.target.value) setSelectedAsset(null); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Search by asset name or number..."
          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-yellow-500/50 focus:outline-none"
        />
        {showDropdown && search && filteredAssets.length > 0 && (
          <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-slate-800 border border-white/10 rounded-xl shadow-xl overflow-hidden">
            {filteredAssets.map(a => (
              <button key={a.id} onMouseDown={() => selectAsset(a)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left border-b border-white/5 last:border-0">
                <div>
                  <p className="text-white text-sm font-medium">{a.name}</p>
                  <p className="text-slate-400 text-xs font-mono">{a.asset_no}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        {assetsLoading && <div className="absolute right-4 top-3.5 text-slate-500 text-sm animate-pulse">Loading...</div>}
      </div>

      {/* Timeline */}
      {!selectedAsset && (
        <div className="bg-slate-900 border border-white/8 rounded-xl p-12 text-center text-slate-500">
          <div className="text-5xl mb-3">🕐</div>
          <p className="font-medium">Select an asset to view its timeline</p>
          <p className="text-sm mt-1">All movements, transfers, dispatches, and events will be shown here.</p>
        </div>
      )}

      {selectedAsset && (
        <div>
          <div className="mb-4 bg-slate-900 border border-white/8 rounded-xl p-4 flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold">{selectedAsset.name}</h2>
              <p className="text-slate-400 text-xs font-mono">{selectedAsset.asset_no}</p>
            </div>
            {loading && <span className="text-slate-400 text-sm animate-pulse">Loading timeline...</span>}
            {!loading && <span className="text-slate-400 text-sm">{movements.length} events</span>}
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm mb-4">{error}</div>}

          {!loading && movements.length === 0 && (
            <div className="bg-slate-900 border border-white/8 rounded-xl p-12 text-center text-slate-500">
              <div className="text-4xl mb-2">📭</div>
              <p>No movement history found for this asset.</p>
            </div>
          )}

          {movements.length > 0 && (
            <div className="relative">
              <div className="absolute left-6 top-0 bottom-0 w-px bg-slate-700" />
              <div className="space-y-4">
                {movements.map((m, i) => {
                  const icon = MOVEMENT_ICONS[m.movement_type] ?? '📋';
                  const color = MOVEMENT_COLORS[m.movement_type] ?? 'border-slate-500 bg-slate-500/10';
                  return (
                    <div key={m.id ?? i} className="flex gap-4 ml-0 relative">
                      <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center text-xl flex-shrink-0 z-10 ${color}`}>
                        {icon}
                      </div>
                      <div className="flex-1 bg-slate-900 border border-white/8 rounded-xl p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <span className="text-white font-semibold">{m.movement_type?.replace('_', ' ')}</span>
                            {m.reference_no && <span className="ml-2 text-xs text-slate-500 font-mono">{m.reference_no}</span>}
                          </div>
                          <time className="text-slate-500 text-xs flex-shrink-0 ml-4">
                            {new Date(m.performed_at).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })}
                          </time>
                        </div>

                        {(m.from_location || m.to_location) && (
                          <div className="flex items-center gap-2 text-sm mb-1">
                            {m.from_location && <span className="text-slate-400">{m.from_location}</span>}
                            {m.from_location && m.to_location && <span className="text-slate-600">→</span>}
                            {m.to_location && <span className="text-slate-200">{m.to_location}</span>}
                          </div>
                        )}

                        {(m.from_custodian || m.to_custodian) && (
                          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                            <span>👤</span>
                            {m.from_custodian && <span>{m.from_custodian}</span>}
                            {m.from_custodian && m.to_custodian && <span>→</span>}
                            {m.to_custodian && <span className="text-slate-300">{m.to_custodian}</span>}
                          </div>
                        )}

                        {m.performed_by && (
                          <p className="text-slate-500 text-xs">By: {m.performed_by}</p>
                        )}

                        {m.notes && (
                          <p className="mt-2 text-slate-400 text-xs italic border-t border-white/5 pt-2">{m.notes}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
