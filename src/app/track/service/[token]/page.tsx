'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  Clock,
  Truck,
  Car,
  MapPin,
  Star,
  Sparkles,
  Phone,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  Headphones,
} from 'lucide-react';
import type { PublicTicketTrackingData } from '@/lib/service-tickets/csat-analytics-engine';

const STAGES = [
  { step: 1, title: 'Received', desc: 'Ticket logged in dispatch queue' },
  { step: 2, title: 'Acknowledged', desc: 'Assigned to controller' },
  { step: 3, title: 'Dispatched', desc: 'Recovery flatbed on the way' },
  { step: 4, title: 'In Progress', desc: 'Inspection & repair active' },
  { step: 5, title: 'Resolved', desc: 'Vehicle back in operation' },
];

export default function PublicTicketTrackingPage() {
  const params = useParams();
  const token = params?.token as string;

  const [data, setData] = useState<PublicTicketTrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // CSAT Rating State
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submittingCsat, setSubmittingCsat] = useState(false);
  const [csatSubmitted, setCsatSubmitted] = useState(false);

  const fetchStatus = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/public/service-tickets/track/${token}`);
      if (!res.ok) throw new Error('Service tracking record not found');
      const json = await res.json();
      setData(json.data);
      if (json.data?.csatFeedback) {
        setCsatSubmitted(true);
        setRating(json.data.csatFeedback.rating);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tracking status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15_000); // 15s auto-refresh
    return () => clearInterval(interval);
  }, [token]);

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmittingCsat(true);
    try {
      const res = await fetch(`/api/public/service-tickets/track/${token}/csat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
      if (!res.ok) throw new Error('Failed to submit rating');
      setCsatSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmittingCsat(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 space-y-3">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
        <p className="text-sm text-slate-400 font-medium">Connecting to Fleet360 Live Dispatch...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-300 max-w-md">
          <h2 className="text-lg font-bold">Tracking Link Expired or Not Found</h2>
          <p className="text-xs text-slate-400 mt-1">{error || 'Please verify your ticket reference number.'}</p>
        </div>
      </div>
    );
  }

  const isResolved = data.currentStage === 5;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between py-6 px-4 sm:px-6">
      <div className="max-w-lg mx-auto w-full space-y-6">
        {/* Top Branding & Ticket ID */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Car className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-tight">Fleet360 Live Service Tracking</div>
              <div className="text-[11px] font-mono text-emerald-400 font-bold">{data.readableId || data.id}</div>
            </div>
          </div>

          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
              isResolved
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
            }`}
          >
            {data.status}
          </span>
        </div>

        {/* 5-Stage Live Progress Stepper */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Status Stepper</h2>
            <span className="text-xs font-bold text-emerald-400">
              Stage {data.currentStage} of 5: {data.stageName}
            </span>
          </div>

          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
            {STAGES.map((st) => {
              const isPast = data.currentStage > st.step;
              const isCurrent = data.currentStage === st.step;

              return (
                <div key={st.step} className="relative flex items-start gap-3">
                  <div
                    className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                      isPast
                        ? 'bg-emerald-500 text-slate-950 ring-4 ring-emerald-500/20'
                        : isCurrent
                        ? 'bg-amber-400 text-slate-950 ring-4 ring-amber-400/30 animate-pulse'
                        : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}
                  >
                    {isPast ? '✓' : st.step}
                  </div>

                  <div>
                    <div
                      className={`text-xs font-bold ${
                        isCurrent ? 'text-amber-300' : isPast ? 'text-white' : 'text-slate-500'
                      }`}
                    >
                      {st.title}
                    </div>
                    <div className="text-[11px] text-slate-400">{st.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Towing Recovery Live ETA Card (if dispatched) */}
        {data.towingDetails && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/40 to-slate-900 border border-amber-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                <Truck className="w-4 h-4" />
                <span>Recovery Flatbed Dispatched</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                ETA ~{data.towingDetails.etaMinutes} Mins
              </span>
            </div>
            <div className="text-xs text-white font-medium">{data.towingDetails.vendorName}</div>
            <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
              <span>Status: En Route to Breakdown Location</span>
              <a
                href="tel:+97142137788"
                className="px-2.5 py-1 rounded-lg bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-semibold text-[10px] flex items-center gap-1"
              >
                <Phone className="w-3 h-3" /> Call Driver
              </a>
            </div>
          </div>
        )}

        {/* Replacement Vehicle Card (if provisioned) */}
        {data.replacementDetails && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-violet-950/40 to-slate-900 border border-violet-500/40 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-violet-300 font-bold text-xs">
                <RotateCcw className="w-4 h-4" />
                <span>Replacement Vehicle Provisioned</span>
              </div>
              <span className="font-mono font-bold text-emerald-400 text-xs">
                {data.replacementDetails.replacementPlate}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Your contract billing has seamlessly transitioned to the replacement unit.
            </p>
          </div>
        )}

        {/* Ticket & Location Summary Card */}
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2.5 text-xs">
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <span className="text-slate-400">Request Type</span>
            <strong className="text-white">{data.ticketType}</strong>
          </div>
          {data.vehiclePlate && (
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400">Vehicle Plate</span>
              <strong className="text-emerald-400 font-mono">{data.vehiclePlate}</strong>
            </div>
          )}
          {data.location && (
            <div className="flex items-start justify-between gap-2 pt-1">
              <span className="text-slate-400 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-rose-400" /> Location
              </span>
              <span className="text-slate-200 text-right truncate max-w-[240px]">{data.location}</span>
            </div>
          )}
        </div>

        {/* Post-Resolution 1-Click CSAT & Feedback Form */}
        {isResolved && (
          <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/40 shadow-2xl space-y-4">
            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
                <Sparkles className="w-3.5 h-3.5" /> Service Completed
              </div>
              <h3 className="text-base font-bold text-white">How was your service experience?</h3>
              <p className="text-xs text-slate-400">Rate your roadside recovery and support speed</p>
            </div>

            {csatSubmitted ? (
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <div className="font-bold text-white text-sm">Thank You for Your Feedback!</div>
                <div className="text-xs text-slate-300">
                  You rated our team <strong>{rating} / 5 Stars</strong>. Your feedback keeps our fleet at peak standards.
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitRating} className="space-y-4">
                {/* 1–5 Stars Interactive Component */}
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = (hoverRating ?? rating) >= star;
                    return (
                      <button
                        type="button"
                        key={star}
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(null)}
                        className="p-1.5 transition-transform hover:scale-125 focus:outline-none"
                      >
                        <Star
                          className={`w-7 h-7 ${
                            active
                              ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                              : 'text-slate-700'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>

                <div className="text-center font-bold text-xs text-amber-300">
                  {rating === 5 && '🌟 Excellent — Super Fast Service!'}
                  {rating === 4 && '👍 Great — Handled Well'}
                  {rating === 3 && '😐 Average — Satisfactory'}
                  {rating === 2 && '👎 Poor — Delayed Response'}
                  {rating === 1 && '⚠️ Terrible — Unacceptable'}
                </div>

                <textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Optional comment: Any feedback for the recovery driver or support team?"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500"
                />

                <button
                  type="submit"
                  disabled={submittingCsat}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50"
                >
                  {submittingCsat ? 'Submitting...' : 'Submit Rating'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Footer Support Hotline */}
      <div className="text-center text-[11px] text-slate-500 pt-6">
        Need urgent assistance? Call 24/7 Dispatch: <strong className="text-slate-400">+971 4 213 7700</strong>
      </div>
    </div>
  );
}
