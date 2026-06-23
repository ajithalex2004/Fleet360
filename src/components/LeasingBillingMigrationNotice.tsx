'use client';

import Link from 'next/link';
import { ArrowRightLeft, Building2 } from 'lucide-react';

export function LeasingBillingMigrationNotice({
  title,
  financeHref,
  description,
}: {
  title: string;
  financeHref: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6 py-10">
      <div className="w-full rounded-2xl border border-emerald-500/20 bg-slate-900/80 p-8 shadow-2xl">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
          <ArrowRightLeft className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">{title} moved to Finance & Billing</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {description}
        </p>
        <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
          Vehicle Leasing remains the operational source. Finance & Billing is now the canonical place for invoice controls,
          reconciliation, approvals, and audit-backed financial actions.
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={financeHref}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Open in Finance <Building2 className="h-4 w-4" />
          </Link>
          <Link
            href="/finance/leasing-billing"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Leasing Billing Hub
          </Link>
        </div>
      </div>
    </div>
  );
}
