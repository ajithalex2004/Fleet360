/**
 * Vendors & Procurement module — landing page.
 * Consolidates garage / vendor management from the Maintenance module (Phase B).
 */
import Link from 'next/link';
import { Building2, Send } from 'lucide-react';

export default function VendorsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Vendors &amp; Procurement</h1>
        <p className="mt-1 text-slate-500">
          Manage approved garages, supplier contracts, and the vendor quotation portal.
        </p>
      </div>

      {/* Phase B migration notice */}
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
        <p className="text-sm text-blue-300">
          <span className="font-semibold">Phase B migration:</span> Garage management and the
          Garage Portal have been consolidated here from the Maintenance module.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/vendors/garages"
          className="group rounded-xl border border-white/10 bg-slate-900 p-6 hover:border-blue-500/40 hover:bg-slate-800/70 transition-all"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Building2 className="h-5 w-5 text-blue-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Garage management</h2>
          </div>
          <p className="text-sm text-slate-500">
            Register and manage approved repair centres, track SLA performance, and maintain
            contact details.
          </p>
        </Link>

        <Link
          href="/vendors/garage-portal"
          className="group rounded-xl border border-white/10 bg-slate-900 p-6 hover:border-blue-500/40 hover:bg-slate-800/70 transition-all"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-emerald-500/20 p-2">
              <Send className="h-5 w-5 text-emerald-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Garage portal</h2>
          </div>
          <p className="text-sm text-slate-500">
            Vendor-facing portal for submitting, revising, and tracking quotations against work
            orders.
          </p>
        </Link>
      </div>
    </div>
  );
}
