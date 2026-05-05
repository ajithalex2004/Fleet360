'use client';

/**
 * Portal — Lessee Contracts (read-only)
 * Shows all contracts belonging to the lessee identified by ?lesseeId=X.
 * Adapts header copy for B2B (Fleet Contracts) vs B2C (My Vehicle Contract).
 */

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

interface Lessee { id: string; name: string; type: string; }
interface Contract {
  id: string;
  contractNumber: string;
  leaseType: string;
  status: string;
  monthlyRate: number;
  startDate: string;
  endDate: string;
  vehicleCount: number;
  vehicles?: Array<{ id: string; type?: string; make?: string; model?: string; licensePlate?: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  EXTENDED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  TERMINATED: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  CLOSED: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  DRAFT: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

export default function PortalContractsPage() {
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const lesseeId = search.get('lesseeId') ?? '';

  const [lessee, setLessee] = useState<Lessee | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!lesseeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [lRes, cRes] = await Promise.all([
        fetch('/api/leasing/lessees'),
        fetch('/api/leasing/contracts-v2'),
      ]);
      const lData = lRes.ok ? await lRes.json() : [];
      const me = (Array.isArray(lData) ? lData : []).find((x: Lessee) => x.id === lesseeId) ?? null;
      setLessee(me);

      const cData = cRes.ok ? await cRes.json() : [];
      // Server returns lessee as the rendered name string; match by name as fallback.
      const mine = (Array.isArray(cData) ? cData : []).filter(
        (c: any) => c.lesseeId === lesseeId || (me && c.lessee === me.name),
      );
      setContracts(mine);
    } finally {
      setLoading(false);
    }
  }, [lesseeId]);

  useEffect(() => { load(); }, [load]);

  if (!lesseeId) {
    return (
      <div className="p-6">
        <p className="text-slate-400 text-sm">Pick a lessee first.</p>
        <Link href={`/portal/${tenantSlug}/leasing`} className="text-cyan-400 underline text-sm">
          ← Back to lessee picker
        </Link>
      </div>
    );
  }

  const isCorporate = lessee?.type === 'corporate';

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={`/portal/${tenantSlug}/leasing?lesseeId=${lesseeId}`}
          className="text-xs text-slate-500 hover:text-cyan-400"
        >
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-1">
          {isCorporate ? 'Fleet Contracts' : 'My Vehicle Contract'}
        </h1>
        {lessee && (
          <p className="text-sm text-slate-400 mt-1">
            {lessee.name} · {contracts.length} contract{contracts.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : contracts.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center">
          <p className="text-slate-400">No contracts on record yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Contract No.</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Vehicles</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3 text-right">Monthly Rate</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(c => (
                <tr key={c.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-white">{c.contractNumber}</td>
                  <td className="px-4 py-3 text-slate-300">{c.leaseType}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.vehicleCount ?? (Array.isArray(c.vehicles) ? c.vehicles.length : 0)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.startDate ? new Date(c.startDate).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.endDate ? new Date(c.endDate).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-white font-medium">
                    AED {Number(c.monthlyRate ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        STATUS_COLORS[c.status] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Read-only view. To request changes, contact your account manager.
      </p>
    </div>
  );
}
