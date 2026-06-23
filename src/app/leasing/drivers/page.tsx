'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';

interface Driver {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactNumber: string | null;
  nationality: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  licenseType: string | null;
  emiratesId: string | null;
  emiratesIdExpiry: string | null;
  visaExpiry: string | null;
  status: string | null;
  driverType: string | null;
  activeAllocations: number;
  totalAllocations: number;
  licenseExpiryStatus: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | null;
  emiratesIdExpiryStatus: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | null;
  visaExpiryStatus: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | null;
}

const EXPIRY_PILL: Record<string, string> = {
  EXPIRED:        'bg-rose-500/20 text-rose-300 border-rose-500/40',
  EXPIRING_SOON:  'bg-amber-500/20 text-amber-300 border-amber-500/40',
  OK:             'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB') : '—';
// Mixing ?? with || requires explicit grouping. Intent: d.name if set,
// else "First Last" if non-empty, else em-dash.
const displayName = (d: Driver) => d.name ?? ([d.firstName, d.lastName].filter(Boolean).join(' ') || '—');

export default function LeasingDriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'allocated' | 'all'>('allocated');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leasing/drivers${scope === 'all' ? '?all=1' : ''}`);
      const data = res.ok ? await res.json() : [];
      setDrivers(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: drivers.length,
    activeAllocs: drivers.reduce((s, d) => s + d.activeAllocations, 0),
    licenseExpiring: drivers.filter(d => d.licenseExpiryStatus === 'EXPIRING_SOON').length,
    licenseExpired: drivers.filter(d => d.licenseExpiryStatus === 'EXPIRED').length,
  }), [drivers]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Drivers</h1>
          <p className="text-slate-400">
            {scope === 'allocated'
              ? `Drivers currently allocated to leasing contracts`
              : `All drivers in the platform — allocate via a contract page`}
          </p>
        </div>
        <div className="inline-flex rounded-xl bg-slate-800/60 border border-white/10 p-1">
          <button
            onClick={() => setScope('allocated')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${scope === 'allocated' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            Allocated
          </button>
          <button
            onClick={() => setScope('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${scope === 'all' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            All Drivers
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Drivers" value={stats.total} />
        <KpiCard label="Active Allocations" value={stats.activeAllocs} accent="emerald" />
        <KpiCard label="Licence Expiring (≤30d)" value={stats.licenseExpiring} accent="amber" />
        <KpiCard label="Licence EXPIRED" value={stats.licenseExpired} accent="rose" />
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : drivers.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          {scope === 'allocated'
            ? 'No drivers currently allocated. Switch to "All Drivers" to see the wider pool, or allocate one from a contract page.'
            : 'No drivers in the platform yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Licence</th>
                <th className="px-4 py-3">EID</th>
                <th className="px-4 py-3">Visa</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Allocations</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{displayName(d)}</div>
                    <div className="text-[11px] text-slate-500">{d.driverType ?? '—'} · {d.nationality ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-200">{d.contactNumber ?? '—'}</div>
                    <div className="text-slate-500">{d.email ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-mono text-slate-200">{d.licenseNumber ?? '—'}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-slate-500">{fmt(d.licenseExpiry)}</span>
                      {d.licenseExpiryStatus && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] border ${EXPIRY_PILL[d.licenseExpiryStatus] ?? ''}`}>
                          {d.licenseExpiryStatus}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-200">{fmt(d.emiratesIdExpiry)}</div>
                    {d.emiratesIdExpiryStatus && d.emiratesIdExpiryStatus !== 'OK' && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] border ${EXPIRY_PILL[d.emiratesIdExpiryStatus]}`}>
                        {d.emiratesIdExpiryStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-200">{fmt(d.visaExpiry)}</div>
                    {d.visaExpiryStatus && d.visaExpiryStatus !== 'OK' && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] border ${EXPIRY_PILL[d.visaExpiryStatus]}`}>
                        {d.visaExpiryStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${d.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-500/20 text-slate-400 border-slate-500/40'}`}>
                      {d.status ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-white font-medium">{d.activeAllocations} <span className="text-slate-500 text-xs">active</span></div>
                    <div className="text-xs text-slate-500">{d.totalAllocations} total</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-5 text-sm text-slate-400">
        <p>
          To allocate or release a driver, open a contract from{' '}
          <Link href="/leasing/contracts-v2" className="text-emerald-400 hover:underline">Contracts</Link>.
          Per-contract driver picker is on the contract detail page.
        </p>
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent = 'slate' }: { label: string; value: number; accent?: string }) {
  const accentClass: Record<string, string> = {
    slate: 'text-white',
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    rose: 'text-rose-300',
  };
  return (
    <div className="bg-slate-800/50 border border-white/10 rounded-xl p-5">
      <div className={`text-3xl font-bold ${accentClass[accent]}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}
