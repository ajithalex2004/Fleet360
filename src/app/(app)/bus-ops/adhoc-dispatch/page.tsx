'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Zap,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  Plus,
  Send,
  Bus,
  Car,
  Ticket,
  ChevronDown,
  ChevronUp,
  Building2,
  Calendar,
} from 'lucide-react';
import type { FulfillmentCandidate } from '@/lib/bus-ops/adhoc-dispatch';

interface AdhocRequestItem {
  id: string;
  requestNo: string;
  requestType: string;
  tripDate: string;
  pickupLocation: string;
  dropLocation: string;
  reason: string;
  status: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  staffMember: {
    id: string;
    name: string;
    employeeId?: string | null;
    department?: string | null;
    contactNumber?: string | null;
  };
  candidates?: FulfillmentCandidate[];
}

export default function AdhocDispatchPage() {
  const [requests, setRequests] = useState<AdhocRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);

  // New Request Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; department?: string | null }>>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [pickupLoc, setPickupLoc] = useState('');
  const [dropLoc, setDropLoc] = useState('');
  const [tripDateTime, setTripDateTime] = useState('');
  const [reason, setReason] = useState('Production Overtime');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Fulfill / Reject state
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const fetchRequests = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch('/api/bus-ops/adhoc-requests');
      if (res.ok) {
        const data = await res.json();
        setRequests(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch adhoc requests:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    // Load staff list for new request modal
    fetch('/api/bus-ops/staff')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setStaffList(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [fetchRequests]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId || !tripDateTime || !pickupLoc || !dropLoc) {
      alert('Please fill in all required fields');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/bus-ops/adhoc-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffMemberId: selectedStaffId,
          tripDate: new Date(tripDateTime).toISOString(),
          pickupLocation: pickupLoc,
          dropLocation: dropLoc,
          reason,
          notes,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create request');
      }

      setShowCreateModal(false);
      setSelectedStaffId('');
      setPickupLoc('');
      setDropLoc('');
      setTripDateTime('');
      setNotes('');
      fetchRequests(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setCreating(false);
    }
  };

  const handleFulfill = async (requestId: string, candidate: FulfillmentCandidate) => {
    setActionBusyId(requestId);
    try {
      const res = await fetch(`/api/bus-ops/adhoc-requests/${requestId}/fulfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fulfill request');
      }

      fetchRequests(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to dispatch transport');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    const reasonText = prompt('Please specify a reason for declining this request:', 'Fleet capacity fully utilized');
    if (!reasonText) return;

    setActionBusyId(requestId);
    try {
      const res = await fetch(`/api/bus-ops/adhoc-requests/${requestId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasonText }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to reject request');
      }

      fetchRequests(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject request');
    } finally {
      setActionBusyId(null);
    }
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        r.requestNo.toLowerCase().includes(q) ||
        r.staffMember.name.toLowerCase().includes(q) ||
        (r.staffMember.department || '').toLowerCase().includes(q) ||
        (r.pickupLocation || '').toLowerCase().includes(q) ||
        (r.dropLocation || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [requests, statusFilter, searchQuery]);

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const fulfilledCount = requests.filter((r) => r.status === 'FULFILLED').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              ⚡ On-Demand Dispatch
            </span>
            <span className="text-xs text-slate-400">Multi-Tier Fulfillment Solver</span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">Overtime & Ad-Hoc Transport Dispatch</h1>
          <p className="text-sm text-slate-400">
            Automated capacity matching for unscheduled shifts: Route Fit $\rightarrow$ Standby Shuttle $\rightarrow$ Taxi Voucher.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchRequests()}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-lg shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New Ad-Hoc Request
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Pending Overtime Requests</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400">{pendingCount}</div>
          <p className="text-[11px] text-slate-500 mt-2">Requires dispatcher matching</p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Dispatched Today</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">{fulfilledCount}</div>
          <p className="text-[11px] text-slate-500 mt-2">Successful trip fulfillments</p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Ad-Hoc Volume</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{requests.length}</div>
          <p className="text-[11px] text-slate-500 mt-2">Logged this period</p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Avg Dispatch Time</span>
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-cyan-400">&lt; 2 min</div>
          <p className="text-[11px] text-slate-500 mt-2">Automated solver response</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-900/50 p-3 rounded-xl border border-slate-800">
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
          {(['ALL', 'PENDING', 'FULFILLED', 'REJECTED'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1 rounded-md font-medium transition ${
                statusFilter === tab
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'ALL' ? 'All Requests' : tab}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search employee, request no, location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Requests Queue */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-12 text-center text-slate-500 bg-slate-900/30 rounded-xl border border-slate-800">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-400" />
            Loading ad-hoc requests and computing smart match candidates...
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 text-center text-slate-500 bg-slate-900/30 rounded-xl border border-slate-800">
            No ad-hoc transport requests match the selected criteria.
          </div>
        ) : (
          filteredRequests.map((req) => {
            const isExpanded = expandedReqId === req.id;
            const isPending = req.status === 'PENDING';
            const tripDate = new Date(req.tripDate);

            return (
              <div
                key={req.id}
                className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700/80 transition"
              >
                {/* Main Card Summary */}
                <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-xs font-bold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30">
                        {req.requestNo}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          req.status === 'FULFILLED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : req.status === 'REJECTED'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {req.status}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {tripDate.toLocaleDateString()} at {tripDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-sm font-semibold text-white">
                      <span>{req.staffMember.name}</span>
                      {req.staffMember.department && (
                        <span className="text-xs font-normal text-indigo-300 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-500/20">
                          {req.staffMember.department}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate text-slate-300">{req.pickupLocation}</span>
                      <span className="text-slate-600">→</span>
                      <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span className="truncate text-slate-300">{req.dropLocation}</span>
                    </div>

                    <div className="text-xs text-slate-400">
                      <span className="text-slate-500 font-medium">Reason: </span>
                      <span className="text-slate-300 italic">{req.reason}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {isPending && (
                      <button
                        onClick={() => setExpandedReqId(isExpanded ? null : req.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        {isExpanded ? 'Hide Smart Match' : 'Smart Match Solver'}
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}

                    {isPending && (
                      <button
                        onClick={() => handleReject(req.id)}
                        disabled={actionBusyId === req.id}
                        className="px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 rounded-lg transition disabled:opacity-50"
                      >
                        Decline
                      </button>
                    )}

                    {req.status === 'FULFILLED' && req.notes && (
                      <div className="text-xs text-emerald-400 font-mono bg-emerald-950/30 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                        {req.notes.split('\n')[0]}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded Smart Match Solver Options */}
                {isExpanded && isPending && req.candidates && (
                  <div className="border-t border-slate-800 bg-slate-950/80 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        Evaluated Fulfillment Solutions for {req.staffMember.name}
                      </span>
                      <span className="text-[11px] text-slate-500">Pick preferred tier to dispatch</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {req.candidates.map((cand) => {
                        const isTier1 = cand.tier === 'ROUTE_INSERTION';
                        const isTier2 = cand.tier === 'STANDBY_SHUTTLE';
                        const isTier3 = cand.tier === 'TAXI_VOUCHER';

                        return (
                          <div
                            key={cand.tier}
                            className={`p-3.5 rounded-xl border flex flex-col justify-between space-y-3 transition ${
                              isTier1
                                ? 'bg-emerald-950/20 border-emerald-500/30 hover:border-emerald-500/60'
                                : isTier2
                                ? 'bg-indigo-950/20 border-indigo-500/30 hover:border-indigo-500/60'
                                : 'bg-slate-900/40 border-slate-700/50 hover:border-slate-600'
                            }`}
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                    isTier1
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : isTier2
                                      ? 'bg-indigo-500/20 text-indigo-300'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {cand.tier.replace('_', ' ')}
                                </span>
                                <span className="font-mono text-xs font-bold text-white">
                                  AED {cand.estimatedCost.toFixed(2)}
                                </span>
                              </div>

                              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                                {isTier1 && <Bus className="w-3.5 h-3.5 text-emerald-400" />}
                                {isTier2 && <Car className="w-3.5 h-3.5 text-indigo-400" />}
                                {isTier3 && <Ticket className="w-3.5 h-3.5 text-amber-400" />}
                                {cand.title}
                              </h4>

                              <p className="text-[11px] text-slate-400 leading-relaxed">
                                {cand.description}
                              </p>
                            </div>

                            <button
                              onClick={() => handleFulfill(req.id, cand)}
                              disabled={actionBusyId === req.id}
                              className={`w-full py-1.5 px-3 rounded-lg text-xs font-semibold text-white shadow-sm flex items-center justify-center gap-1.5 transition disabled:opacity-50 ${
                                isTier1
                                  ? 'bg-emerald-600 hover:bg-emerald-500'
                                  : isTier2
                                  ? 'bg-indigo-600 hover:bg-indigo-500'
                                  : 'bg-slate-700 hover:bg-slate-600'
                              }`}
                            >
                              <Send className="w-3 h-3" />
                              {actionBusyId === req.id ? 'Dispatching...' : 'Dispatch This Tier'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* New Request Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                  ⚡ Ad-Hoc Request Portal
                </span>
                <h3 className="text-lg font-bold text-white mt-1">Submit Overtime / Ad-Hoc Transport</h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-500 hover:text-slate-300 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Select Employee / Rider *</label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Choose Employee --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.department ? `(${s.department})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Required Pickup Date & Time *</label>
                <input
                  type="datetime-local"
                  value={tripDateTime}
                  onChange={(e) => setTripDateTime(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Pickup Location *</label>
                  <input
                    type="text"
                    placeholder="e.g. JAFZA Plant Gate 3"
                    value={pickupLoc}
                    onChange={(e) => setPickupLoc(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Drop-off Location *</label>
                  <input
                    type="text"
                    placeholder="e.g. DIP Staff Accommodations"
                    value={dropLoc}
                    onChange={(e) => setDropLoc(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Overtime / Ad-Hoc Reason *</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="Production Overtime">Production Overtime Shift</option>
                  <option value="Emergency Plant Maintenance">Emergency Plant Maintenance</option>
                  <option value="Flight / Port Turnaround Delay">Flight / Port Turnaround Delay</option>
                  <option value="Hospital Emergency Coverage">Hospital Emergency Coverage</option>
                  <option value="Ad-Hoc Business Meeting">Ad-Hoc Business Meeting</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Special Dispatch Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. 2 heavy toolboxes, gate pass required"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-xl shadow transition disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {creating ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
