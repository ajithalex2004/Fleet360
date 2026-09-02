/**
 * src/components/bus-ops/outsource/OutsourceExceptionDrawer.tsx
 *
 * Phase 2.5: Operational Exception Management Drawer for Fleet360 Operations.
 * Raise, monitor, and resolve operational breakdowns, no-shows, and replacement dispatches.
 */

'use client';

import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Truck,
  User,
  ShieldAlert,
  Send,
  RefreshCw,
} from 'lucide-react';
import { OutsourceExceptionType } from '@prisma/client';

interface OutsourceExceptionDrawerProps {
  award: any;
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
}

export function OutsourceExceptionDrawer({
  award,
  isOpen,
  onClose,
  onResolved,
}: OutsourceExceptionDrawerProps) {
  const [exceptionType, setExceptionType] = useState<OutsourceExceptionType>('VEHICLE_BREAKDOWN');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');

  // Replacement resource state
  const [needsReplacement, setNeedsReplacement] = useState(true);
  const [replacementPlate, setReplacementPlate] = useState('');
  const [replacementDriver, setReplacementDriver] = useState('');
  const [replacementPhone, setReplacementPhone] = useState('+971501234567');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen || !award) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/bus-ops/outsource/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RAISE_AND_RESOLVE',
          tenantId: award.tenantId,
          partnerId: award.partnerId,
          awardId: award.id,
          type: exceptionType,
          severity,
          description,
          replacementResource: needsReplacement && replacementPlate && replacementDriver
            ? {
                vehiclePlate: replacementPlate,
                driverName: replacementDriver,
                driverPhone: replacementPhone,
                replacedReason: `Exception: ${exceptionType}`,
              }
            : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to process exception');
      }

      setFeedback('✓ Exception handled & replacement resources dispatched!');
      setTimeout(() => {
        setFeedback(null);
        onResolved();
        onClose();
      }, 1500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error processing exception');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/75 backdrop-blur-sm animate-in fade-in font-sans">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-lg bg-slate-950 border-l border-slate-800 text-slate-100 flex flex-col justify-between shadow-2xl text-xs">
          {/* Header */}
          <div className="p-5 border-b border-slate-800 bg-rose-950/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-white">Outsource Exception Management</h2>
                <p className="text-[11px] text-slate-400">Trip: {award.request?.requestNumber || award.id.slice(0, 8)}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4 flex-1 overflow-y-auto">
            {feedback && (
              <div className="p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{feedback}</span>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Exception Classification *</label>
              <select
                value={exceptionType}
                onChange={(e) => setExceptionType(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-rose-500"
              >
                <option value="VEHICLE_BREAKDOWN">Vehicle Mechanical Breakdown</option>
                <option value="DRIVER_NO_SHOW">Driver No-Show / Unavailable</option>
                <option value="VEHICLE_NO_SHOW">Vehicle No-Show</option>
                <option value="ACCIDENT">Road Traffic Accident</option>
                <option value="LATE_ARRIVAL">Severe Delay / Late Arrival</option>
                <option value="PASSENGER_OVER_CAPACITY">Passenger Headcount Exceeds Capacity</option>
                <option value="ROUTE_CHANGED">Unplanned Route Diversion</option>
                <option value="OTHER">Other Operational Incident</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Incident Description & Location *</label>
              <textarea
                rows={2}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Bus engine overheated on Sheikh Zayed Road near Exit 29. Replacement coach dispatched."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            {/* Replacement Bridge */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Immediate Resource Substitution</span>
                </span>
                <input
                  type="checkbox"
                  checked={needsReplacement}
                  onChange={(e) => setNeedsReplacement(e.target.checked)}
                  className="rounded text-cyan-500"
                />
              </div>

              {needsReplacement && (
                <div className="space-y-3 pt-2 border-t border-slate-800/80">
                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">Replacement Vehicle Plate *</label>
                    <input
                      type="text"
                      required={needsReplacement}
                      value={replacementPlate}
                      onChange={(e) => setReplacementPlate(e.target.value)}
                      placeholder="e.g. Dubai K 99120"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono uppercase focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-400 text-[11px] mb-1">New Driver Name *</label>
                      <input
                        type="text"
                        required={needsReplacement}
                        value={replacementDriver}
                        onChange={(e) => setReplacementDriver(e.target.value)}
                        placeholder="e.g. Tariq Khan"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-[11px] mb-1">New Driver Mobile *</label>
                      <input
                        type="text"
                        required={needsReplacement}
                        value={replacementPhone}
                        onChange={(e) => setReplacementPhone(e.target.value)}
                        placeholder="+971 50 123 4567"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !description}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-lg shadow-rose-600/30 transition disabled:opacity-50"
              >
                {submitting ? 'Processing...' : 'Submit & Resolve Exception'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
