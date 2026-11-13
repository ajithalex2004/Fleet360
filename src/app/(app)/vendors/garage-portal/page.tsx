/**
 * Garage Portal — owned by the Vendors module (Phase B migration from Maintenance).
 * Previously at /maintenance/garage-portal.
 */
'use client';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';

import { Send, FileText, CheckCircle2, Clock } from 'lucide-react';

export default function VendorGaragePortalPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)]">Garage Portal</h1>
        <p className="text-xs mt-1 text-[var(--text-faint)]">
          Vendor-facing portal for submitting and managing quotations against work orders.
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm text-amber-300">
          <span className="font-semibold">Domain ownership:</span> The Garage Portal is now part
          of the Vendors &amp; Procurement module. Previously at{' '}
          <code className="rounded bg-[var(--bg-surface)] px-1 text-xs">/maintenance/garage-portal</code>.
        </p>
      </div>

      <StatGrid cols={3}>
        <KpiCard label="Pending submissions" value="—" icon={FileText} accent="cyan" />
        <KpiCard label="Submitted this month" value="—" icon={CheckCircle2} accent="emerald" />
        <KpiCard label="Awaiting approval" value="—" icon={Clock} accent="amber" />
      </StatGrid>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center">
        <Send className="h-12 w-12 text-[var(--text-faint)] mx-auto mb-3" />
        <p className="text-[var(--text-muted)] font-medium">Vendor quotation submission portal</p>
        <p className="text-[var(--text-faint)] text-sm mt-1">
          Full implementation coming in Vendor Portal v1.0.
        </p>
      </div>
    </div>
  );
}
