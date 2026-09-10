'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Headphones,
  Clock,
  Calendar,
  User,
  Car,
  Tag,
  AlertCircle,
  CheckCircle2,
  Share2,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { CostLedgerCard } from '../components/cost-ledger-card';
import { ContextDrawer360 } from '../components/context-drawer-360';
import type { ServiceTicket } from '@/types/service-tickets';

interface PageProps {
  params: Promise<{ id: string }>;
}

const STATUS_BADGE: Record<string, string> = {
  'Awaiting Approval': 'bg-amber-500/30 text-amber-200 border-amber-500/60 ring-1 ring-amber-500/30',
  Pending: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  Acknowledged: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  Assigned: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Escalated: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  'In Progress': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Resolved: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Rejected: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  Closed: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

const PRIORITY_BADGE: Record<string, string> = {
  Low: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  Medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  High: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  Critical: 'text-rose-300 bg-rose-950 border-rose-500 animate-pulse font-bold',
};

export default function ServiceTicketDetailsPage({ params }: PageProps) {
  const { id: ticketId } = use(params);
  const router = useRouter();

  const [ticket, setTicket] = useState<ServiceTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDrawer360, setShowDrawer360] = useState(false);

  const fetchTicket = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Service ticket not found');
        throw new Error('Failed to load ticket details');
      }
      const data = await res.json();
      setTicket(data.ticket || data);
    } catch (e: any) {
      setError(e.message || 'Error loading ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6 flex flex-col items-center justify-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-violet-400" />
        <p className="text-slate-400 text-sm">Loading service ticket details & financial ledger...</p>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6 max-w-4xl mx-auto space-y-6">
        <Link
          href="/service-tickets"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Tickets</span>
        </Link>
        <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-500/40 text-rose-300 space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-5 h-5" />
            <span>Unable to load ticket</span>
          </div>
          <p className="text-sm">{error || 'Ticket not found'}</p>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_BADGE[ticket.status] || STATUS_BADGE.Pending;
  const priorityStyle = PRIORITY_BADGE[ticket.priority] || PRIORITY_BADGE.Medium;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-16">
      {/* Top Header & Breadcrumbs */}
      <div className="border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/service-tickets"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Back to Tickets"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Link href="/service-tickets" className="hover:text-slate-200">
                Service & Support
              </Link>
              <span>/</span>
              <span className="font-mono text-slate-300">{ticket.readableId || ticket.id.slice(0, 8)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDrawer360(true)}
              className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-lg shadow-violet-900/20"
            >
              <Car className="w-3.5 h-3.5" />
              <span>Open 360 Context Drawer</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Ticket Header Banner */}
        <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-slate-900/80 border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {ticket.readableId || ticket.id.slice(0, 8)}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${statusStyle}`}>
                  {ticket.status}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${priorityStyle}`}>
                  {ticket.priority} Priority
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/80 text-slate-300">
                  {ticket.ticketType}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{ticket.title}</h1>
            </div>

            <div className="text-right text-xs text-slate-400 space-y-1">
              <div className="flex items-center justify-end gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Created {new Date(ticket.createdAt).toLocaleString()}</span>
              </div>
              {ticket.dueDate && (
                <div className="flex items-center justify-end gap-1.5 text-amber-400">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Target SLA: {new Date(ticket.dueDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>

          {ticket.description && (
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-sm text-slate-300 leading-relaxed">
              {ticket.description}
            </div>
          )}
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Financial Control & Itemized Ledger (2 Spans) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Multi-Line Cost Ledger Breakdown Card */}
            <CostLedgerCard ticketId={ticket.id} onCostUpdated={fetchTicket} />

            {/* Ticket Activity / History Log */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="font-semibold text-sm text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-violet-400" />
                  <span>Audit Trail & Activity Log</span>
                </h2>
                <span className="text-xs text-slate-500">
                  {Array.isArray(ticket.history) ? ticket.history.length : 0} event(s)
                </span>
              </div>

              {Array.isArray(ticket.history) && ticket.history.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1 text-xs">
                  {[...ticket.history].reverse().map((entry: any, i: number) => (
                    <div key={i} className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="font-semibold text-slate-200">{entry.actor || 'System'}</span>
                        <span>{entry.date ? new Date(entry.date).toLocaleString() : 'Recent'}</span>
                      </div>
                      <div className="text-slate-300">{entry.note || `Status transitioned to ${entry.status}`}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-slate-500 text-xs bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
                  No previous audit notes logged for this ticket.
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Key Context & Metadata (1 Span) */}
          <div className="space-y-6">
            {/* Quick Metadata Box */}
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4 text-xs">
              <h2 className="font-semibold text-sm text-white">Ticket Properties</h2>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-400">Requester</span>
                  <span className="font-medium text-slate-200">{ticket.requestorName || ticket.requestorId || 'Self-service'}</span>
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-400">Assigned Technician</span>
                  <span className="font-medium text-slate-200">{ticket.assignedTo || 'Unassigned (Triage)'}</span>
                </div>

                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-400">Assigned Department</span>
                  <span className="font-medium text-violet-300">{ticket.assignedDepartment || 'OPERATIONS_TRIAGE'}</span>
                </div>

                {ticket.vehicleId && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-slate-400">Linked Vehicle ID</span>
                    <span className="font-mono text-emerald-400">{ticket.vehicleId.slice(0, 12)}...</span>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowDrawer360(true)}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <Car className="w-3.5 h-3.5 text-cyan-400" />
                <span>View Full 360 Asset & Driver Context</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded 360 Context Drawer */}
      <ContextDrawer360
        ticketId={showDrawer360 ? ticket.id : null}
        onClose={() => setShowDrawer360(false)}
        onStatusChange={fetchTicket}
      />
    </div>
  );
}
