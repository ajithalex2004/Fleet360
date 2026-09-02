/**
 * src/app/track/partner-trip/[token]/page.tsx
 *
 * Public Mobile Web Screen for External Partner Drivers (Zero-Login).
 * Purpose-bound cryptographic token enables drivers to report milestones (Reached, Started, Completed) and submit POD.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  MapPin,
  Clock,
  Users,
  CheckCircle2,
  Navigation,
  FileCheck,
  AlertCircle,
  ShieldCheck,
  Send,
} from 'lucide-react';

export default function PartnerDriverTripPage() {
  const params = useParams();
  const token = params?.token as string;

  const [tripData, setTripData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [podModalOpen, setPodModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // POD Form state
  const [passengerCount, setPassengerCount] = useState('48');
  const [signedByName, setSignedByName] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');

  const loadTrip = async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/public/partner-driver/${token}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load trip');
      }
      const data = await res.json();
      setTripData(data.trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired link');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTrip();
  }, [token]);

  const handleAction = async (action: 'REACHED' | 'STARTED' | 'COMPLETED', podPayload?: any) => {
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/public/partner-driver/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...podPayload,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Action failed');
      }

      setFeedback(`✓ Milestone ${action} recorded successfully!`);
      setTimeout(() => setFeedback(null), 4000);
      setPodModalOpen(false);
      await loadTrip();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting milestone');
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-slate-400 text-xs font-semibold">
        Loading outsourced trip details...
      </div>
    );
  }

  if (error || !tripData) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h1 className="text-base font-bold text-white">Trip Link Unavailable</h1>
          <p className="text-xs text-slate-400">{error || 'This driver trip link is expired or invalid.'}</p>
        </div>
      </div>
    );
  }

  const reached = !!tripData.reachedAt;
  const started = !!tripData.startedAt;
  const completed = !!tripData.completedAt;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between max-w-md mx-auto shadow-2xl">
      {/* Top Header */}
      <header className="p-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Outsourced Trip</span>
            <div className="text-base font-black text-white">{tripData.requestNumber}</div>
          </div>
          <span
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
              completed
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : started
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
            }`}
          >
            {completed ? 'COMPLETED' : started ? 'IN PROGRESS' : reached ? 'AT PICKUP' : 'ASSIGNED'}
          </span>
        </div>
      </header>

      {/* Main Body */}
      <main className="p-4 space-y-4 flex-1">
        {feedback && (
          <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Route Card */}
        <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-3">
          <span className="text-[10px] uppercase font-bold text-slate-400">Route & Location</span>
          <div className="space-y-2">
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                A
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Pickup Origin</span>
                <span className="text-sm font-bold text-white">{tripData.pickupLocation}</span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                B
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Drop-off Destination</span>
                <span className="text-sm font-bold text-white">{tripData.dropoffLocation}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>{new Date(tripData.serviceDate).toLocaleDateString()} at {tripData.pickupTime}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-500" />
              <span>{tripData.requiredCapacity} Passengers</span>
            </div>
          </div>
        </div>

        {/* Assigned Vehicle & Driver Card */}
        <div className="p-4 rounded-3xl bg-slate-900/40 border border-slate-800 text-xs space-y-1.5">
          <div className="flex justify-between text-slate-400">
            <span>Assigned Vehicle:</span>
            <span className="font-bold text-cyan-300 font-mono">{tripData.vehiclePlate}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Driver:</span>
            <span className="font-semibold text-white">{tripData.driverName}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Partner Operator:</span>
            <span className="font-semibold text-slate-200">{tripData.partnerName}</span>
          </div>
        </div>

        {/* Milestone Stepper Status */}
        <div className="p-4 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-3">
          <span className="text-[10px] uppercase font-bold text-slate-400">Trip Milestones</span>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${reached ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                <span>1. Reached Pickup</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {tripData.reachedAt ? new Date(tripData.reachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${started ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                <span>2. Departed / Trip Started</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {tripData.startedAt ? new Date(tripData.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${completed ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                <span>3. Completed & POD Uploaded</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                {tripData.completedAt ? new Date(tripData.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
              </span>
            </div>
          </div>
        </div>

        {/* POD Details Card if Completed */}
        {tripData.pod && (
          <div className="p-4 rounded-3xl bg-emerald-950/30 border border-emerald-500/40 text-xs space-y-1.5 text-emerald-200">
            <div className="font-bold flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Proof of Delivery (POD) Verified</span>
            </div>
            <p className="text-[11px] text-emerald-300/80">
              Passengers Boarded: <span className="font-bold">{tripData.pod.passengerCount}</span> · Signed by:{' '}
              <span className="font-bold">{tripData.pod.signedByName || 'Site Lead'}</span>
            </p>
          </div>
        )}
      </main>

      {/* Action Footer Button Bar */}
      <footer className="p-4 border-t border-slate-800 bg-slate-900/95 sticky bottom-0 z-20">
        {!reached && (
          <button
            onClick={() => handleAction('REACHED')}
            disabled={submittingAction}
            className="w-full py-3.5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm shadow-xl shadow-cyan-600/30 transition disabled:opacity-50"
          >
            {submittingAction ? 'Updating...' : '📍 Reached Pickup Point'}
          </button>
        )}

        {reached && !started && (
          <button
            onClick={() => handleAction('STARTED')}
            disabled={submittingAction}
            className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-xl shadow-emerald-600/30 transition disabled:opacity-50"
          >
            {submittingAction ? 'Updating...' : '▶️ Start Trip / Depart'}
          </button>
        )}

        {started && !completed && (
          <button
            onClick={() => setPodModalOpen(true)}
            disabled={submittingAction}
            className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-xl shadow-amber-500/30 transition disabled:opacity-50"
          >
            ⏹️ Complete Trip & Submit POD
          </button>
        )}

        {completed && (
          <div className="py-2.5 text-center text-xs font-bold text-emerald-400 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>Trip Complete · Great job!</span>
          </div>
        )}
      </footer>

      {/* ── SUBMIT POD MODAL ── */}
      {podModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 max-w-sm w-full space-y-4 shadow-2xl text-xs">
            <h3 className="text-sm font-bold text-white">Trip Completion & Proof of Delivery</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Total Passengers Transported *</label>
                <input
                  type="number"
                  required
                  value={passengerCount}
                  onChange={(e) => setPassengerCount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-bold text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Client / Site Sign-Off Name</label>
                <input
                  type="text"
                  value={signedByName}
                  onChange={(e) => setSignedByName(e.target.value)}
                  placeholder="e.g. Supervisor Ahmed"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Notes / Delay Observations</label>
                <textarea
                  rows={2}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="e.g. Safe trip, dropped at Gate 4 on time"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPodModalOpen(false)}
                className="px-4 py-2 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  handleAction('COMPLETED', {
                    passengerCount: Number(passengerCount),
                    signedByName,
                    completionNotes,
                  })
                }
                disabled={submittingAction || !passengerCount}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-600/30 transition disabled:opacity-50"
              >
                {submittingAction ? 'Submitting...' : 'Confirm Completion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
