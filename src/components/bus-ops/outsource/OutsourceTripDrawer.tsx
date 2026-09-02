/**
 * src/components/bus-ops/outsource/OutsourceTripDrawer.tsx
 *
 * Enterprise Operations Slide-Over Drawer for Outsourcing Bus Trips to Transport Partners.
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Briefcase,
  Award,
  DollarSign,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Users,
} from 'lucide-react';

interface OutsourceTripDrawerProps {
  tripId: string;
  tripNumber?: string;
  routeName?: string;
  serviceDate?: string;
  departureTime?: string;
  originName?: string;
  destinationName?: string;
  requiredCapacity?: number;
  isOpen: boolean;
  onClose: () => void;
  onAwarded?: () => void;
}

export function OutsourceTripDrawer({
  tripId,
  tripNumber,
  routeName,
  serviceDate,
  departureTime,
  originName,
  destinationName,
  requiredCapacity = 50,
  isOpen,
  onClose,
  onAwarded,
}: OutsourceTripDrawerProps) {
  const [approvedPartners, setApprovedPartners] = useState<any[]>([]);
  const [outsourceRequest, setOutsourceRequest] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // New Request Form
  const [pricingMethod, setPricingMethod] = useState<'RFQ' | 'CONTRACT_RATE' | 'MANUAL_PRICE'>('RFQ');
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState('');

  const loadData = async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/bus-ops/outsource?tripId=${tripId}`);
      if (!res.ok) throw new Error('Failed to load outsource status');
      const data = await res.json();
      setApprovedPartners(data.approvedPartners || []);
      setOutsourceRequest(data.outsourceRequest);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadData();
    }
  }, [isOpen, tripId]);

  if (!isOpen) return null;

  const handleCreateRequest = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_REQUEST',
          tripId,
          serviceDate: serviceDate || new Date(),
          pickupTime: departureTime || '06:00',
          pickupLocation: originName || 'Main Station',
          dropoffLocation: destinationName || 'Worksite / Depot',
          requiredCapacity,
          pricingMethod,
          invitedPartnerIds: selectedPartnerIds.length > 0 ? selectedPartnerIds : undefined,
          specialInstructions,
        }),
      });

      if (!res.ok) throw new Error('Failed to create outsource request');
      setFeedback('✓ Outsource Request dispatched to transport partner network!');
      setTimeout(() => setFeedback(null), 4000);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAward = async (quoteId: string) => {
    if (!outsourceRequest) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'AWARD_QUOTE',
          tripId,
          requestId: outsourceRequest.id,
          quoteId,
        }),
      });

      if (!res.ok) throw new Error('Failed to award quote');
      setFeedback('✓ Partner awarded! TripSchedule assigned to external carrier.');
      setTimeout(() => setFeedback(null), 4000);
      await loadData();
      if (onAwarded) onAwarded();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error awarding quote');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-slate-950 border-l border-slate-800 text-slate-100 flex flex-col justify-between shadow-2xl text-xs">
          {/* Header */}
          <div className="p-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-cyan-600/20 text-cyan-400">
                <Briefcase className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Outsource Trip to Partner</h2>
                <p className="text-[11px] text-slate-400">Trip: {tripNumber || tripId?.slice(0, 8)}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4 flex-1 overflow-y-auto">
            {feedback && (
              <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Trip Context Card */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-[10px] uppercase font-bold text-cyan-400">Scheduled Route</span>
              <div className="font-bold text-white text-sm">{routeName || 'Staff Transport Route'}</div>
              <div className="text-[11px] text-slate-300">
                {originName || 'Origin'} → {destinationName || 'Destination'}
              </div>
              <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800 flex justify-between">
                <span>Date: {serviceDate || 'Today'}</span>
                <span>Time: {departureTime || '06:00'}</span>
                <span>Capacity: {requiredCapacity} seats</span>
              </div>
            </div>

            {/* Existing Request & Quotes View */}
            {outsourceRequest ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white uppercase text-[10px]">Outsource Status</span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 text-[10px] font-bold">
                    {outsourceRequest.status}
                  </span>
                </div>

                {/* Quotes Received */}
                <div className="space-y-2">
                  <span className="text-[11px] text-slate-400 font-semibold block">Partner Quotes ({outsourceRequest.quotes?.length || 0})</span>
                  {outsourceRequest.quotes?.length > 0 ? (
                    outsourceRequest.quotes.map((q: any) => (
                      <div key={q.id} className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">{q.partner?.legalName}</span>
                          <span className="font-mono text-cyan-300 font-bold">AED {Number(q.totalAmount).toFixed(2)}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex justify-between">
                          <span>Revision: Rev {q.revisionNo}</span>
                          <span>Valid: {new Date(q.validUntil).toLocaleDateString()}</span>
                        </div>
                        {outsourceRequest.status !== 'AWARDED' && (
                          <button
                            onClick={() => handleAward(q.id)}
                            disabled={submitting}
                            className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition disabled:opacity-50"
                          >
                            🏆 Award to this Partner
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-slate-500 rounded-xl bg-slate-900/40 border border-slate-800">
                      Request published. Awaiting quotations from invited transport partners.
                    </div>
                  )}
                </div>

                {/* Award Details if Awarded */}
                {outsourceRequest.award && (
                  <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 space-y-2 text-emerald-200">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                      <Award className="w-4 h-4 text-emerald-400" />
                      <span>Awarded to {outsourceRequest.award.partner?.legalName}</span>
                    </div>
                    <div className="text-[11px] flex justify-between text-slate-300">
                      <span>Total Agreed Price:</span>
                      <span className="font-bold text-white font-mono">AED {Number(outsourceRequest.award.totalAwarded).toFixed(2)}</span>
                    </div>
                    {outsourceRequest.award.assignment && (
                      <div className="text-[11px] text-slate-300 pt-1 border-t border-emerald-800/40 space-y-0.5">
                        <div>Vehicle Plate: <span className="font-mono font-bold text-cyan-300">{outsourceRequest.award.assignment.vehiclePlate}</span></div>
                        <div>Driver: {outsourceRequest.award.assignment.driverName} ({outsourceRequest.award.assignment.driverPhone})</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Create Outsource Request Form */
              <div className="space-y-4">
                <span className="font-bold text-white uppercase text-[10px]">Create Outsourcing Request</span>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Pricing Method</label>
                  <select
                    value={pricingMethod}
                    onChange={(e) => setPricingMethod(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="RFQ">Request for Quotation (RFQ)</option>
                    <option value="CONTRACT_RATE">Contracted Rate Card</option>
                    <option value="MANUAL_PRICE">Manual Fixed Price</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Special Operational Instructions</label>
                  <textarea
                    rows={2}
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="e.g. Ensure A/C is pre-cooled; gate pass required at Al Quoz security"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <button
                  onClick={handleCreateRequest}
                  disabled={submitting}
                  className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Dispatching...' : 'Dispatch Outsource Request'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
