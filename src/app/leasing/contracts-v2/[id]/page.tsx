'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface LeaseContractDetail {
  id: string;
  contractNumber?: string | null;
  status?: string | null;
  agreementType?: string | null;
  leaseType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  monthlyRate?: number | string | null;
  totalContractValue?: number | string | null;
  currency?: string | null;
  lessee?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  vehicles?: Array<{ id: string; licensePlate?: string | null; make?: string | null; model?: string | null; status?: string | null }>;
  payments2?: Array<{ id: string; dueDate?: string | null; amount?: number | string | null; status?: string | null }>;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toISOString().slice(0, 10);
}

function formatMoney(value?: number | string | null, currency = 'AED') {
  const amount = Number(value ?? 0);
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function LeaseContractDetailPage() {
  const params = useParams<{ id: string }>();
  const contractId = params?.id;
  const [contract, setContract] = useState<LeaseContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!contractId) return;
    let active = true;
    setLoading(true);
    setError('');
    fetch(`/api/leasing/contracts-v2/${encodeURIComponent(contractId)}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? 'Failed to load lease agreement');
        if (active) setContract(data);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load lease agreement');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [contractId]);

  const currency = contract?.currency ?? 'AED';
  const paymentSummary = useMemo(() => {
    const rows = contract?.payments2 ?? [];
    return {
      count: rows.length,
      total: rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    };
  }, [contract?.payments2]);

  if (loading) {
    return <div className="py-16 text-center text-slate-400">Loading lease agreement...</div>;
  }

  if (error || !contract) {
    return (
      <div className="space-y-4">
        <Link href="/leasing/workflow" className="text-sm text-blue-300 hover:text-blue-200">&larr; Back to Workflow</Link>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-100">
          {error || 'Lease agreement not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/leasing/workflow" className="text-sm text-blue-300 hover:text-blue-200">&larr; Back to Workflow</Link>
          <h1 className="mt-3 text-4xl font-bold text-white">{contract.contractNumber ?? `Contract ${contract.id.slice(0, 8)}`}</h1>
          <p className="mt-1 text-slate-400">Lease agreement review and approval context</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/leasing/contracts-v2/${contract.id}/pdf?lang=en&download=1`} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20">
            PDF EN
          </a>
          <a href={`/api/leasing/contracts-v2/${contract.id}/pdf?lang=ar&download=1`} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20">
            PDF AR
          </a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Status', contract.status ?? '-'],
          ['Agreement Type', contract.agreementType ?? '-'],
          ['Lease Type', contract.leaseType ?? '-'],
          ['Monthly Rate', formatMoney(contract.monthlyRate, currency)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-slate-800/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-lg font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-slate-800/50 p-6">
          <h2 className="text-lg font-bold text-white">Contract Details</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-slate-500">Start Date</dt><dd className="mt-1 text-white">{formatDate(contract.startDate)}</dd></div>
            <div><dt className="text-slate-500">End Date</dt><dd className="mt-1 text-white">{formatDate(contract.endDate)}</dd></div>
            <div><dt className="text-slate-500">Total Value</dt><dd className="mt-1 text-white">{formatMoney(contract.totalContractValue, currency)}</dd></div>
            <div><dt className="text-slate-500">Payments</dt><dd className="mt-1 text-white">{paymentSummary.count} rows · {formatMoney(paymentSummary.total, currency)}</dd></div>
          </dl>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-800/50 p-6">
          <h2 className="text-lg font-bold text-white">Lessee</h2>
          <div className="mt-4 space-y-2 text-sm">
            <p className="font-semibold text-white">{contract.lessee?.name ?? '-'}</p>
            <p className="text-slate-400">{contract.lessee?.email ?? '-'}</p>
            <p className="text-slate-400">{contract.lessee?.phone ?? '-'}</p>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-800/50 p-6">
        <h2 className="text-lg font-bold text-white">Vehicles</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-3 pr-4">Plate</th>
                <th className="py-3 pr-4">Vehicle</th>
                <th className="py-3 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {(contract.vehicles ?? []).map(vehicle => (
                <tr key={vehicle.id} className="border-b border-white/5">
                  <td className="py-3 pr-4 font-semibold text-white">{vehicle.licensePlate ?? '-'}</td>
                  <td className="py-3 pr-4 text-slate-300">{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '-'}</td>
                  <td className="py-3 pr-4 text-slate-300">{vehicle.status ?? '-'}</td>
                </tr>
              ))}
              {(contract.vehicles ?? []).length === 0 && (
                <tr><td colSpan={3} className="py-8 text-center text-slate-500">No vehicles linked to this agreement.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
