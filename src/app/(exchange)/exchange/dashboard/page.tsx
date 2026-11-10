/**
 * src/app/(exchange)/exchange/dashboard/page.tsx
 *
 * Phase 8 & Phase 13: Partner Dashboard Overview with Live Pre-Dispatch Compliance
 * Readiness Banner, 5-KPI Trust Scorecard Breakdown, SLA Exception History, and
 * Multi-Vertical Job & Revenue Tracking.
 */

'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Award,
  Truck,
  ArrowUpRight,
  Clock,
  MapPin,
  DollarSign,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Activity,
} from 'lucide-react';
import { usePartnerMembership } from '@/components/exchange/PartnerMembershipContext';
import { PartnerTierBadge } from '@/components/exchange/PartnerTierBadge';

export default function ExchangeDashboardPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [scorecard, setScorecard] = useState<any | null>(null);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [recalculatingScorecard, setRecalculatingScorecard] = useState(false);
  const [invoices, setInvoices] = useState<Array<{ totalAmount: string | number; status: string }> | null>(null);
  const [loading, setLoading] = useState(true);
  const membership = usePartnerMembership();
  const partnerName = membership.status === 'ok' ? membership.partner.legalName : null;

  const refreshScorecard = useCallback(async () => {
    setRecalculatingScorecard(true);
    try {
      const postRes = await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'EVALUATE' }),
      });
      if (postRes.ok) {
        const postJson = await postRes.json();
        if (postJson?.evaluation) {
          setScorecard((prev: any) => ({ ...(prev || {}), ...postJson.evaluation }));
        }
      }
      const getRes = await fetch('/api/exchange/scorecard');
      if (getRes.ok) {
        const getJson = await getRes.json();
        if (getJson?.scorecard) setScorecard(getJson.scorecard);
        if (Array.isArray(getJson?.exceptions)) setExceptions(getJson.exceptions);
      }
    } catch {
      // Ignore transient refresh errors
    } finally {
      setRecalculatingScorecard(false);
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const [resReq, resAward, resFleet, resDrivers, resInvoices, resDocs, resScore] = await Promise.all([
          get('/api/exchange/jobs/requests'),
          get('/api/exchange/jobs/awards'),
          get('/api/exchange/partner/fleet'),
          get('/api/exchange/partner/drivers'),
          get('/api/exchange/invoices'),
          get('/api/exchange/partner/compliance'),
          get('/api/exchange/scorecard'),
        ]);
        setRequests(resReq?.requests || []);
        setAwards(resAward?.awards || []);
        if (resFleet) setVehicles(resFleet.vehicles || []);
        if (resDrivers) setDrivers(resDrivers.drivers || []);
        if (resInvoices) setInvoices(resInvoices.invoices || []);
        if (resDocs) setDocs(resDocs.documents || []);
        if (resScore?.scorecard) setScorecard(resScore.scorecard);
        if (Array.isArray(resScore?.exceptions)) setExceptions(resScore.exceptions);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  const invoicedTotal =
    invoices === null
      ? null
      : invoices.filter((i) => i.status !== 'REJECTED').reduce((sum, i) => sum + Number(i.totalAmount || 0), 0);

  // Compute Pre-Dispatch Gate alerts across Company Docs, Vehicles (Mulkiya), and Drivers (License/Permit)
  const complianceReadiness = useMemo(() => {
    const now = Date.now();
    const soonCutoff = now + 30 * 24 * 60 * 60 * 1000;

    let expiredVehicles = 0;
    let expiringVehicles = 0;
    for (const v of vehicles) {
      if (!v.mulkiyaExpiry) continue;
      const ms = new Date(v.mulkiyaExpiry).getTime();
      if (Number.isNaN(ms)) continue;
      if (ms < now) expiredVehicles += 1;
      else if (ms <= soonCutoff) expiringVehicles += 1;
    }

    let expiredDrivers = 0;
    let expiringDrivers = 0;
    for (const d of drivers) {
      const dates = [d.licenseExpiry, d.permitExpiry]
        .filter(Boolean)
        .map((iso) => new Date(iso as string).getTime())
        .filter((ms) => !Number.isNaN(ms));
      if (dates.length === 0) continue;
      const minMs = Math.min(...dates);
      if (minMs < now) expiredDrivers += 1;
      else if (minMs <= soonCutoff) expiringDrivers += 1;
    }

    let expiredDocs = 0;
    let expiringDocs = 0;
    for (const doc of docs) {
      if (doc.status === 'EXPIRED' || doc.status === 'REJECTED') {
        expiredDocs += 1;
        continue;
      }
      if (doc.expiryDate) {
        const ms = new Date(doc.expiryDate).getTime();
        if (!Number.isNaN(ms)) {
          if (ms < now) expiredDocs += 1;
          else if (ms <= soonCutoff) expiringDocs += 1;
        }
      }
    }

    const totalBlocked = expiredVehicles + expiredDrivers + expiredDocs;
    const totalExpiring = expiringVehicles + expiringDrivers + expiringDocs;

    return {
      expiredVehicles,
      expiringVehicles,
      expiredDrivers,
      expiringDrivers,
      expiredDocs,
      expiringDocs,
      totalBlocked,
      totalExpiring,
    };
  }, [vehicles, drivers, docs]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-cyan-950/60 via-slate-900 to-slate-900 border border-cyan-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
              Transport Partner Dashboard
            </span>
            {scorecard?.tier && <PartnerTierBadge tier={scorecard.tier} score={scorecard.compositeScore} />}
          </div>
          <h1 className="text-2xl font-black text-white mt-1">
            {partnerName ? `Welcome back, ${partnerName}` : 'Welcome back'}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage outsourced Bus, Freight, Limousine, and Recovery trips, submit blind quotes, and track 3-way matched settlements.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/exchange/marketplace"
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 flex items-center gap-1.5 transition"
          >
            <span>Open Marketplace</span>
          </Link>
          <Link
            href="/exchange/jobs"
            className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition"
          >
            <span>View Open Requests</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Stage-3 Pre-Dispatch Compliance Readiness Banner */}
      {!loading && (complianceReadiness.totalBlocked > 0 || complianceReadiness.totalExpiring > 0) ? (
        <div
          className={`p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs ${
            complianceReadiness.totalBlocked > 0
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                complianceReadiness.totalBlocked > 0 ? 'text-rose-400' : 'text-amber-400'
              }`}
            />
            <div>
              <div className="font-bold">
                {complianceReadiness.totalBlocked > 0
                  ? `Stage-3 Pre-Dispatch Gate Alert: ${complianceReadiness.totalBlocked} expired item(s) blocked from dispatch`
                  : `Proactive Renewal Notice: ${complianceReadiness.totalExpiring} credential(s) expiring within 30 days`}
              </div>
              <div className="text-[11px] opacity-85 mt-0.5">
                Company Docs: {complianceReadiness.expiredDocs} expired / {complianceReadiness.expiringDocs} expiring ·
                Fleet Mulkiya: {complianceReadiness.expiredVehicles} expired / {complianceReadiness.expiringVehicles}{' '}
                expiring · Driver Credentials: {complianceReadiness.expiredDrivers} expired /{' '}
                {complianceReadiness.expiringDrivers} expiring
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/exchange/compliance"
              className="px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white font-semibold text-[11px] border border-slate-700"
            >
              Compliance Vault
            </Link>
            <Link
              href="/exchange/fleet"
              className="px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white font-semibold text-[11px] border border-slate-700"
            >
              Fleet Mulkiya
            </Link>
            <Link
              href="/exchange/drivers"
              className="px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white font-semibold text-[11px] border border-slate-700"
            >
              Driver Permits
            </Link>
          </div>
        </div>
      ) : !loading ? (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">
              All 3 Compliance Gates Active (Award, Assignment & Pre-Dispatch): Company KYB, Fleet Mulkiya, and Driver Permits are current.
            </span>
          </div>
          <Link href="/exchange/compliance" className="text-[11px] text-emerald-400 hover:underline font-bold">
            View Vault →
          </Link>
        </div>
      ) : null}

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
          <div className="text-2xl font-black text-white">
            {`${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'}`}
          </div>
          <div className="text-[11px] text-purple-400">
            {`${drivers.length} active ${drivers.length === 1 ? 'driver' : 'drivers'}`}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold">Invoiced Revenue</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">
            {invoicedTotal === null ? '—' : `AED ${invoicedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          </div>
          <div className="text-[11px] text-amber-400">
            {invoices === null
              ? 'Invoices unavailable'
              : `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'} · ${invoices.filter((i) => i.status === 'PAID').length} paid`}
          </div>
        </div>
      </div>

      {/* Phase 13: Partner Trust Scorecard, 5-KPI SLA Breakdown & Exception History */}
      <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white">
                Partner Trust Scorecard & 5-Factor SLA Breakdown
              </h2>
              {scorecard?.tier && (
                <PartnerTierBadge tier={scorecard.tier} score={scorecard.compositeScore} />
              )}
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-semibold">
                {Number(scorecard?.completedTrips ?? 0)} / {Number(scorecard?.totalAwardedTrips ?? awards.length)} trips completed
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Deterministic multi-factor SLA score (0–100) governing Preferred Exclusive Window priority and Tier progression (PLATINUM ≥ 90 · GOLD ≥ 80 · SILVER ≥ 70 · BRONZE ≥ 60).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {scorecard?.evaluatedAt && (
              <span className="text-[10px] text-slate-500">
                Updated {new Date(scorecard.evaluatedAt).toLocaleDateString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => void refreshScorecard()}
              disabled={recalculatingScorecard}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-300 font-bold text-xs border border-slate-700 flex items-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recalculatingScorecard ? 'animate-spin' : ''}`} />
              <span>{recalculatingScorecard ? 'Evaluating...' : 'Recalculate SLA'}</span>
            </button>
          </div>
        </div>

        {/* 5 Weighted SLA KPIs */}
        {(() => {
          const otp = Number(scorecard?.onTimePerformance ?? 100);
          const podQuality = Number(scorecard?.podQualityRate ?? 100);
          const quoteResp = Number(scorecard?.quoteResponseRate ?? 100);
          const exceptionRate = Number(scorecard?.exceptionRate ?? 0);
          const reliabilityRate = Math.max(0, 100 - exceptionRate);
          const disputeRate = Number(scorecard?.disputeRate ?? 0);
          const commercialAccuracy = Math.max(0, 100 - disputeRate);

          const kpis = [
            {
              label: 'On-Time Performance',
              weight: '40% Weight',
              value: otp,
              detail: `${Number(scorecard?.onTimeTrips ?? 0)} on-time · ${Number(scorecard?.lateTrips ?? 0)} late (15m grace)`,
              color: otp >= 90 ? 'bg-emerald-500' : otp >= 75 ? 'bg-amber-500' : 'bg-rose-500',
              textColor: otp >= 90 ? 'text-emerald-400' : otp >= 75 ? 'text-amber-400' : 'text-rose-400',
            },
            {
              label: 'ePOD Quality Rate',
              weight: '20% Weight',
              value: podQuality,
              detail: 'Signed & photo-verified Proof of Delivery',
              color: podQuality >= 90 ? 'bg-cyan-500' : podQuality >= 75 ? 'bg-amber-500' : 'bg-rose-500',
              textColor: podQuality >= 90 ? 'text-cyan-400' : podQuality >= 75 ? 'text-amber-400' : 'text-rose-400',
            },
            {
              label: 'Quote Responsiveness',
              weight: '15% Weight',
              value: quoteResp,
              detail: `${Number(scorecard?.quotesSubmitted ?? 0)} / ${Number(scorecard?.quotesInvited ?? 0)} invited RFQs quoted`,
              color: quoteResp >= 85 ? 'bg-indigo-500' : quoteResp >= 65 ? 'bg-amber-500' : 'bg-rose-500',
              textColor: quoteResp >= 85 ? 'text-indigo-400' : quoteResp >= 65 ? 'text-amber-400' : 'text-rose-400',
            },
            {
              label: 'Operational Reliability',
              weight: '15% Weight',
              value: reliabilityRate,
              detail: `${Number(scorecard?.exceptionsCount ?? exceptions.length)} SLA exception(s) (${exceptionRate.toFixed(1)}% rate)`,
              color: reliabilityRate >= 95 ? 'bg-emerald-500' : reliabilityRate >= 85 ? 'bg-amber-500' : 'bg-rose-500',
              textColor: reliabilityRate >= 95 ? 'text-emerald-400' : reliabilityRate >= 85 ? 'text-amber-400' : 'text-rose-400',
            },
            {
              label: 'Commercial Accuracy',
              weight: '10% Weight',
              value: commercialAccuracy,
              detail: `${Number(scorecard?.disputesCount ?? 0)} invoice dispute(s) (${disputeRate.toFixed(1)}% rate)`,
              color: commercialAccuracy >= 95 ? 'bg-purple-500' : commercialAccuracy >= 85 ? 'bg-amber-500' : 'bg-rose-500',
              textColor: commercialAccuracy >= 95 ? 'text-purple-400' : commercialAccuracy >= 85 ? 'text-amber-400' : 'text-rose-400',
            },
          ];

          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/80 flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-slate-300">{kpi.label}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                      {kpi.weight}
                    </span>
                  </div>
                  <div className={`text-xl font-black ${kpi.textColor}`}>
                    {kpi.value.toFixed(1)}%
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${kpi.color}`}
                      style={{ width: `${Math.min(100, Math.max(0, kpi.value))}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400">{kpi.detail}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* SLA Exception & Governed Failover History */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">
              Recent SLA Exceptions & Governed Failover Log
            </span>
            <span className="text-[11px] text-slate-400">
              {exceptions.length === 0
                ? 'Zero active SLA defaults'
                : `${exceptions.length} recorded exception${exceptions.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {exceptions.length > 0 ? (
            <div className="space-y-2">
              {exceptions.slice(0, 4).map((ex: any) => (
                <div
                  key={ex.id}
                  className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          ex.severity === 'CRITICAL'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : ex.severity === 'HIGH'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {ex.severity || 'HIGH'} · {String(ex.type || 'SLA_EXCEPTION').replace(/_/g, ' ')}
                      </span>
                      {ex.award?.request?.requestNumber && (
                        <span className="font-mono text-cyan-400 font-bold text-[11px]">
                          {ex.award.request.requestNumber}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          ex.status === 'RESOLVED'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {ex.status}
                      </span>
                    </div>
                    <div className="text-slate-300 text-[11px]">{ex.description}</div>
                    {ex.resolutionNotes && (
                      <div className="text-[11px] text-slate-400">
                        Resolution: {ex.resolutionNotes}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 shrink-0">
                    {ex.createdAt ? new Date(ex.createdAt).toLocaleString() : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Clean SLA track record — no vehicle breakdowns, no-shows, or governed failover penalties recorded against your partner account.
              </span>
            </div>
          )}
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
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-cyan-400 font-bold">{r.requestNumber}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[9px] font-bold">
                        {r.domain || 'PASSENGER_TRANSPORT'}
                      </span>
                    </div>
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
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-emerald-400 font-bold">
                        {a.request?.requestNumber || a.id.slice(0, 8)}
                      </span>
                      {a.commercialSnapshot?.commercialModel && (
                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[9px] font-mono">
                          {a.commercialSnapshot.commercialModel}
                        </span>
                      )}
                    </div>
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
