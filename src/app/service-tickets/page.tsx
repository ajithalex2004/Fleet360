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
import {
  Headphones, Plus, AlertCircle, Clock, ChevronRight, ArrowUpRight,
  Paperclip, Upload, X, Car, Wrench, Lock,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { TICKET_TYPES_ORDER } from '@/types/service-tickets';
import type { TicketType, ServiceTicket, TenantTicketTypeAccess, FormFieldDef } from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';
import { getServiceIcon } from '@/lib/service-tickets/icons';
import { createMaintenanceRequest } from '@/services/mockData';

// ── Phase A/B data-master types — what the form fetches once per mount ─────
interface MaintenanceTypeOpt {
  id: string; code: string; name: string;
  defaultPriority: 'Low' | 'Medium' | 'High';
  estimatedHours: number | null;
  defaultAssignee: string | null;
}
interface AttachmentTypeOpt {
  id: string; code: string; name: string;
  required: boolean;
  maxFileSizeMb: number | null;
  allowedMimeTypes: string[];
  appliesTo: string[];
}
interface VehicleOpt {
  id: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  makeModelYear: string;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  vehicleClass: string | null;
  branchId: string | null;
  branchName: string | null;
  status: string | null;
  lastOdometer: number | null;
}

interface CurrentUser {
  id: string;
  email: string | null;
  name: string | null;
  department: string | null;
  role: string | null;
}

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
  // currentUser is forwarded to NewTicketForm so binding-aware fields can
  // render the resolved value client-side (display-only — server has the
  // final word on POST).
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
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
      // Compose a CurrentUser snapshot for binding-aware fields. /api/auth/me
      // returns userId / tenantId / role / tenantName; we merge in firstName
      // / lastName / email / department from the user record when available
      // so client-side resolveSourceClient() can fill currentUser.* sources.
      setCurrentUser({
        id:         me.userId ?? '',
        email:      me.email ?? null,
        name:       me.userName ?? me.fullName ?? me.email ?? null,
        department: me.department ?? null,
        role:       me.role ?? null,
      });

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
          currentUser={currentUser}
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

// ── Create form (Phase B + B+) ──────────────────────────────────────────────
//
// Adds for MAINTENANCE tickets specifically:
//   • Maintenance Type dropdown sourced from the Maintenance Type Master
//     (Phase A). Picking one auto-fills Priority + estimated hours.
//   • Vehicle dropdown sourced from /api/fleet/vehicles/dropdown (Phase A).
//     Picking a vehicle auto-populates the Vehicle Type read-only chip
//     and pre-fills Current Odometer with the last known reading.
//   • Current Odometer numeric input.
//   • Multi-attachment widget — Type dropdown sourced from the Attachment
//     Master (Phase A) + file upload via /api/service-tickets/upload.
//
// Adds for ALL ticket types (Phase B+ bindings):
//   • Custom fields with `source !== 'user-input'` are auto-populated from
//     the current user / selected vehicle / selected maintenance type.
//   • Custom fields with `readOnly: true` render disabled.
//   • Custom fields with `hidden: true` don't render at all (server still
//     resolves their values from the source).
function NewTicketForm({
  enabledTypes,
  formFieldsByType,
  typeConfigByType,
  currentUser,
  onCreated,
  onCancel,
}: {
  enabledTypes: TicketType[];
  formFieldsByType: FormFieldsByType;
  typeConfigByType: TypeConfigByType;
  currentUser: CurrentUser | null;
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

  // Maintenance-specific state.
  const [maintenanceTypeId, setMaintenanceTypeId] = useState('');
  const [odometer, setOdometer]                   = useState<string>('');

  // Multi-attachment payload — populated as the user uploads files.
  const [attachments, setAttachments] = useState<Array<{
    type: string; fileName: string; url: string; size?: number; mimeType?: string;
  }>>([]);

  // Master + dropdown data, fetched lazily once on mount.
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceTypeOpt[]>([]);
  const [attachmentTypes, setAttachmentTypes]   = useState<AttachmentTypeOpt[]>([]);
  const [vehicles, setVehicles]                 = useState<VehicleOpt[]>([]);

  useEffect(() => {
    // All three masters in parallel — failures are non-fatal (the form
    // degrades to free-text input where data is missing).
    void (async () => {
      try {
        const [mtRes, atRes, vRes] = await Promise.all([
          fetch('/api/data-masters/maintenance-types?activeOnly=true'),
          fetch(`/api/data-masters/attachment-types?activeOnly=true&appliesTo=${ticketType}`),
          fetch('/api/fleet/vehicles/dropdown'),
        ]);
        if (mtRes.ok) setMaintenanceTypes((await mtRes.json()).types ?? []);
        if (atRes.ok) setAttachmentTypes((await atRes.json()).types ?? []);
        if (vRes.ok)  setVehicles((await vRes.json()).vehicles ?? []);
      } catch { /* ignore — UI handles empty arrays gracefully */ }
    })();
    // We refetch attachment types when ticketType changes so the widget
    // only offers types that apply (or are universal).
  }, [ticketType]);

  // Resolved per-type config from the Service Configuration Engine.
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

  const isMaintenance = ticketType === 'MAINTENANCE';
  const selectedVehicle = vehicles.find(v => v.id === vehicleId) ?? null;
  const selectedMaintenanceType = maintenanceTypes.find(t => t.id === maintenanceTypeId) ?? null;

  // Reset per-type custom fields whenever the ticket type changes.
  useEffect(() => {
    setCustomFields({});
    setMaintenanceTypeId('');
  }, [ticketType]);

  // Snap priority to the type default on type change.
  useEffect(() => {
    setPriority(p => (p === 'Low' || p === 'Medium' || p === 'High') ? resolvedDefaultPriority : p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketType]);

  // When a Maintenance Type is picked, pull its default priority forward.
  // The user can still override Priority manually afterwards.
  useEffect(() => {
    if (selectedMaintenanceType) {
      setPriority(selectedMaintenanceType.defaultPriority);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceTypeId]);

  // When a Vehicle is picked, pre-fill the odometer with the last known
  // reading as a starting suggestion (the user enters what they actually
  // observe and it'll usually be close).
  useEffect(() => {
    if (selectedVehicle?.lastOdometer != null && odometer === '') {
      setOdometer(String(selectedVehicle.lastOdometer));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  // Build the binding context the DynamicField needs to auto-populate
  // source-driven fields. Mirrors ResolverContext on the server side.
  const bindingContext = useMemo(() => ({
    user:            currentUser,
    vehicle:         selectedVehicle,
    maintenanceType: selectedMaintenanceType,
  }), [currentUser, selectedVehicle, selectedMaintenanceType]);

  const setField = (key: string, value: unknown) => {
    setCustomFields(prev => ({ ...prev, [key]: value }));
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!title.trim()) { setErr('Title is required.'); return; }
    if (vehicleRequired && !vehicleId.trim()) { setErr(`${longLabel} requires a vehicle.`); return; }
    if (isMaintenance && maintenanceTypes.length > 0 && !maintenanceTypeId) {
      setErr('Pick a Maintenance Type.');
      return;
    }

    // Required-field validation — skip fields whose value will be filled
    // server-side from a non-default source.
    for (const f of formFields) {
      if (!f.required) continue;
      if (f.source && f.source !== 'user-input') continue;
      const v = customFields[f.key];
      const empty = v === undefined || v === null || v === '' || v === false;
      if (empty && f.type !== 'checkbox') {
        setErr(`${f.label} is required for ${longLabel}.`);
        return;
      }
    }

    // Required attachment-type check — applies the master's `required` flag.
    const requiredTypes = attachmentTypes.filter(t =>
      t.required && (t.appliesTo.length === 0 || t.appliesTo.includes(ticketType)));
    for (const reqType of requiredTypes) {
      if (!attachments.some(a => a.type === reqType.code)) {
        setErr(`Required attachment missing: ${reqType.name}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // Stuff Maintenance Type + Odometer into customFields so admins can
      // surface them on the card. The bindings layer can also bind these
      // out to top-level columns via the Form Fields tab.
      const payloadCustomFields: Record<string, unknown> = { ...customFields };
      if (isMaintenance && selectedMaintenanceType) {
        payloadCustomFields.maintenanceTypeCode = selectedMaintenanceType.code;
        payloadCustomFields.maintenanceTypeName = selectedMaintenanceType.name;
      }
      if (isMaintenance && odometer !== '') {
        payloadCustomFields.odometer = Number(odometer);
      }

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
          maintenanceTypeId: isMaintenance ? (maintenanceTypeId || undefined) : undefined,
          customFields: Object.keys(payloadCustomFields).length ? payloadCustomFields : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
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
        {willAwaitApproval && (
          <p className="text-[11px] text-amber-300/90 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            This ticket will start in <strong className="text-amber-200">Awaiting Approval</strong>.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Maintenance Type — first because it drives Priority defaults */}
        {isMaintenance && (
          <FormCol label="Maintenance Type" required hint={selectedMaintenanceType?.estimatedHours != null
            ? `Estimated ${selectedMaintenanceType.estimatedHours}h work`
            : undefined}>
            <div className="relative">
              <Wrench className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <select value={maintenanceTypeId} onChange={e => setMaintenanceTypeId(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                <option value="">{maintenanceTypes.length === 0 ? 'No types defined — add some in the Master' : '— Select a type —'}</option>
                {maintenanceTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </FormCol>
        )}

        {/* Title */}
        <FormCol label="Title" required colSpan={2}>
          <input value={title} onChange={e => setTitle(e.target.value)} required
            placeholder="Short summary"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </FormCol>

        {/* Vehicle dropdown — drives the Vehicle Type chip and odometer hint */}
        <FormCol label="Vehicle" required={vehicleRequired} colSpan={2}>
          <div className="relative">
            <Car className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
              <option value="">{vehicles.length === 0 ? 'No vehicles available' : '— Select a vehicle —'}</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.licensePlate ? `[${v.licensePlate}] ` : ''}{v.makeModelYear}
                  {v.branchName ? ` · ${v.branchName}` : ''}
                </option>
              ))}
            </select>
          </div>
          {/* Vehicle Type — read-only chip auto-populated from selection */}
          {selectedVehicle && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[11px]">
              {selectedVehicle.vehicleTypeName && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  <Lock className="w-3 h-3" /> Type: <strong>{selectedVehicle.vehicleTypeName}</strong>
                </span>
              )}
              {selectedVehicle.vehicleClass && (
                <span className="text-slate-500">· {selectedVehicle.vehicleClass}</span>
              )}
              {selectedVehicle.lastOdometer != null && (
                <span className="text-slate-500">· last odometer {selectedVehicle.lastOdometer.toLocaleString()} km</span>
              )}
            </div>
          )}
        </FormCol>

        {/* Priority + Due Date row */}
        <FormCol label="Priority">
          <select value={priority} onChange={e => setPriority(e.target.value as 'Low' | 'Medium' | 'High')}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
        </FormCol>
        <FormCol label="Due date">
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
        </FormCol>

        {/* Current Odometer — maintenance only */}
        {isMaintenance && (
          <FormCol label="Current Odometer (km)"
            hint={selectedVehicle?.lastOdometer != null
              ? `Last known: ${selectedVehicle.lastOdometer.toLocaleString()} km`
              : undefined}>
            <input type="number" min={0} value={odometer}
              onChange={e => setOdometer(e.target.value)}
              placeholder="Reading at the time of request"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </FormCol>
        )}

        {/* Description */}
        <FormCol label="Description / Remarks" colSpan={2}>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="Additional details, symptoms, requestor remarks…"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </FormCol>

        {/* Per-type dynamic custom fields — driven by resolved formFields */}
        {formFields.map(f => (
          <DynamicField key={`${ticketType}:${f.key}`}
            field={f}
            value={customFields[f.key]}
            onChange={v => setField(f.key, v)}
            ctx={bindingContext} />
        ))}
      </div>

      {/* Multi-attachment widget */}
      <AttachmentsWidget
        attachmentTypes={attachmentTypes}
        ticketType={ticketType}
        attachments={attachments}
        onAdd={a => setAttachments(prev => [...prev, a])}
        onRemove={removeAttachment} />

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
        <button type="submit" disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all">
          <Plus className="w-4 h-4" /> {submitting ? 'Submitting…' : 'Submit Request'}
        </button>
      </div>
    </form>
  );
}

// ── Form column helper — tiny wrapper to keep markup tidy ───────────────────
function FormCol({ label, required, hint, children, colSpan }: {
  label: string; required?: boolean; hint?: string;
  children: React.ReactNode; colSpan?: 1 | 2;
}) {
  return (
    <div className={`space-y-1 ${colSpan === 2 ? 'md:col-span-2' : ''}`}>
      <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

// ── Multi-attachment widget ─────────────────────────────────────────────────
// One row per attachment: [Type dropdown] + [File picker] + [remove].
// Plus an "Add attachment" button that adds a row and waits for the user
// to pick a file. Upload happens via /api/service-tickets/upload which
// validates against the Attachment Master (MIME, size).
function AttachmentsWidget({
  attachmentTypes, ticketType, attachments, onAdd, onRemove,
}: {
  attachmentTypes: AttachmentTypeOpt[];
  ticketType: TicketType;
  attachments: Array<{ type: string; fileName: string; url: string; size?: number; mimeType?: string }>;
  onAdd: (a: { type: string; fileName: string; url: string; size?: number; mimeType?: string }) => void;
  onRemove: (i: number) => void;
}) {
  const [stagedType, setStagedType] = useState('');
  const [uploading, setUploading]   = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  // Keep only types that apply to this ticket type or are universal.
  const applicableTypes = attachmentTypes.filter(t =>
    t.appliesTo.length === 0 || t.appliesTo.includes(ticketType));

  const handleFileChosen = async (file: File) => {
    if (!stagedType) { setErr('Pick an attachment type first.'); return; }
    setErr(null); setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('typeCode', stagedType);
      const res = await fetch('/api/service-tickets/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Upload failed'); return; }
      onAdd({ type: stagedType, fileName: data.fileName, url: data.url, size: data.size, mimeType: data.mimeType });
      setStagedType('');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Paperclip className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Attachments</span>
        <span className="text-[10px] text-slate-500">{attachments.length} attached</span>
      </div>

      {/* Existing attachments */}
      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((a, i) => {
            const typeMeta = attachmentTypes.find(t => t.code === a.type);
            return (
              <li key={`${a.url}-${i}`}
                className="flex items-center gap-2 text-xs bg-slate-800/60 border border-white/5 rounded-lg px-3 py-1.5">
                <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[10px] font-mono">
                  {typeMeta?.name ?? a.type}
                </span>
                <a href={a.url} target="_blank" rel="noreferrer"
                  className="flex-1 truncate text-violet-300 hover:text-violet-200 underline-offset-2 hover:underline">
                  {a.fileName}
                </a>
                {a.size != null && (
                  <span className="text-[10px] text-slate-500">{(a.size / 1024).toFixed(0)} KB</span>
                )}
                <button type="button" onClick={() => onRemove(i)}
                  className="p-1 text-rose-300 hover:bg-rose-500/10 rounded">
                  <X className="w-3 h-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Staged uploader */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
        <select value={stagedType} onChange={e => setStagedType(e.target.value)}
          className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-violet-500">
          <option value="">{applicableTypes.length === 0 ? 'No types configured' : '— Pick attachment type —'}</option>
          {applicableTypes.map(t => (
            <option key={t.id} value={t.code}>
              {t.name}{t.required ? ' (required)' : ''}{t.maxFileSizeMb != null ? ` · max ${t.maxFileSizeMb} MB` : ''}
            </option>
          ))}
        </select>
        <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer ${
          stagedType && !uploading
            ? 'bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200'
            : 'bg-slate-800/60 border border-white/10 text-slate-500 cursor-not-allowed'
        }`}>
          <Upload className="w-3.5 h-3.5" />
          {uploading ? 'Uploading…' : 'Choose file'}
          <input type="file" className="sr-only"
            disabled={!stagedType || uploading}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleFileChosen(f);
              e.target.value = ''; // reset so picking the same file twice still fires onChange
            }} />
        </label>
      </div>
      {err && <p className="text-[11px] text-rose-300">{err}</p>}
    </div>
  );
}

// ── Dynamic per-type form field (binding-aware) ─────────────────────────────
// Renders a single field from cfg.formFields. Knows about all 7 input types
// and respects Phase B+ bindings:
//   • field.hidden   → render nothing (server still resolves the value)
//   • field.readOnly → render disabled
//   • field.source !== 'user-input' → pre-fill with the resolved value from
//     the binding context (current user / vehicle / maintenance type)
//
// The display value precedence is:
//   1. User-entered `value` if the user has typed (state owns it)
//   2. Resolved source value when the field is auto-sourced
//   3. Empty string
function DynamicField({
  field, value, onChange, ctx,
}: {
  field: FormFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  ctx: { user: CurrentUser | null; vehicle: VehicleOpt | null; maintenanceType: MaintenanceTypeOpt | null };
}) {
  // ── Hooks must fire unconditionally on every render ──────────────────
  // Earlier versions returned null for `field.hidden` BEFORE calling the
  // hooks below, which violates the rules of hooks and crashes the page
  // when a field's `hidden` flag toggles between renders. We evaluate
  // the hooks first and gate the JSX afterwards.
  const autoSourced = !!field.source && field.source !== 'user-input';
  const readOnly = !!field.readOnly;

  // Resolve the source value client-side for display. The server has the
  // last word — whatever it computes wins on POST — so this is purely UX.
  const resolved = useMemo(() => resolveSourceClient(field.source, ctx), [field.source, ctx]);

  // The displayed value: prefer user input when present, otherwise the
  // auto-sourced value. Empty string falls through to "let the user type".
  const displayValue = (value !== undefined && value !== null && value !== '')
    ? value
    : (autoSourced ? resolved : '');

  // When auto-sourced, push the resolved value into form state so it gets
  // submitted even if the user never touches the field. We only do this
  // when there's no user-typed value, so we don't clobber edits.
  useEffect(() => {
    if (autoSourced && (value === undefined || value === '') && resolved !== null && resolved !== undefined) {
      onChange(resolved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSourced, resolved]);

  // Hidden fields are suppressed in the UI — return AFTER hooks have run
  // so the hook order stays stable across hidden/visible transitions.
  if (field.hidden) return null;

  const span = field.type === 'textarea' || field.type === 'select' || field.type === 'text'
    ? 'md:col-span-2' : '';
  const labelEl = (
    <label className="text-xs font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
      {field.label}
      {field.required && <span className="text-rose-400">*</span>}
      {readOnly && <Lock className="w-3 h-3 text-slate-500" />}
    </label>
  );

  const baseClasses = `w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${
    readOnly ? 'opacity-60 cursor-not-allowed' : ''
  }`;

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-1 md:col-span-2">
        <label className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
          <input type="checkbox"
            checked={!!displayValue}
            disabled={readOnly}
            onChange={e => onChange(e.target.checked)}
            className="w-4 h-4 accent-violet-500 rounded" />
          <span>{field.label}{field.required && <span className="ml-1 text-rose-400">*</span>}</span>
          {readOnly && <Lock className="w-3 h-3 text-slate-500" />}
        </label>
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div className={`space-y-1 ${span}`}>
        {labelEl}
        <select value={(displayValue as string) ?? ''}
          onChange={e => onChange(e.target.value || undefined)}
          required={field.required && !autoSourced}
          disabled={readOnly}
          className={baseClasses}>
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
          value={(displayValue as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          required={field.required && !autoSourced}
          readOnly={readOnly}
          rows={3}
          className={baseClasses} />
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
        value={(displayValue as string | number | undefined) ?? ''}
        onChange={e => {
          const v = e.target.value;
          onChange(field.type === 'number' ? (v === '' ? undefined : Number(v)) : v);
        }}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        required={field.required && !autoSourced}
        readOnly={readOnly}
        className={baseClasses} />
    </div>
  );
}

// Mirror of the server-side resolveFieldSource for client-side display.
// The server is authoritative; this is purely so the user sees the value
// they're about to submit. Only handles the cases the client has data for —
// other sources (currentDate, etc.) the server fills in.
function resolveSourceClient(
  source: FormFieldDef['source'] | undefined,
  ctx: { user: CurrentUser | null; vehicle: VehicleOpt | null; maintenanceType: MaintenanceTypeOpt | null },
): unknown | null {
  switch (source) {
    case 'currentUser.id':           return ctx.user?.id ?? null;
    case 'currentUser.email':        return ctx.user?.email ?? null;
    case 'currentUser.name':         return ctx.user?.name ?? ctx.user?.email ?? null;
    case 'currentUser.department':   return ctx.user?.department ?? null;
    case 'currentUser.role':         return ctx.user?.role ?? null;
    case 'currentDate':              return new Date().toISOString().slice(0, 10);
    case 'currentTimestamp':         return new Date().toISOString();
    case 'vehicle.id':               return ctx.vehicle?.id ?? null;
    case 'vehicle.licensePlate':     return ctx.vehicle?.licensePlate ?? null;
    case 'vehicle.type':             return ctx.vehicle?.vehicleTypeName ?? null;
    case 'vehicle.lastOdometer':     return ctx.vehicle?.lastOdometer ?? null;
    case 'maintenanceType.code':              return ctx.maintenanceType?.code ?? null;
    case 'maintenanceType.name':              return ctx.maintenanceType?.name ?? null;
    case 'maintenanceType.defaultPriority':   return ctx.maintenanceType?.defaultPriority ?? null;
    case 'maintenanceType.estimatedHours':    return ctx.maintenanceType?.estimatedHours ?? null;
    // tenant.* + currentUser fields not in CurrentUser fall through — the
    // server fills them on submit.
    default: return null;
  }
}
