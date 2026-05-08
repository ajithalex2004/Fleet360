'use client';

/**
 * /service-tickets — Service & Support Ticketing module home (Phase 1B).
 *
 * One module, 7 ticket types. Same engines as /maintenance/service-requests:
 *   - Status workflow: Pending → Acknowledged → Assigned/Escalated → Resolved
 *   - SLA aging badge on Pending cards (24h / 72h thresholds)
 *   - Bulk actions toolbar (Acknowledge / Assign / Escalate / Resolve)
 *   - History audit appended to every PATCH
 *   - Auto-creates a MaintenanceRequest when a MAINTENANCE-type ticket is
 *     Acknowledged (preserves the existing /maintenance cross-module bridge).
 *
 * Tenant access matrix is enforced server-side on POST; the UI hides any
 * disabled types from the type tabs and the create form.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Headphones, Plus, AlertCircle, Clock, ChevronRight, ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { TICKET_TYPES_ORDER } from '@/types/service-tickets';
import type { TicketType, ServiceTicket, TenantTicketTypeAccess, FormFieldDef } from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';
import { getServiceIcon } from '@/lib/service-tickets/icons';
import { createMaintenanceRequest } from '@/services/mockData';

/** Map of ticket type → resolved form fields, sourced from
 *  /api/service-tickets/form-fields. Empty array for a type means
 *  "no extra fields". `undefined` for the whole map means "still loading". */
type FormFieldsByType = Partial<Record<TicketType, FormFieldDef[]>>;

/** Per-type config (presentation + behavioural) sourced from the same
 *  endpoint. Single source of truth for everything the UI needs to render
 *  a service-ticket type. */
interface ServiceTypeConfig {
  name: string;
  longLabel: string;
  description: string;
  iconName: string | null;
  tone: ServiceTone;
  sortOrder: number;
  vehicleRequired: boolean;
  autoCreatesMaintenanceRequest: boolean;
  defaultPriority: 'Low' | 'Medium' | 'High';
  defaultSlaHours: number;
  prefix: string;
  approvalRequired: boolean;
  approvalEmergencyBypass: boolean;
}
type TypeConfigByType = Partial<Record<TicketType, ServiceTypeConfig>>;

// ── Shared visuals ───────────────────────────────────────────────────────────
const TONE_BG: Record<string, string> = {
  gold: 'bg-amber-500/10', blue: 'bg-blue-500/10', emerald: 'bg-emerald-500/10',
  amber: 'bg-amber-500/10', rose: 'bg-rose-500/10', slate: 'bg-slate-500/10',
  violet: 'bg-violet-500/10',
};
const TONE_FG: Record<string, string> = {
  gold: 'text-amber-300', blue: 'text-blue-300', emerald: 'text-emerald-300',
  amber: 'text-amber-300', rose: 'text-rose-300', slate: 'text-slate-300',
  violet: 'text-violet-300',
};
const STATUS_BADGE: Record<string, string> = {
  'Awaiting Approval': 'bg-amber-500/30 text-amber-200 border-amber-500/60 ring-1 ring-amber-500/30',
  Pending:      'bg-amber-500/20 text-amber-300 border-amber-500/40',
  Acknowledged: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  Assigned:     'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Escalated:    'bg-rose-500/20 text-rose-300 border-rose-500/40',
  'In Progress':'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Resolved:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Completed:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Rejected:     'bg-rose-500/20 text-rose-300 border-rose-500/40',
  Closed:       'bg-slate-500/20 text-slate-300 border-slate-500/40',
};
const PRIORITY_FG: Record<string, string> = {
  Low:    'text-emerald-400',
  Medium: 'text-amber-400',
  High:   'text-rose-400',
};

// ── SLA aging helper ─────────────────────────────────────────────────────────
// Phase 2C.x — thresholds now driven by the ticket's resolved SLA target
// (warn at 50%, breach at 100%). Falls back to the legacy 24h/72h pair when
// the API hasn't supplied a target (e.g. tenants pre-2C.x or ticket created
// before the schema change).
function pendingAge(t: ServiceTicket): { hours: number; tone: 'ok' | 'warn' | 'breach'; targetHours?: number } | null {
  if (t.status !== 'Pending') return null;
  const start = new Date(t.createdAt).getTime();
  if (!isFinite(start)) return null;
  const hours = Math.max(0, (Date.now() - start) / 3_600_000);

  const target = t.slaTargetHours;
  if (typeof target === 'number' && target > 0) {
    const tone: 'ok' | 'warn' | 'breach' =
      hours >= target ? 'breach'
      : hours >= target * 0.5 ? 'warn'
      : 'ok';
    return { hours, tone, targetHours: target };
  }

  // Legacy fallback — fixed thresholds.
  return { hours, tone: hours > 72 ? 'breach' : hours > 24 ? 'warn' : 'ok' };
}
function ageLabel(h: number): string {
  if (h < 1)  return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
function withHistory(t: ServiceTicket, status: string, actor: string, note?: string) {
  return [
    ...(t.history ?? []),
    { status, date: new Date().toISOString(), actor, ...(note ? { note } : {}) },
  ];
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ServiceTicketsHome() {
  const [, setTenantId]               = useState<string | null>(null);
  const [userId, setUserId]           = useState<string | null>(null);
  const [accessMap, setAccessMap]     = useState<Map<TicketType, TenantTicketTypeAccess>>(new Map());
  const [formFieldsByType, setFormFieldsByType] = useState<FormFieldsByType>({});
  const [typeConfigByType, setTypeConfigByType] = useState<TypeConfigByType>({});
  const [tickets, setTickets]         = useState<ServiceTicket[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const [activeType, setActiveType]   = useState<TicketType | 'ALL'>('ALL');
  const [showForm, setShowForm]       = useState(false);

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy]       = useState(false);

  /** Enabled types as a sorted list of (type, config) pairs. Sourced from
   *  typeConfigByType (Service Configuration Engine), filtered through
   *  accessMap. Sort order also lives on the type record. */
  const enabledTypes = useMemo(() => {
    const types = (Object.keys(typeConfigByType) as TicketType[])
      .filter(t => accessMap.get(t)?.enabled !== false);
    return types
      .map(t => ({ type: t, cfg: typeConfigByType[t]! }))
      .sort((a, b) => a.cfg.sortOrder - b.cfg.sortOrder);
  }, [accessMap, typeConfigByType]);

  // ── Initial load ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) throw new Error('Not authenticated');
      const me = await meRes.json();
      setTenantId(me.tenantId);
      setUserId(me.userId);

      const [matrixRes, ticketsRes, fieldsRes] = await Promise.all([
        fetch(`/api/admin/tenants/${me.tenantId}/ticket-types`),
        fetch(`/api/service-tickets`),
        fetch(`/api/service-tickets/form-fields`),
      ]);

      if (matrixRes.ok) {
        const data = await matrixRes.json();
        const map = new Map<TicketType, TenantTicketTypeAccess>(
          (data.matrix as TenantTicketTypeAccess[]).map(r => [r.ticketType, r])
        );
        setAccessMap(map);
      }
      if (fieldsRes.ok) {
        const data = await fieldsRes.json();
        setFormFieldsByType(data.formFields ?? {});
        setTypeConfigByType(data.typeConfig ?? {});
      }
      if (ticketsRes.ok) {
        const data = await ticketsRes.json();
        setTickets(data.tickets ?? []);
      } else {
        const body = await ticketsRes.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Failed to load tickets');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Filter ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (activeType === 'ALL') return tickets;
    return tickets.filter(t => t.ticketType === activeType);
  }, [tickets, activeType]);

  // ── Counts per type for tabs ─────────────────────────────────────────
  const countByType = useMemo(() => {
    const out: Record<string, number> = { ALL: tickets.length };
    for (const type of TICKET_TYPES_ORDER) out[type] = 0;
    for (const t of tickets) {
      out[t.ticketType] = (out[t.ticketType] ?? 0) + 1;
    }
    return out;
  }, [tickets]);

  // ── Mutations ────────────────────────────────────────────────────────
  const patch = async (id: string, patchBody: Record<string, unknown>): Promise<ServiceTicket | null> => {
    const res = await fetch(`/api/service-tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e?.error ?? 'Update failed');
      return null;
    }
    const d = await res.json();
    return d.ticket as ServiceTicket;
  };

  const handleStatusChange = async (
    ticket: ServiceTicket,
    newStatus: 'Acknowledged' | 'Resolved' | 'Assigned' | 'Escalated' | 'Pending' | 'Rejected',
  ) => {
    let assignee: string | null = null;
    if (newStatus === 'Assigned' || newStatus === 'Escalated') {
      const v = window.prompt(`${newStatus} ${ticket.readableId ?? ''} to which email?`, ticket.assignedTo ?? '');
      if (!v) return;
      const trimmed = v.trim();
      if (!/.+@.+\..+/.test(trimmed)) { alert('Please enter a valid email.'); return; }
      assignee = trimmed;
    }

    // Approval gate — confirm and capture an optional reason for Reject.
    let rejectReason: string | null = null;
    if (ticket.status === 'Awaiting Approval' && newStatus === 'Pending') {
      if (!window.confirm(`Approve ${ticket.readableId ?? 'this ticket'}? It will move to Pending.`)) return;
    }
    if (ticket.status === 'Awaiting Approval' && newStatus === 'Rejected') {
      const r = window.prompt(`Reject ${ticket.readableId ?? 'this ticket'} — reason (optional):`, '');
      if (r === null) return; // user cancelled
      rejectReason = r.trim() || null;
    }

    let extraNote: string | undefined =
      assignee
        ? `${newStatus} to ${assignee}${ticket.assignedTo ? ` (was ${ticket.assignedTo})` : ''}`
        : newStatus === 'Pending' && ticket.status === 'Awaiting Approval'
          ? 'Approved — moved to Pending'
          : newStatus === 'Rejected'
            ? rejectReason ? `Rejected: ${rejectReason}` : 'Rejected'
            : undefined;

    let mrId: string | null = null;

    // Special case — MAINTENANCE Acknowledge auto-creates a back-office MR.
    // Flag resolved through the Service Configuration Engine (typeConfig is
    // loaded by the parent from /api/service-tickets/form-fields).
    const autoCreatesMR = !!typeConfigByType[ticket.ticketType]?.autoCreatesMaintenanceRequest;
    if (autoCreatesMR && newStatus === 'Acknowledged') {
      try {
        if (!ticket.vehicleId) { alert('Cannot Acknowledge — no vehicle on this ticket.'); return; }
        const mr = await createMaintenanceRequest({
          vehicleId: ticket.vehicleId,
          driverId:  ticket.relatedDriverId ?? ticket.requestorId,
          requestDate: new Date(ticket.createdAt).toISOString(),
          description: ticket.description ?? ticket.title,
          estimatedCost: 0,
        });
        mrId = mr?.id ?? null;
        if (mrId) extraNote = `Linked to Maintenance Request ${mrId}`;
      } catch (err) {
        console.error('Auto-MR creation failed', err);
        alert('Could not auto-create the linked Maintenance Request — Acknowledge aborted.');
        return;
      }
    }

    const updated = await patch(ticket.id, {
      status: newStatus,
      ...(assignee ? { assignedTo: assignee } : {}),
      ...(mrId    ? { maintenanceRequestId: mrId } : {}),
      history: withHistory(ticket, newStatus, userId ?? 'user', extraNote),
    });
    if (updated) {
      setTickets(prev => prev.map(t => t.id === ticket.id ? updated : t));
    }
  };

  // ── Bulk ─────────────────────────────────────────────────────────────
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulk = async (newStatus: 'Acknowledged' | 'Resolved' | 'Assigned' | 'Escalated') => {
    if (selectedIds.size === 0 || bulkBusy) return;
    const targets = tickets.filter(t => selectedIds.has(t.id));

    let assignee: string | null = null;
    if (newStatus === 'Assigned' || newStatus === 'Escalated') {
      const v = window.prompt(`${newStatus} ${targets.length} tickets to which email?`, '');
      if (!v) return;
      const trimmed = v.trim();
      if (!/.+@.+\..+/.test(trimmed)) { alert('Please enter a valid email.'); return; }
      assignee = trimmed;
    }
    if (!window.confirm(`Apply "${newStatus}"${assignee ? ` (${assignee})` : ''} to ${targets.length} tickets?`)) return;

    setBulkBusy(true);
    try {
      const updates = await Promise.all(targets.map(async t => {
        let mrId: string | null = null;
        let note: string | undefined =
          assignee ? `Bulk ${newStatus.toLowerCase()} to ${assignee}${t.assignedTo ? ` (was ${t.assignedTo})` : ''}` : `Bulk ${newStatus.toLowerCase()}`;

        const autoCreatesMR = !!typeConfigByType[t.ticketType]?.autoCreatesMaintenanceRequest;
        if (autoCreatesMR && newStatus === 'Acknowledged' && t.vehicleId) {
          try {
            const mr = await createMaintenanceRequest({
              vehicleId: t.vehicleId,
              driverId: t.relatedDriverId ?? t.requestorId,
              requestDate: new Date(t.createdAt).toISOString(),
              description: t.description ?? t.title,
              estimatedCost: 0,
            });
            mrId = mr?.id ?? null;
            if (mrId) note = `${note} · linked MR ${mrId}`;
          } catch { /* swallow per-row failure; continue with PATCH */ }
        }

        return patch(t.id, {
          status: newStatus,
          ...(assignee ? { assignedTo: assignee } : {}),
          ...(mrId ? { maintenanceRequestId: mrId } : {}),
          history: withHistory(t, newStatus, userId ?? 'user', note),
        });
      }));
      const ok = updates.filter(Boolean) as ServiceTicket[];
      const okIds = new Set(ok.map(u => u.id));
      setTickets(prev => prev.map(t => okIds.has(t.id) ? ok.find(u => u.id === t.id)! : t));
      clearSelection();
      alert(`${ok.length}/${targets.length} tickets updated.`);
    } finally {
      setBulkBusy(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader
        title="Service & Support Ticketing"
        subtitle="One module · seven ticket types · shared SLA, assignment & notification engines"
        icon={Headphones}
        accent="violet"
        actions={
          <button onClick={() => setShowForm(s => !s)}
            disabled={enabledTypes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/30">
            <Plus className="w-4 h-4" /> {showForm ? 'Hide form' : 'New ticket'}
          </button>
        }
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Type tabs */}
      <div className="flex flex-wrap gap-1.5 bg-slate-900/40 border border-white/10 rounded-2xl p-1.5">
        <TabBtn active={activeType === 'ALL'} onClick={() => setActiveType('ALL')}
          label="All" count={countByType.ALL} tone="violet" />
        {enabledTypes.map(({ type, cfg }) => (
          <TabBtn key={type}
            active={activeType === type}
            onClick={() => setActiveType(type)}
            label={cfg.name}
            count={countByType[type] ?? 0}
            tone={cfg.tone}
            Icon={getServiceIcon(cfg.iconName)} />
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <NewTicketForm
          enabledTypes={enabledTypes.map(c => c.type)}
          formFieldsByType={formFieldsByType}
          typeConfigByType={typeConfigByType}
          onCreated={(t) => {
            setTickets(prev => [t, ...prev]);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 flex items-center gap-2 flex-wrap rounded-xl bg-violet-600/15 border border-violet-500/40 backdrop-blur-md px-4 py-2.5 shadow-lg shadow-violet-500/20">
          <span className="text-sm font-semibold text-white">{selectedIds.size} selected</span>
          <span className="ml-auto" />
          <BulkBtn label="✓ Acknowledge" onClick={() => handleBulk('Acknowledged')} disabled={bulkBusy} cls="bg-blue-600 hover:bg-blue-500" />
          <BulkBtn label="→ Assign"      onClick={() => handleBulk('Assigned')}      disabled={bulkBusy} cls="bg-violet-600 hover:bg-violet-500" />
          <BulkBtn label="↑ Escalate"    onClick={() => handleBulk('Escalated')}     disabled={bulkBusy} cls="bg-rose-600 hover:bg-rose-500" />
          <BulkBtn label="✓ Resolve"     onClick={() => handleBulk('Resolved')}      disabled={bulkBusy} cls="bg-emerald-600 hover:bg-emerald-500" />
          <BulkBtn label="Clear"         onClick={clearSelection}                     disabled={bulkBusy} cls="bg-slate-700 hover:bg-slate-600" />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-slate-900 rounded-lg p-4 border border-white/10 animate-pulse h-56" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900 border border-white/10 rounded-2xl py-16 text-center">
          <Headphones className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No tickets {activeType !== 'ALL' && `of type ${typeConfigByType[activeType]?.name ?? activeType}`} yet.</p>
          <button onClick={() => setShowForm(true)}
            disabled={enabledTypes.length === 0}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 text-sm">
            <Plus className="w-4 h-4" /> Create the first one
          </button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(t => (
            <TicketCard
              key={t.id}
              ticket={t}
              formFields={formFieldsByType[t.ticketType]}
              typeConfig={typeConfigByType[t.ticketType]}
              selected={selectedIds.has(t.id)}
              onToggleSelect={() => toggleSelected(t.id)}
              onStatusChange={(status) => handleStatusChange(t, status)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, label, count, tone, Icon }: {
  active: boolean; onClick: () => void; label: string; count: number; tone: string;
  Icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active
          ? `${TONE_BG[tone]} ${TONE_FG[tone]} ring-1 ring-current/30`
          : 'text-slate-400 hover:text-white hover:bg-white/5'
      }`}>
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {label}
      <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${
        active ? 'bg-black/30' : 'bg-slate-700/60'
      }`}>{count}</span>
    </button>
  );
}

function BulkBtn({ label, onClick, disabled, cls }: { label: string; onClick: () => void; disabled?: boolean; cls: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 text-white font-semibold ${cls}`}>
      {label}
    </button>
  );
}

function TicketCard({ ticket, formFields, typeConfig, selected, onToggleSelect, onStatusChange }: {
  ticket: ServiceTicket;
  formFields?: FormFieldDef[];
  typeConfig?: ServiceTypeConfig;
  selected: boolean;
  onToggleSelect: () => void;
  onStatusChange: (s: 'Acknowledged' | 'Resolved' | 'Assigned' | 'Escalated' | 'Pending' | 'Rejected') => void;
}) {
  const Icon = getServiceIcon(typeConfig?.iconName);
  const tone = typeConfig?.tone ?? 'violet';
  const typeLabel = typeConfig?.name ?? ticket.ticketType;
  const age = pendingAge(ticket);
  const isHigh = ticket.priority === 'High';
  const awaitingApproval = ticket.status === 'Awaiting Approval';

  // Surface fields marked `preview: true` from the resolved per-type schema
  // as a small strip below the description. Schema sourced from the parent
  // which loaded it via /api/service-tickets/form-fields.
  const fieldDefs = formFields ?? [];
  const previewFields = fieldDefs.filter(f => f.preview);
  const customFields = ticket.customFields ?? {};
  const renderPreviewValue = (f: typeof previewFields[number], v: unknown): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (f.type === 'select') {
      const opt = f.options?.find(o => o.value === v);
      return opt?.label ?? String(v);
    }
    if (f.type === 'date' || f.type === 'datetime') {
      const s = String(v);
      return s.includes('T') ? s.replace('T', ' ').slice(0, 16) : s;
    }
    if (f.type === 'checkbox') return v ? 'Yes' : null;
    return String(v);
  };

  return (
    <div className={`bg-slate-900 rounded-lg p-4 relative overflow-hidden group border shadow-sm hover:shadow-md transition-all flex flex-col ${
      isHigh ? 'border-rose-400/40 ring-1 ring-rose-500/10' : 'border-white/10'
    } ${selected ? 'ring-2 ring-violet-500/60' : ''}`}>
      {/* Hover/selected checkbox */}
      <label
        className={`absolute top-2 left-2 z-30 cursor-pointer transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onClick={e => e.stopPropagation()}
        title="Select for bulk action">
        <input type="checkbox" checked={selected} onChange={onToggleSelect}
          className="w-4 h-4 accent-violet-500 rounded" />
      </label>

      <div className="relative z-10 flex-1">
        {/* ID row */}
        <div className="flex justify-between items-start mb-3 gap-2">
          <span className="text-[11px] font-mono font-semibold text-slate-300 bg-slate-700/40 px-2 py-0.5 rounded" title={ticket.id}>
            {ticket.readableId ?? ticket.id.slice(0, 12)}
          </span>
          <div className="flex items-center gap-1.5">
            {age && (
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border tabular-nums inline-flex items-center gap-1 ${
                age.tone === 'breach' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                : age.tone === 'warn' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-500/20 text-slate-400 border-slate-500/40'
              }`} title={
                age.targetHours
                  ? age.tone === 'breach' ? `SLA breach — exceeded ${age.targetHours}h target`
                    : age.tone === 'warn' ? `SLA warn — past 50% of ${age.targetHours}h target`
                    : `Pending — within SLA (${age.targetHours}h target)`
                  : age.tone === 'breach' ? 'SLA breach — pending >72h'
                    : age.tone === 'warn' ? 'SLA warn — pending >24h'
                    : 'Pending'
              }>
                <Clock className="w-2.5 h-2.5" /> {ageLabel(age.hours)}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_BADGE[ticket.status] ?? STATUS_BADGE.Pending}`}>
              {ticket.status}
            </span>
          </div>
        </div>

        {/* Type + Title */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-7 h-7 rounded-lg ${TONE_BG[tone]} flex items-center justify-center shrink-0`}>
            <Icon className={`w-3.5 h-3.5 ${TONE_FG[tone]}`} strokeWidth={2} />
          </div>
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${TONE_FG[tone]}`}>
            {typeLabel}
          </span>
        </div>
        <h4 className="text-sm font-bold text-white mb-1 line-clamp-1" title={ticket.title}>{ticket.title}</h4>
        {ticket.description && (
          <p className="text-xs text-slate-500 mb-3 line-clamp-2 h-8">{ticket.description}</p>
        )}

        {/* Per-type preview fields — chips for badges, plain rows for text */}
        {previewFields.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {previewFields.map(f => {
              const display = renderPreviewValue(f, customFields[f.key]);
              if (!display) return null;
              if (f.display === 'badge') {
                return (
                  <span key={f.key}
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${TONE_BG[tone]} ${TONE_FG[tone]} border-current/30`}
                    title={f.label}>
                    {display}
                  </span>
                );
              }
              return (
                <span key={f.key} className="text-[10px] text-slate-400" title={f.label}>
                  <span className="text-slate-500">{f.label}:</span> <span className="text-slate-300">{display}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Details */}
        <div className="space-y-1.5 text-xs border-t border-white/5 pt-3">
          {ticket.vehicleId && (
            <div className="flex justify-between">
              <span className="text-slate-500">Vehicle:</span>
              <span className="text-slate-300 font-mono text-[10px] truncate max-w-[120px]">{ticket.vehicleId}</span>
            </div>
          )}
          {ticket.dueDate && (
            <div className="flex justify-between">
              <span className="text-slate-500">Due:</span>
              <span className="text-slate-300">{ticket.dueDate.split('T')[0]}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-1">
            <span className="text-slate-500">Priority:</span>
            <span className={`font-medium ${PRIORITY_FG[ticket.priority]}`}>{ticket.priority}</span>
          </div>
          {ticket.assignedTo && (
            <div className="flex justify-between items-center pt-1">
              <span className="text-slate-500">Assignee:</span>
              <span className="text-slate-300 truncate max-w-[120px]" title={ticket.assignedTo}>{ticket.assignedTo}</span>
            </div>
          )}
          {ticket.maintenanceRequestId && (
            <div className="flex justify-between items-center pt-1">
              <span className="text-slate-500">Linked MR:</span>
              <span className="text-blue-300 inline-flex items-center gap-0.5 font-mono text-[10px]" title={ticket.maintenanceRequestId}>
                <ArrowUpRight className="w-2.5 h-2.5" />
                {ticket.maintenanceRequestId.slice(0, 12)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 mt-4">
        {awaitingApproval && (
          <>
            <button onClick={() => onStatusChange('Pending')}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1">
              ✓ Approve
            </button>
            <button onClick={() => onStatusChange('Rejected')}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold inline-flex items-center gap-1">
              ✕ Reject
            </button>
          </>
        )}
        {ticket.status === 'Pending' && (
          <button onClick={() => onStatusChange('Acknowledged')}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold inline-flex items-center gap-1">
            ✓ Acknowledge
          </button>
        )}
        {(ticket.status === 'Pending' || ticket.status === 'Acknowledged') && (
          <>
            <button onClick={() => onStatusChange('Assigned')}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">
              → Assign
            </button>
            <button onClick={() => onStatusChange('Escalated')}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold">
              ↑ Escalate
            </button>
          </>
        )}
        {['Acknowledged', 'Assigned', 'Escalated', 'In Progress'].includes(ticket.status) && (
          <button onClick={() => onStatusChange('Resolved')}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold ml-auto inline-flex items-center gap-1">
            ✓ Resolve <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Create form ──────────────────────────────────────────────────────────────
function NewTicketForm({
  enabledTypes,
  formFieldsByType,
  typeConfigByType,
  onCreated,
  onCancel,
}: {
  enabledTypes: TicketType[];
  formFieldsByType: FormFieldsByType;
  typeConfigByType: TypeConfigByType;
  onCreated: (t: ServiceTicket) => void;
  onCancel: () => void;
}) {
  const [ticketType, setTicketType] = useState<TicketType>(enabledTypes[0] ?? 'MAINTENANCE');
  const [title, setTitle]           = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority]     = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [vehicleId, setVehicleId]   = useState('');
  const [dueDate, setDueDate]       = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  // Resolved per-type config from the Service Configuration Engine —
  // delivered by /api/service-tickets/form-fields. Single source of truth
  // for everything the create form needs. Fallback values cover the brief
  // window before the parent's mount fetch completes.
  const tc = typeConfigByType[ticketType];
  const formFields: FormFieldDef[] = formFieldsByType[ticketType] ?? [];
  const vehicleRequired         = !!tc?.vehicleRequired;
  const autoCreatesMR           = !!tc?.autoCreatesMaintenanceRequest;
  const resolvedDefaultPriority = tc?.defaultPriority ?? 'Medium';
  const longLabel               = tc?.longLabel ?? ticketType;
  const defaultSlaHours         = tc?.defaultSlaHours ?? 24;
  const willAwaitApproval =
    !!tc?.approvalRequired
    && !(tc.approvalEmergencyBypass && priority === 'High');

  // Reset per-type custom fields whenever the ticket type changes — different
  // types have different field schemas, so values don't carry across.
  useEffect(() => {
    setCustomFields({});
  }, [ticketType]);

  // When the type's defaultPriority differs from current selection AND the
  // user hasn't started typing, snap to it. We only do this on type change.
  useEffect(() => {
    setPriority(p => (p === 'Low' || p === 'Medium' || p === 'High') ? resolvedDefaultPriority : p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketType]);

  const setField = (key: string, value: unknown) => {
    setCustomFields(prev => ({ ...prev, [key]: value }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!title.trim()) { setErr('Title is required.'); return; }
    if (vehicleRequired && !vehicleId.trim()) { setErr(`${longLabel} requires a vehicle ID.`); return; }

    // Client-side mirror of server validation — fail fast before POST.
    for (const f of formFields) {
      if (!f.required) continue;
      const v = customFields[f.key];
      const empty = v === undefined || v === null || v === '' || v === false;
      if (empty && f.type !== 'checkbox') {
        setErr(`${f.label} is required for ${longLabel}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/service-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketType,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          vehicleId: vehicleId.trim() || undefined,
          dueDate: dueDate || undefined,
          customFields: Object.keys(customFields).length ? customFields : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Failed to create ticket'); return; }
      onCreated(data.ticket as ServiceTicket);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}
      className="bg-slate-900 border border-violet-500/30 rounded-2xl p-5 space-y-4 shadow-lg shadow-violet-500/10">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">Create new ticket</h3>
        <button type="button" onClick={onCancel}
          className="text-xs text-slate-400 hover:text-white">Cancel</button>
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs">{err}</div>
      )}

      {/* Type chooser */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Type</label>
        <div className="flex flex-wrap gap-2">
          {enabledTypes.map((t: TicketType) => {
            const c = typeConfigByType[t];
            if (!c) return null;
            const Icon = getServiceIcon(c.iconName);
            const active = t === ticketType;
            return (
              <button type="button" key={t} onClick={() => setTicketType(t)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  active
                    ? `${TONE_BG[c.tone]} ${TONE_FG[c.tone]} border-current/40`
                    : 'bg-slate-800/50 text-slate-400 border-white/10 hover:border-white/30'
                }`}>
                <Icon className="w-3.5 h-3.5" /> {c.name}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500">
          Default SLA: <strong className="text-white">{defaultSlaHours}h</strong> · default priority: <strong className="text-white">{resolvedDefaultPriority}</strong>
          {autoCreatesMR && <span className="ml-2 text-blue-300">· auto-creates Maintenance Request on Acknowledge</span>}
        </p>
        {/* Approval-gate hint — derived server-side from the resolved
            approval rules. */}
        {willAwaitApproval && (
          <p className="text-[11px] text-amber-300/90 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            This ticket will start in <strong className="text-amber-200">Awaiting Approval</strong>.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} required
            placeholder="Short summary"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value as 'Low' | 'Medium' | 'High')}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Due date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Vehicle ID {vehicleRequired && <span className="text-rose-400">*</span>}
          </label>
          <input value={vehicleId} onChange={e => setVehicleId(e.target.value)}
            placeholder={vehicleRequired ? 'Required for this ticket type' : 'Optional'}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>

        {/* Per-type dynamic fields — driven by resolved formFields
            (admin-edited rules first, compile-time config as fallback). */}
        {formFields.map(f => (
          <DynamicField key={`${ticketType}:${f.key}`}
            field={f}
            value={customFields[f.key]}
            onChange={v => setField(f.key, v)} />
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
        <button type="submit" disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all">
          <Plus className="w-4 h-4" /> {submitting ? 'Creating…' : 'Create ticket'}
        </button>
      </div>
    </form>
  );
}

// ── Dynamic per-type form field ─────────────────────────────────────────────
// Renders a single field from cfg.formFields. Knows about all 7 input types.
// Layout: text/textarea/select span 2 cols; numbers/dates/checkboxes 1 col.
function DynamicField({
  field, value, onChange,
}: {
  field: FormFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const span = field.type === 'textarea' || field.type === 'select' || field.type === 'text'
    ? 'md:col-span-2' : '';
  const labelEl = (
    <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
      {field.label} {field.required && <span className="text-rose-400">*</span>}
    </label>
  );

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-1 md:col-span-2">
        <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
          <input type="checkbox"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            className="w-4 h-4 accent-violet-500 rounded" />
          <span>{field.label}{field.required && <span className="ml-1 text-rose-400">*</span>}</span>
        </label>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div className={`space-y-1 ${span}`}>
        {labelEl}
        <select value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value || undefined)}
          required={field.required}
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
          <option value="">— Select —</option>
          {field.options?.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className={`space-y-1 ${span}`}>
        {labelEl}
        <textarea
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          rows={3}
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
      </div>
    );
  }

  // text / number / date / datetime — same input shape, different `type` attr.
  const inputType =
    field.type === 'number'   ? 'number'           :
    field.type === 'date'     ? 'date'             :
    field.type === 'datetime' ? 'datetime-local'   : 'text';

  return (
    <div className={`space-y-1 ${span}`}>
      {labelEl}
      <input type={inputType}
        value={(value as string | number | undefined) ?? ''}
        onChange={e => {
          const v = e.target.value;
          onChange(field.type === 'number' ? (v === '' ? undefined : Number(v)) : v);
        }}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        required={field.required}
        className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
    </div>
  );
}
