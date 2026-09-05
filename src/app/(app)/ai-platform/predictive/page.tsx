/**
 * Predictive Maintenance Engine — owned by the AI Platform (Phase B migration).
 * Previously at /maintenance/predictive.
 * Maintenance consumer view: /maintenance/predictive-alerts (read-only).
 */
'use client';

import Link from 'next/link';
import { Sparkles, AlertTriangle, TrendingUp, Activity } from 'lucide-react';

const RISK_ITEMS = [
  { vehicle: 'Toyota Hilux – DXB-A-12345', component: 'Brake pads', risk: 'High', days: 8, confidence: 94 },
  { vehicle: 'Ford F-150 – SHJ-B-67890', component: 'Engine oil', risk: 'Medium', days: 21, confidence: 87 },
  { vehicle: 'Mitsubishi Canter – AUH-C-11111', component: 'Transmission', risk: 'High', days: 12, confidence: 91 },
];

const riskColor = (r: string) =>
  r === 'High' ? 'bg-red-500/20 text-red-300 border-red-500/30'
  : r === 'Medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

export default function AIPlatformPredictivePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Predictive Maintenance</h1>
        <p className="text-xs mt-1 text-slate-500">AI-powered failure prediction and cost forecasting — owned by AI Platform.</p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start justify-between gap-4">
        <p className="text-sm text-amber-300">
          <span className="font-semibold">Domain ownership:</span> This engine is managed by the
          AI Platform. Maintenance teams consume alerts via{' '}
          <Link href="/maintenance/predictive-alerts" className="underline hover:text-amber-100">
            /maintenance/predictive-alerts
          </Link>.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'High risk', value: '3', icon: AlertTriangle, color: 'red' },
          { label: 'Medium risk', value: '7', icon: Activity, color: 'amber' },
          { label: 'Avg confidence', value: '89%', icon: Sparkles, color: 'blue' },
          { label: 'Cost forecast (30d)', value: 'AED 42k', icon: TrendingUp, color: 'purple' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-white/10 bg-slate-900 p-5">
            <div className={`rounded-lg bg-${color}-500/20 p-2 w-fit mb-2`}>
              <Icon className={`h-4 w-4 text-${color}-400`} />
            </div>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Predictions */}
      <div className="rounded-xl border border-white/10 bg-slate-900">
        <div className="p-5 border-b border-white/10">
          <h3 className="font-semibold text-white">Failure Predictions</h3>
          <p className="text-sm text-slate-500 mt-0.5">Components with predicted failures, ranked by urgency</p>
        </div>
        <div className="divide-y divide-white/10">
          {RISK_ITEMS.map((item, i) => (
            <div key={i} className="flex items-center justify-between p-5 hover:bg-white/5 transition-colors">
              <div>
                <p className="text-sm font-medium text-white">{item.vehicle}</p>
                <p className="text-xs text-slate-500 mt-0.5">Component: {item.component}</p>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <p className="text-xs text-slate-500">Predicted failure</p>
                  <p className="text-sm font-medium text-orange-300">{item.days}d away</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Confidence</p>
                  <p className="text-sm font-bold text-blue-400">{item.confidence}%</p>
                </div>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${riskColor(item.risk)}`}>
                  {item.risk}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
