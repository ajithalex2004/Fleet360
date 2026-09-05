/**
 * Predictive Alerts — read-only consumer view for the Maintenance module.
 * Shows AI-generated failure predictions relevant to maintenance scheduling.
 * The predictive engine is owned by the AI Platform at /ai-platform/predictive.
 */
'use client';

import Link from 'next/link';
import { Sparkles, ExternalLink, AlertTriangle } from 'lucide-react';

const MOCK_ALERTS = [
  { vehicle: 'Toyota Hilux – DXB-A-12345', component: 'Brake pads', risk: 'High', days: 8, confidence: 94, action: 'Schedule brake service immediately' },
  { vehicle: 'Mitsubishi Canter – AUH-C-11111', component: 'Transmission fluid', risk: 'High', days: 12, confidence: 91, action: 'Book transmission service within 10 days' },
  { vehicle: 'Ford F-150 – SHJ-B-67890', component: 'Engine oil', risk: 'Medium', days: 21, confidence: 87, action: 'Schedule oil change in next service cycle' },
  { vehicle: 'Nissan Patrol – DXB-D-22222', component: 'Air filter', risk: 'Low', days: 45, confidence: 79, action: 'Include in next scheduled maintenance' },
];

const riskStyle: Record<string, { badge: string; bg: string }> = {
  High:   { badge: 'bg-red-500/20 text-red-300 border-red-500/30',    bg: 'bg-red-500/5' },
  Medium: { badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30', bg: 'bg-amber-500/5' },
  Low:    { badge: 'bg-slate-700/40 text-slate-400 border-white/10',   bg: '' },
};

export default function PredictiveAlertsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Predictive Alerts</h1>
          <p className="text-xs mt-1 text-slate-500">AI-generated failure predictions for your fleet.</p>
        </div>
        <Link
          href="/ai-platform/predictive"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400 hover:text-white hover:border-white/20 transition-colors"
        >
          AI Platform engine
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Consumer view notice */}
      <div className="rounded-xl border border-slate-500/30 bg-slate-800/50 p-4 flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <p className="text-sm text-slate-400">
          <span className="font-semibold text-slate-300">Read-only consumer view.</span>{' '}
          Model configuration and full analytics are in{' '}
          <Link href="/ai-platform/predictive" className="text-blue-400 underline hover:text-blue-300">
            AI Platform → Predictive maintenance
          </Link>.
        </p>
      </div>

      <div className="space-y-3">
        {MOCK_ALERTS.map((alert, i) => {
          const style = riskStyle[alert.risk] ?? riskStyle.Low;
          return (
            <div key={i} className={`rounded-xl border border-white/10 bg-slate-900 p-5 ${style.bg}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-white">{alert.vehicle}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.badge}`}>
                      {alert.risk} Risk
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Component: <span className="text-slate-300">{alert.component}</span></p>
                  <div className="mt-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2">
                    <p className="text-xs text-blue-300">
                      <AlertTriangle className="inline h-3 w-3 mr-1" />
                      {alert.action}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-500">Predicted failure</p>
                  <p className="text-lg font-bold text-orange-300">{alert.days}d</p>
                  <p className="text-xs text-blue-400 mt-1">Confidence: {alert.confidence}%</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
