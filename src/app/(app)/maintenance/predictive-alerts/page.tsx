/**
 * Predictive Alerts — vehicles whose maintenance record points to a higher
 * risk of failure, from /api/maintenance/risk-scores (overdue service,
 * recent failures, repeat jobs, open defects, downtime, age, mileage,
 * failed inspections, warranty). The full ranking is on the Risk screen.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import type { MaintenanceRiskScore, RiskBand } from '@/types/maintenance';

const ALERT_BANDS: RiskBand[] = ['CRITICAL', 'HIGH', 'MEDIUM'];

const bandStyle: Record<RiskBand, { label: string; badge: string; bg: string; action: string }> = {
  CRITICAL: { label: 'Critical', badge: 'bg-red-500/20 text-red-300 border-red-500/30', bg: 'bg-red-500/5', action: 'Inspect this vehicle before its next trip' },
  HIGH:     { label: 'High',     badge: 'bg-orange-500/20 text-orange-300 border-orange-500/30', bg: 'bg-orange-500/5', action: 'Book a service within the week' },
  MEDIUM:   { label: 'Medium',   badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30', bg: 'bg-amber-500/5', action: 'Include in the next scheduled service' },
  LOW:      { label: 'Low',      badge: 'bg-[var(--bg-surface-hover)]/40 text-[var(--text-muted)] border-[var(--border-subtle)]', bg: '', action: '' },
};

export default function PredictiveAlertsPage() {
  const [scores, setScores] = useState<MaintenanceRiskScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/maintenance/risk-scores', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Could not load risk scores (${res.status})`);
        if (!cancelled) setScores(Array.isArray(json?.scores) ? json.scores : []);
      })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Could not load risk scores'); setScores([]); } });
    return () => { cancelled = true; };
  }, []);

  const alerts = (scores ?? []).filter((s) => ALERT_BANDS.includes(s.band));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Predictive Alerts</h1>
          <p className="text-xs mt-1 text-[var(--text-faint)]">
            Vehicles whose maintenance record points to a higher risk of failure
          </p>
        </div>
        <Link
          href="/maintenance/risk"
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)] transition-colors"
        >
          Full risk ranking
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {scores === null ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-sm text-[var(--text-faint)]">
          Loading risk scores…
        </div>
      ) : alerts.length === 0 && !error ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-sm text-[var(--text-faint)]">
          {scores.length === 0
            ? 'No active vehicles to assess yet.'
            : `No vehicles at medium risk or above. ${scores.length} vehicle${scores.length === 1 ? '' : 's'} assessed.`}
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((s) => {
            const style = bandStyle[s.band];
            const reasons = s.factors.filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
            const name = [s.make, s.model].filter(Boolean).join(' ');
            return (
              <div key={s.vehicleId} className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 ${style.bg}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--text-main)]">
                        {[name, s.licensePlate || s.vehicleCode].filter(Boolean).join(' – ') || s.vehicleId}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.badge}`}>
                        {style.label} Risk
                      </span>
                    </div>
                    {reasons.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-[var(--text-muted)]">
                        {reasons.map((f) => (
                          <li key={f.key}><span className="text-[var(--text-faint)]">{f.label}:</span> {f.description}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2">
                      <p className="text-xs text-blue-300">
                        <AlertTriangle className="inline h-3 w-3 mr-1" />
                        {style.action}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-[var(--text-faint)]">Risk score</p>
                    <p className="text-lg font-bold text-orange-300">{s.score}<span className="text-xs text-[var(--text-faint)]">/100</span></p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
