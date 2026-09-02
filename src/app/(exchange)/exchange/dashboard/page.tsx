/**
 * src/app/(exchange)/exchange/dashboard/page.tsx
 *
 * Partner Dashboard Overview for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Award,
  Truck,
  FileText,
  ArrowUpRight,
  Clock,
  MapPin,
  CheckCircle2,
  DollarSign,
  AlertCircle,
} from 'lucide-react';

export default function ExchangeDashboardPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [resReq, resAward] = await Promise.all([
          fetch('/api/exchange/jobs/requests').then((r) => r.json()),
          fetch('/api/exchange/jobs/awards').then((r) => r.json()),
        ]);
        setRequests(resReq.requests || []);
        setAwards(resAward.awards || []);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-cyan-950/60 via-slate-900 to-slate-900 border border-cyan-500/20 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Transport Partner Dashboard</span>
          <h1 className="text-2xl font-black text-white mt-1">Welcome back, ABC Transport</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage your outsourced trips, submit commercial quotes, dispatch vehicles & drivers, and track invoices.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/exchange/jobs"
            className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition"
          >
            <span>View Open Requests</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">New Requests</span>
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">{requests.length}</div>
          <div className="text-[11px] text-cyan-400">Awaiting your quotation</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Awarded Jobs</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">{awards.length}</div>
          <div className="text-[11px] text-emerald-400">Active contracts & trips</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Fleet & Drivers</span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">12 Buses</div>
          <div className="text-[11px] text-purple-400">14 Active drivers ready</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Invoiced Revenue</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">AED 42,800</div>
          <div className="text-[11px] text-amber-400">Net 30 settlement cycle</div>
        </div>
      </div>

      {/* Main Grid: Pending Requests & Recent Awards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Requests */}
        <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white">Open Outsource Requests</h2>
            </div>
            <Link href="/exchange/jobs" className="text-xs text-cyan-400 hover:underline">
              View all
            </Link>
          </div>

          {requests.length > 0 ? (
            <div className="space-y-3">
              {requests.slice(0, 3).map((r) => (
                <div key={r.id} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-cyan-400 font-bold">{r.requestNumber}</span>
                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-[10px] font-bold">
                      {r.pricingMethod}
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>{r.pickupLocation} → {r.dropoffLocation}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(r.serviceDate).toLocaleDateString()} at {r.pickupTime}</span>
                    </div>
                    <Link
                      href="/exchange/jobs"
                      className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] transition"
                    >
                      Quote Now
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-slate-500 rounded-2xl bg-slate-950/40 border border-slate-800/40">
              No open requests awaiting quotes right now.
            </div>
          )}
        </div>

        {/* Awarded Jobs */}
        <div className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold text-white">Awarded Jobs & Execution</h2>
            </div>
            <Link href="/exchange/jobs" className="text-xs text-emerald-400 hover:underline">
              View all
            </Link>
          </div>

          {awards.length > 0 ? (
            <div className="space-y-3">
              {awards.slice(0, 3).map((a) => (
                <div key={a.id} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-emerald-400 font-bold">{a.request?.requestNumber || a.id.slice(0, 8)}</span>
                    <span className="font-bold text-white">AED {Number(a.totalAwarded).toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-slate-300 flex items-center justify-between">
                    <span>{a.request?.pickupLocation} → {a.request?.dropoffLocation}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold">
                      {a.status}
                    </span>
                  </div>
                  <div className="pt-1 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">
                      Vehicle: {a.assignment?.vehiclePlate || 'Not assigned yet'}
                    </span>
                    <Link
                      href="/exchange/jobs"
                      className="text-cyan-400 hover:underline font-semibold"
                    >
                      {a.assignment ? 'View Driver Link' : 'Assign Driver →'}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-slate-500 rounded-2xl bg-slate-950/40 border border-slate-800/40">
              No awarded jobs yet. Submit quotes on open requests to receive awards.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
