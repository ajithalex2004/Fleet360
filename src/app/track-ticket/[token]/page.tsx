'use client';

import React, { useEffect, useState, use } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  Truck,
  ShieldCheck,
  Building2,
  RefreshCw,
  Wrench,
  Sparkles,
  Inbox,
  MessageSquare,
} from 'lucide-react';

interface PublicTicketData {
  readableId: string;
  ticketType: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  department: {
    key: string;
    label: string;
    shortLabel: string;
    tone: string;
  };
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  timeline: Array<{
    status: string;
    date: string;
    note: string;
  }>;
  recovery?: {
    vendorName?: string;
    dispatchedAt?: string;
    etaMinutes?: number;
    trackingStatus?: string;
  } | null;
}

const DEPT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  OPERATIONS_TRIAGE: Inbox,
  WORKSHOP_MAINTENANCE: Wrench,
  RECOVERY_DISPATCH: Truck,
  SAFETY_COMPLIANCE: ShieldCheck,
  CUSTOMER_SERVICE: MessageSquare,
  FACILITIES_CLEANING: Sparkles,
};

const STATUS_STEPS = [
  { key: 'Submitted', label: 'Ticket Filed' },
  { key: 'Triage', label: 'Ops Triage' },
  { key: 'Assigned', label: 'Department Handover' },
  { key: 'In Progress', label: 'In Progress' },
  { key: 'Resolved', label: 'Resolved' },
];

function getStepIndex(status: string, departmentKey: string): number {
  switch (status) {
    case 'Pending':
    case 'Awaiting Approval':
      return departmentKey === 'OPERATIONS_TRIAGE' ? 1 : 2;
    case 'Acknowledged':
    case 'Assigned':
      return 2;
    case 'In Progress':
    case 'Escalated':
      return 3;
    case 'Resolved':
    case 'Completed':
    case 'Closed':
      return 4;
    default:
      return 1;
  }
}

export default function PublicTicketTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;

  const [ticket, setTicket] = useState<PublicTicketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/service-tickets/track/${token}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Ticket not found or link has expired');
      }
      setTicket(data.ticket);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load ticket');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // 30s live refresh
    return () => clearInterval(interval);
  }, [token]);

  const handleManualRefresh = () => {
    setRefreshing(true);
    void fetchStatus();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-400">Loading live ticket status...</p>
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Tracking Link Expired or Invalid</h2>
          <p className="text-xs text-slate-400">
            {error || 'We could not locate this ticket. Please verify your link or contact fleet support.'}
          </p>
          <a
            href="tel:+97180035338"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
          >
            Call 24/7 Operations Desk
          </a>
        </div>
      </div>
    );
  }

  const DeptIcon = DEPT_ICONS[ticket.department.key] || Building2;
  const currentStep = getStepIndex(ticket.status, ticket.department.key);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6">
      <div className="max-w-3xl w-full space-y-6">
        {/* Public Header */}
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 font-bold">
              360
            </div>
            <div>
              <h1 className="text-base font-bold text-white flex items-center gap-2">
                Fleet360 Live Service Tracker
              </h1>
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Verified Customer Portal
              </span>
            </div>
          </div>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-white/10 hover:border-white/20 text-xs font-semibold text-slate-300 hover:text-white transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </header>

        {/* Emergency Recovery Banner (if Towing Dispatched) */}
        {ticket.recovery && (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex items-start gap-3 shadow-lg shadow-rose-500/10">
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center shrink-0 text-rose-300">
              <Truck className="w-5 h-5 animate-pulse" />
            </div>
            <div className="space-y-1 flex-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-bold text-white">
                  Roadside Recovery Flatbed En Route
                </h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/30 border border-rose-500/50 font-bold text-rose-100">
                  ETA ~{ticket.recovery.etaMinutes ?? 25} Mins
                </span>
              </div>
              <p className="text-xs text-rose-200/90 leading-relaxed">
                Assigned Recovery Partner:{' '}
                <strong className="text-white">{ticket.recovery.vendorName || 'Fleet Recovery Unit'}</strong>.
                The tow truck driver has received your vehicle coordinates.
              </p>
            </div>
          </div>
        )}

        {/* Main Ticket Summary Card */}
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 sm:p-6 space-y-6 shadow-xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono font-bold bg-violet-600/30 text-violet-200 px-2.5 py-1 rounded-lg border border-violet-500/40">
                  {ticket.readableId}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/10 font-semibold">
                  {ticket.ticketType}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white">{ticket.title}</h2>
            </div>
            <div className="flex items-center gap-2 sm:self-start">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800/80 border border-white/10 text-xs font-semibold text-slate-300">
                <DeptIcon className="w-3.5 h-3.5 text-violet-400" />
                <span>{ticket.department.label}</span>
              </div>
              <span className="text-xs px-3 py-1 rounded-xl bg-violet-600/20 text-violet-300 border border-violet-500/30 font-bold">
                {ticket.status}
              </span>
            </div>
          </div>

          {ticket.description && (
            <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-white/5">
              {ticket.description}
            </p>
          )}

          {/* Stepper */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Resolution Progress
            </h3>
            <div className="grid grid-cols-5 gap-1 pt-2">
              {STATUS_STEPS.map((step, idx) => {
                const isPassed = idx <= currentStep;
                const isCurrent = idx === currentStep;

                return (
                  <div key={step.key} className="flex flex-col items-center text-center space-y-1.5">
                    <div
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        isCurrent
                          ? 'bg-violet-600 text-white ring-4 ring-violet-500/30'
                          : isPassed
                            ? 'bg-emerald-500 text-slate-950 font-black'
                            : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {isPassed && !isCurrent ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                    </div>
                    <span
                      className={`text-[10px] sm:text-xs font-medium ${
                        isCurrent
                          ? 'text-violet-300 font-bold'
                          : isPassed
                            ? 'text-slate-200'
                            : 'text-slate-600'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Milestone Timeline */}
          <div className="space-y-3 pt-4 border-t border-white/5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Service Milestones & Updates
            </h3>
            <div className="space-y-2.5">
              {ticket.timeline.map((m, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/40 border border-white/5 text-xs"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">{m.status}</span>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                        <Clock className="w-2.5 h-2.5" />
                        {new Date(m.date).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">{m.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-slate-500 pt-4">
          Fleet360 Enterprise Transport Operating System · 24/7 Operations Desk
        </footer>
      </div>
    </div>
  );
}
