'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Bus,
  Users,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Search,
  ArrowRight,
  MapPin,
  Flame,
  Filter,
} from 'lucide-react';
import type { SlaMonitorSummary, TripSlaEvaluation, SlaStatus } from '@/lib/bus-ops/sla-monitor';

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function ShiftSlaMonitorPage() {
  const [data, setData] = useState<SlaMonitorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | 'SLA_BREACH' | 'AT_RISK' | 'ON_TIME'>('ALL');
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(30); // seconds

  // Modal state for broadcast
  const [broadcastTrip, setBroadcastTrip] = useState<TripSlaEvaluation | null>(null);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState<string | null>(null);

  const fetchSlaData = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/bus-ops/sla-monitor');
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json: SlaMonitorSummary = await res.json();
      setData(json);
    } catch (err) {
      console.error('Failed to load Shift SLA Monitor data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load SLA Monitor data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const triggerSlaSweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch('/api/bus-ops/schedules/sweep-sla', { method: 'POST' });
      if (!res.ok) throw new Error('Sweep request failed');
      await fetchSlaData(true);
    } catch (err) {
      console.error('SLA sweep error:', err);
    } finally {
      setSweeping(false);
    }
  };

  const handleBroadcast = async () => {
    if (!broadcastTrip) return;
    setBroadcasting(true);
    setBroadcastSuccess(null);
    try {
      const res = await fetch(`/api/bus-ops/schedules/${broadcastTrip.tripId}/notify-delay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delayMinutes: broadcastTrip.delayMinutes,
          newEta: broadcastTrip.predictedArrivalTime ? formatTime(broadcastTrip.predictedArrivalTime) : undefined,
          message: broadcastMessage || undefined,
        }),
      });
      if (!res.ok) throw new Error('Broadcast failed');
      setBroadcastSuccess(`Notice successfully broadcast to ${broadcastTrip.totalPassengers} passengers and shift supervisors.`);
      setTimeout(() => {
        setBroadcastTrip(null);
        setBroadcastSuccess(null);
        setBroadcastMessage('');
      }, 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setBroadcasting(false);
    }
  };

  useEffect(() => {
    fetchSlaData();
  }, [fetchSlaData]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchSlaData(true);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, fetchSlaData]);

  const filteredTrips = useMemo(() => {
    if (!data?.trips) return [];
    return data.trips.filter((t) => {
      // Filter by SLA category
      if (selectedFilter !== 'ALL' && t.slaStatus !== selectedFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesRoute = t.routeName.toLowerCase().includes(q);
        const matchesTripNo = (t.tripNumber || '').toLowerCase().includes(q);
        const matchesVehicle = (t.vehicleCode || '').toLowerCase().includes(q);
        const matchesDriver = (t.driverName || '').toLowerCase().includes(q);
        const matchesDest = t.destination.toLowerCase().includes(q);
        if (!matchesRoute && !matchesTripNo && !matchesVehicle && !matchesDriver && !matchesDest) {
          return false;
        }
      }
      return true;
    });
  }, [data?.trips, selectedFilter, searchQuery]);

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Real-Time Staff Logistics
            </span>
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Radio className="w-3.5 h-3.5 animate-pulse" /> Live Telemetry
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mt-1">Shift Arrival SLA Monitor</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Real-time workplace destination ETA tracking and proactive delay warning system for corporate shift shuttles.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5">
            <span>Refresh:</span>
            <select
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
              className="bg-transparent text-[var(--text-main)] border-none outline-none cursor-pointer"
            >
              <option value={15} className="bg-[var(--bg-surface)]">15s</option>
              <option value={30} className="bg-[var(--bg-surface)]">30s</option>
              <option value={60} className="bg-[var(--bg-surface)]">60s</option>
              <option value={0} className="bg-[var(--bg-surface)]">Manual</option>
            </select>
          </div>

          <button
            onClick={() => fetchSlaData()}
            disabled={refreshing}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-[var(--text-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
            Refresh
          </button>

          <button
            onClick={triggerSlaSweep}
            disabled={sweeping}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-[var(--text-main)] bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition"
          >
            <ShieldAlert className={`w-3.5 h-3.5 ${sweeping ? 'animate-spin' : ''}`} />
            Run SLA Sweep
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">On-Time Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-main)]">{data ? `${data.onTimeRatePercent}%` : '—'}</span>
            <span className="text-xs text-emerald-400 font-medium">SLA Target &gt;95%</span>
          </div>
          <div className="mt-2 w-full bg-[var(--bg-surface)] rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${data?.onTimeRatePercent || 0}%` }}
            />
          </div>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active Commutes</span>
            <Bus className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-main)]">{data?.totalActiveTrips ?? '—'}</span>
            <span className="text-xs text-[var(--text-muted)]">running / scheduled</span>
          </div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">In transit to work sites</p>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">At-Risk Trips</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-400">{data?.atRiskCount ?? '—'}</span>
            <span className="text-xs text-[var(--text-muted)]">5–15 min delay</span>
          </div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">Predicted before shift start</p>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Critical Breaches</span>
            <Flame className="w-4 h-4 text-red-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-red-400">{data?.breachCount ?? '—'}</span>
            <span className="text-xs text-red-400 font-medium">&gt;15m or past SLA</span>
          </div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">Requires immediate dispatch action</p>
        </div>

        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Impacted Staff</span>
            <Users className="w-4 h-4 text-orange-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--text-main)]">{data?.totalImpactedPassengers ?? 0}</span>
            <span className="text-xs text-orange-400">passengers affected</span>
          </div>
          <p className="text-[11px] text-[var(--text-faint)] mt-2">In at-risk or delayed buses</p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[var(--bg-surface)]/40 p-3 rounded-xl border border-[var(--border-subtle)]">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap ${
              selectedFilter === 'ALL'
                ? 'bg-[var(--bg-surface)] text-[var(--text-main)] shadow'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]/50'
            }`}
          >
            All Trips ({data?.totalActiveTrips ?? 0})
          </button>
          <button
            onClick={() => setSelectedFilter('SLA_BREACH')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
              selectedFilter === 'SLA_BREACH'
                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                : 'text-[var(--text-muted)] hover:text-red-300 hover:bg-[var(--bg-surface)]/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-400" />
            SLA Breaches ({data?.breachCount ?? 0})
          </button>
          <button
            onClick={() => setSelectedFilter('AT_RISK')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
              selectedFilter === 'AT_RISK'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-[var(--text-muted)] hover:text-amber-300 hover:bg-[var(--bg-surface)]/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            At Risk ({data?.atRiskCount ?? 0})
          </button>
          <button
            onClick={() => setSelectedFilter('ON_TIME')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition whitespace-nowrap flex items-center gap-1.5 ${
              selectedFilter === 'ON_TIME'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-[var(--text-muted)] hover:text-emerald-300 hover:bg-[var(--bg-surface)]/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            On Time ({data?.onTimeCount ?? 0})
          </button>
        </div>

        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="text"
            placeholder="Search route, vehicle, driver..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Trips Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-muted)]">
            <thead className="bg-[var(--bg-surface)]/90 text-[var(--text-muted)] font-semibold border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-3 px-4">Route & Trip</th>
                <th className="py-3 px-4">Shift / Direction</th>
                <th className="py-3 px-4">Vehicle & Driver</th>
                <th className="py-3 px-4">Departure</th>
                <th className="py-3 px-4">Planned Arrival</th>
                <th className="py-3 px-4">Predicted ETA</th>
                <th className="py-3 px-4">Shift SLA Deadline</th>
                <th className="py-3 px-4">SLA Health</th>
                <th className="py-3 px-4">Staff</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[var(--text-faint)]">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                    Evaluating live shift arrivals & telematics...
                  </td>
                </tr>
              ) : filteredTrips.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[var(--text-faint)]">
                    No active shift trips matching the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredTrips.map((t) => {
                  const isBreach = t.slaStatus === 'SLA_BREACH';
                  const isRisk = t.slaStatus === 'AT_RISK';

                  return (
                    <tr
                      key={t.tripId}
                      className={`hover:bg-[var(--bg-surface)]/40 transition ${
                        isBreach ? 'bg-red-950/10' : isRisk ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[var(--text-main)] flex items-center gap-1.5">
                          {t.routeName}
                          {t.tripNumber && (
                            <span className="text-[10px] text-[var(--text-muted)] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-surface)]">
                              #{t.tripNumber}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                          <span>{t.origin}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-[var(--text-faint)]" />
                          <span className="text-[var(--text-muted)] font-medium">{t.destination}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex text-[10px] font-semibold text-[var(--text-muted)] px-2 py-0.5 rounded bg-[var(--bg-surface)] w-fit">
                            {t.shiftType || 'GENERAL'}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {t.direction === 'OUTBOUND' ? 'Drop-Off' : 'Pick-Up (Inbound)'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-[var(--text-main)]">{t.vehicleCode || 'Unassigned'}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">{t.driverName || 'No Driver'}</div>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-[var(--text-muted)]">
                        {formatTime(t.departureTime)}
                      </td>

                      <td className="py-3.5 px-4 font-mono text-[var(--text-muted)]">
                        {formatTime(t.plannedArrivalTime)}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-mono font-semibold text-[var(--text-main)]">
                          {formatTime(t.predictedArrivalTime)}
                        </div>
                        {t.delayMinutes > 0 && (
                          <div className={`text-[11px] font-medium ${isBreach ? 'text-red-400' : 'text-amber-400'}`}>
                            +{t.delayMinutes} min delay
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-mono">
                        {t.latestArrivalTime ? (
                          <span className="text-[var(--text-main)] font-medium">{formatTime(t.latestArrivalTime)}</span>
                        ) : (
                          <span className="text-[var(--text-faint)] italic">No hard SLA</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {isBreach ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30">
                            <Flame className="w-3.5 h-3.5" /> SLA Breach
                          </span>
                        ) : isRisk ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            <AlertTriangle className="w-3.5 h-3.5" /> At Risk
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3.5 h-3.5" /> On Time
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-[var(--text-muted)] font-medium">
                          <Users className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                          <span>{t.totalPassengers}</span>
                        </div>
                        <div className="text-[10px] text-[var(--text-faint)]">
                          {t.boardedPassengers} boarded
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        {(isBreach || isRisk) ? (
                          <button
                            onClick={() => {
                              setBroadcastTrip(t);
                              setBroadcastMessage(
                                `⚠️ Shift Delay Alert: Trip on ${t.routeName} carrying ${t.totalPassengers} staff is delayed by ${t.delayMinutes} mins. New estimated arrival at ${t.destination}: ${formatTime(t.predictedArrivalTime)}.`
                              );
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg transition"
                          >
                            <Send className="w-3 h-3" />
                            Send Notice
                          </button>
                        ) : (
                          <span className="text-[var(--text-faint)] text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Early Warning Broadcast Modal */}
      {broadcastTrip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-orange-400">
                  Early Warning Dispatch
                </span>
                <h3 className="text-lg font-bold text-[var(--text-main)] mt-1">Broadcast Shift Delay Notice</h3>
              </div>
              <button
                onClick={() => setBroadcastTrip(null)}
                className="text-[var(--text-faint)] hover:text-[var(--text-muted)] text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <div className="bg-[var(--bg-canvas)] p-3 rounded-xl border border-[var(--border-subtle)] text-xs space-y-1.5">
              <div className="flex justify-between text-[var(--text-muted)]">
                <span>Route:</span>
                <span className="font-semibold text-[var(--text-main)]">{broadcastTrip.routeName}</span>
              </div>
              <div className="flex justify-between text-[var(--text-muted)]">
                <span>Destination:</span>
                <span className="text-[var(--text-main)]">{broadcastTrip.destination}</span>
              </div>
              <div className="flex justify-between text-[var(--text-muted)]">
                <span>Estimated Delay:</span>
                <span className="font-bold text-red-400">+{broadcastTrip.delayMinutes} minutes</span>
              </div>
              <div className="flex justify-between text-[var(--text-muted)]">
                <span>New Arrival ETA:</span>
                <span className="font-bold text-indigo-400">{formatTime(broadcastTrip.predictedArrivalTime)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-muted)]">
                <span>Target Recipients:</span>
                <span className="text-[var(--text-main)] font-medium">
                  {broadcastTrip.totalPassengers} Passengers + Shift Supervisors
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                Notification Message (WhatsApp & In-App):
              </label>
              <textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                rows={4}
                className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl p-3 text-xs text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-indigo-500"
              />
            </div>

            {broadcastSuccess && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400 font-medium">
                {broadcastSuccess}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBroadcastTrip(null)}
                disabled={broadcasting}
                className="px-4 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBroadcast}
                disabled={broadcasting || Boolean(broadcastSuccess)}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[var(--text-main)] bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow transition disabled:opacity-50"
              >
                <Send className={`w-3.5 h-3.5 ${broadcasting ? 'animate-spin' : ''}`} />
                {broadcasting ? 'Broadcasting...' : 'Send Broadcast'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
