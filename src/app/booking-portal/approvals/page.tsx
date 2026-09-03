'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Building2,
  UserCheck,
  Truck,
  DollarSign,
  ShieldAlert,
  ChevronRight,
  Filter,
  Sparkles,
} from 'lucide-react';
import { PolicyEvaluationResult } from '@/lib/booking-approval-policy';

const SERVICE_STYLE: Record<string, { label: string; icon: string; color: string }> = {
  RENTAL:          { label: 'Rent-a-Car',     icon: '🚗', color: 'text-emerald-400' },
  LEASING:         { label: 'Leasing',         icon: '📋', color: 'text-blue-400'   },
  STAFF_TRANSPORT: { label: 'Staff Transport', icon: '🚌', color: 'text-purple-400' },
  EXECUTIVE:       { label: 'Executive',       icon: '⭐', color: 'text-amber-400'  },
  LOGISTICS:       { label: 'Logistics',       icon: '🚛', color: 'text-orange-400' },
  SCHOOL_BUS:      { label: 'School Bus',      icon: '🏫', color: 'text-yellow-400' },
};

interface ApprovalBooking {
  id: string;
  bookingRef: string | null;
  requestorName: string | null;
  requestorEmail: string | null;
  serviceType: string;
  vehicleCategory: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  createdAt: string | null;
  financials: {
    totalFareAed: number;
    fareSubtotal: number;
    vatAmount: number;
    costCenter: string;
    projectCode: string;
    billingMethod: string;
    budgetStatus: string;
    distanceKm: number;
    salikTollsAed: number;
    depotId: string;
    sampleModels: string;
  };
  policyEvaluation: PolicyEvaluationResult;
  approvalHistory: Array<{
    tier: number;
    tierName: string;
    approverName: string;
    approverRole: string;
    action: string;
    timestamp: string;
    remarks?: string;
  }>;
}

export default function MultiLevelApprovalsPage() {
  const [bookings, setBookings] = useState<ApprovalBooking[]>([]);
  const [stats, setStats] = useState({
    totalPending: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
    autoApprovedCount: 0,
  });
  const [activeTab, setActiveTab] = useState<'ALL' | 'TIER_1' | 'TIER_2' | 'TIER_3' | 'RESOLVED'>('ALL');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState('');
  const [actionFeedback, setActionFeedback] = useState<{ ref: string; message: string } | null>(null);

  const loadApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/booking-portal/approvals');
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to load approvals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const handleAction = async (
    bookingId: string,
    action: 'APPROVE_TIER_1' | 'APPROVE_TIER_2' | 'APPROVE_TIER_3' | 'REJECT',
    ref: string
  ) => {
    try {
      setProcessingId(bookingId);
      const res = await fetch('/api/booking-portal/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          action,
          approverName: 'Corporate Manager',
          approverRole:
            action === 'APPROVE_TIER_1'
              ? 'Line Manager'
              : action === 'APPROVE_TIER_2'
              ? 'Department Head'
              : 'Fleet Operations Lead',
        }),
      });

      if (res.ok) {
        setActionFeedback({
          ref,
          message:
            action === 'REJECT'
              ? 'Request rejected'
              : action === 'APPROVE_TIER_3'
              ? 'Final Dispatch Confirmed'
              : 'Approved and escalated to next tier',
        });
        setTimeout(() => setActionFeedback(null), 4000);
        await loadApprovals();
      }
    } catch (err) {
      console.error('Approval action error:', err);
    } finally {
      setProcessingId('');
    }
  };

  const filteredBookings = bookings.filter((b) => {
    if (activeTab === 'ALL') return b.status === 'PENDING';
    if (activeTab === 'TIER_1') return b.status === 'PENDING' && b.policyEvaluation.currentTier === 'TIER_1_PENDING';
    if (activeTab === 'TIER_2') return b.status === 'PENDING' && b.policyEvaluation.currentTier === 'TIER_2_PENDING';
    if (activeTab === 'TIER_3') return b.status === 'PENDING' && b.policyEvaluation.currentTier === 'TIER_3_PENDING';
    if (activeTab === 'RESOLVED') return b.status !== 'PENDING';
    return true;
  });

  return (
    <div className="space-y-8">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Corporate Travel Approvals</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Multi-tier hierarchical escalation & corporate travel policy compliance engine
          </p>
        </div>
        <button
          onClick={loadApprovals}
          className="self-start sm:self-auto text-xs text-slate-400 hover:text-white border border-white/10 rounded-xl px-4 py-2 hover:bg-white/5 transition-colors"
        >
          ↻ Refresh Queues
        </button>
      </div>

      {/* ── Action Feedback Toast ── */}
      {actionFeedback && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-3 text-emerald-300 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>
            Booking <strong className="font-mono text-white">{actionFeedback.ref}</strong>: {actionFeedback.message}
          </span>
        </div>
      )}

      {/* ── KPI Metrics Ribbon ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Pending</p>
          <p className="text-2xl font-bold font-mono text-white">{stats.totalPending}</p>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider mb-1">Tier 1: Line Manager</p>
          <p className="text-2xl font-bold font-mono text-purple-300">{stats.tier1Count}</p>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-1">Tier 2: Dept Head (&gt;1k)</p>
          <p className="text-2xl font-bold font-mono text-amber-300">{stats.tier2Count}</p>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider mb-1">Tier 3: Fleet Ops</p>
          <p className="text-2xl font-bold font-mono text-blue-300">{stats.tier3Count}</p>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">⚡ Auto-Approved</p>
          <p className="text-2xl font-bold font-mono text-emerald-300">{stats.autoApprovedCount}</p>
        </div>
      </div>

      {/* ── Filter Tabs ── */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        <button
          onClick={() => setActiveTab('ALL')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'ALL'
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          All Pending ({stats.totalPending})
        </button>

        <button
          onClick={() => setActiveTab('TIER_1')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'TIER_1'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Tier 1: Line Manager ({stats.tier1Count})
        </button>

        <button
          onClick={() => setActiveTab('TIER_2')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'TIER_2'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Tier 2: Dept Head &gt;AED 1k ({stats.tier2Count})
        </button>

        <button
          onClick={() => setActiveTab('TIER_3')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'TIER_3'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Tier 3: Fleet Dispatch ({stats.tier3Count})
        </button>

        <button
          onClick={() => setActiveTab('RESOLVED')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'RESOLVED'
              ? 'bg-slate-700 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Completed / History
        </button>
      </div>

      {/* ── Bookings List ── */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Evaluating policy compliance & loading approval queues…</p>
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="bg-slate-900/40 border border-white/8 rounded-2xl p-12 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-white font-semibold">No Pending Requests in this Queue</p>
          <p className="text-slate-500 text-xs mt-1">All bookings in this tier have been processed</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map((b) => {
            const svc = SERVICE_STYLE[b.serviceType] || { label: b.serviceType, icon: '🚗', color: 'text-white' };
            const isProcessing = processingId === b.id;
            const currentTier = b.policyEvaluation.currentTier;

            return (
              <div
                key={b.id}
                className="bg-slate-900/70 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all space-y-4"
              >
                {/* Header & Core Metadata */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{svc.icon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white text-base">
                          {b.bookingRef || b.id.slice(0, 8)}
                        </span>
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 ${svc.color}`}>
                          {svc.label}
                        </span>
                        {b.policyEvaluation.isAutoApproved && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Auto-Approved Commute
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Requested by <strong className="text-slate-300">{b.requestorName || 'Employee'}</strong> (
                        {b.requestorEmail || 'N/A'})
                      </p>
                    </div>
                  </div>

                  {/* Fare & Cost Center Pill */}
                  <div className="text-left sm:text-right">
                    <div className="text-lg font-bold font-mono text-emerald-400">
                      AED {Number(b.financials.totalFareAed || 0).toFixed(2)}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Cost Center: <strong className="text-slate-300">{b.financials.costCenter}</strong>
                    </p>
                  </div>
                </div>

                {/* Multi-Tier Approval Stepper */}
                <div className="bg-slate-950/40 border border-white/5 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Step 1: Line Manager */}
                  <div className="flex items-center gap-2 text-xs">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                        b.approvalHistory.some((h) => h.tier === 1) || b.policyEvaluation.isAutoApproved
                          ? 'bg-emerald-500 text-white'
                          : currentTier === 'TIER_1_PENDING'
                          ? 'bg-purple-600 text-white animate-pulse'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      1
                    </div>
                    <div>
                      <p className="font-semibold text-white">Tier 1: Line Manager</p>
                      <p className="text-[10px] text-slate-400">
                        {b.policyEvaluation.isAutoApproved
                          ? 'Auto-Approved Policy'
                          : b.approvalHistory.some((h) => h.tier === 1)
                          ? 'Approved ✅'
                          : 'Pending Sign-Off ⏳'}
                      </p>
                    </div>
                  </div>

                  <ChevronRight className="hidden md:block w-4 h-4 text-slate-600" />

                  {/* Step 2: Department Head */}
                  <div className="flex items-center gap-2 text-xs">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                        b.approvalHistory.some((h) => h.tier === 2)
                          ? 'bg-emerald-500 text-white'
                          : currentTier === 'TIER_2_PENDING'
                          ? 'bg-amber-600 text-white animate-pulse'
                          : !b.policyEvaluation.requiresTier2
                          ? 'bg-slate-800 text-slate-600'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      2
                    </div>
                    <div>
                      <p className="font-semibold text-white">Tier 2: Dept Head (&gt;AED 1k)</p>
                      <p className="text-[10px] text-slate-400">
                        {!b.policyEvaluation.requiresTier2
                          ? 'Policy Exempt (≤1k)'
                          : b.approvalHistory.some((h) => h.tier === 2)
                          ? 'Escalation Approved ✅'
                          : 'Pending VP Sign-Off ⏳'}
                      </p>
                    </div>
                  </div>

                  <ChevronRight className="hidden md:block w-4 h-4 text-slate-600" />

                  {/* Step 3: Fleet Operations */}
                  <div className="flex items-center gap-2 text-xs">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                        b.status === 'CONFIRMED'
                          ? 'bg-emerald-500 text-white'
                          : currentTier === 'TIER_3_PENDING'
                          ? 'bg-blue-600 text-white animate-pulse'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      3
                    </div>
                    <div>
                      <p className="font-semibold text-white">Tier 3: Fleet Dispatch</p>
                      <p className="text-[10px] text-slate-400">
                        {b.status === 'CONFIRMED' ? 'Dispatched ✅' : 'Vehicle Assignment ⏳'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Policy Violations & Warning Badges */}
                {b.policyEvaluation.policyViolations.length > 0 && (
                  <div className="space-y-1.5">
                    {b.policyEvaluation.policyViolations.map((v, i) => (
                      <div
                        key={i}
                        className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-3.5 py-2 flex items-center gap-2 text-amber-300 text-xs"
                      >
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        <span>{v.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action Toolbar */}
                {b.status === 'PENDING' && (
                  <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-white/5">
                    <button
                      onClick={() => handleAction(b.id, 'REJECT', b.bookingRef || b.id.slice(0, 8))}
                      disabled={isProcessing}
                      className="px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold border border-red-500/30 transition-colors disabled:opacity-40"
                    >
                      Reject Request
                    </button>

                    {currentTier === 'TIER_1_PENDING' && (
                      <button
                        onClick={() => handleAction(b.id, 'APPROVE_TIER_1', b.bookingRef || b.id.slice(0, 8))}
                        disabled={isProcessing}
                        className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-500/20 transition-all disabled:opacity-40"
                      >
                        {isProcessing ? 'Processing…' : 'Approve (Tier 1 Line Manager) →'}
                      </button>
                    )}

                    {currentTier === 'TIER_2_PENDING' && (
                      <button
                        onClick={() => handleAction(b.id, 'APPROVE_TIER_2', b.bookingRef || b.id.slice(0, 8))}
                        disabled={isProcessing}
                        className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-500/20 transition-all disabled:opacity-40"
                      >
                        {isProcessing ? 'Processing…' : 'Approve Financial Escalation (Tier 2) →'}
                      </button>
                    )}

                    {currentTier === 'TIER_3_PENDING' && (
                      <button
                        onClick={() => handleAction(b.id, 'APPROVE_TIER_3', b.bookingRef || b.id.slice(0, 8))}
                        disabled={isProcessing}
                        className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40"
                      >
                        {isProcessing ? 'Processing…' : 'Confirm Vehicle Dispatch (Tier 3) ✅'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
