'use client';

import React, { useState, useEffect } from 'react';
import { Car, Building2, AlertTriangle, CheckCircle2, ShieldAlert, Sparkles, RefreshCw } from 'lucide-react';
import { CategoryStock, AvailabilityResponse, STANDARD_DEPOTS } from '@/lib/fleet/availability-types';

interface AssetAvailabilitySelectorProps {
  serviceType: string;
  startDate?: string;
  pickupTime?: string;
  value: string;
  onChange: (category: string, meta?: { sampleModels?: string; depotId?: string }) => void;
  required?: boolean;
}

export function AssetAvailabilitySelector({
  serviceType,
  startDate,
  pickupTime,
  value,
  onChange,
  required = true,
}: AssetAvailabilitySelectorProps) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDepot, setSelectedDepot] = useState<string>('DXB_HUB');

  const fetchAvailability = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('serviceType', serviceType);
      if (startDate) params.set('startDate', startDate);
      if (pickupTime) params.set('pickupTime', pickupTime);

      const res = await fetch(`/api/fleet/availability?${params.toString()}`);
      if (res.ok) {
        const json: AvailabilityResponse = await res.json();
        setData(json);
        // If current value is empty and categories exist, auto-select first available
        if (!value && json.categories.length > 0) {
          const firstAvail = json.categories.find(c => c.isAvailable) || json.categories[0];
          onChange(firstAvail.category, { sampleModels: firstAvail.sampleModels, depotId: selectedDepot });
        }
      }
    } catch (err) {
      console.error('Failed to fetch availability:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailability();
  }, [serviceType, startDate, pickupTime]);

  const handleSelectCategory = (cat: CategoryStock) => {
    if (!cat.isAvailable) return;
    onChange(cat.category, { sampleModels: cat.sampleModels, depotId: selectedDepot });
  };

  const handleDepotChange = (depotId: string) => {
    setSelectedDepot(depotId);
    if (value && data) {
      const cat = data.categories.find(c => c.category === value);
      onChange(value, { sampleModels: cat?.sampleModels, depotId });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Station Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-3.5 shadow-xl">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
            Dispatch Depot / Station:
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedDepot}
            onChange={(e) => handleDepotChange(e.target.value)}
            className="bg-slate-950/80 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40"
          >
            {STANDARD_DEPOTS.map((d) => (
              <option key={d.id} value={d.id}>
                📍 {d.name} ({d.city})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={fetchAvailability}
            title="Refresh availability"
            className="p-1.5 text-cyan-400 hover:text-white border border-white/10 rounded-xl hover:bg-cyan-500/10 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Lead-Time Warning Alert */}
      {data?.leadTimeViolated && (
        <div className="bg-amber-500/15 border border-amber-500/40 rounded-2xl p-3.5 flex items-start gap-3 text-amber-300 text-xs leading-relaxed animate-pulse">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Lead-Time Notice: </span>
            {data.leadTimeWarning ||
              `This service requires at least ${data.leadTimeHoursRequired} hours advance notice.`}
          </div>
        </div>
      )}

      {/* Interactive Category Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(data?.categories || []).map((cat) => {
          const isSelected = value === cat.category;
          const depotStock = cat.depots[selectedDepot] ?? cat.availableCount;

          return (
            <button
              key={cat.category}
              type="button"
              onClick={() => handleSelectCategory(cat)}
              disabled={!cat.isAvailable}
              className={`p-4 rounded-2xl border text-left transition-all relative overflow-hidden flex flex-col justify-between ${
                isSelected
                  ? 'bg-cyan-500/15 border-cyan-400 shadow-xl shadow-cyan-500/20 ring-1 ring-cyan-400/50 scale-[1.01]'
                  : cat.isAvailable
                  ? 'bg-slate-900/60 backdrop-blur-xl border-white/10 hover:border-cyan-400/50 hover:bg-slate-900/90'
                  : 'bg-slate-950/40 border-white/5 opacity-40 cursor-not-allowed'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-sm font-bold text-white">
                    {cat.category}
                  </span>

                  {/* Live Stock Badge */}
                  {cat.availableCount === 0 ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                      Sold Out
                    </span>
                  ) : cat.lowStock ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                      Only {cat.availableCount} left
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {cat.availableCount} available
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 line-clamp-1 mb-2">
                  {cat.sampleModels}
                </p>
              </div>

              {/* Depot Station Inventory Footnote */}
              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
                <span>At selected depot:</span>
                <span className={`font-mono font-bold ${depotStock > 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                  {depotStock} in station
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
