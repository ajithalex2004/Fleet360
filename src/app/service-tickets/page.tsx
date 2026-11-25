'use client';

/**
 * /service-tickets — Service & Support Ticketing module home (Phase 1B).
 *
 * One module, every catalogue ticket type. Same engines as /maintenance/service-requests:
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

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Headphones, Plus, AlertCircle, Clock, ChevronRight, MessageSquare, Star, Send, Inbox, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import SmartDataGrid, { type SmartDataGridColumn, type KpiTile, type BulkAction } from '@/components/ui/SmartDataGrid';
import { TICKET_DEPARTMENTS, TICKET_PRIORITIES } from '@/types/service-tickets';
import type { TicketType, ServiceTicket, TenantTicketTypeAccess, FormFieldDef, TicketDepartment, TicketDepartmentDef, TicketPriority } from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';
import { getServiceIcon } from '@/lib/service-tickets/icons';
import { createMaintenanceRequest } from '@/services/mockData';
import { ContextDrawer360 } from './components/context-drawer-360';
import { ForwardTicketModal } from './components/forward-ticket-modal';
import { VehicleRef } from '@/components/ui/EntityRef';

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
  defaultPriority: TicketPriority;
  defaultSlaHours: number;
  categoryKey?: string;
  categoryName?: string;
  slaByPriority?: Record<TicketPriority, number>;
  prefix: string;
  approvalRequired: boolean;
  approvalEmergencyBypass: boolean;
}
type TypeConfigByType = Partial<Record<TicketType, ServiceTypeConfig>>;

/** Minimal shape used to populate the Vehicle ID dropdown on the create
 *  form — sourced from /api/vehicles (tenant-scoped, Fleet-owned registry). */
interface VehiclePickerOption {
  id: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
}

// ── Shared visuals ───────────────────────────────────────────────────────────
const TONE_BG: Record<string, string> = {
  gold: 'bg-amber-500/10', blue: 'bg-blue-500/10', emerald: 'bg-emerald-500/10',
  amber: 'bg-amber-500/10', rose: 'bg-rose-500/10', slate: 'bg-slate-500/10',
  violet: 'bg-violet-500/10', cyan: 'bg-cyan-500/10',
};
const TONE_FG: Record<string, string> = {
  gold: 'text-yellow-700 dark:text-amber-300', blue: 'text-blue-700 dark:text-blue-300', emerald: 'text-emerald-700 dark:text-emerald-300',
  amber: 'text-amber-700 dark:text-amber-300', rose: 'text-rose-700 dark:text-rose-300', slate: 'text-slate-700 dark:text-slate-300',
  violet: 'text-violet-700 dark:text-violet-300', cyan: 'text-cyan-700 dark:text-cyan-300',
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
  Critical: 'text-rose-300 font-bold',
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
  const [departments, setDepartments] = useState<TicketDepartmentDef[]>(TICKET_DEPARTMENTS);
  const [vehicles, setVehicles]       = useState<VehiclePickerOption[]>([]);
  const [tickets, setTickets]         = useState<ServiceTicket[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const [activeType, setActiveType]             = useState<TicketType | 'ALL'>('ALL');
  const [activeDepartment, setActiveDepartment] = useState<TicketDepartment | 'ALL'>('ALL');
  const [showForm, setShowForm]                 = useState(false);
  const [drawerTicketId, setDrawerTicketId]     = useState<string | null>(null);
  const [forwardingTicket, setForwardingTicket] = useState<ServiceTicket | null>(null);

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

      // Each response renders as soon as it lands — a slow vehicle list must
      // not hold back the ticket types (and with them the New ticket button).
      const loadMatrix = fetch(`/api/admin/tenants/${me.tenantId}/ticket-types`).then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setAccessMap(new Map<TicketType, TenantTicketTypeAccess>(
          (data.matrix as TenantTicketTypeAccess[]).map(r => [r.ticketType, r])
        ));
      });
      const loadFields = fetch(`/api/service-tickets/form-fields`).then(async (res) => {
        if (!res.ok) {
          // Without the type catalogue the create form has nothing to offer —
          // say so instead of leaving "New ticket" silently disabled.
          setError('Ticket types could not be loaded, so new tickets cannot be raised right now. Try Refresh.');
          return;
        }
        const data = await res.json();
        setFormFieldsByType(data.formFields ?? {});
        setTypeConfigByType(data.typeConfig ?? {});
        if (Array.isArray(data.departments) && data.departments.length > 0) setDepartments(data.departments);
      });
      const loadVehicles = fetch(`/api/vehicles`).then(async (res) => {
        if (!res.ok) return;
        const data: Array<VehiclePickerOption & { status?: string | null }> = await res.json();
        const list = Array.isArray(data) ? data : [];
        const EXCLUDED_STATUSES = new Set(['DECOMMISSIONED', 'SOLD', 'INACTIVE']);
        setVehicles(
          list
            .filter(v => !EXCLUDED_STATUSES.has(v.status ?? ''))
            .map(v => ({
              id: v.id, vehicleCode: v.vehicleCode, licensePlate: v.licensePlate,
              make: v.make, model: v.model,
            }))
        );
      }).catch(() => { /* vehicle picker stays empty */ });
      const loadTickets = fetch(`/api/service-tickets`).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? 'Failed to load tickets');
        }
        const data = await res.json();
        setTickets(data.tickets ?? []);
      });

      await Promise.all([loadMatrix, loadFields, loadVehicles, loadTickets]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Filter ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return tickets.filter(t => {
      const matchesType = activeType === 'ALL' || t.ticketType === activeType;
      const dept = t.assignedDepartment || 'OPERATIONS_TRIAGE';
      const matchesDept = activeDepartment === 'ALL' || dept === activeDepartment;
      return matchesType && matchesDept;
    });
  }, [tickets, activeType, activeDepartment]);

  // ── Counts per type for tabs ─────────────────────────────────────────
  const countByType = useMemo(() => {
    const out: Record<string, number> = { ALL: tickets.length };
    for (const { type } of enabledTypes) out[type] = 0;
    for (const t of tickets) {
      out[t.ticketType] = (out[t.ticketType] ?? 0) + 1;
    }
    return out;
  }, [tickets, enabledTypes]);

  // ── Counts per department for tabs ───────────────────────────────────
  const countByDept = useMemo(() => {
    const out: Record<string, number> = { ALL: tickets.length };
    for (const dept of departments) out[dept.key] = 0;
    for (const t of tickets) {
      const d = t.assignedDepartment || 'OPERATIONS_TRIAGE';
      out[d] = (out[d] ?? 0) + 1;
    }
    return out;
  }, [tickets, departments]);

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
  const handleBulk = async (
    newStatus: 'Acknowledged' | 'Resolved' | 'Assigned' | 'Escalated',
    selection: ServiceTicket[],
  ) => {
    // Triage tickets must be forwarded to a department before they can be actioned.
    const targets = selection.filter(t => (t.assignedDepartment || 'OPERATIONS_TRIAGE') !== 'OPERATIONS_TRIAGE');
    const skipped = selection.length - targets.length;
    if (targets.length === 0) {
      alert('The selected tickets are still in Operations Triage — forward them to a department first.');
      return;
    }

    let assignee: string | null = null;
    if (newStatus === 'Assigned' || newStatus === 'Escalated') {
      const v = window.prompt(`${newStatus} ${targets.length} tickets to which email?`, '');
      if (!v) return;
      const trimmed = v.trim();
      if (!/.+@.+\..+/.test(trimmed)) { alert('Please enter a valid email.'); return; }
      assignee = trimmed;
    }
    if (!window.confirm(`Apply "${newStatus}"${assignee ? ` (${assignee})` : ''} to ${targets.length} tickets?${skipped ? ` ${skipped} triage ticket(s) will be skipped.` : ''}`)) return;

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
    const byId = new Map(ok.map(u => [u.id, u]));
    setTickets(prev => prev.map(t => byId.get(t.id) ?? t));
    alert(`${ok.length}/${targets.length} tickets updated.`);
  };
  const handleBulkRef = useRef(handleBulk);
  handleBulkRef.current = handleBulk;

  // ── Smart data grid: columns, KPIs, bulk actions ─────────────────────
  // Row-action handlers change every render; the memoised columns call them
  // through a ref so the grid's column state isn't reset on each render.
  const rowActions = useRef({ handleStatusChange, openForward: setForwardingTicket, open360: setDrawerTicketId });
  rowActions.current = { handleStatusChange, openForward: setForwardingTicket, open360: setDrawerTicketId };

  const columns = useMemo<SmartDataGridColumn<ServiceTicket>[]>(() => {
    const deptOf = (t: ServiceTicket) => departments.find(d => d.key === (t.assignedDepartment || 'OPERATIONS_TRIAGE'));
    return [
      {
        key: 'id', header: 'Ticket',
        accessor: (t) => t.readableId ?? t.id.slice(0, 12),
        render: (t) => (
          <span className="text-[11px] font-mono font-semibold text-slate-300 bg-slate-700/40 px-2 py-0.5 rounded whitespace-nowrap" title={t.id}>
            {t.readableId ?? t.id.slice(0, 12)}
          </span>
        ),
      },
      {
        key: 'type', header: 'Type', filter: 'select',
        accessor: (t) => typeConfigByType[t.ticketType]?.name ?? t.ticketType,
        render: (t) => {
          const cfg = typeConfigByType[t.ticketType];
          const Icon = getServiceIcon(cfg?.iconName);
          const tone = cfg?.tone ?? 'violet';
          return (
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${TONE_FG[tone]}`}>
              <span className={`w-6 h-6 rounded-md ${TONE_BG[tone]} inline-flex items-center justify-center shrink-0`}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              {cfg?.name ?? t.ticketType}
            </span>
          );
        },
      },
      {
        key: 'title', header: 'Title',
        accessor: (t) => t.title,
        render: (t) => (
          <div className="min-w-[180px] max-w-[280px]">
            <div className="text-sm font-semibold text-white truncate" title={t.title}>{t.title}</div>
            {t.description && <div className="text-[11px] text-slate-500 truncate" title={t.description}>{t.description}</div>}
          </div>
        ),
      },
      {
        key: 'department', header: 'Department', filter: 'select',
        accessor: (t) => deptOf(t)?.label ?? (t.assignedDepartment || 'OPERATIONS_TRIAGE'),
        render: (t) => {
          const b = departmentBadge(t.assignedDepartment || 'OPERATIONS_TRIAGE', deptOf(t));
          return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${b.bg} ${b.text} ${b.border}`}>{b.label}</span>;
        },
      },
      {
        key: 'status', header: 'Status', filter: 'select',
        accessor: (t) => t.status,
        render: (t) => (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${STATUS_BADGE[t.status] ?? STATUS_BADGE.Pending}`}>{t.status}</span>
        ),
      },
      {
        key: 'priority', header: 'Priority', filter: 'select', selectOptions: [...TICKET_PRIORITIES],
        accessor: (t) => t.priority,
        render: (t) => <span className={`text-xs font-medium ${PRIORITY_FG[t.priority] ?? ''}`}>{t.priority}</span>,
      },
      {
        key: 'sla', header: 'SLA age', filter: false, align: 'center',
        accessor: (t) => pendingAge(t)?.hours ?? null,
        render: (t) => {
          const age = pendingAge(t);
          if (!age) return <span className="text-slate-600 text-xs">—</span>;
          return (
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border tabular-nums inline-flex items-center gap-1 ${
              age.tone === 'breach' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              : age.tone === 'warn' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-slate-500/20 text-slate-400 border-slate-500/40'
            }`} title={age.targetHours ? `SLA target ${age.targetHours}h` : 'Pending'}>
              <Clock className="w-2.5 h-2.5" /> {ageLabel(age.hours)}
            </span>
          );
        },
      },
      {
        key: 'source', header: 'Source', filter: 'select',
        accessor: (t) => (SOURCE_BADGES[t.source || 'WEB'] ?? SOURCE_BADGES.WEB).label,
        render: (t) => {
          const s = SOURCE_BADGES[t.source || 'WEB'] ?? SOURCE_BADGES.WEB;
          return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${s.cls}`}>{s.label}</span>;
        },
      },
      {
        key: 'vehicle', header: 'Vehicle',
        accessor: (t) => t.vehicleId ?? '',
        render: (t) => t.vehicleId
          ? <span className="text-slate-300 font-mono text-[11px]"><VehicleRef id={t.vehicleId} /></span>
          : <span className="text-slate-600 text-xs">—</span>,
      },
      {
        key: 'assignee', header: 'Assignee',
        accessor: (t) => t.assignedTo ?? '',
        render: (t) => <span className="text-xs text-slate-300 truncate max-w-[160px] inline-block" title={t.assignedTo ?? ''}>{t.assignedTo || '—'}</span>,
      },
      {
        key: 'created', header: 'Created', filter: false,
        accessor: (t) => t.createdAt,
        render: (t) => <span className="text-xs text-slate-400 whitespace-nowrap tabular-nums">{String(t.createdAt).replace('T', ' ').slice(0, 16)}</span>,
      },
      {
        key: 'actions', header: 'Actions', sortable: false, filter: false,
        render: (t) => <RowActions ticket={t} actions={rowActions.current} />,
      },
    ];
  }, [typeConfigByType, departments]);

  const kpis = useMemo<KpiTile[]>(() => {
    const open = tickets.filter(t => !['Resolved', 'Completed', 'Closed', 'Rejected'].includes(t.status));
    return [
      { label: 'Open tickets', value: open.length, sub: `${tickets.length} total`, accent: 'violet', icon: Headphones },
      { label: 'Triage hopper', value: countByDept.OPERATIONS_TRIAGE ?? 0, sub: 'awaiting routing', accent: 'amber', icon: Inbox },
      { label: 'Awaiting approval', value: tickets.filter(t => t.status === 'Awaiting Approval').length, accent: 'sky', icon: Clock },
      { label: 'SLA breached', value: tickets.filter(t => pendingAge(t)?.tone === 'breach').length, sub: 'pending past target', accent: 'rose', icon: AlertCircle },
      { label: 'Critical / High open', value: open.filter(t => t.priority === 'Critical' || t.priority === 'High').length, accent: 'rose', icon: AlertCircle },
    ];
  }, [tickets, countByDept]);

  // Bulk actions only apply to tickets a department owns — triage tickets
  // must be forwarded first (same rule as the per-row actions).
  const bulkActions = useMemo<BulkAction<ServiceTicket>[]>(() => (
    (['Acknowledged', 'Assigned', 'Escalated', 'Resolved'] as const).map((status) => ({
      key: status,
      label: { Acknowledged: 'Acknowledge', Assigned: 'Assign', Escalated: 'Escalate', Resolved: 'Resolve' }[status],
      run: (rows: ServiceTicket[]) => handleBulkRef.current(status, rows),
    }))
  ), []);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader
        title="Field Service Management"
        subtitle={`Central operations triage hopper · ${enabledTypes.length ? `${enabledTypes.length} ticket types` : 'loading ticket types'} · 1-click recovery · replacement fleet swaps`}
        icon={Headphones}
        accent="violet"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/service-tickets/sla"
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 border border-rose-500/30 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/40 hover:border-rose-500/60 transition-all shadow-sm"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-400" /> SLA Control Tower
            </Link>
            <Link
              href="/service-tickets/csat"
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 border border-amber-500/30 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-950/40 hover:border-amber-500/60 transition-all shadow-sm"
            >
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" /> CSAT & Feedback
            </Link>
            <Link
              href="/service-tickets/simulator"
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 border border-emerald-500/30 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/40 hover:border-emerald-500/60 transition-all shadow-sm"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp Simulator
            </Link>
            <button onClick={() => setShowForm(s => !s)}
              disabled={enabledTypes.length === 0}
              title={enabledTypes.length === 0 ? (loading ? 'Loading ticket types…' : 'No ticket types are enabled for this tenant') : undefined}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/30">
              <Plus className="w-4 h-4" /> {showForm ? 'Hide form' : loading && enabledTypes.length === 0 ? 'Loading…' : 'New ticket'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Filters — department + type dropdowns */}
      <div className="sdg flex flex-wrap items-end gap-3 bg-slate-900/60 border border-white/10 rounded-2xl px-4 py-3">
        <FilterSelect
          label="Department"
          icon={Inbox}
          value={activeDepartment}
          onChange={(v) => setActiveDepartment(v as TicketDepartment | 'ALL')}
          options={[
            { value: 'ALL', label: `All departments (${countByDept.ALL ?? 0})` },
            ...departments.map((d) => ({ value: d.key, label: `${d.label} (${countByDept[d.key] ?? 0})` })),
          ]}
        />
        <FilterSelect
          label="Ticket type"
          value={activeType}
          onChange={(v) => setActiveType(v as TicketType | 'ALL')}
          options={[
            { value: 'ALL', label: `All types (${countByType.ALL ?? 0})` },
            ...enabledTypes.map(({ type, cfg }) => ({ value: type, label: `${cfg.name} (${countByType[type] ?? 0})` })),
          ]}
        />
        {(activeDepartment !== 'ALL' || activeType !== 'ALL') && (
          <button
            onClick={() => { setActiveDepartment('ALL'); setActiveType('ALL'); }}
            className="text-xs text-slate-400 hover:text-white underline underline-offset-2 pb-2"
          >
            Reset filters
          </button>
        )}
        {countByDept.OPERATIONS_TRIAGE > 0 && (
          <button
            onClick={() => setActiveDepartment('OPERATIONS_TRIAGE')}
            className="ml-auto text-xs font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 px-2.5 py-1 rounded-full flex items-center gap-2 transition-colors cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>{countByDept.OPERATIONS_TRIAGE} tickets pending triage</span>
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <NewTicketForm
          enabledTypes={enabledTypes.map(c => c.type)}
          formFieldsByType={formFieldsByType}
          typeConfigByType={typeConfigByType}
          vehicles={vehicles}
          onCreated={(t) => {
            setTickets(prev => [t, ...prev]);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Smart data grid */}
      <SmartDataGrid<ServiceTicket>
        rows={filtered}
        columns={columns}
        getRowId={(t) => t.id}
        onRowClick={(t) => setDrawerTicketId(t.id)}
        selectedId={drawerTicketId}
        loading={loading}
        emptyMessage={
          activeType !== 'ALL' || activeDepartment !== 'ALL'
            ? 'No tickets match these filters.'
            : 'No tickets yet — use “New ticket” to raise the first one.'
        }
        initialSort={{ key: 'created', dir: 'desc' }}
        kpis={kpis}
        bulkActions={bulkActions}
        toolbar={{
          title: 'Field service tickets',
          exportName: 'field-service-tickets',
          actions: (
            <button onClick={() => void load()}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10">
              Refresh
            </button>
          ),
        }}
      />

      {/* Slide-Over Context 360 Drawer */}
      <ContextDrawer360
        ticketId={drawerTicketId}
        onClose={() => setDrawerTicketId(null)}
        onStatusChange={(newStatus) => {
          const target = tickets.find(x => x.id === drawerTicketId);
          if (target) {
            handleStatusChange(target, newStatus);
            setDrawerTicketId(null);
          }
        }}
      />

      {/* Forward Ticket to Department Modal */}
      <ForwardTicketModal
        key={forwardingTicket?.id ?? 'none'}
        departments={departments}
        ticket={forwardingTicket}
        isOpen={!!forwardingTicket}
        onClose={() => setForwardingTicket(null)}
        onSuccess={(updated, createdMr) => {
          setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
          if (createdMr) {
            alert(`Ticket forwarded to Workshop & Maintenance. Created Work Order #${createdMr.workOrderNo || createdMr.id}`);
          }
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options, icon: Icon }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-[220px]">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider inline-flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-violet-400" />} {label}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

type StatusTarget = 'Acknowledged' | 'Resolved' | 'Assigned' | 'Escalated' | 'Pending' | 'Rejected';

/** Compact per-row actions for the grid. Clicks never bubble to the row
 *  (a row click opens the 360 drawer). */
function RowActions({ ticket, actions }: {
  ticket: ServiceTicket;
  actions: {
    handleStatusChange: (t: ServiceTicket, s: StatusTarget) => void;
    openForward: (t: ServiceTicket) => void;
    open360: (id: string) => void;
  };
}) {
  const dept = ticket.assignedDepartment || 'OPERATIONS_TRIAGE';
  // Operations Triage may route (Forward) but not action a ticket.
  const canProgress = dept !== 'OPERATIONS_TRIAGE';
  const awaitingApproval = ticket.status === 'Awaiting Approval';
  const go = (s: StatusTarget) => (e: React.MouseEvent) => { e.stopPropagation(); actions.handleStatusChange(ticket, s); };
  const btn = 'text-[11px] px-2 py-1 rounded-md font-semibold whitespace-nowrap';
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Link href={`/service-tickets/${ticket.id}`} title="Ticket details & cost ledger"
        className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 inline-flex items-center gap-1`}>
        <ExternalLink className="w-3 h-3" /> Details
      </Link>
      <button onClick={(e) => { e.stopPropagation(); actions.openForward(ticket); }} title="Forward to a department"
        className={`${btn} bg-violet-600/20 hover:bg-violet-600/30 text-violet-200 border border-violet-500/40 inline-flex items-center gap-1`}>
        <Send className="w-3 h-3" /> Forward
      </button>
      {awaitingApproval && (
        <>
          <button onClick={go('Pending')} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>Approve</button>
          <button onClick={go('Rejected')} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}>Reject</button>
        </>
      )}
      {canProgress && ticket.status === 'Pending' && (
        <button onClick={go('Acknowledged')} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>Acknowledge</button>
      )}
      {canProgress && (ticket.status === 'Pending' || ticket.status === 'Acknowledged') && (
        <>
          <button onClick={go('Assigned')} className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}>Assign</button>
          <button onClick={go('Escalated')} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}>Escalate</button>
        </>
      )}
      {canProgress && ['Acknowledged', 'Assigned', 'Escalated', 'In Progress'].includes(ticket.status) && (
        <button onClick={go('Resolved')} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-0.5`}>
          Resolve <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

const DEPT_BADGE_STYLE: Record<
  'OPERATIONS_TRIAGE' | 'WORKSHOP_MAINTENANCE' | 'RECOVERY_DISPATCH' | 'SAFETY_COMPLIANCE' | 'CUSTOMER_SERVICE' | 'FACILITIES_CLEANING',
  { label: string; bg: string; text: string; border: string }
> = {
  OPERATIONS_TRIAGE: { label: 'Triage Hopper', bg: 'bg-slate-500/20', text: 'text-slate-300', border: 'border-slate-500/40' },
  WORKSHOP_MAINTENANCE: { label: 'Workshop', bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/40' },
  RECOVERY_DISPATCH: { label: 'Recovery', bg: 'bg-rose-500/20', text: 'text-rose-300', border: 'border-rose-500/40' },
  SAFETY_COMPLIANCE: { label: 'Compliance', bg: 'bg-violet-500/20', text: 'text-violet-300', border: 'border-violet-500/40' },
  CUSTOMER_SERVICE: { label: 'Customer Care', bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/40' },
  FACILITIES_CLEANING: { label: 'Cleaning', bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/40' },
};

const SOURCE_BADGES: Record<string, { label: string; cls: string }> = {
  DRIVER_APP: { label: 'Driver App', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
  WHATSAPP: { label: 'WhatsApp', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  DVIR: { label: 'DVIR Defect', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  TELEMATICS: { label: 'Telematics', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  WEB: { label: 'Web Portal', cls: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  BOOKING_PORTAL: { label: 'Booking Portal', cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
};

/** Badge colours for tenant-defined departments, by tone. */
const DEPT_TONE_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  slate:   { bg: 'bg-slate-500/20',   text: 'text-slate-300',   border: 'border-slate-500/40' },
  amber:   { bg: 'bg-amber-500/20',   text: 'text-amber-300',   border: 'border-amber-500/40' },
  rose:    { bg: 'bg-rose-500/20',    text: 'text-rose-300',    border: 'border-rose-500/40' },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/40' },
  blue:    { bg: 'bg-blue-500/20',    text: 'text-blue-300',    border: 'border-blue-500/40' },
  violet:  { bg: 'bg-violet-500/20',  text: 'text-violet-300',  border: 'border-violet-500/40' },
  cyan:    { bg: 'bg-cyan-500/20',    text: 'text-cyan-300',    border: 'border-cyan-500/40' },
  gold:    { bg: 'bg-yellow-500/20',  text: 'text-yellow-300',  border: 'border-yellow-500/40' },
};

/** Department badge — built-in departments keep their colours; renamed or
 *  tenant-defined ones use the configured label and tone. */
function departmentBadge(dept: string, def?: TicketDepartmentDef) {
  const builtIn = DEPT_BADGE_STYLE[dept as keyof typeof DEPT_BADGE_STYLE];
  if (def && (!builtIn || !def.isSystem || def.shortLabel !== builtIn.label)) {
    return { ...(builtIn ?? DEPT_TONE_STYLE[def.tone] ?? DEPT_TONE_STYLE.slate), label: def.shortLabel || def.label };
  }
  return builtIn || DEPT_BADGE_STYLE.OPERATIONS_TRIAGE;
}

// ── Create form ──────────────────────────────────────────────────────────────
function NewTicketForm({
  enabledTypes,
  formFieldsByType,
  typeConfigByType,
  vehicles,
  onCreated,
  onCancel,
}: {
  enabledTypes: TicketType[];
  formFieldsByType: FormFieldsByType;
  vehicles: VehiclePickerOption[];
  typeConfigByType: TypeConfigByType;
  onCreated: (t: ServiceTicket) => void;
  onCancel: () => void;
}) {
  const [ticketType, setTicketType] = useState<TicketType>(enabledTypes[0] ?? 'MAINTENANCE');
  const [title, setTitle]           = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority]     = useState<TicketPriority>('Medium');
  const [vehicleId, setVehicleId]   = useState('');
  const [dueDate, setDueDate]       = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  // Resolved per-type config from the Service Configuration Engine —
  // delivered by /api/service-tickets/form-fields. Single source of truth
  // for everything the create form needs. Fallback values cover the brief
  // window before the parent's mount fetch completes.
  /** Enabled types grouped by service category for the type dropdown. */
  const typeGroups = useMemo(() => {
    const groups = new Map<string, TicketType[]>();
    for (const t of enabledTypes) {
      const c = typeConfigByType[t];
      if (!c) continue;
      const g = c.categoryName || 'Other';
      groups.set(g, [...(groups.get(g) ?? []), t]);
    }
    return [...groups.entries()];
  }, [enabledTypes, typeConfigByType]);

  const tc = typeConfigByType[ticketType];
  const formFields: FormFieldDef[] = formFieldsByType[ticketType] ?? [];
  const vehicleRequired         = !!tc?.vehicleRequired;
  const autoCreatesMR           = !!tc?.autoCreatesMaintenanceRequest;
  const resolvedDefaultPriority = tc?.defaultPriority ?? 'Medium';
  const longLabel               = tc?.longLabel ?? ticketType;
  const defaultSlaHours         = tc?.defaultSlaHours ?? 24;
  const willAwaitApproval =
    !!tc?.approvalRequired
    && !(tc.approvalEmergencyBypass && (priority === 'High' || priority === 'Critical'));

  // Reset per-type custom fields whenever the ticket type changes — different
  // types have different field schemas, so values don't carry across.
  useEffect(() => {
    setCustomFields({});
  }, [ticketType]);

  // When the type's defaultPriority differs from current selection AND the
  // user hasn't started typing, snap to it. We only do this on type change.
  useEffect(() => {
    setPriority(resolvedDefaultPriority);
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
        <select value={ticketType} onChange={e => setTicketType(e.target.value as TicketType)}
          className="w-full md:w-96 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
          {typeGroups.map(([group, types]) => (
            <optgroup key={group} label={group}>
              {types.map(t => <option key={t} value={t}>{typeConfigByType[t]!.name}</option>)}
            </optgroup>
          ))}
        </select>
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
          <select value={priority} onChange={e => setPriority(e.target.value as TicketPriority)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            {TICKET_PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Due date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
        </div>
        {vehicleRequired ? (
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Vehicle <span className="text-rose-400">*</span>
            </label>
            <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} required
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
              <option value="">— Select a vehicle —</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.vehicleCode ?? v.id.slice(0, 8)}
                  {v.licensePlate ? ` · ${v.licensePlate}` : ''}
                  {v.make || v.model ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
                </option>
              ))}
            </select>
            {vehicles.length === 0 && (
              <p className="text-[11px] text-amber-300/90">No active vehicles found for this tenant.</p>
            )}
          </div>
        ) : (
          <div className="space-y-1 md:col-span-2 opacity-40" title={`${longLabel} doesn't require a vehicle`}>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Vehicle</label>
            <select disabled value=""
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2 text-slate-500 text-sm cursor-not-allowed">
              <option value="">Not applicable for {longLabel}</option>
            </select>
          </div>
        )}

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
