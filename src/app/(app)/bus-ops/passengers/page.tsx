'use client';
/**
 * Passengers — standing-roster CRUD, one row per (route × employee ×
 * validity window). Fully rebuilt against /api/bus-ops/route-passengers.
 *
 * Design decisions:
 *   - Passenger belongs to a ROUTE, not to a trip. Trip attendance is
 *     derived downstream (phase 2 will materialise TripPassenger rows from
 *     this roster when a trip is scheduled).
 *   - The Employee ID column is the primary identifier and comes first.
 *     The dropdown lists tenant StaffMember rows that have an employeeId
 *     set. Selecting one autofills the name (read-only in the form) so
 *     ops can't create a mismatched name/id pair.
 *   - Pickup / Drop-off are the SELECTED ROUTE's stops (each route has its
 *     own stop sequence, tenant-scoped through the route). Not a global
 *     "any tenant stop" list — a passenger can only board at a stop the
 *     bus actually visits.
 *   - Validity window (effectiveFrom / effectiveTo) lets ops schedule a
 *     future start or a definite end (contract passenger, seasonal shift).
 *     Overlap protection is enforced server-side per (route, employee).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Plus, Edit, Trash2, X, UserPlus, Upload, FileDown } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

// ── Types ──────────────────────────────────────────────────────────────────

interface RouteStop { id: string; stopName: string; sequence: number; }
interface BusRoute  { id: string; name: string; origin?: string; destination?: string; stops?: RouteStop[]; }
interface StaffMember {
  id: string;
  employeeId?: string | null;
  name: string;
  contactNumber?: string | null;
  email?: string | null;
  isActive?: boolean | null;
  shiftType?: string | null;
}
interface RoutePassenger {
  id: string;
  routeId: string;
  staffMemberId: string;
  pickupStopId: string | null;
  pickupTime: string | null;
  dropoffStopId: string | null;
  dropoffTime: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
}

interface EditState {
  id: string | null;
  routeId: string;
  staffMemberId: string;
  pickupStopId: string;
  pickupTime: string;
  dropoffStopId: string;
  dropoffTime: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string;
}

const EMPTY_EDIT: EditState = {
  id: null, routeId: '', staffMemberId: '',
  pickupStopId: '', pickupTime: '', dropoffStopId: '', dropoffTime: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '',
  status: 'ACTIVE',
  notes: '',
};

// Sub-modal state for creating an employee inline from the passenger form.
interface EmpDraft {
  employeeId: string;
  name: string;
  department: string;
  contactNumber: string;
  email: string;
  shiftType: '' | 'MORNING' | 'EVENING' | 'BOTH';
}
const EMPTY_EMP: EmpDraft = { employeeId: '', name: '', department: '', contactNumber: '', email: '', shiftType: '' };

// ── Bulk import ─────────────────────────────────────────────────────────
//
// CSV columns (case-insensitive, order-flexible):
//   employee_id, route_name (or route_code), pickup_stop, dropoff_stop,
//   pickup_time (HH:MM), dropoff_time, effective_from (YYYY-MM-DD),
//   effective_to (optional), notes
//
// Server resolves employee_id → StaffMember, route_name/code → BusRoute,
// stop names → RouteStop on that route. Rows with unresolvable references
// are reported per-row in the response; overlap with existing active
// enrollment counts as `skipped` (not an error).

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    // Simple splitter — does NOT handle quoted commas. Ops should
    // quote-strip in Excel before export or use one of the safer
    // header names. For MVP the columns are UUIDs / short names, so
    // embedded commas are unlikely.
    const cells = raw.split(',').map(c => c.trim());
    const row: Record<string, string> = {};
    header.forEach((h, j) => { row[h] = cells[j] ?? ''; });
    out.push(row);
  }
  return out;
}

const CSV_TO_API: Record<string, string> = {
  employee_id: 'employeeId',
  route_name:  'routeName',
  route_code:  'routeCode',
  pickup_stop: 'pickupStopName',
  dropoff_stop:'dropoffStopName',
  pickup_time: 'pickupTime',
  dropoff_time:'dropoffTime',
  effective_from:'effectiveFrom',
  effective_to:  'effectiveTo',
  notes: 'notes',
};

function csvRowToApi(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!v) continue;
    const apiKey = CSV_TO_API[k];
    if (apiKey) out[apiKey] = v;
  }
  return out;
}

const CSV_TEMPLATE =
  'employee_id,route_name,pickup_stop,dropoff_stop,pickup_time,dropoff_time,effective_from,effective_to,notes\n' +
  'EMP-001,Marina Morning Route,ICAD Gate 3,HQ Main Entrance,07:00,08:15,2026-08-13,,\n';

function BulkImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ total: number; created: number; skipped: number; errored: number; errors: Array<{ row: number; error: string }> } | null>(null);
  const [err, setErr] = useState('');

  const onFile = async (f: File | null) => {
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    try { setPreview(parseCsv(text)); }
    catch { setErr('Could not parse CSV — check header row + column names'); }
  };

  const submit = async () => {
    if (preview.length === 0) { setErr('Load a CSV file first'); return; }
    setImporting(true); setErr(''); setResult(null);
    try {
      const rows = preview.map(csvRowToApi);
      const res = await fetch('/api/bus-ops/route-passengers/bulk-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed');
    } finally { setImporting(false); }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'route-passenger-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[85vh] bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">Bulk Import Passengers</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {err && <div className="bg-rose-500/15 border border-rose-500/40 rounded-lg px-3 py-2 text-rose-200 text-xs">{err}</div>}

          {!result && (
            <>
              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-2">CSV file</label>
                <input type="file" accept=".csv,text/csv"
                  onChange={e => onFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-[var(--text-muted)] file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-[var(--border-subtle)] file:bg-[var(--bg-surface-hover)] file:text-[var(--text-main)] file:text-xs file:hover:border-violet-500/40" />
                <button onClick={downloadTemplate}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200">
                  <FileDown className="w-3 h-3" /> Download CSV template
                </button>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)]/60 rounded-lg p-3 border border-[var(--border-subtle)]">
                <strong className="text-[var(--text-main)]">Columns:</strong>{' '}
                <code>employee_id</code> (business ID), <code>route_name</code> or <code>route_code</code>,
                {' '}<code>pickup_stop</code>, <code>dropoff_stop</code>, <code>pickup_time</code> (HH:MM),
                {' '}<code>dropoff_time</code>, <code>effective_from</code> (YYYY-MM-DD),
                {' '}<code>effective_to</code> (optional), <code>notes</code>. Header is required, order flexible.
              </div>
              {preview.length > 0 && (
                <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-lg p-3">
                  <p className="text-xs text-[var(--text-muted)] mb-2">Preview — {preview.length} row{preview.length === 1 ? '' : 's'}</p>
                  <div className="overflow-x-auto max-h-48">
                    <table className="text-xs">
                      <thead className="text-[var(--text-faint)] text-[10px]">
                        <tr>{Object.keys(preview[0]).map(k => <th key={k} className="px-2 py-1 text-left whitespace-nowrap">{k}</th>)}</tr>
                      </thead>
                      <tbody className="text-[var(--text-muted)] font-mono">
                        {preview.slice(0, 10).map((r, i) => (
                          <tr key={i}>{Object.keys(preview[0]).map(k => <td key={k} className="px-2 py-1 whitespace-nowrap">{r[k]}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.length > 10 && <p className="text-[10px] text-[var(--text-faint)] pt-2">+{preview.length - 10} more…</p>}
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--text-main)]">{result.total}</p>
                  <p className="text-[10px] text-[var(--text-faint)] uppercase mt-0.5">Total</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-300">{result.created}</p>
                  <p className="text-[10px] text-emerald-400/70 uppercase mt-0.5">Created</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-amber-300">{result.skipped}</p>
                  <p className="text-[10px] text-amber-400/70 uppercase mt-0.5">Skipped (overlap)</p>
                </div>
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-rose-300">{result.errored}</p>
                  <p className="text-[10px] text-rose-400/70 uppercase mt-0.5">Errored</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3 max-h-64 overflow-y-auto">
                  <p className="text-xs text-rose-300 font-medium mb-2">Errors ({result.errors.length})</p>
                  <ul className="space-y-1 text-[11px]">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-[var(--text-muted)]">
                        <span className="text-[var(--text-faint)]">row {e.row}:</span> {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button onClick={submit} disabled={importing || preview.length === 0}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm inline-flex items-center gap-1.5">
              <Upload className="w-4 h-4" /> {importing ? `Importing ${preview.length}…` : `Import ${preview.length} row${preview.length === 1 ? '' : 's'}`}
            </button>
          )}
          {result && (
            <button onClick={onDone}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 text-sm">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  ACTIVE:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  INACTIVE: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PassengersPage() {
  const [routes,   setRoutes]     = useState<BusRoute[]>([]);
  const [staff,    setStaff]      = useState<StaffMember[]>([]);
  const [rows,     setRows]       = useState<RoutePassenger[]>([]);
  const [routeFilter,  setRouteFilter]  = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [loading,  setLoading]    = useState(true);
  const [saving,   setSaving]     = useState(false);
  const [error,    setError]      = useState('');
  const [edit,     setEdit]       = useState<EditState | null>(null);
  const [empDraft, setEmpDraft]   = useState<EmpDraft | null>(null);
  const [savingEmp, setSavingEmp] = useState(false);
  const [empError, setEmpError]   = useState('');
  const [showImport, setShowImport] = useState(false);

  const loadRefData = useCallback(async () => {
    // Parallel fetches — none of these depend on each other.
    const [rRes, sRes] = await Promise.all([
      fetch('/api/bus-ops/routes?active=true', { cache: 'no-store' }),
      fetch('/api/bus-ops/staff?active=true',  { cache: 'no-store' }),
    ]);
    if (rRes.ok) setRoutes(await rRes.json());
    if (sRes.ok) setStaff(await sRes.json());
  }, []);

  const loadPassengers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (routeFilter)  params.set('routeId', routeFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await fetch(`/api/bus-ops/route-passengers?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load passengers');
    } finally { setLoading(false); }
  }, [routeFilter, statusFilter]);

  useEffect(() => { loadRefData(); }, [loadRefData]);
  useEffect(() => { loadPassengers(); }, [loadPassengers]);

  // Fast lookups for table rendering — turn arrays into maps once per change.
  const routeById = useMemo(() => new Map(routes.map(r => [r.id, r])), [routes]);
  const staffById = useMemo(() => new Map(staff.map(s  => [s.id, s])), [staff]);

  // Employee dropdown source — only staff with an employeeId set. The
  // sort keeps the picker stable and skimmable.
  const staffWithEmpId = useMemo(
    () => staff
      .filter(s => s.employeeId && (s.isActive !== false))
      .sort((a, b) => (a.employeeId ?? '').localeCompare(b.employeeId ?? '')),
    [staff],
  );

  // Stops of the route currently selected in the editor modal.
  const editRouteStops = useMemo(() => {
    if (!edit?.routeId) return [] as RouteStop[];
    const r = routeById.get(edit.routeId);
    return (r?.stops ?? []).slice().sort((a, b) => a.sequence - b.sequence);
  }, [edit?.routeId, routeById]);

  // ── Modal helpers ────────────────────────────────────────────────────────

  const openNew = () => {
    setError('');
    setEdit({ ...EMPTY_EDIT, routeId: routeFilter || '' });
  };

  const openEdit = (rp: RoutePassenger) => {
    setError('');
    setEdit({
      id: rp.id,
      routeId: rp.routeId,
      staffMemberId: rp.staffMemberId,
      pickupStopId:  rp.pickupStopId  ?? '',
      pickupTime:    rp.pickupTime    ?? '',
      dropoffStopId: rp.dropoffStopId ?? '',
      dropoffTime:   rp.dropoffTime   ?? '',
      effectiveFrom: rp.effectiveFrom.slice(0, 10),
      effectiveTo:   rp.effectiveTo ? rp.effectiveTo.slice(0, 10) : '',
      status: rp.status,
      notes:  rp.notes ?? '',
    });
  };

  const closeEditor = () => setEdit(null);

  const save = async () => {
    if (!edit) return;
    if (!edit.routeId)       { setError('Route is required'); return; }
    if (!edit.staffMemberId) { setError('Employee is required'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        routeId:       edit.routeId,
        staffMemberId: edit.staffMemberId,
        pickupStopId:  edit.pickupStopId  || null,
        pickupTime:    edit.pickupTime    || null,
        dropoffStopId: edit.dropoffStopId || null,
        dropoffTime:   edit.dropoffTime   || null,
        effectiveFrom: edit.effectiveFrom || null,
        effectiveTo:   edit.effectiveTo   || null,
        status:        edit.status,
        notes:         edit.notes || null,
      };
      const res = edit.id
        ? await fetch(`/api/bus-ops/route-passengers/${edit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/bus-ops/route-passengers`,             { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      setEdit(null);
      await loadPassengers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  // ── Inline employee create ───────────────────────────────────────────────
  // Opens a sub-modal on top of the passenger editor. On save, POST to
  // /api/bus-ops/staff, refresh the staff list, then auto-select the new
  // employee in the passenger form so the operator continues in one flow.
  const saveEmployee = async () => {
    if (!empDraft) return;
    // Validation errors go into the sub-modal's own error state — the outer
    // page error banner is behind the modal so writing there would be invisible.
    if (!empDraft.employeeId.trim()) { setEmpError('Employee ID is required'); return; }
    if (!empDraft.name.trim())       { setEmpError('Full Name is required');   return; }
    setSavingEmp(true); setEmpError('');
    try {
      const body: Record<string, unknown> = {
        employeeId:    empDraft.employeeId.trim(),
        name:          empDraft.name.trim(),
        department:    empDraft.department.trim()    || null,
        contactNumber: empDraft.contactNumber.trim() || null,
        email:         empDraft.email.trim()         || null,
        isActive:      true,
      };
      if (empDraft.shiftType) body.shiftType = empDraft.shiftType;
      const res = await fetch('/api/bus-ops/staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Read as text first so we can surface useful info whether the API
        // returned JSON, an HTML error page, or nothing at all.
        const text = await res.text().catch(() => '');
        let detail = '';
        try {
          const parsed = text ? JSON.parse(text) : null;
          detail = parsed?.error ?? parsed?.message ?? '';
        } catch {
          // Not JSON — show first 300 chars so ops can see what came back
          // (e.g. an HTML error page from Next) without flooding the UI.
          detail = text.slice(0, 300);
        }
        // Log as plain strings so the console shows values without needing
        // to expand a collapsed object — makes over-the-shoulder debugging
        // and copy-paste diagnostics reliable.
        console.error('[NewEmployee] POST /api/bus-ops/staff status:', res.status);
        console.error('[NewEmployee] POST /api/bus-ops/staff body   :', text.slice(0, 500) || '(empty)');
        throw new Error(detail || `HTTP ${res.status} (empty body)`);
      }
      const created = await res.json() as StaffMember;
      // Refresh reference data so the new employee shows in the dropdown, then
      // auto-select them in the passenger form so ops can continue without
      // hunting for the row they just created.
      await loadRefData();
      if (edit) setEdit({ ...edit, staffMemberId: created.id });
      setEmpDraft(null);
    } catch (e) {
      setEmpError(e instanceof Error ? e.message : 'Failed to create employee');
    } finally { setSavingEmp(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this passenger from the route roster? (soft delete — historical trips keep the record)')) return;
    try {
      const res = await fetch(`/api/bus-ops/route-passengers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadPassengers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  // ── Aggregates for header ────────────────────────────────────────────────
  const counts = {
    active:   rows.filter(r => r.status === 'ACTIVE').length,
    inactive: rows.filter(r => r.status === 'INACTIVE').length,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Passengers"
        subtitle={`${counts.active} active · ${counts.inactive} inactive · ${rows.length} total roster entries`}
        icon={Users}
        accent="violet"
        actions={
          <>
            <button onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-main)] hover:border-violet-500/40 hover:text-[var(--text-main)]">
              <Upload className="w-4 h-4" /> Bulk Import
            </button>
            <button onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              <Plus className="w-4 h-4" /> Add Passenger
            </button>
          </>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">Route</label>
          <select value={routeFilter} onChange={e => setRouteFilter(e.target.value)}
            className="min-w-64 px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
            <option value="">All Routes</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
            className="px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {loading ? (
          <div className="text-center text-[var(--text-muted)] py-12 animate-pulse">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">
            No passengers on the {routeFilter ? 'selected route' : 'roster'} yet. Click <strong className="text-violet-300">Add Passenger</strong> to register one.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {['Emp ID', 'Employee Name', 'Route', 'Pickup Point', 'Pickup Time', 'Drop-off Point', 'Drop-off Time', 'Effective From', 'Effective To', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(rp => {
                const emp   = staffById.get(rp.staffMemberId);
                const route = routeById.get(rp.routeId);
                const stops = route?.stops ?? [];
                const pickup  = stops.find(s => s.id === rp.pickupStopId);
                const dropoff = stops.find(s => s.id === rp.dropoffStopId);
                return (
                  <tr key={rp.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="px-3 py-3 text-sm font-mono text-[var(--text-main)] whitespace-nowrap">{emp?.employeeId ?? '—'}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-main)]">{emp?.name ?? <span className="text-[var(--text-faint)] italic">(deleted)</span>}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-main)]">{route?.name ?? <span className="text-[var(--text-faint)] italic">(deleted)</span>}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-main)]">{pickup?.stopName ?? <span className="text-[var(--text-faint)]">—</span>}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-muted)] font-mono">{rp.pickupTime ?? '—'}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-main)]">{dropoff?.stopName ?? <span className="text-[var(--text-faint)]">—</span>}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-muted)] font-mono">{rp.dropoffTime ?? '—'}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-muted)] whitespace-nowrap">{fmtDate(rp.effectiveFrom)}</td>
                    <td className="px-3 py-3 text-sm text-[var(--text-muted)] whitespace-nowrap">{rp.effectiveTo ? fmtDate(rp.effectiveTo) : <span className="text-[var(--text-faint)]">open</span>}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_PILL[rp.status]}`}>{rp.status}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(rp)} title="Edit"
                          className="p-1.5 rounded border border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-violet-500/40 hover:text-[var(--text-main)]">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => remove(rp.id)} title="Remove"
                          className="p-1.5 rounded border border-[var(--border-subtle)] text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showImport && (
        <BulkImportModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); loadPassengers(); }} />
      )}

      {/* Inline "New Employee" sub-modal — sits on top of the passenger modal
          when open. Its scope is intentionally narrow: create a StaffMember
          row and hand its id back to the passenger form. Full employee edit
          lives on the Staff page. */}
      {empDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[var(--bg-surface)]/95 border border-violet-500/30 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-main)]">New Employee</h2>
              <button onClick={() => { setEmpDraft(null); setEmpError(''); }} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X className="w-5 h-5" /></button>
            </div>
            {empError && (
              <div className="mb-3 bg-rose-500/15 border border-rose-500/40 rounded-lg px-3 py-2 text-rose-200 text-xs">
                {empError}
              </div>
            )}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Employee ID *</label>
                  <input type="text" value={empDraft.employeeId} onChange={e => setEmpDraft({ ...empDraft, employeeId: e.target.value })}
                    placeholder="EMP-001"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Shift</label>
                  <select value={empDraft.shiftType} onChange={e => setEmpDraft({ ...empDraft, shiftType: e.target.value as EmpDraft['shiftType'] })}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                    <option value="">—</option>
                    <option value="MORNING">Morning</option>
                    <option value="EVENING">Evening</option>
                    <option value="BOTH">Both</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Full Name *</label>
                <input type="text" value={empDraft.name} onChange={e => setEmpDraft({ ...empDraft, name: e.target.value })}
                  placeholder="Ahmed Al Mansouri"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Department</label>
                  <input type="text" value={empDraft.department} onChange={e => setEmpDraft({ ...empDraft, department: e.target.value })}
                    placeholder="Operations"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Contact</label>
                  <input type="tel" value={empDraft.contactNumber} onChange={e => setEmpDraft({ ...empDraft, contactNumber: e.target.value })}
                    placeholder="+971 50 …"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Email</label>
                <input type="email" value={empDraft.email} onChange={e => setEmpDraft({ ...empDraft, email: e.target.value })}
                  placeholder="ahmed@company.ae"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => { setEmpDraft(null); setEmpError(''); }}
                className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm">Cancel</button>
              <button onClick={saveEmployee} disabled={savingEmp}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm">
                {savingEmp ? 'Creating…' : 'Create Employee'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor Modal — new + edit share the same form */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-6 my-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[var(--text-main)]">{edit.id ? 'Edit Passenger Roster' : 'Add Passenger to Route'}</h2>
              <button onClick={closeEditor} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Employee ID — the primary identifier, first field. The "+ New"
                  button opens a sub-modal so an operator can create the employee
                  inline when the target person isn't in the Staff registry yet. */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Employee ID *</label>
                <div className="flex gap-2">
                  <select value={edit.staffMemberId} onChange={e => setEdit({ ...edit, staffMemberId: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                    <option value="">— Select employee —</option>
                    {staffWithEmpId.map(s => (
                      <option key={s.id} value={s.id}>{s.employeeId} · {s.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setEmpDraft({ ...EMPTY_EMP })}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] hover:border-violet-500/40 hover:text-[var(--text-main)] text-sm whitespace-nowrap">
                    <UserPlus className="w-4 h-4" /> New
                  </button>
                </div>
              </div>

              {/* Employee Name — read-only, auto-filled from the selection */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Employee Name</label>
                <input type="text" readOnly
                  value={staffById.get(edit.staffMemberId)?.name ?? ''}
                  placeholder="Auto-filled once an Employee ID is chosen"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] text-[var(--text-muted)] placeholder-[var(--text-faint)] cursor-not-allowed" />
              </div>

              {/* Route */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Route *</label>
                <select value={edit.routeId} onChange={e => setEdit({ ...edit, routeId: e.target.value, pickupStopId: '', dropoffStopId: '' })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                  <option value="">— Select route —</option>
                  {routes.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.origin} → {r.destination})</option>
                  ))}
                </select>
              </div>

              {/* Pickup Point + Time */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Pickup Point</label>
                <select value={edit.pickupStopId} onChange={e => setEdit({ ...edit, pickupStopId: e.target.value })}
                  disabled={!edit.routeId}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed">
                  <option value="">{edit.routeId ? '— Select stop —' : 'Select route first'}</option>
                  {editRouteStops.map(s => (
                    <option key={s.id} value={s.id}>#{s.sequence} · {s.stopName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Pickup Time</label>
                <input type="time" value={edit.pickupTime} onChange={e => setEdit({ ...edit, pickupTime: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none" />
              </div>

              {/* Drop-off Point + Time */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Drop-off Point</label>
                <select value={edit.dropoffStopId} onChange={e => setEdit({ ...edit, dropoffStopId: e.target.value })}
                  disabled={!edit.routeId}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed">
                  <option value="">{edit.routeId ? '— Select stop —' : 'Select route first'}</option>
                  {editRouteStops.map(s => (
                    <option key={s.id} value={s.id}>#{s.sequence} · {s.stopName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Drop-off Time</label>
                <input type="time" value={edit.dropoffTime} onChange={e => setEdit({ ...edit, dropoffTime: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none" />
              </div>

              {/* Validity window */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Effective From *</label>
                <input type="date" value={edit.effectiveFrom} onChange={e => setEdit({ ...edit, effectiveFrom: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Effective To <span className="text-[var(--text-faint)] font-normal">(blank = open-ended)</span></label>
                <input type="date" value={edit.effectiveTo} onChange={e => setEdit({ ...edit, effectiveTo: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none" />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Status</label>
                <select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>

              {/* Notes */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-1.5">Notes</label>
                <textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} rows={2}
                  placeholder="Contract details, temporary variation, etc."
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-5">
              <button onClick={closeEditor}
                className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : edit.id ? 'Save' : 'Add Passenger'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
