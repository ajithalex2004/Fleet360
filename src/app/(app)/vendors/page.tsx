/**
 * Vendors & Partner Procurement module — Unified Cross-Domain Landing Page.
 * Consolidates Transport Partner Outsourcing across Passenger, Freight, Recovery & Limousine,
 * alongside Maintenance Garages and Supplier Procurement.
 */
import Link from 'next/link';
import { Building2, Send, ArrowLeftRight, Globe, Trophy, Receipt, Truck, ShieldCheck } from 'lucide-react';

export default function VendorsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Vendor &amp; Partner Management</h1>
        <p className="mt-1 text-slate-400 text-sm">
          Unified procurement and external partner operations across Transport Outsourcing (Passenger, Freight, Recovery, Limo) and Maintenance Garages.
        </p>
      </div>

      {/* Cross-Domain Outsourcing Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-cyan-400" />
            <h2 className="text-base font-semibold text-white">Transport Outsourcing &amp; Partner Exchange</h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">Passenger • Freight • Recovery • Limousine</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/exchange/jobs"
            className="group rounded-xl border border-cyan-500/30 bg-slate-900/90 p-5 hover:border-cyan-400 hover:bg-slate-800/80 transition-all duration-200 hover:shadow-lg hover:shadow-cyan-500/10 block"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-cyan-500/20 p-2 text-cyan-400">
                <ArrowLeftRight className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors">
                Outsource Management
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Dispatch, assign, and track outsourced trips and loads across all transport domains with live GPS telematics.
            </p>
          </Link>

          <Link
            href="/exchange/marketplace"
            className="group rounded-xl border border-white/10 bg-slate-900/90 p-5 hover:border-blue-500/40 hover:bg-slate-800/80 transition-all duration-200 block"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-blue-500/20 p-2 text-blue-400">
                <Globe className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-white group-hover:text-blue-300 transition-colors">
                Partner Marketplace
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Broadcast RFQs and spot requirements to vetted transport carriers with blind competitive bidding.
            </p>
          </Link>

          <Link
            href="/exchange/scorecard"
            className="group rounded-xl border border-white/10 bg-slate-900/90 p-5 hover:border-amber-500/40 hover:bg-slate-800/80 transition-all duration-200 block"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-amber-500/20 p-2 text-amber-400">
                <Trophy className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">
                Partner Scorecards &amp; SLAs
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Evaluate on-time performance (OTP %), exception rates, POD quality, and tier rankings (Platinum to Bronze).
            </p>
          </Link>

          <Link
            href="/exchange/statements"
            className="group rounded-xl border border-white/10 bg-slate-900/90 p-5 hover:border-emerald-500/40 hover:bg-slate-800/80 transition-all duration-200 block"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400">
                <Receipt className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">
                Settlements &amp; Invoices
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              3-way financial reconciliation, consolidated partner statements, and downloadable UAE FTA Tax Invoices.
            </p>
          </Link>
        </div>
      </div>

      {/* Maintenance Garages & Repair Vendors Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-blue-400" />
            <h2 className="text-base font-semibold text-white">Maintenance Garages &amp; Repair Vendors</h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">Work Orders • Quotations • Garages</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/vendors/garages"
            className="group rounded-xl border border-white/10 bg-slate-900 p-6 hover:border-blue-500/40 hover:bg-slate-800/70 transition-all block"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-blue-500/20 p-2">
                <Building2 className="h-5 w-5 text-blue-400" />
              </div>
              <h3 className="text-base font-semibold text-white group-hover:text-blue-300 transition-colors">
                Garage Management
              </h3>
            </div>
            <p className="text-sm text-slate-400">
              Register and manage approved repair centres, track maintenance SLA performance, and maintain commercial contracts.
            </p>
          </Link>

          <Link
            href="/vendors/garage-portal"
            className="group rounded-xl border border-white/10 bg-slate-900 p-6 hover:border-emerald-500/40 hover:bg-slate-800/70 transition-all block"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-emerald-500/20 p-2">
                <Send className="h-5 w-5 text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold text-white group-hover:text-emerald-300 transition-colors">
                Garage Quotation Portal
              </h3>
            </div>
            <p className="text-sm text-slate-400">
              Vendor-facing portal for external garages to submit, revise, and track repair quotations against maintenance work orders.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
