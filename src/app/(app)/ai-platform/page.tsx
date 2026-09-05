/**
 * AI Platform module landing page.
 * Houses the predictive maintenance engine and future AI capabilities.
 * Predictive maintenance engine moved here from /maintenance/predictive (Phase B).
 */
import Link from 'next/link';
import { Sparkles, Brain, Activity } from 'lucide-react';

export default function AIPlatformPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">AI Platform</h1>
        <p className="text-xs mt-1 text-slate-500">
          Machine-learning models and AI engines powering Fleet360 intelligence.
        </p>
      </div>

      {/* Phase B migration notice */}
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
        <p className="text-sm text-blue-300">
          <span className="font-semibold">Phase B:</span> The Predictive Maintenance engine has
          been moved here from the Maintenance module. Maintenance retains a read-only consumer
          view at{' '}
          <Link href="/maintenance/predictive-alerts" className="underline hover:text-blue-200">
            /maintenance/predictive-alerts
          </Link>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/ai-platform/predictive"
          className="group rounded-xl border border-white/10 bg-slate-900 p-6 hover:border-purple-500/40 hover:bg-slate-800/70 transition-all"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <Sparkles className="h-5 w-5 text-purple-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Predictive maintenance</h2>
          </div>
          <p className="text-sm text-slate-500">
            ML-powered failure prediction, cost forecasting, and optimal replacement timing for the
            entire fleet.
          </p>
        </Link>

        <div className="rounded-xl border border-white/10 bg-slate-900 p-6 opacity-50 cursor-not-allowed">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-slate-700/50 p-2">
              <Brain className="h-5 w-5 text-slate-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Demand forecasting</h2>
          </div>
          <p className="text-sm text-slate-500">Coming soon — AI-driven demand and utilisation forecasting.</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900 p-6 opacity-50 cursor-not-allowed">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-slate-700/50 p-2">
              <Activity className="h-5 w-5 text-slate-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Anomaly detection</h2>
          </div>
          <p className="text-sm text-slate-500">Coming soon — real-time fleet anomaly detection.</p>
        </div>
      </div>
    </div>
  );
}
