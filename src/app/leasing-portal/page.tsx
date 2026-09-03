'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Receipt, AlertTriangle, FolderOpen } from 'lucide-react';

interface Contract { id: string; contractNumber: string | null; status: string; monthlyRate: number | string; endDate: string; vehicles: unknown[] }
interface Invoice { id: string; invoiceNo: string | null; status: string; totalAmount: number | string; dueDate: string }

export default function LeasingPortalDashboard() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, iRes] = await Promise.all([
          fetch('/api/leasing-portal/contracts'),
          fetch('/api/leasing-portal/invoices'),
        ]);
        setContracts(cRes.ok ? await cRes.json() : []);
        setInvoices(iRes.ok ? await iRes.json() : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-slate-400">Loading…</div>;

  const activeContracts = contracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED');
  const totalVehicles = contracts.reduce((s, c) => s + (Array.isArray(c.vehicles) ? c.vehicles.length : 0), 0);
  const monthlySpend = activeContracts.reduce((s, c) => s + Number(c.monthlyRate ?? 0), 0);
  const overdue = invoices.filter(i => i.status === 'OVERDUE');
  const overdueAmount = overdue.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="text-sm text-slate-400 mt-1">Here's an overview of your lease.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Active contracts" value={String(activeContracts.length)} />
        <KpiCard label="Vehicles" value={String(totalVehicles)} />
        <KpiCard label="Monthly spend" value={`AED ${monthlySpend.toLocaleString()}`} />
        <KpiCard
          label="Overdue invoices"
          value={overdue.length > 0 ? `${overdue.length} · AED ${overdueAmount.toLocaleString()}` : '—'}
          tone={overdue.length > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PortalLink href="/leasing-portal/contracts" icon={FileText} title="Contracts" subtitle={`${contracts.length} on record`} />
        <PortalLink href="/leasing-portal/invoices" icon={Receipt} title="Invoices & payments" subtitle={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`} />
        <PortalLink href="/leasing-portal/documents" icon={FolderOpen} title="Documents" subtitle="View and upload" />
        <PortalLink href="/leasing-portal/damage-reports" icon={AlertTriangle} title="Damage reports" subtitle="Report an issue" />
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`p-4 rounded-xl border ${tone === 'danger' ? 'bg-rose-900/20 border-rose-700/40' : 'bg-slate-800/40 border-slate-700'}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === 'danger' ? 'text-rose-300' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function PortalLink({ href, icon: Icon, title, subtitle }: { href: string; icon: typeof FileText; title: string; subtitle: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/40 border border-slate-700 hover:bg-slate-700/40 transition">
      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-cyan-400" />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
      </div>
    </Link>
  );
}
