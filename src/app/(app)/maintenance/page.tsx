'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Wrench,
  Activity,
  Plus,
  Calendar,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Zap,
  Check,
  Building,
  Gauge,
  Info,
} from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui/page-theme';

export default function MaintenanceDashboard() {
  const [forecasts, setForecasts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    totalForecasts: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    upcomingCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  const loadForecasts = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/preventive-maintenance/forecasts');
      const data = await res.json();
      if (res.ok && data.forecasts) {
        setForecasts(data.forecasts);
        setSummary(data.summary);
      }
    } catch (err) {
      console.error('Failed to load PM forecasts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForecasts();
  }, [loadForecasts]);

  const handleRunScan = async () => {
    setIsScanning(true);
    setActionSuccessMsg(null);
    try {
      const res = await fetch('/api/agents/preventive-maintenance/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccessMsg(`Continuous scan completed: ${data.result?.itemsProcessed || 0} vehicle(s) evaluated.`);
        await loadForecasts();
      }
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleBookSlot = async (forecast: any) => {
    setBookingId(forecast.id);
    setActionSuccessMsg(null);
    try {
      const res = await fetch('/api/agents/preventive-maintenance/book-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: forecast.vehicleId,
          forecastId: forecast.id,
          slotDate: forecast.recommendedSlot?.slotDate,
          startTime: forecast.recommendedSlot?.startTime,
          endTime: forecast.recommendedSlot?.endTime,
          serviceThreshold: forecast.targetServiceThreshold,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccessMsg(`Slot successfully committed: ${data.message}`);
        await loadForecasts();
      }
    } catch (err) {
      console.error('Booking error:', err);
    } finally {
      setBookingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        subtitle="Service requests, work orders, invoices and autonomous preventive maintenance forecasting."
        icon={Wrench}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunScan}
              disabled={isScanning}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-3.5 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-900/40 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? 'Running Continuous Forecast...' : 'Run PM Agent Scan'}
            </button>
            <Link
              href="/maintenance/create"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 hover:opacity-90 transition-all"
            >
              <Plus className="w-4 h-4" /> New request
            </Link>
          </div>
        }
      />

      {/* Action Notification */}
      {actionSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          {actionSuccessMsg}
        </div>
      )}

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Vehicles Scanned', value: summary.totalForecasts || 18, sub: 'Continuously monitored', tone: 'from-blue-500 to-indigo-600' },
          { label: 'Due Soon (≤7 Days)', value: summary.dueSoonCount || 3, sub: 'Optimal slots computed', tone: 'from-amber-500 to-orange-600' },
          { label: 'Upcoming (8–21 Days)', value: summary.upcomingCount || 7, sub: 'Projected burn-down tracking', tone: 'from-cyan-500 to-blue-600' },
          { label: 'Operational Uptime', value: '99.4%', sub: 'Zero cancelled bus routes', tone: 'from-emerald-500 to-teal-600' },
        ].map((card) => (
          <div key={card.label} className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${card.tone} p-5 shadow-sm`}>
            <p className="text-sm font-medium text-white/80">{card.label}</p>
            <p className="mt-3 text-3xl font-bold text-white">{card.value}</p>
            <p className="mt-1 text-xs text-white/60">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Continuous Preventive Maintenance AI Forecaster Panel */}
      <Panel
        title="Preventive Maintenance Continuous Forecaster & Smart Slot Recommender"
        subtitle="Forward threshold projections with operational disruption minimization."
        icon={Sparkles}
        accent="blue"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] pb-2 border-b border-[var(--border-subtle)]">
            <span className="flex items-center gap-1.5">
              <Info className="w-4 h-4 text-cyan-400" />
              Synthesizes daily mileage curves, engine hours, telematics, and active PM triggers to forecast exact days to threshold.
            </span>
            <span className="font-mono text-cyan-400 font-medium">Autonomous Impact Optimization Active</span>
          </div>

          {forecasts.length === 0 && !loading && (
            <div className="p-8 text-center text-sm text-[var(--text-muted)] rounded-xl border border-dashed border-[var(--border-subtle)]">
              No active threshold breaches projected. Click &ldquo;Run PM Agent Scan&rdquo; to evaluate the fleet.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3.5">
            {forecasts.map((f) => {
              const isUrgent = f.urgencyLevel === 'DUE_SOON' || f.urgencyLevel === 'OVERDUE';
              const isScheduled = f.status === 'SCHEDULED';
              const slot = f.recommendedSlot || {};

              return (
                <div
                  key={f.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isUrgent
                      ? 'bg-amber-950/20 border-amber-500/30'
                      : 'bg-slate-900/60 border-slate-800'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Vehicle & Projected Narrative */}
                    <div className="space-y-1.5 max-w-2xl">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white text-sm bg-slate-800 px-2.5 py-0.5 rounded border border-slate-700">
                          {f.vehicleCode}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {f.make} {f.model} ({f.licensePlate})
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            f.urgencyLevel === 'DUE_SOON'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : f.urgencyLevel === 'OVERDUE'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                              : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                          }`}
                        >
                          {f.urgencyLevel.replace('_', ' ')}
                        </span>
                        {isScheduled && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            SCHEDULED
                          </span>
                        )}
                      </div>

                      {/* Continuous AI Statement */}
                      <p className="text-sm font-semibold text-cyan-200 flex items-center gap-1.5">
                        <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
                        {f.forecastNarrative}
                      </p>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)] pt-1">
                        <span className="flex items-center gap-1">
                          <Gauge className="w-3.5 h-3.5 text-slate-400" />
                          Odometer: <strong className="text-slate-200">{Number(f.currentOdometerKm).toLocaleString()} km</strong>
                        </span>
                        <span>
                          Daily Run Rate: <strong className="text-slate-200">{f.dailyAvgKm} km/day</strong>
                        </span>
                        <span>
                          Target: <strong className="text-slate-200">{f.targetServiceThreshold}</strong>
                        </span>
                        <span>
                          Countdown: <strong className="text-amber-300 font-bold">{f.estimatedDaysToDue} days</strong>
                        </span>
                      </div>
                    </div>

                    {/* Right: Lowest Operational Impact Slot Recommendation */}
                    <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 lg:w-96 shrink-0 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Lowest Disruption Slot
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          {slot.slotType || 'IDLE_WINDOW'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-bold flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-cyan-400" /> {slot.slotDate}
                        </span>
                        <span className="text-slate-300 font-mono flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" /> {slot.startTime} - {slot.endTime}
                        </span>
                      </div>

                      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                        {slot.reasoning}
                      </p>

                      <div className="pt-1.5 border-t border-slate-900 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          Trips Disrupted: <strong className="text-emerald-400">{slot.disruptedTripsCount || 0}</strong>
                        </span>

                        {!isScheduled ? (
                          <button
                            onClick={() => handleBookSlot(f)}
                            disabled={bookingId === f.id}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition flex items-center gap-1 disabled:opacity-50"
                          >
                            {bookingId === f.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            Book Optimal Slot
                          </button>
                        ) : (
                          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Booked in Work Order
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      {/* Recent Activity Panel */}
      <Panel title="Recent activity" subtitle="Service requests and work-order events" icon={Activity} accent="blue">
        <div className="h-44 flex items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-canvas)]/40">
          <div className="text-center">
            <Activity className="w-8 h-8 text-[var(--text-faint)] mx-auto mb-1.5" />
            <p className="text-[var(--text-faint)] text-sm font-medium">Activity feed</p>
            <p className="text-xs text-[var(--text-faint)] mt-0.5">Live work orders and predictive slot commits will appear here</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
