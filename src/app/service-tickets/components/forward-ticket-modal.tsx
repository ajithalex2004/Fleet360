'use client';

import React, { useState } from 'react';
import {
  X,
  Send,
  Wrench,
  Truck,
  ShieldCheck,
  MessageSquare,
  Sparkles,
  Inbox,
  AlertCircle,
  CheckCircle2,
  Building2,
} from 'lucide-react';
import {
  TICKET_DEPARTMENTS,
  type TicketDepartment,
  type TicketPriority,
  type ServiceTicket,
} from '@/types/service-tickets';

interface ForwardTicketModalProps {
  ticket: ServiceTicket | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedTicket: ServiceTicket, createdMr?: any) => void;
}

const DEPT_ICONS: Record<TicketDepartment, React.ComponentType<{ className?: string }>> = {
  OPERATIONS_TRIAGE: Inbox,
  WORKSHOP_MAINTENANCE: Wrench,
  RECOVERY_DISPATCH: Truck,
  SAFETY_COMPLIANCE: ShieldCheck,
  CUSTOMER_SERVICE: MessageSquare,
  FACILITIES_CLEANING: Sparkles,
};

const DEPT_BADGES: Record<
  TicketDepartment,
  { bg: string; text: string; border: string }
> = {
  OPERATIONS_TRIAGE: {
    bg: 'bg-slate-500/20',
    text: 'text-slate-300',
    border: 'border-slate-500/40',
  },
  WORKSHOP_MAINTENANCE: {
    bg: 'bg-amber-500/20',
    text: 'text-amber-300',
    border: 'border-amber-500/40',
  },
  RECOVERY_DISPATCH: {
    bg: 'bg-rose-500/20',
    text: 'text-rose-300',
    border: 'border-rose-500/40',
  },
  SAFETY_COMPLIANCE: {
    bg: 'bg-violet-500/20',
    text: 'text-violet-300',
    border: 'border-violet-500/40',
  },
  CUSTOMER_SERVICE: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-300',
    border: 'border-blue-500/40',
  },
  FACILITIES_CLEANING: {
    bg: 'bg-emerald-500/20',
    text: 'text-emerald-300',
    border: 'border-emerald-500/40',
  },
};

export function ForwardTicketModal({
  ticket,
  isOpen,
  onClose,
  onSuccess,
}: ForwardTicketModalProps) {
  const currentDept = ticket?.assignedDepartment || 'OPERATIONS_TRIAGE';
  
  // Default to WORKSHOP_MAINTENANCE if currently in triage, else first other dept
  const [selectedDept, setSelectedDept] = useState<TicketDepartment>(
    currentDept === 'OPERATIONS_TRIAGE' ? 'WORKSHOP_MAINTENANCE' : currentDept
  );
  const [assignee, setAssignee] = useState<string>(ticket?.assignedTo || '');
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority || 'Medium');
  const [forwardNotes, setForwardNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !ticket) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/service-tickets/${ticket.id}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department: selectedDept,
          forwardNotes: forwardNotes.trim() || undefined,
          assignee: assignee.trim() || undefined,
          priority,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to forward ticket');
      }

      onSuccess(data.ticket, data.maintenanceRequest);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred while forwarding the ticket');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Forward Ticket to Department
              </h3>
              <p className="text-xs text-slate-400">
                Operations Triage · Re-route ticket to the concerned operating unit
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Ticket Context Summary */}
        <div className="px-5 py-3 bg-slate-950/60 border-b border-white/5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-semibold text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                {ticket.readableId || ticket.id.slice(0, 8)}
              </span>
              <span className="text-xs font-semibold text-white truncate max-w-[260px]">
                {ticket.title}
              </span>
            </div>
            {ticket.vehicleId && (
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Vehicle: <span className="font-mono text-slate-300">{ticket.vehicleId}</span>
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className="text-[10px] text-slate-400 block mb-0.5">Current Dept:</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${
                DEPT_BADGES[currentDept]?.bg || 'bg-slate-500/20'
              } ${DEPT_BADGES[currentDept]?.text || 'text-slate-300'} ${
                DEPT_BADGES[currentDept]?.border || 'border-slate-500/40'
              }`}
            >
              {TICKET_DEPARTMENTS.find((d) => d.key === currentDept)?.label || currentDept}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Department Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Target Department <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TICKET_DEPARTMENTS.map((dept) => {
                const Icon = DEPT_ICONS[dept.key];
                const isSelected = selectedDept === dept.key;
                const isCurrent = currentDept === dept.key;
                const tone = DEPT_BADGES[dept.key];

                return (
                  <button
                    key={dept.key}
                    type="button"
                    onClick={() => setSelectedDept(dept.key)}
                    className={`text-left p-3 rounded-xl border transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'bg-violet-600/15 border-violet-500/60 ring-1 ring-violet-500/40'
                        : 'bg-slate-800/40 border-white/5 hover:border-white/15 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-lg ${tone.bg} flex items-center justify-center ${tone.text}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-bold text-white leading-tight">
                          {dept.label}
                        </span>
                      </div>
                      {isCurrent && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
                      {dept.description}
                    </p>
                    {dept.key === 'WORKSHOP_MAINTENANCE' && (
                      <span className="mt-2 text-[9px] font-medium text-amber-400 flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Auto-creates Work Order
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority & Assignee Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High (Immediate)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Assignee Email / Officer (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. workshop.supervisor@fleet360.io"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          {/* Forward Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Forwarding Notes & Handover Instructions
            </label>
            <textarea
              rows={3}
              placeholder="Add operational notes, urgency rationale, or specific instructions for the target department..."
              value={forwardNotes}
              onChange={(e) => setForwardNotes(e.target.value)}
              className="w-full bg-slate-800/60 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-xs font-bold text-white shadow-lg shadow-violet-500/20 disabled:opacity-50 transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              {loading ? 'Forwarding...' : 'Forward to Department'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
