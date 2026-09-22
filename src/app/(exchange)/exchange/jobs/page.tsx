/**
 * src/app/(exchange)/exchange/jobs/page.tsx
 *
 * Jobs & Outsourced Trips Management for Transport Partners.
 * Handles Requests, Quote Submissions, Awards, Vehicle/Driver Assignments, and Driver Execution Links.
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  Clock,
  MapPin,
  CheckCircle2,
  Copy,
  ExternalLink,
  Send,
  X,
} from 'lucide-react';

interface PartnerQuoteRow {
  id: string;
  revisionNo: number;
  amount: number | string;
  vatAmount: number | string;
  totalAmount: number | string;
  currency: string;
  status: string;
  notes?: string | null;
}

interface OutsourceRequestRow {
  id: string;
  requestNumber: string;
  domain: string;
  pricingMethod: string;
  status: string;
  serviceDate: string;
  pickupTime: string;
  pickupLocation: string;
  dropoffLocation: string;
  requiredCapacity: number;
  vehicleTypeRequired?: string | null;
  specialInstructions?: string | null;
  // OutsourceRequest itself has no closesAt column — it lives on the related
  // MarketplaceOpportunity (only present once the request has been published).
  opportunity?: { closesAt?: string | null } | null;
  quotes?: PartnerQuoteRow[];
}

interface PartnerAssignmentRow {
  id: string;
  vehiclePlate?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  pod?: {
    passengerCount?: number | null;
    signedByName?: string | null;
  } | null;
}

interface OutsourceAwardRow {
  id: string;
  status: string;
  totalAwarded: number | string;
  partnerId: string;
  request?: OutsourceRequestRow | null;
  assignment?: PartnerAssignmentRow | null;
}

interface PartnerVehicleRow {
  id: string;
  licensePlate: string;
  vehicleType: string;
}

interface PartnerDriverRow {
  id: string;
  fullName: string;
  mobileNumber: string;
}

export default function ExchangeJobsPage() {
  const [activeTab, setActiveTab] = useState<'REQUESTS' | 'AWARDS'>('REQUESTS');
  const [requests, setRequests] = useState<OutsourceRequestRow[]>([]);
  const [awards, setAwards] = useState<OutsourceAwardRow[]>([]);
  const [vehicles, setVehicles] = useState<PartnerVehicleRow[]>([]);
  const [drivers, setDrivers] = useState<PartnerDriverRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [selectedRequestForQuote, setSelectedRequestForQuote] = useState<OutsourceRequestRow | null>(null);
  const [selectedAwardForAssign, setSelectedAwardForAssign] = useState<OutsourceAwardRow | null>(null);
  const [generatedDriverLink, setGeneratedDriverLink] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [resReq, resAward, resVeh, resDrv] = await Promise.all([
        fetch('/api/exchange/jobs/requests').then((r) => r.json()),
        fetch('/api/exchange/jobs/awards').then((r) => r.json()),
        fetch('/api/exchange/partner/fleet').then((r) => r.json()),
        fetch('/api/exchange/partner/drivers').then((r) => r.json()),
      ]);
      setRequests(resReq.requests || []);
      setAwards(resAward.awards || []);
      setVehicles(resVeh.vehicles || []);
      setDrivers(resDrv.drivers || []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Title & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Jobs & Outsourced Trips</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Review invitations, submit quotations, assign resources, and monitor driver milestone execution.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-2xl">
          <button
            onClick={() => setActiveTab('REQUESTS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'REQUESTS'
                ? 'bg-cyan-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            📥 Open Requests ({requests.length})
          </button>
          <button
            onClick={() => setActiveTab('AWARDS')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'AWARDS'
                ? 'bg-cyan-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🏆 Awarded Jobs ({awards.length})
          </button>
        </div>
      </div>

      {/* Feedback Toast */}
      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Driver Execution Link — shown once, right when it's generated, since the raw
          token is only ever returned by the assign endpoint and can't be retrieved later. */}
      {generatedDriverLink && (
        <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/40 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              Driver Execution Link Generated
            </span>
            <button onClick={() => setGeneratedDriverLink(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Already dispatched to the driver via WhatsApp/SMS — copy or open it below if you need it directly.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-mono text-[11px]">
              {`${window.location.origin}${generatedDriverLink}`}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${generatedDriverLink}`);
                showToast('✓ Driver trip link copied to clipboard!');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] flex items-center gap-1 shadow shrink-0"
            >
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </button>
            <a
              href={generatedDriverLink}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* TAB 1: OPEN REQUESTS */}
      {activeTab === 'REQUESTS' && (
        <div className="space-y-4">
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800 flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Loading open requests...
            </div>
          ) : requests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {requests.map((r) => {
                const existingQuote = r.quotes?.[0];
                return (
                  <div
                    key={r.id}
                    className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-cyan-400 font-bold text-xs">{r.requestNumber}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-bold">
                          {r.pricingMethod}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>
                          {r.opportunity?.closesAt
                            ? `Closes ${new Date(r.opportunity.closesAt).toLocaleDateString()}`
                            : 'No deadline set'}
                        </span>
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="text-white font-bold flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>{r.pickupLocation} → {r.dropoffLocation}</span>
                      </div>
                      <div className="text-slate-400 flex items-center gap-4 text-[11px]">
                        <span>📅 {new Date(r.serviceDate).toLocaleDateString()}</span>
                        <span>⏰ {r.pickupTime}</span>
                        <span>👥 Capacity: {r.requiredCapacity} seats</span>
                      </div>
                      {r.specialInstructions && (
                        <div className="text-[11px] text-slate-400 bg-slate-950 p-2.5 rounded-xl border border-slate-800/60 mt-2">
                          <span className="font-semibold text-slate-300">Instructions:</span> {r.specialInstructions}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      {existingQuote ? (
                        <div className="text-xs">
                          <span className="text-slate-400">Your Quote (Rev {existingQuote.revisionNo}): </span>
                          <span className="font-bold text-emerald-400">AED {Number(existingQuote.totalAmount).toFixed(2)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-amber-400 font-semibold">Awaiting Quotation</span>
                      )}

                      <button
                        onClick={() => setSelectedRequestForQuote(r)}
                        className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow transition active:scale-95"
                      >
                        {existingQuote ? 'Revise Quote' : 'Submit Quote'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800">
              No open requests found. When enterprise clients invite you, they will appear here.
            </div>
          )}
        </div>
      )}

      {/* TAB 2: AWARDED JOBS */}
      {activeTab === 'AWARDS' && (
        <div className="space-y-4">
          {loading ? (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800 flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Loading awarded jobs...
            </div>
          ) : awards.length > 0 ? (
            <div className="space-y-3">
              {awards.map((a) => {
                const assignment = a.assignment;
                const pod = assignment?.pod;
                return (
                  <div
                    key={a.id}
                    className="p-5 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-emerald-400 font-bold text-xs">{a.request?.requestNumber || a.id.slice(0, 8)}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                            {a.status}
                          </span>
                        </div>
                        <div className="text-sm font-bold text-white mt-1">
                          {a.request?.pickupLocation} → {a.request?.dropoffLocation}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-400">Awarded Commercials</div>
                        <div className="text-base font-black text-white">AED {Number(a.totalAwarded).toFixed(2)}</div>
                      </div>
                    </div>

                    {/* Operational Assignment / Driver Execution Link */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80">
                        <span className="text-slate-400 text-[11px] block">Assigned Vehicle</span>
                        <span className="font-bold text-white font-mono mt-0.5 block">
                          {assignment?.vehiclePlate || '⚠️ Vehicle not assigned'}
                        </span>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80">
                        <span className="text-slate-400 text-[11px] block">Assigned Driver</span>
                        <span className="font-bold text-white mt-0.5 block">
                          {assignment?.driverName ? `${assignment.driverName} (${assignment.driverPhone})` : '⚠️ Driver not assigned'}
                        </span>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80 flex flex-col justify-between">
                        <span className="text-slate-400 text-[11px] block">Driver Execution Link</span>
                        {assignment ? (
                          // The raw driver token is one-time-only (see the reveal banner
                          // above right after assignment) — only its hash is ever stored,
                          // so it can't be recovered or re-copied from here afterward.
                          <span className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                            <Send className="w-3 h-3" />
                            Delivered to driver via WhatsApp/SMS
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-400">Assign driver to generate link</span>
                        )}
                      </div>
                    </div>

                    {/* Milestones & POD Summary */}
                    {pod && (
                      <div className="p-3 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>POD Submitted by Driver (Passengers on Board: {pod.passengerCount || 'N/A'})</span>
                        </div>
                        <span className="text-[11px] text-slate-400">Signed by: {pod.signedByName || 'Site Lead'}</span>
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/60">
                      <button
                        onClick={() => setSelectedAwardForAssign(a)}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 transition"
                      >
                        {assignment ? 'Reassign Driver / Vehicle' : 'Assign Vehicle & Driver'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800">
              No awarded jobs found yet.
            </div>
          )}
        </div>
      )}

      {/* ── MODAL 1: SUBMIT / REVISE QUOTE ── */}
      {selectedRequestForQuote && (
        <SubmitQuoteModal
          request={selectedRequestForQuote}
          onClose={() => setSelectedRequestForQuote(null)}
          onSubmitted={() => {
            setSelectedRequestForQuote(null);
            showToast('✓ Quotation submitted successfully!');
            void loadAll();
          }}
        />
      )}

      {/* ── MODAL 2: ASSIGN DRIVER & VEHICLE ── */}
      {selectedAwardForAssign && (
        <AssignDriverModal
          award={selectedAwardForAssign}
          vehicles={vehicles}
          drivers={drivers}
          onClose={() => setSelectedAwardForAssign(null)}
          onAssigned={(link) => {
            setSelectedAwardForAssign(null);
            setGeneratedDriverLink(link);
            showToast('✓ Vehicle and Driver assigned! Driver execution link generated.');
            void loadAll();
          }}
        />
      )}
    </div>
  );
}

// ── SUBMIT QUOTE MODAL COMPONENT ──────────────────────────────────────────

function SubmitQuoteModal({
  request,
  onClose,
  onSubmitted,
}: {
  request: OutsourceRequestRow;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const subtotal = Number(amount) || 0;
  const vat = subtotal * 0.05;
  const total = subtotal + vat;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subtotal) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          partnerId: 'dummy-partner-id', // Handled by API resolver or session
          amount: subtotal,
          vatAmount: vat,
          notes,
        }),
      });

      if (!res.ok) throw new Error('Failed to submit quote');
      onSubmitted();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting quote');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Commercial Quotation</h3>
            <p className="text-[11px] text-slate-400">Request: {request.requestNumber}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Trip Route</span>
            <div className="text-white font-bold">{request.pickupLocation} → {request.dropoffLocation}</div>
            <div className="text-slate-400 text-[11px]">{new Date(request.serviceDate).toLocaleDateString()} at {request.pickupTime}</div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Base Price (AED) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 4500"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm font-bold focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* Pricing Breakdown */}
          <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1 text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal:</span>
              <span className="font-mono text-white font-semibold">AED {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>UAE VAT (5%):</span>
              <span className="font-mono text-white font-semibold">AED {vat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-cyan-300 font-bold pt-1 border-t border-slate-800">
              <span>Total Quoted Amount:</span>
              <span className="font-mono text-cyan-400">AED {total.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Commercial Notes / Terms</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Includes driver fuel & tolls; 50-seat luxury coach"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !subtotal}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Quote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── ASSIGN DRIVER & VEHICLE MODAL COMPONENT ───────────────────────────────

function AssignDriverModal({
  award,
  vehicles,
  drivers,
  onClose,
  onAssigned,
}: {
  award: OutsourceAwardRow;
  vehicles: PartnerVehicleRow[];
  drivers: PartnerDriverRow[];
  onClose: () => void;
  onAssigned: (link: string) => void;
}) {
  const hasRegisteredVehicles = vehicles.length > 0;
  const hasRegisteredDrivers = drivers.length > 0;

  const [vehiclePlate, setVehiclePlate] = useState<string>(vehicles[0]?.licensePlate || '');
  const [driverName, setDriverName] = useState<string>(drivers[0]?.fullName || '');
  const [driverPhone, setDriverPhone] = useState<string>(drivers[0]?.mobileNumber || '+971501234567');
  const [submitting, setSubmitting] = useState(false);

  const handleDriverSelect = (fullName: string) => {
    setDriverName(fullName);
    const match = drivers.find((d) => d.fullName === fullName);
    if (match) setDriverPhone(match.mobileNumber);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehiclePlate || !driverName) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          awardId: award.id,
          partnerId: award.partnerId,
          vehiclePlate,
          driverName,
          driverPhone,
        }),
      });

      if (!res.ok) throw new Error('Failed to assign resources');
      const json = await res.json();
      onAssigned(json.driverSecureUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error assigning driver');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Assign Vehicle & Driver</h3>
            <p className="text-[11px] text-slate-400">Generates instant zero-login driver execution link</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Select Partner Vehicle *</label>
            {hasRegisteredVehicles ? (
              <select
                required
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono uppercase focus:outline-none focus:border-cyan-500"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.licensePlate}>
                    {v.licensePlate} — {v.vehicleType}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="e.g. Dubai K 44102 (no vehicles registered yet)"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono uppercase focus:outline-none focus:border-cyan-500"
              />
            )}
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Driver Full Name *</label>
            {hasRegisteredDrivers ? (
              <select
                required
                value={driverName}
                onChange={(e) => handleDriverSelect(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              >
                {drivers.map((d) => (
                  <option key={d.id} value={d.fullName}>
                    {d.fullName} ({d.mobileNumber})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="e.g. Rashid Tariq (no drivers registered yet)"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
              />
            )}
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Driver Mobile Phone *</label>
            <input
              type="text"
              required
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
              placeholder="+971 50 123 4567"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Generating...' : 'Confirm & Generate Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
