'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles, X, Bot, CheckCircle2, ArrowRight, Bus, Users,
  TrendingDown, DollarSign, Clock, MapPin, RefreshCw, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react';

export interface StaffTransportPlanRec {
  id: string;
  plan_name: string;
  shift_coverage: Array<{ shiftId: string; shiftName: string; window: string; employees: number }>;
  total_employees_covered: number;
  baseline_vehicles_needed: number;
  optimized_vehicles_needed: number;
  vehicles_saved: number;
  daily_distance_saved_km: number;
  monthly_cost_saved_aed: number;
  annual_cost_saved_aed: number;
  routes: Array<{
    id: string;
    shiftName: string;
    vehicleType: string;
    capacity: number;
    passengerCount: number;
    utilizationPercent: number;
    calculatedDepartureTime: string;
    arrivalTime: string;
    stops: Array<{ name: string; passengerCount: number; scheduledTime: string; sequenceNumber: number }>;
    totalDistanceKm: number;
    estimatedDurationMins: number;
  }>;
  vehicle_reuse_chains: Array<{
    chainId: string;
    vehicleType: string;
    routeIds: string[];
    shiftsServed: string[];
    deadheadDistanceKm: number;
    bufferMinutesBetweenShifts: number;
  }>;
  status: 'SUGGESTED' | 'APPLIED' | 'REJECTED';
  created_at: string;
}

interface StaffTransportAiDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanApplied?: (planId: string) => void;
}

export function StaffTransportAiDrawer({
  isOpen,
  onClose,
  onPlanApplied,
}: StaffTransportAiDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<StaffTransportPlanRec[]>([]);
  const [selectedRecId, setSelectedRecId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({});

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bus-ops/plan/ai-recommendations');
      const json = await res.json();
      if (res.ok && json.data) {
        setRecommendations(json.data);
        if (json.data.length > 0 && !selectedRecId) {
          setSelectedRecId(json.data[0].id);
        }
      } else {
        setError(json.error || 'Failed to fetch AI plan recommendations');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRecommendations();
    }
  }, [isOpen]);

  const handleTriggerAI = async () => {
    setTriggering(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/bus-ops/plan/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TRIGGER_AI' }),
      });
      const json = await res.json();
      if (res.ok) {
        setSuccessMsg('Staff Transport Planning Agent computed fresh recommendations!');
        await fetchRecommendations();
      } else {
        setError(json.error || 'Failed to run AI Planner');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execution error');
    } finally {
      setTriggering(false);
    }
  };

  const handleApply = async (recId: string) => {
    setApplyingId(recId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/bus-ops/plan/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPLY_RECOMMENDATION',
          recommendationId: recId,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setSuccessMsg('AI Plan committed and applied to Planning Core successfully!');
        if (onPlanApplied && json.planId) {
          onPlanApplied(json.planId);
        }
        await fetchRecommendations();
      } else {
        setError(json.error || 'Failed to apply recommendation');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Application error');
    } finally {
      setApplyingId(null);
    }
  };

  const toggleRouteExpand = (routeId: string) => {
    setExpandedRoutes((prev) => ({ ...prev, [routeId]: !prev[routeId] }));
  };

  if (!isOpen) return null;

  const activeRec = recommendations.find((r) => r.id === selectedRecId) || recommendations[0];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Staff Transport Planning Agent
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  AI Intelligence Layer
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Shift clustering, vehicle bin-packing & cross-shift vehicle reuse optimization
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerAI}
              disabled={triggering}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${triggering ? 'animate-spin' : ''}`} />
              {triggering ? 'Analyzing Fleet...' : 'Re-Run AI Planner'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="py-20 text-center text-slate-400 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-violet-400" />
              <p className="text-sm">Evaluating staff manifests, pickup zones & vehicle sizes...</p>
            </div>
          ) : recommendations.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-slate-800 rounded-2xl p-8 space-y-4">
              <Bot className="w-12 h-12 text-violet-400/50 mx-auto" />
              <h3 className="text-base font-semibold text-white">No AI Plan Recommendations Yet</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Trigger the Staff Transport Planning Agent to cluster employee pickup accommodations, size optimal vehicles (Van/Coaster/Coach), and chain cross-shift vehicle reuses.
              </p>
              <button
                onClick={handleTriggerAI}
                disabled={triggering}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition shadow-lg shadow-violet-600/30"
              >
                <Sparkles className="w-4 h-4" />
                Generate First AI Plan
              </button>
            </div>
          ) : (
            <>
              {/* Recommendations Selector Tabs */}
              {recommendations.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2 border-b border-slate-800">
                  {recommendations.map((rec) => (
                    <button
                      key={rec.id}
                      onClick={() => setSelectedRecId(rec.id)}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-2 ${
                        (activeRec?.id === rec.id)
                          ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40'
                          : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                      }`}
                    >
                      <span>{rec.plan_name}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                        rec.status === 'APPLIED' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {rec.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {activeRec && (
                <div className="space-y-6">
                  {/* Top Highlight Box */}
                  <div className="bg-gradient-to-br from-violet-900/30 via-slate-900 to-slate-900 border border-violet-500/30 rounded-2xl p-5 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold text-white">{activeRec.plan_name}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            activeRec.status === 'APPLIED'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {activeRec.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Calculated at {new Date(activeRec.created_at).toLocaleString('en-AE')}
                        </p>
                      </div>

                      {activeRec.status !== 'APPLIED' && (
                        <button
                          onClick={() => handleApply(activeRec.id)}
                          disabled={applyingId === activeRec.id}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-600/20 transition"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {applyingId === activeRec.id ? 'Applying...' : '1-Click Commit to Planning Core'}
                        </button>
                      )}
                    </div>

                    {/* KPI Cards Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                      <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                          <Users className="w-3.5 h-3.5 text-blue-400" />
                          <span>Staff Covered</span>
                        </div>
                        <p className="text-lg font-bold text-white">{activeRec.total_employees_covered}</p>
                        <p className="text-[10px] text-slate-400">across {activeRec.shift_coverage?.length || 0} shifts</p>
                      </div>

                      <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                          <Bus className="w-3.5 h-3.5 text-violet-400" />
                          <span>Vehicles Needed</span>
                        </div>
                        <p className="text-lg font-bold text-violet-300">
                          {activeRec.optimized_vehicles_needed}{' '}
                          <span className="text-xs font-normal text-slate-400">
                            (was {activeRec.baseline_vehicles_needed})
                          </span>
                        </p>
                        <p className="text-[10px] text-emerald-400 font-semibold">
                          ↓ {activeRec.vehicles_saved} vehicles saved
                        </p>
                      </div>

                      <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                          <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Daily Mileage Saved</span>
                        </div>
                        <p className="text-lg font-bold text-emerald-300">
                          {activeRec.daily_distance_saved_km}{' '}
                          <span className="text-xs font-normal text-slate-400">km/day</span>
                        </p>
                        <p className="text-[10px] text-slate-400">route consolidation</p>
                      </div>

                      <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                          <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                          <span>Monthly Savings</span>
                        </div>
                        <p className="text-lg font-bold text-amber-300">
                          AED {Number(activeRec.monthly_cost_saved_aed).toLocaleString('en-AE')}
                        </p>
                        <p className="text-[10px] text-emerald-400 font-semibold">
                          AED {Number(activeRec.annual_cost_saved_aed).toLocaleString('en-AE')} / year
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Vehicle Reuse Chains */}
                  {activeRec.vehicle_reuse_chains && activeRec.vehicle_reuse_chains.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>Cross-Shift Vehicle Reuse Chains</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {activeRec.vehicle_reuse_chains.length} Chains
                          </span>
                        </h4>
                        <span className="text-xs text-slate-400">Maximized vehicle asset utilization</span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5">
                        {activeRec.vehicle_reuse_chains.map((chain, idx) => (
                          <div
                            key={chain.chainId || idx}
                            className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-400">Chain #{idx + 1}:</span>
                              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                {chain.vehicleType}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              {chain.shiftsServed?.map((shift, sIdx) => (
                                <React.Fragment key={sIdx}>
                                  {sIdx > 0 && (
                                    <div className="flex items-center text-slate-500 gap-1">
                                      <ArrowRight className="w-3 h-3" />
                                      <span className="text-[10px] text-slate-400">
                                        ({chain.bufferMinutesBetweenShifts}m buffer)
                                      </span>
                                    </div>
                                  )}
                                  <span className="bg-slate-800 text-slate-200 px-2.5 py-1 rounded-lg border border-slate-700">
                                    {shift}
                                  </span>
                                </React.Fragment>
                              ))}
                            </div>

                            <div className="text-right text-xs text-slate-400">
                              Deadhead: <span className="text-white font-medium">{chain.deadheadDistanceKm} km</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Optimized Routes Breakdown */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>Optimized Routes & Waypoint Sequences</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {activeRec.routes?.length || 0} Routes
                      </span>
                    </h4>

                    <div className="space-y-2.5">
                      {activeRec.routes?.map((route, rIdx) => {
                        const isExpanded = !!expandedRoutes[route.id || String(rIdx)];
                        return (
                          <div
                            key={route.id || rIdx}
                            className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition"
                          >
                            <div
                              onClick={() => toggleRouteExpand(route.id || String(rIdx))}
                              className="p-3.5 flex items-center justify-between cursor-pointer select-none"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-slate-400">R{rIdx + 1}</span>
                                <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-800 text-slate-200 border border-slate-700">
                                  {route.vehicleType}
                                </span>
                                <span className="text-xs font-semibold text-white">
                                  {route.shiftName}
                                </span>
                              </div>

                              <div className="flex items-center gap-4 text-xs">
                                <div className="text-slate-300">
                                  <Users className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                                  <span className="font-semibold text-white">{route.passengerCount}</span> / {route.capacity} pax
                                  <span className="text-emerald-400 ml-1">({route.utilizationPercent}%)</span>
                                </div>
                                <div className="text-slate-300">
                                  <Clock className="w-3.5 h-3.5 inline mr-1 text-amber-400" />
                                  Depart: <span className="text-amber-300 font-semibold">{route.calculatedDepartureTime}</span>
                                  {' → '}Arrival: <span className="text-slate-200">{route.arrivalTime}</span>
                                </div>
                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4 text-slate-400" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-slate-400" />
                                )}
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="p-3.5 bg-slate-950/60 border-t border-slate-800 space-y-2 text-xs">
                                <div className="text-slate-400 font-semibold mb-2 flex items-center justify-between">
                                  <span>Pickup Waypoints & Calculated Timings:</span>
                                  <span>Est. Trip Distance: {route.totalDistanceKm} km ({route.estimatedDurationMins} mins)</span>
                                </div>
                                <div className="space-y-1.5 pl-2">
                                  {route.stops?.map((stop, sIdx) => (
                                    <div key={sIdx} className="flex items-center gap-3 text-slate-300">
                                      <span className="w-4 h-4 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-[10px] font-bold">
                                        {stop.sequenceNumber}
                                      </span>
                                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                                      <span className="font-medium text-white">{stop.name}</span>
                                      <span className="text-slate-500 text-[11px]">({stop.passengerCount} pax)</span>
                                      <span className="ml-auto text-amber-300/90 font-mono text-[11px]">
                                        {stop.scheduledTime}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
