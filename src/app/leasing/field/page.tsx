'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Field PWA landing — quick-action tiles plus a 7-day capture log so the
 * operator can confirm their entries went through before they leave the
 * vehicle.
 */
export default function FieldHome() {
  const [stats, setStats] = useState({ mileage7d: 0, fuel7d: 0, fines7d: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const since = new Date(Date.now() - 7 * 86400000).toISOString();
        const [m, f, t] = await Promise.all([
          fetch('/api/leasing/mileage-readings').then(r => r.ok ? r.json() : []),
          fetch('/api/leasing/fuel').then(r => r.ok ? r.json() : []),
          fetch('/api/leasing/traffic-fines').then(r => r.ok ? r.json() : []),
        ]);
        setStats({
          mileage7d: (Array.isArray(m) ? m : []).filter((x: { readingDate: string }) => x.readingDate >= since).length,
          fuel7d:    (Array.isArray(f) ? f : []).filter((x: { fuelDate: string }) => x.fuelDate >= since).length,
          fines7d:   (Array.isArray(t) ? t : []).filter((x: { violationDate: string }) => x.violationDate >= since).length,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tiles: Array<{ href: string; label: string; icon: string; sub: string; gradient: string }> = [
    { href: '/leasing/field/mileage', label: 'Mileage Reading',  icon: '🛣️', sub: 'Capture odometer at delivery / monthly / return',  gradient: 'from-cyan-600 to-blue-600' },
    { href: '/leasing/field/fuel',    label: 'Fuel Log',         icon: '⛽', sub: 'Refuelling event with cost & station',          gradient: 'from-amber-600 to-orange-600' },
    { href: '/leasing/field/fine',    label: 'Traffic Fine',     icon: '🚦', sub: 'Log a violation against vehicle / driver',      gradient: 'from-rose-600 to-pink-600' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Field Operations</h1>
        <p className="text-sm text-slate-400 mt-1">Tap a tile to capture an event. Add to Home Screen for offline launch.</p>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <KpiPill label="Mileage" value={stats.mileage7d} loading={loading} />
        <KpiPill label="Fuel" value={stats.fuel7d} loading={loading} />
        <KpiPill label="Fines" value={stats.fines7d} loading={loading} />
      </div>

      <div className="space-y-3">
        {tiles.map(t => (
          <Link
            key={t.href}
            href={t.href}
            className={`block bg-gradient-to-r ${t.gradient} rounded-2xl p-5 active:scale-95 transition-transform shadow-lg`}
          >
            <div className="flex items-center gap-4">
              <div className="text-4xl">{t.icon}</div>
              <div className="flex-1">
                <div className="text-lg font-bold">{t.label}</div>
                <div className="text-xs text-white/80">{t.sub}</div>
              </div>
              <div className="text-2xl text-white/70">→</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 text-xs text-slate-400">
        <p className="text-white font-semibold mb-1">Tips</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Mileage readings auto-trigger overage billing on RETURN / MONTHLY captures.</li>
          <li>Fuel and fine entries default to <em>billable to lessee</em> — uncheck if absorbing.</li>
          <li>Sweeps run nightly to consolidate pending charges into invoices.</li>
        </ul>
      </div>
    </div>
  );
}

function KpiPill({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-xl bg-slate-800/60 border border-white/10 p-3">
      <div className="text-2xl font-bold">{loading ? '—' : value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">{label} · 7d</div>
    </div>
  );
}
