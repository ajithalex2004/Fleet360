'use client';

import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Plus,
  Trash2,
  ArrowUpDown,
  Sparkles,
  Route,
  Clock,
  DollarSign,
  ShieldCheck,
  Leaf,
  Layers,
  ChevronRight,
  Warehouse,
} from 'lucide-react';
import {
  WaypointNode,
  RouteOptimizationResult,
  computeMultiStopRoute,
  UAE_KEY_HUBS,
} from '@/lib/multi-stop-routing';

interface MultiStopRoutePickerProps {
  initialOrigin?: string;
  initialDestination?: string;
  baseFareAed?: number;
  onRouteChange: (result: RouteOptimizationResult) => void;
}

export function MultiStopRoutePicker({
  initialOrigin = 'Jebel Ali (JAFZA) Logistics Base Gate 4',
  initialDestination = 'Abu Dhabi Kizad Logistics Hub Dock 2',
  baseFareAed = 550,
  onRouteChange,
}: MultiStopRoutePickerProps) {
  const [originNode, setOriginNode] = useState<WaypointNode>({
    id: 'node-origin',
    sequence: 1,
    type: 'PICKUP',
    address: initialOrigin,
    lat: UAE_KEY_HUBS.jafza.lat,
    lng: UAE_KEY_HUBS.jafza.lng,
    dockGate: 'Gate 4 - Dock A',
    pallets: 4,
    weightTons: 2.5,
    contactPerson: 'Warehouse Dock Supervisor',
    contactPhone: '+971 50 111 2233',
  });

  const [intermediateNodes, setIntermediateNodes] = useState<WaypointNode[]>([
    {
      id: 'node-stop-1',
      sequence: 2,
      type: 'DROPOFF',
      address: 'Dubai Mall Service Loading Dock 3, Downtown',
      lat: UAE_KEY_HUBS.dubai_mall.lat,
      lng: UAE_KEY_HUBS.dubai_mall.lng,
      dockGate: 'Dock 3B',
      pallets: 2,
      weightTons: 1.2,
      contactPerson: 'Retail Receiving Dock',
      contactPhone: '+971 50 222 3344',
    },
    {
      id: 'node-stop-2',
      sequence: 3,
      type: 'DROPOFF',
      address: 'Mall of the Emirates Delivery Bay 1',
      lat: UAE_KEY_HUBS.moe.lat,
      lng: UAE_KEY_HUBS.moe.lng,
      dockGate: 'Bay 1',
      pallets: 1,
      weightTons: 0.6,
      contactPerson: 'Central Receiving',
      contactPhone: '+971 50 333 4455',
    },
  ]);

  const [destinationNode, setDestinationNode] = useState<WaypointNode>({
    id: 'node-destination',
    sequence: 4,
    type: 'DROPOFF',
    address: initialDestination,
    lat: UAE_KEY_HUBS.abu_dhabi_kizad.lat,
    lng: UAE_KEY_HUBS.abu_dhabi_kizad.lng,
    dockGate: 'Kizad Main Dock 2',
    pallets: 1,
    weightTons: 0.7,
    contactPerson: 'Abu Dhabi Receiving Manager',
    contactPhone: '+971 50 444 5566',
  });

  const [routeResult, setRouteResult] = useState<RouteOptimizationResult | null>(null);
  const [enableLtlConsolidation, setEnableLtlConsolidation] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Recalculate route whenever waypoints change
  const recalculate = () => {
    const res = computeMultiStopRoute(originNode, intermediateNodes, destinationNode, baseFareAed);
    setRouteResult(res);
    onRouteChange(res);
  };

  useEffect(() => {
    recalculate();
  }, [originNode, intermediateNodes, destinationNode, baseFareAed]);

  // Add intermediate stop
  const handleAddStop = () => {
    const newStop: WaypointNode = {
      id: `node-stop-${Date.now()}`,
      sequence: intermediateNodes.length + 2,
      type: 'DROPOFF',
      address: 'Dubai Silicon Oasis (DSO) Central Depot Gate 1',
      lat: UAE_KEY_HUBS.dso.lat,
      lng: UAE_KEY_HUBS.dso.lng,
      dockGate: 'Gate 1',
      pallets: 1,
      weightTons: 0.5,
      contactPerson: 'DSO Warehouse Ops',
      contactPhone: '+971 50 555 6677',
    };
    setIntermediateNodes([...intermediateNodes, newStop]);
  };

  // Remove intermediate stop
  const handleRemoveStop = (id: string) => {
    setIntermediateNodes(intermediateNodes.filter((n) => n.id !== id));
  };

  // 1-Click TSP Sequence Optimization
  const handleOptimizeSequence = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      recalculate();
      setIsOptimizing(false);
    }, 400);
  };

  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-orange-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Multi-Stop Waypoints & LTL Route Optimizer
          </span>
        </div>
        <button
          type="button"
          onClick={handleOptimizeSequence}
          disabled={isOptimizing}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30 text-[11px] font-semibold transition-colors"
        >
          <Sparkles className="w-3 h-3 text-orange-400" />
          {isOptimizing ? 'Optimizing Order…' : 'Optimize Stop Sequence (TSP)'}
        </button>
      </div>

      {/* Waypoints Sequence List */}
      <div className="space-y-3">
        {/* 1. Origin Pickup */}
        <div className="bg-slate-950/60 border border-emerald-500/30 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-400 flex items-center gap-1.5">
              🟢 Stop 1 · Origin Pickup
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Gate: {originNode.dockGate} · {originNode.pallets} Pallets ({originNode.weightTons}T)
            </span>
          </div>
          <input
            type="text"
            value={originNode.address}
            onChange={(e) => setOriginNode({ ...originNode, address: e.target.value })}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
          />
        </div>

        {/* 2. Intermediate Waypoints */}
        {intermediateNodes.map((stop, idx) => (
          <div
            key={stop.id}
            className="bg-slate-950/40 border border-white/10 rounded-xl p-3.5 space-y-2 ml-3 border-l-2 border-l-orange-500"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-orange-300 flex items-center gap-1.5">
                📍 Stop {idx + 2} · Intermediate Dropoff
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400 font-mono">
                  {stop.pallets} Pallets ({stop.weightTons}T)
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveStop(stop.id)}
                  className="text-slate-500 hover:text-rose-400 text-xs"
                  title="Remove Stop"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <input
              type="text"
              value={stop.address}
              onChange={(e) => {
                const next = [...intermediateNodes];
                next[idx].address = e.target.value;
                setIntermediateNodes(next);
              }}
              className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
            />
          </div>
        ))}

        {/* Add Stop Button */}
        <button
          type="button"
          onClick={handleAddStop}
          className="w-full py-2 border border-dashed border-white/20 hover:border-orange-500/50 rounded-xl text-xs text-slate-300 hover:text-orange-400 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> + Add Intermediate Warehouse / Dock Stop
        </button>

        {/* 3. Final Destination Dropoff */}
        <div className="bg-slate-950/60 border border-blue-500/30 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-blue-400 flex items-center gap-1.5">
              🏁 Final Stop · Destination Dropoff
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Gate: {destinationNode.dockGate} · {destinationNode.pallets} Pallets
            </span>
          </div>
          <input
            type="text"
            value={destinationNode.address}
            onChange={(e) => setDestinationNode({ ...destinationNode, address: e.target.value })}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
          />
        </div>
      </div>

      {/* Multi-Leg Trip Metrics */}
      {routeResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/10 text-xs">
          <div className="bg-slate-950 p-2.5 rounded-xl text-center">
            <span className="text-[10px] text-slate-500 uppercase block">Total Route Distance</span>
            <span className="font-mono font-bold text-white text-sm">{routeResult.totalDistanceKm} km</span>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-xl text-center">
            <span className="text-[10px] text-slate-500 uppercase block">Total Driving Time</span>
            <span className="font-mono font-bold text-white text-sm">{routeResult.totalDurationMins} mins</span>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-xl text-center">
            <span className="text-[10px] text-slate-500 uppercase block">Total Salik Tolls</span>
            <span className="font-mono font-bold text-amber-400 text-sm">AED {routeResult.totalSalikTollsAed}</span>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-xl text-center">
            <span className="text-[10px] text-slate-500 uppercase block">Total Pallets / Load</span>
            <span className="font-mono font-bold text-cyan-400 text-sm">
              {routeResult.totalPallets} Pallets ({routeResult.totalWeightTons}T)
            </span>
          </div>
        </div>
      )}

      {/* LTL Load Sharing & Green Eco-Consolidation Incentive */}
      {routeResult?.ltlConsolidation.isEligible && (
        <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Leaf className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white">
                LTL Load Sharing & Green Fleet Consolidation
              </span>
            </div>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
              {routeResult.ltlConsolidation.discountPercent}% Eco-Rebate
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/60 p-2.5 rounded-xl">
              <span className="text-[10px] text-slate-400 block mb-0.5">Shared Corridor Pool:</span>
              <span className="font-mono text-emerald-300 font-semibold">
                {routeResult.ltlConsolidation.poolId}
              </span>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl">
              <span className="text-[10px] text-slate-400 block mb-0.5">Carbon Reduction:</span>
              <span className="font-mono text-emerald-400 font-bold">
                🌱 -{routeResult.ltlConsolidation.co2SavedKg} kg CO₂ Saved
              </span>
            </div>
          </div>

          <label className="flex items-center justify-between cursor-pointer pt-1">
            <span className="text-xs text-slate-300">
              Apply LTL Consolidation Discount (Save <strong>AED {routeResult.ltlConsolidation.discountAmountAed}</strong> on this run):
            </span>
            <input
              type="checkbox"
              checked={enableLtlConsolidation}
              onChange={(e) => setEnableLtlConsolidation(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded bg-slate-900 border-white/20"
            />
          </label>
        </div>
      )}
    </div>
  );
}
