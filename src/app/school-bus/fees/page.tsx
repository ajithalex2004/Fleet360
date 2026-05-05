'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * School Bus Fees has moved to the Finance Module.
 *
 * Reason: Transport invoices should live in the central Finance ledger so they
 * appear in AR Aging, VAT Returns, Revenue Analysis, and P&L — all automatically.
 * The Finance module's invoice engine supports UAE EDU Zero Rate (0% VAT) natively.
 *
 * This page shows an informational banner and auto-redirects after 3 seconds.
 */
export default function SchoolBusFeesRedirect() {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (countdown <= 0) {
      window.location.href = '/finance/invoices?module=SCHOOL_BUS';
    }
  }, [countdown]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 max-w-2xl mx-auto">
      {/* Moved badge */}
      <div className="flex items-center gap-2 bg-slate-800 border border-white/10 rounded-full px-4 py-1.5 text-xs text-slate-400">
        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        Module Relocated
      </div>

      {/* Icon */}
      <div className="relative">
        <div className="text-6xl">🏫</div>
        <div className="absolute -right-3 -bottom-2 text-3xl">→</div>
        <div className="absolute -right-10 -bottom-2 text-3xl">💰</div>
      </div>

      {/* Title */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-2">School Bus Fees have moved</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Transport invoices are now managed in the <strong className="text-emerald-400">Finance Module</strong> —
          alongside all other receivables. This gives you AR Aging, VAT Returns, Collections,
          Payment Reminders, and P&L reporting automatically.
        </p>
      </div>

      {/* Benefits */}
      <div className="w-full bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">What you get in Finance</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            { icon: '📊', label: 'AR Aging Report', desc: 'See overdue school bus fees by age bucket' },
            { icon: '🇦🇪', label: 'UAE VAT Returns', desc: 'EDU Zero Rate (0%) handled automatically' },
            { icon: '📞', label: 'Collections & Dunning', desc: 'Automated payment reminders to parents' },
            { icon: '📈', label: 'Revenue Analysis', desc: 'School bus income in P&L and dashboards' },
            { icon: '💳', label: 'Payment Recording', desc: 'One unified payment workflow' },
            { icon: '🔁', label: 'Recurring Invoices', desc: 'Auto-generate term/monthly invoices' },
          ].map(b => (
            <div key={b.label} className="flex items-start gap-2 bg-slate-800 rounded-lg p-2.5">
              <span className="text-lg flex-shrink-0">{b.icon}</span>
              <div>
                <p className="text-xs font-semibold text-white">{b.label}</p>
                <p className="text-xs text-slate-500">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* UAE VAT note */}
      <div className="w-full bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
        <span className="text-xl flex-shrink-0">🇦🇪</span>
        <p className="text-xs text-slate-400">
          <strong className="text-emerald-400">UAE VAT — Educational Transport:</strong> School bus services to students are
          Zero Rated (0%) under Article 45 of the UAE VAT Law. The Finance module applies
          this automatically when you select <em>School Bus</em> as the module.
        </p>
      </div>

      {/* Redirect CTA */}
      <div className="flex flex-col items-center gap-3">
        <Link href="/finance/invoices?module=SCHOOL_BUS"
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-3 rounded-xl text-sm transition-colors flex items-center gap-2">
          Go to Finance → School Bus Fees
          <span className="text-emerald-200 font-normal">({countdown}s)</span>
        </Link>
        <Link href="/school-bus" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          ← Back to School Bus Dashboard
        </Link>
      </div>

      {/* Data migration note */}
      <div className="w-full bg-slate-900 border border-white/5 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-400 mb-2">🔄 Data Migration</p>
        <p className="text-xs text-slate-500 mb-3">
          Existing fee records from <code className="bg-slate-800 px-1 rounded text-slate-400">school_bus_fees</code> can be
          migrated to <code className="bg-slate-800 px-1 rounded text-slate-400">finance_invoices</code> using the migration endpoint below.
          This is a one-time, non-destructive operation.
        </p>
        <MigrateButton />
      </div>
    </div>
  );
}

function MigrateButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ migrated?: number; skipped?: number; error?: string } | null>(null);

  const run = async () => {
    setState('running');
    try {
      const r = await fetch('/api/school-bus/fees/migrate', { method: 'POST' });
      const d = await r.json();
      setResult(d);
      setState(d.error ? 'error' : 'done');
    } catch (e: unknown) {
      setResult({ error: String(e) });
      setState('error');
    }
  };

  if (state === 'done') return (
    <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
      ✅ Migration complete — {result?.migrated ?? 0} records migrated, {result?.skipped ?? 0} already existed.
    </div>
  );
  if (state === 'error') return (
    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
      ❌ {result?.error ?? 'Migration failed'}
    </div>
  );

  return (
    <button onClick={run} disabled={state === 'running'}
      className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-4 py-2 rounded-lg border border-white/10 transition-colors">
      {state === 'running' ? '⟳ Migrating…' : '⟳ Run Migration: school_bus_fees → finance_invoices'}
    </button>
  );
}
