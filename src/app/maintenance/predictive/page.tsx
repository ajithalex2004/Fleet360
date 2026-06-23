'use client';

import { useEffect, useState } from 'react';
import { backendFetch } from '@/lib/auth/backend-fetch';

// ── Response shape from /api/v1/maintenance/predictive ─────────────────────
// Honest fields only — the old struct's Confidence / CurrentCondition /
// PredictedFailureDate / EstimatedCost were all hardcoded constants. They
// were removed in the backend's Phase 1 honesty pass. Phase 2 will
// reintroduce data-driven fields under different names (typicalIntervalKm,
// projectedDueAt, etc.) computed from actual maintenance history.
interface MaintenanceDueAlert {
  vehicleId: string;
  vehicleName: string;
  component: string;
  recommendedAction: string;
  riskLevel: 'High' | 'Medium' | 'Low';
  reason: string;
  vehicleMileage: number;
  vehicleYear: number;
}

interface RiskCounts {
  critical: number;
  warning: number;
  healthy: number;
}

interface DueAlertsResponse {
  alerts: MaintenanceDueAlert[];
  riskCounts: RiskCounts;
  disclaimer: string;
}

const riskBadgeClass = (risk: string) => {
  switch (risk) {
    case 'High':
      return 'bg-red-500/20 text-red-300 border-red-300/30';
    case 'Medium':
      return 'bg-amber-500/20 text-amber-300 border-amber-300/30';
    case 'Low':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-300/30';
    default:
      return 'bg-slate-700/40 text-slate-300 border-white/15';
  }
};

export default function MaintenanceDueAlertsPage() {
  const [data, setData] = useState<DueAlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | 'High' | 'Medium' | 'Low'>('All');

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const response = await backendFetch('http://localhost:8080/api/v1/maintenance/predictive');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as DueAlertsResponse;
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load maintenance alerts');
      } finally {
        setLoading(false);
      }
    };
    fetchAlerts();
  }, []);

  const alerts = data?.alerts ?? [];
  const visibleAlerts =
    filter === 'All' ? alerts : alerts.filter(a => a.riskLevel === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Maintenance Due Alerts</h1>
        <p className="mt-1 text-slate-500">
          Service recommendations from mileage and vehicle-age rules. No machine learning
          on this page yet — see the disclaimer below.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
          Could not load alerts: {error}
        </div>
      )}

      {/* Risk Rollup */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => setFilter(filter === 'High' ? 'All' : 'High')}
          className={`text-left rounded-xl border p-4 transition-colors ${
            filter === 'High'
              ? 'bg-red-500/20 border-red-400'
              : 'bg-red-500/10 border-red-400/30 hover:bg-red-500/15'
          }`}
        >
          <p className="text-xs text-red-300 uppercase tracking-wide">Critical</p>
          <p className="mt-1 text-3xl font-bold text-red-200">
            {data?.riskCounts.critical ?? 0}
          </p>
          <p className="mt-1 text-xs text-red-300/70">vehicles need attention</p>
        </button>
        <button
          onClick={() => setFilter(filter === 'Medium' ? 'All' : 'Medium')}
          className={`text-left rounded-xl border p-4 transition-colors ${
            filter === 'Medium'
              ? 'bg-amber-500/20 border-amber-400'
              : 'bg-amber-500/10 border-amber-400/30 hover:bg-amber-500/15'
          }`}
        >
          <p className="text-xs text-amber-300 uppercase tracking-wide">Warning</p>
          <p className="mt-1 text-3xl font-bold text-amber-200">
            {data?.riskCounts.warning ?? 0}
          </p>
          <p className="mt-1 text-xs text-amber-300/70">vehicles to monitor</p>
        </button>
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <p className="text-xs text-emerald-300 uppercase tracking-wide">Healthy</p>
          <p className="mt-1 text-3xl font-bold text-emerald-200">
            {data?.riskCounts.healthy ?? 0}
          </p>
          <p className="mt-1 text-xs text-emerald-300/70">no rules triggered</p>
        </div>
      </div>

      {/* Alerts list */}
      <div className="rounded-xl border border-white/10 bg-slate-900 shadow-sm">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Vehicles Due for Service</h3>
            <p className="text-sm text-slate-500">
              {filter === 'All'
                ? `${alerts.length} alert(s) across the fleet`
                : `${visibleAlerts.length} ${filter.toLowerCase()}-risk alert(s)`}
            </p>
          </div>
          {filter !== 'All' && (
            <button
              onClick={() => setFilter('All')}
              className="text-xs text-slate-400 hover:text-white underline"
            >
              Clear filter
            </button>
          )}
        </div>
        <div className="divide-y divide-white/10">
          {loading ? (
            <div className="p-6 text-center text-slate-500">Loading alerts…</div>
          ) : visibleAlerts.length === 0 ? (
            <div className="p-6 text-center text-slate-500">
              {alerts.length === 0
                ? 'No vehicles flagged. Add a vehicle with mileage > 30,000 km or age ≥ 3 years to see alerts.'
                : `No ${filter.toLowerCase()}-risk alerts.`}
            </div>
          ) : (
            visibleAlerts.map((alert, idx) => (
              <div key={`${alert.vehicleId}-${alert.component}-${idx}`} className="p-6 hover:bg-white/5 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h4 className="text-base font-bold text-white truncate">
                        {alert.vehicleName}
                      </h4>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${riskBadgeClass(alert.riskLevel)}`}
                      >
                        {alert.riskLevel} Risk
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-300">
                      Component:{' '}
                      <span className="font-medium text-white">{alert.component}</span>
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-400 shrink-0">
                    <p>{alert.vehicleMileage.toLocaleString()} km</p>
                    <p>Year {alert.vehicleYear || '—'}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-lg bg-blue-500/10 border border-blue-400/30 p-3">
                  <p className="text-sm text-blue-200">
                    <span className="font-medium">Recommendation:</span> {alert.recommendedAction}
                  </p>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-medium">Triggered by:</span> {alert.reason}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Honest disclaimer card — replaces the old "AI Model Information" theater */}
      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
        <h4 className="text-sm font-bold text-amber-200">How these alerts are computed</h4>
        <p className="mt-1 text-sm text-amber-100/90">
          {data?.disclaimer ??
            'Alerts come from mileage- and age-based rules, not a machine-learning model.'}
        </p>
        <p className="mt-2 text-xs text-amber-200/70">
          Phase 2 (in development): per-vehicle predictive analytics computed from actual
          maintenance history — mean km-between-services, projected next-due date, with
          sample-size disclosure on every prediction.
        </p>
      </div>
    </div>
  );
}
