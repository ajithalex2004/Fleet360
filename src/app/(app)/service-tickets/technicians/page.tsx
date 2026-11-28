'use client';

/**
 * /service-tickets/technicians — Field Service Workforce, Teams, Territories & RBAC Console
 *
 * Four integrated tabs:
 *   1. Technicians  — roster, live availability switcher, skills/certifications with
 *                     expiry warnings, and shifts/leave windows.
 *   2. Teams/Squads — persistent named teams with Team Lead, department, territory & members.
 *   3. Territories  — geographic service zones (city, center lat/lng, radius km).
 *   4. FSM RBAC     — granular FSM roles scoped by optional territory & team.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  UserCheck,
  MapPin,
  ShieldCheck,
  Plus,
  Search,
  Pencil,
  Trash2,
  Award,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  X,
  ArrowLeft,
  Save,
  RefreshCw,
} from 'lucide-react';
import { PageHeader, KpiCard, StatGrid } from '@/components/ui/page-theme';
import {
  AVAILABILITY_STATUSES,
  COMMON_FSM_SKILLS,
  EMPLOYMENT_TYPES,
  FSM_ROLES,
  FSM_ROLE_META,
  SHIFT_ENTRY_TYPES,
  expiredCertificationsOf,
  getCertificationStatus,
  type AvailabilityStatus,
  type EmploymentType,
  type FsmRole,
  type FsmTeam,
  type FsmTechnician,
  type FsmTechnicianShift,
  type FsmTerritory,
  type FsmUserScope,
  type ShiftEntryType,
} from '@/lib/service-tickets/workforce';
import { TICKET_DEPARTMENTS, type TicketDepartmentDef } from '@/types/service-tickets';

type TabKey = 'technicians' | 'teams' | 'territories' | 'rbac';

interface TenantUserOption {
  id: string;
  email: string;
  fullName?: string | null;
  name?: string | null;
  role?: string | null;
}

const AVAIL_STYLE: Record<AvailabilityStatus, string> = {
  AVAILABLE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  ON_JOB: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  EN_ROUTE: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  ON_BREAK: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  OFF_SHIFT: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
  ON_LEAVE: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
};

export default function FsmWorkforcePage() {
  const [activeTab, setActiveTab] = useState<TabKey>('technicians');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const [technicians, setTechnicians] = useState<FsmTechnician[]>([]);
  const [teams, setTeams] = useState<FsmTeam[]>([]);
  const [territories, setTerritories] = useState<FsmTerritory[]>([]);
  const [scopes, setScopes] = useState<FsmUserScope[]>([]);
  const [departments, setDepartments] = useState<TicketDepartmentDef[]>(TICKET_DEPARTMENTS);
  const [tenantUsers, setTenantUsers] = useState<TenantUserOption[]>([]);

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [availFilter, setAvailFilter] = useState('ALL');

  const [editingTech, setEditingTech] = useState<FsmTechnician | 'NEW' | null>(null);
  const [shiftTech, setShiftTech] = useState<FsmTechnician | null>(null);
  const [editingTeam, setEditingTeam] = useState<FsmTeam | 'NEW' | null>(null);
  const [editingTerritory, setEditingTerritory] = useState<FsmTerritory | 'NEW' | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, tmRes, trRes, rbacRes, fieldsRes, usersRes] = await Promise.all([
        fetch('/api/service-tickets/technicians'),
        fetch('/api/service-tickets/teams'),
        fetch('/api/service-tickets/territories'),
        fetch('/api/service-tickets/rbac'),
        fetch('/api/service-tickets/form-fields'),
        fetch('/api/users').catch(() => null),
      ]);

      const [tData, tmData, trData, rbacData, fieldsData] = await Promise.all([
        tRes.ok ? tRes.json() : { technicians: [] },
        tmRes.ok ? tmRes.json() : { teams: [] },
        trRes.ok ? trRes.json() : { territories: [] },
        rbacRes.ok ? rbacRes.json() : { scopes: [] },
        fieldsRes.ok
          ? (fieldsRes.json() as Promise<{ departments?: TicketDepartmentDef[] }>)
          : Promise.resolve({ departments: [] as TicketDepartmentDef[] }),
      ]);

      setTechnicians(Array.isArray(tData.technicians) ? tData.technicians : []);
      setTeams(Array.isArray(tmData.teams) ? tmData.teams : []);
      setTerritories(Array.isArray(trData.territories) ? trData.territories : []);
      setScopes(Array.isArray(rbacData.scopes) ? rbacData.scopes : []);
      if (Array.isArray(fieldsData.departments) && fieldsData.departments.length > 0) {
        setDepartments(fieldsData.departments);
      }

      if (usersRes && usersRes.ok) {
        const uData = await usersRes.json().catch(() => []);
        const list = Array.isArray(uData) ? uData : Array.isArray(uData.users) ? uData.users : [];
        setTenantUsers(list);
      }
    } catch {
      setBanner({ kind: 'error', text: 'Failed to load FSM workforce data.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const kpis = useMemo(() => {
    const active = technicians.filter((t) => t.isActive);
    const available = active.filter((t) => t.availabilityStatus === 'AVAILABLE').length;
    let certWarnings = 0;
    for (const t of active) {
      for (const s of t.skills) {
        if (!s.isCertification) continue;
        const st = getCertificationStatus(s).status;
        if (st === 'EXPIRED' || st === 'EXPIRING_SOON') certWarnings++;
      }
    }
    return {
      activeCount: active.length,
      availableCount: available,
      certWarnings,
      teamsAndZones: `${teams.length} teams · ${territories.length} zones`,
    };
  }, [technicians, teams, territories]);

  const filteredTechs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return technicians.filter((t) => {
      if (deptFilter !== 'ALL' && t.primaryDepartment !== deptFilter) return false;
      if (availFilter !== 'ALL' && t.availabilityStatus !== availFilter) return false;
      if (!q) return true;
      return (
        t.fullName.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.employeeCode.toLowerCase().includes(q) ||
        t.skills.some((s) => s.skillName.toLowerCase().includes(q) || s.skillCode.toLowerCase().includes(q)) ||
        t.territories.some((tr) => tr.territoryName.toLowerCase().includes(q))
      );
    });
  }, [technicians, search, deptFilter, availFilter]);

  const quickAvailability = async (tech: FsmTechnician, nextStatus: AvailabilityStatus) => {
    const res = await fetch(`/api/service-tickets/technicians/${tech.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ availabilityStatus: nextStatus }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBanner({ kind: 'error', text: d?.error ?? 'Failed to update status.' });
      return;
    }
    setTechnicians((prev) => prev.map((t) => (t.id === tech.id ? d.technician : t)));
  };

  const deleteTech = async (tech: FsmTechnician) => {
    if (!window.confirm(`Remove technician "${tech.fullName}" from the active roster?`)) return;
    const res = await fetch(`/api/service-tickets/technicians/${tech.id}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBanner({ kind: 'error', text: d?.error ?? 'Delete failed.' });
      return;
    }
    setBanner({ kind: 'success', text: `Removed technician "${tech.fullName}".` });
    void loadAll();
  };

  const deleteTeam = async (tm: FsmTeam) => {
    if (!window.confirm(`Delete team "${tm.name}"?`)) return;
    const res = await fetch(`/api/service-tickets/teams?id=${encodeURIComponent(tm.id)}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBanner({ kind: 'error', text: d?.error ?? 'Failed to delete team.' });
      return;
    }
    setBanner({ kind: 'success', text: `Deleted team "${tm.name}".` });
    void loadAll();
  };

  const deleteTerritory = async (tr: FsmTerritory) => {
    if (!window.confirm(`Delete territory "${tr.name}"?`)) return;
    const res = await fetch(`/api/service-tickets/territories?id=${encodeURIComponent(tr.id)}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBanner({ kind: 'error', text: d?.error ?? 'Failed to delete territory.' });
      return;
    }
    setBanner({ kind: 'success', text: `Deleted territory "${tr.name}".` });
    void loadAll();
  };

  const revokeScope = async (s: FsmUserScope) => {
    if (!window.confirm(`Revoke ${s.fsmRole} for ${s.userEmail || s.userId}?`)) return;
    const res = await fetch(`/api/service-tickets/rbac?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBanner({ kind: 'error', text: d?.error ?? 'Failed to revoke scope.' });
      return;
    }
    setBanner({ kind: 'success', text: 'Revoked FSM role scope.' });
    void loadAll();
  };

  return (
    <div className="space-y-5 max-w-[1600px]">
      <PageHeader
        title="Technicians, Teams & FSM Access"
        subtitle="Manage field technicians, trades & expiring certifications, shifts, named squads, territories, and scoped FSM roles"
        icon={Users}
        accent="violet"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/service-tickets"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-xs font-semibold text-[var(--text-main)]"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Service Tickets
            </Link>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-xs font-semibold text-[var(--text-main)]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />

      {banner && (
        <div
          className={`rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 border ${
            banner.kind === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          {banner.kind === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss" className="p-0.5 rounded hover:bg-black/10">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <StatGrid cols={4}>
        <KpiCard label="Active Technicians" value={kpis.activeCount} sub={`${technicians.length} total in roster`} icon={UserCheck} accent="violet" />
        <KpiCard label="Available Now" value={kpis.availableCount} sub="Ready for immediate dispatch" icon={CheckCircle2} accent="emerald" />
        <KpiCard
          label="Certification Alerts"
          value={kpis.certWarnings}
          sub="Expired or expiring within 30d"
          icon={Award}
          accent={kpis.certWarnings > 0 ? 'rose' : 'slate'}
        />
        <KpiCard label="Teams & Territories" value={teams.length + territories.length} sub={kpis.teamsAndZones} icon={MapPin} accent="blue" />
      </StatGrid>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] pb-2 flex-wrap">
        {(
          [
            { key: 'technicians', label: `Technicians (${technicians.length})`, icon: UserCheck },
            { key: 'teams', label: `Teams & Squads (${teams.length})`, icon: Users },
            { key: 'territories', label: `Territories (${territories.length})`, icon: MapPin },
            { key: 'rbac', label: `FSM Roles & Access (${scopes.length})`, icon: ShieldCheck },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                active
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab 1: Technicians ── */}
      {activeTab === 'technicians' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, code, email, skill, or territory…"
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
            <select
              value={availFilter}
              onChange={(e) => setAvailFilter(e.target.value)}
              className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
            >
              <option value="ALL">All Statuses</option>
              {AVAILABILITY_STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setEditingTech('NEW')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Technician
            </button>
          </div>

          {filteredTechs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center space-y-2">
              <UserCheck className="w-8 h-8 mx-auto text-[var(--text-faint)]" />
              <p className="text-sm font-semibold text-[var(--text-main)]">No technicians found</p>
              <p className="text-xs text-[var(--text-muted)]">Add your field technicians with their trade skills, certifications, and territories to enable smart dispatch.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {filteredTechs.map((tech) => {
                const expired = expiredCertificationsOf(tech.skills);
                return (
                  <div
                    key={tech.id}
                    className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-[var(--text-main)]">{tech.fullName}</span>
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                            {tech.employeeCode}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)] font-semibold">
                            {tech.employmentType}
                          </span>
                          {!tech.isActive && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 font-semibold">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">
                          {tech.email}{tech.mobile ? ` · ${tech.mobile}` : ''} · {tech.primaryDepartment}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={tech.availabilityStatus}
                          onChange={(e) => void quickAvailability(tech, e.target.value as AvailabilityStatus)}
                          aria-label={`Availability status for ${tech.fullName}`}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer ${AVAIL_STYLE[tech.availabilityStatus]}`}
                        >
                          {AVAILABILITY_STATUSES.map((st) => (
                            <option key={st} value={st} className="bg-[var(--bg-surface)] text-[var(--text-main)]">
                              {st.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setShiftTech(tech)}
                          title="Manage shifts & leave"
                          className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-violet-700 dark:hover:text-violet-300"
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTech(tech)}
                          title="Edit technician"
                          className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-violet-700 dark:hover:text-violet-300"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTech(tech)}
                          title="Delete technician"
                          className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Skills & Certifications */}
                    <div className="flex flex-wrap gap-1.5">
                      {tech.skills.length === 0 ? (
                        <span className="text-[11px] text-[var(--text-faint)]">No skills assigned yet</span>
                      ) : (
                        tech.skills.map((s) => {
                          const c = getCertificationStatus(s);
                          const style =
                            s.isCertification && c.status === 'EXPIRED'
                              ? 'bg-rose-500/15 border-rose-500/35 text-rose-700 dark:text-rose-300'
                              : s.isCertification && c.status === 'EXPIRING_SOON'
                                ? 'bg-amber-500/15 border-amber-500/35 text-amber-800 dark:text-amber-300'
                                : 'bg-violet-500/10 border-violet-500/25 text-violet-800 dark:text-violet-200';
                          return (
                            <span key={s.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border font-medium ${style}`}>
                              {s.isCertification && <Award className="w-3 h-3 shrink-0" />}
                              {s.skillName} (L{s.proficiencyLevel})
                              {s.isCertification && c.status === 'EXPIRED' && ' · Expired'}
                              {s.isCertification && c.status === 'EXPIRING_SOON' && ` · ${c.daysRemaining}d left`}
                            </span>
                          );
                        })
                      )}
                    </div>

                    {/* Footer meta */}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] pt-2 border-t border-[var(--border-subtle)] flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {tech.territories.length > 0 ? (
                          tech.territories.map((tr) => (
                            <span key={tr.territoryId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                              <MapPin className="w-3 h-3 text-blue-500" />
                              {tr.territoryName}{tr.isPrimary ? ' ★' : ''}
                            </span>
                          ))
                        ) : (
                          <span className="text-[var(--text-faint)]">All territories</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span>Max {tech.maxDailyJobs} jobs/day</span>
                        <span>
                          {tech.currency} {tech.hourlyCostRate}/h cost · {tech.hourlyBillableRate}/h bill
                        </span>
                      </div>
                    </div>

                    {expired.length > 0 && (
                      <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Expired certification(s): {expired.map((e) => e.skillName).join(', ')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: Teams / Squads ── */}
      {activeTab === 'teams' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-muted)]">
              Create persistent named squads (e.g. &ldquo;Dubai Marina HVAC Squad A&rdquo;) to dispatch tickets directly to a team and its Team Lead.
            </p>
            <button
              type="button"
              onClick={() => setEditingTeam('NEW')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shrink-0"
            >
              <Plus className="w-4 h-4" /> Add Team
            </button>
          </div>

          {teams.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-xs text-[var(--text-muted)]">
              No persistent teams configured yet. Click &ldquo;Add Team&rdquo; to build your first squad.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {teams.map((tm) => (
                <div key={tm.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[var(--text-main)]">{tm.name}</h3>
                        <span className="text-[10px] font-mono text-[var(--text-faint)]">{tm.code}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {tm.departmentKey}{tm.territoryName ? ` · ${tm.territoryName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingTeam(tm)}
                        className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)]"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTeam(tm)}
                        className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-faint)]">
                      Members ({tm.members.length})
                    </p>
                    {tm.members.length === 0 ? (
                      <p className="text-xs text-[var(--text-faint)]">No technicians assigned</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {tm.members.map((m) => (
                          <span
                            key={m.technicianId}
                            className={`px-2 py-0.5 rounded-md text-[11px] border ${
                              m.role === 'LEAD'
                                ? 'bg-violet-500/15 border-violet-500/40 text-violet-800 dark:text-violet-200 font-semibold'
                                : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                            }`}
                          >
                            {m.fullName}{m.role === 'LEAD' ? ' (Lead)' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 3: Territories ── */}
      {activeTab === 'territories' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-muted)]">
              Define geographic service zones used for proximity matching, team coverage, and territory-scoped FSM RBAC.
            </p>
            <button
              type="button"
              onClick={() => setEditingTerritory('NEW')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shrink-0"
            >
              <Plus className="w-4 h-4" /> Add Territory
            </button>
          </div>

          {territories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-12 text-center text-xs text-[var(--text-muted)]">
              No service territories configured yet. Add zones like &ldquo;Dubai Marina&rdquo;, &ldquo;Abu Dhabi Industrial&rdquo;, or &ldquo;Sharjah North&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {territories.map((tr) => (
                <div key={tr.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-500 shrink-0" />
                        <h3 className="text-sm font-bold text-[var(--text-main)]">{tr.name}</h3>
                        <span className="text-[10px] font-mono text-[var(--text-faint)]">{tr.code}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {tr.city || 'City not set'}
                        {tr.radiusKm ? ` · ${tr.radiusKm} km radius` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingTerritory(tr)}
                        className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)]"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteTerritory(tr)}
                        className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border-subtle)]">
                    <span>{tr.technicianCount} technician(s)</span>
                    <span>· {tr.teamCount} team(s)</span>
                    {tr.centerLat !== null && tr.centerLng !== null && (
                      <span className="font-mono text-[10px] ml-auto">
                        {tr.centerLat.toFixed(3)}, {tr.centerLng.toFixed(3)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 4: Granular FSM Roles & Access ── */}
      {activeTab === 'rbac' && (
        <RbacPanel
          scopes={scopes}
          territories={territories}
          teams={teams}
          tenantUsers={tenantUsers}
          onRevoke={revokeScope}
          onGranted={() => {
            setBanner({ kind: 'success', text: 'FSM role scope granted.' });
            void loadAll();
          }}
          onError={(msg) => setBanner({ kind: 'error', text: msg })}
        />
      )}

      {/* Modals */}
      {editingTech !== null && (
        <TechnicianEditorModal
          initial={editingTech === 'NEW' ? null : editingTech}
          departments={departments}
          territories={territories}
          tenantUsers={tenantUsers}
          onClose={() => setEditingTech(null)}
          onSaved={(msg) => {
            setEditingTech(null);
            setBanner({ kind: 'success', text: msg });
            void loadAll();
          }}
        />
      )}

      {shiftTech && (
        <ShiftsModal
          technician={shiftTech}
          onClose={() => setShiftTech(null)}
        />
      )}

      {editingTeam !== null && (
        <TeamEditorModal
          initial={editingTeam === 'NEW' ? null : editingTeam}
          departments={departments}
          territories={territories}
          technicians={technicians}
          onClose={() => setEditingTeam(null)}
          onSaved={(msg) => {
            setEditingTeam(null);
            setBanner({ kind: 'success', text: msg });
            void loadAll();
          }}
        />
      )}

      {editingTerritory !== null && (
        <TerritoryEditorModal
          initial={editingTerritory === 'NEW' ? null : editingTerritory}
          onClose={() => setEditingTerritory(null)}
          onSaved={(msg) => {
            setEditingTerritory(null);
            setBanner({ kind: 'success', text: msg });
            void loadAll();
          }}
        />
      )}
    </div>
  );
}

// ── Technician Create / Edit Modal ───────────────────────────────────────────

interface SkillDraft {
  skillCode: string;
  skillName: string;
  proficiencyLevel: number;
  isCertification: boolean;
  certificateNumber: string;
  issuingAuthority: string;
  expiresAt: string;
}

function TechnicianEditorModal({
  initial,
  departments,
  territories,
  tenantUsers,
  onClose,
  onSaved,
}: {
  initial: FsmTechnician | null;
  departments: TicketDepartmentDef[];
  territories: FsmTerritory[];
  tenantUsers: TenantUserOption[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [employeeCode, setEmployeeCode] = useState(initial?.employeeCode ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [mobile, setMobile] = useState(initial?.mobile ?? '');
  const [userId, setUserId] = useState(initial?.userId ?? '');
  const [primaryDepartment, setPrimaryDepartment] = useState(initial?.primaryDepartment ?? (departments[1]?.key || 'OPERATIONS_TRIAGE'));
  const [employmentType, setEmploymentType] = useState<EmploymentType>(initial?.employmentType ?? 'INTERNAL');
  const [hourlyCostRate, setHourlyCostRate] = useState(String(initial?.hourlyCostRate ?? 0));
  const [hourlyBillableRate, setHourlyBillableRate] = useState(String(initial?.hourlyBillableRate ?? 0));
  const [maxDailyJobs, setMaxDailyJobs] = useState(String(initial?.maxDailyJobs ?? 8));
  const [selectedTerrIds, setSelectedTerrIds] = useState<string[]>(initial?.territories.map((t) => t.territoryId) ?? []);
  const [skills, setSkills] = useState<SkillDraft[]>(
    initial?.skills.map((s) => ({
      skillCode: s.skillCode,
      skillName: s.skillName,
      proficiencyLevel: s.proficiencyLevel,
      isCertification: s.isCertification,
      certificateNumber: s.certificateNumber ?? '',
      issuingAuthority: s.issuingAuthority ?? '',
      expiresAt: s.expiresAt ? s.expiresAt.slice(0, 10) : '',
    })) ?? [],
  );
  const [newSkillPreset, setNewSkillPreset] = useState(COMMON_FSM_SKILLS[0].code);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addSkillFromPreset = () => {
    const preset = COMMON_FSM_SKILLS.find((c) => c.code === newSkillPreset);
    if (!preset) return;
    if (skills.some((s) => s.skillCode === preset.code)) return;
    setSkills((prev) => [
      ...prev,
      {
        skillCode: preset.code,
        skillName: preset.name,
        proficiencyLevel: 3,
        isCertification: Boolean(preset.regulated),
        certificateNumber: '',
        issuingAuthority: '',
        expiresAt: '',
      },
    ]);
  };

  const toggleTerr = (id: string) =>
    setSelectedTerrIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        fullName,
        employeeCode: employeeCode || undefined,
        email,
        mobile: mobile || null,
        userId: userId || null,
        primaryDepartment,
        employmentType,
        hourlyCostRate: Number(hourlyCostRate) || 0,
        hourlyBillableRate: Number(hourlyBillableRate) || 0,
        maxDailyJobs: Number(maxDailyJobs) || 8,
        territoryIds: selectedTerrIds,
        primaryTerritoryId: selectedTerrIds[0] ?? null,
        skills: skills.map((s) => ({
          ...s,
          certificateNumber: s.certificateNumber || null,
          issuingAuthority: s.issuingAuthority || null,
          expiresAt: s.expiresAt || null,
        })),
      };
      const url = initial ? `/api/service-tickets/technicians/${initial.id}` : '/api/service-tickets/technicians';
      const res = await fetch(url, {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d?.error ?? 'Save failed.');
        return;
      }
      onSaved(initial ? `Updated technician "${fullName}".` : `Added technician "${fullName}".`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-bold text-[var(--text-main)]">
            {initial ? `Edit Technician · ${initial.fullName}` : 'Add Field Technician'}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {err && <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{err}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Full Name *</span>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Employee Code</span>
            <input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="Auto if blank (e.g. TECH-01)" disabled={!!initial}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm font-mono uppercase text-[var(--text-main)] disabled:opacity-60" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Email *</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Mobile</span>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+971 50 ..."
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Primary Department</span>
            <select value={primaryDepartment} onChange={(e) => setPrimaryDepartment(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]">
              {departments.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Employment Type</span>
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]">
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Linked App Login (Optional)</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]">
              <option value="">Not linked yet (roster only)</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName || u.name || u.email} ({u.email})</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="font-semibold uppercase text-[var(--text-muted)]">Max Jobs</span>
              <input type="number" min={1} max={50} value={maxDailyJobs} onChange={(e) => setMaxDailyJobs(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-2 text-sm text-[var(--text-main)]" />
            </label>
            <label className="space-y-1">
              <span className="font-semibold uppercase text-[var(--text-muted)]">Cost/h</span>
              <input type="number" min={0} step="0.5" value={hourlyCostRate} onChange={(e) => setHourlyCostRate(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-2 text-sm text-[var(--text-main)]" />
            </label>
            <label className="space-y-1">
              <span className="font-semibold uppercase text-[var(--text-muted)]">Bill/h</span>
              <input type="number" min={0} step="0.5" value={hourlyBillableRate} onChange={(e) => setHourlyBillableRate(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-2 text-sm text-[var(--text-main)]" />
            </label>
          </div>
        </div>

        {/* Territories */}
        {territories.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Assigned Territories (first selected = Primary)</span>
            <div className="flex flex-wrap gap-1.5">
              {territories.map((tr) => {
                const active = selectedTerrIds.includes(tr.id);
                return (
                  <button
                    key={tr.id}
                    type="button"
                    onClick={() => toggleTerr(tr.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-[var(--bg-main)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    {tr.name}{selectedTerrIds[0] === tr.id ? ' ★' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Skills & Certifications */}
        <div className="space-y-2 pt-1 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Skills &amp; Expiring Certifications</span>
            <div className="flex items-center gap-1.5">
              <select
                value={newSkillPreset}
                onChange={(e) => setNewSkillPreset(e.target.value)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
              >
                {COMMON_FSM_SKILLS.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={addSkillFromPreset}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600/15 hover:bg-violet-600/25 border border-violet-500/40 text-violet-700 dark:text-violet-200 text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" /> Add Skill
              </button>
            </div>
          </div>

          {skills.length > 0 && (
            <div className="space-y-2">
              {skills.map((s, idx) => (
                <div key={s.skillCode} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs">
                  <div className="md:col-span-3 font-semibold text-[var(--text-main)]">{s.skillName}</div>
                  <select
                    value={s.proficiencyLevel}
                    onChange={(e) => setSkills((prev) => prev.map((x, i) => (i === idx ? { ...x, proficiencyLevel: Number(e.target.value) } : x)))}
                    className="md:col-span-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-main)]"
                  >
                    <option value={1}>L1 Junior</option>
                    <option value={2}>L2 Standard</option>
                    <option value={3}>L3 Senior</option>
                    <option value={4}>L4 Lead</option>
                  </select>
                  <label className="md:col-span-2 inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                    <input
                      type="checkbox"
                      checked={s.isCertification}
                      onChange={(e) => setSkills((prev) => prev.map((x, i) => (i === idx ? { ...x, isCertification: e.target.checked } : x)))}
                    />
                    Certified
                  </label>
                  <input
                    value={s.certificateNumber}
                    onChange={(e) => setSkills((prev) => prev.map((x, i) => (i === idx ? { ...x, certificateNumber: e.target.value } : x)))}
                    placeholder="Cert #"
                    className="md:col-span-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-main)]"
                  />
                  <input
                    type="date"
                    value={s.expiresAt}
                    onChange={(e) => setSkills((prev) => prev.map((x, i) => (i === idx ? { ...x, expiresAt: e.target.value } : x)))}
                    title="Certification expiry date"
                    className="md:col-span-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-main)]"
                  />
                  <button
                    type="button"
                    onClick={() => setSkills((prev) => prev.filter((_, i) => i !== idx))}
                    className="md:col-span-1 justify-self-end p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/15"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Technician'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Shifts & Leave Modal ─────────────────────────────────────────────────────

function ShiftsModal({ technician, onClose }: { technician: FsmTechnician; onClose: () => void }) {
  const [shifts, setShifts] = useState<FsmTechnicianShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryType, setEntryType] = useState<ShiftEntryType>('SHIFT');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/service-tickets/technicians/${technician.id}/shifts`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) setShifts(Array.isArray(d.shifts) ? d.shifts : []);
    } finally {
      setLoading(false);
    }
  }, [technician.id]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/service-tickets/technicians/${technician.id}/shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryType, startsAt, endsAt, notes: notes || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d?.error ?? 'Failed to add shift.');
        return;
      }
      setNotes('');
      await loadShifts();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (shiftId: string) => {
    const res = await fetch(`/api/service-tickets/technicians/${technician.id}/shifts?shiftId=${encodeURIComponent(shiftId)}`, {
      method: 'DELETE',
    });
    if (res.ok) await loadShifts();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text-main)]">Shifts &amp; Leave · {technician.fullName}</h3>
            <p className="text-xs text-[var(--text-muted)]">Schedule regular shifts, on-call windows, training, or leave blocks.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => void add(e)} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 space-y-2.5 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select value={entryType} onChange={(e) => setEntryType(e.target.value as ShiftEntryType)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]">
              {SHIFT_ENTRY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
            <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]" />
            <input type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]" />
          </div>
          <div className="flex gap-2">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
              className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]" />
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-50">
              {busy ? 'Adding…' : '+ Add Entry'}
            </button>
          </div>
          {err && <p className="text-rose-600 dark:text-rose-300">{err}</p>}
        </form>

        <div className="space-y-1.5">
          {loading ? (
            <p className="text-xs text-[var(--text-muted)]">Loading…</p>
          ) : shifts.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)] py-4 text-center">No shift or leave entries scheduled.</p>
          ) : (
            shifts.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-xs">
                <div>
                  <span className="font-semibold text-[var(--text-main)]">{s.entryType.replace('_', ' ')}</span>
                  <span className="text-[var(--text-muted)] ml-2">
                    {new Date(s.startsAt).toLocaleString()} → {new Date(s.endsAt).toLocaleString()}
                  </span>
                  {s.notes && <p className="text-[11px] text-[var(--text-faint)]">{s.notes}</p>}
                </div>
                <button type="button" onClick={() => void remove(s.id)} className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/15">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Team Create / Edit Modal ─────────────────────────────────────────────────

function TeamEditorModal({
  initial,
  departments,
  territories,
  technicians,
  onClose,
  onSaved,
}: {
  initial: FsmTeam | null;
  departments: TicketDepartmentDef[];
  territories: FsmTerritory[];
  technicians: FsmTechnician[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [departmentKey, setDepartmentKey] = useState(initial?.departmentKey ?? (departments[1]?.key || 'OPERATIONS_TRIAGE'));
  const [territoryId, setTerritoryId] = useState(initial?.territoryId ?? '');
  const [leadTechnicianId, setLeadTechnicianId] = useState(initial?.leadTechnicianId ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(initial?.members.map((m) => m.technicianId) ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleMember = (id: string) =>
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/service-tickets/teams', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(initial ? { id: initial.id } : { code: code || name }),
          name,
          departmentKey,
          territoryId: territoryId || null,
          leadTechnicianId: leadTechnicianId || null,
          memberIds,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d?.error ?? 'Save failed.');
        return;
      }
      onSaved(initial ? `Updated team "${name}".` : `Created team "${name}".`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-bold text-[var(--text-main)]">{initial ? `Edit Team · ${initial.name}` : 'Create Team / Squad'}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-[var(--text-muted)]"><X className="w-4 h-4" /></button>
        </div>
        {err && <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{err}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Team Name *</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dubai Marina HVAC Squad A"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!initial} placeholder="Auto if blank"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm font-mono uppercase text-[var(--text-main)] disabled:opacity-60" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Department</span>
            <select value={departmentKey} onChange={(e) => setDepartmentKey(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]">
              {departments.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Territory</span>
            <select value={territoryId} onChange={(e) => setTerritoryId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]">
              <option value="">All territories</option>
              {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="md:col-span-2 space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Team Lead</span>
            <select value={leadTechnicianId} onChange={(e) => setLeadTechnicianId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]">
              <option value="">Unassigned</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.fullName} ({t.employeeCode})</option>)}
            </select>
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-semibold uppercase text-[var(--text-muted)]">Squad Members</span>
          <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-2 space-y-1">
            {technicians.length === 0 ? (
              <p className="text-xs text-[var(--text-faint)] p-2">Add technicians first to populate team membership.</p>
            ) : (
              technicians.map((t) => (
                <label key={t.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-surface-hover)] text-xs cursor-pointer">
                  <input type="checkbox" checked={memberIds.includes(t.id)} onChange={() => toggleMember(t.id)} />
                  <span className="font-medium text-[var(--text-main)]">{t.fullName}</span>
                  <span className="text-[var(--text-faint)] font-mono text-[10px]">{t.employeeCode}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)]">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Team'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Territory Create / Edit Modal ────────────────────────────────────────────

function TerritoryEditorModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: FsmTerritory | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [centerLat, setCenterLat] = useState(initial?.centerLat != null ? String(initial.centerLat) : '');
  const [centerLng, setCenterLng] = useState(initial?.centerLng != null ? String(initial.centerLng) : '');
  const [radiusKm, setRadiusKm] = useState(initial?.radiusKm != null ? String(initial.radiusKm) : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/service-tickets/territories', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(initial ? { id: initial.id } : { code: code || name }),
          name,
          city: city || null,
          centerLat: centerLat === '' ? null : Number(centerLat),
          centerLng: centerLng === '' ? null : Number(centerLng),
          radiusKm: radiusKm === '' ? null : Number(radiusKm),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d?.error ?? 'Save failed.');
        return;
      }
      onSaved(initial ? `Updated territory "${name}".` : `Created territory "${name}".`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-bold text-[var(--text-main)]">{initial ? `Edit Territory · ${initial.name}` : 'Add Service Territory'}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-[var(--text-muted)]"><X className="w-4 h-4" /></button>
        </div>
        {err && <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{err}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Territory Name *</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dubai Marina"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!initial} placeholder="Auto (e.g. DXB_MARINA)"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm font-mono uppercase text-[var(--text-main)] disabled:opacity-60" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">City / Emirate</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Dubai"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Radius (km)</span>
            <input type="number" min={0} step="0.5" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} placeholder="15"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Center Latitude</span>
            <input type="number" step="0.0001" value={centerLat} onChange={(e) => setCenterLat(e.target.value)} placeholder="25.0805"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm font-mono text-[var(--text-main)]" />
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Center Longitude</span>
            <input type="number" step="0.0001" value={centerLng} onChange={(e) => setCenterLng(e.target.value)} placeholder="55.1403"
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-sm font-mono text-[var(--text-main)]" />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)]">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Territory'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Granular FSM RBAC Panel ──────────────────────────────────────────────────

function RbacPanel({
  scopes,
  territories,
  teams,
  tenantUsers,
  onRevoke,
  onGranted,
  onError,
}: {
  scopes: FsmUserScope[];
  territories: FsmTerritory[];
  teams: FsmTeam[];
  tenantUsers: TenantUserOption[];
  onRevoke: (s: FsmUserScope) => void;
  onGranted: () => void;
  onError: (msg: string) => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [manualUserId, setManualUserId] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [fsmRole, setFsmRole] = useState<FsmRole>('FSM_DISPATCHER');
  const [territoryId, setTerritoryId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosenUser = tenantUsers.find((u) => u.id === selectedUserId);
    const uid = chosenUser?.id || manualUserId.trim();
    if (!uid) {
      onError('Select a user or enter a user ID.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/service-tickets/rbac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: uid,
          userEmail: chosenUser?.email || manualEmail.trim() || null,
          userName: chosenUser?.fullName || chosenUser?.name || null,
          fsmRole,
          territoryId: territoryId || null,
          teamId: teamId || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(d?.error ?? 'Failed to grant FSM role scope.');
        return;
      }
      setSelectedUserId('');
      setManualUserId('');
      setManualEmail('');
      onGranted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Grant form */}
      <form onSubmit={(e) => void grant(e)} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-main)]">Grant Granular FSM Role &amp; Territory/Team Scope</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 text-xs">
          {tenantUsers.length > 0 ? (
            <label className="space-y-1">
              <span className="font-semibold uppercase text-[var(--text-muted)]">Staff User *</span>
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-2 text-xs text-[var(--text-main)]">
                <option value="">Select user…</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName || u.name || u.email} ({u.email})</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="space-y-1">
              <span className="font-semibold uppercase text-[var(--text-muted)]">User ID &amp; Email *</span>
              <div className="flex gap-1">
                <input value={manualUserId} onChange={(e) => setManualUserId(e.target.value)} placeholder="User ID"
                  className="w-1/2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2 py-2 text-xs text-[var(--text-main)]" />
                <input value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="Email"
                  className="w-1/2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2 py-2 text-xs text-[var(--text-main)]" />
              </div>
            </label>
          )}
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">FSM Role *</span>
            <select value={fsmRole} onChange={(e) => setFsmRole(e.target.value as FsmRole)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-2 text-xs text-[var(--text-main)]">
              {FSM_ROLES.map((r) => <option key={r} value={r}>{FSM_ROLE_META[r].label} ({r})</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Territory Scope</span>
            <select value={territoryId} onChange={(e) => setTerritoryId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-2 text-xs text-[var(--text-main)]">
              <option value="">All territories</option>
              {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-semibold uppercase text-[var(--text-muted)]">Team Scope</span>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-2.5 py-2 text-xs text-[var(--text-main)]">
              <option value="">All teams</option>
              {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] text-[var(--text-muted)]">{FSM_ROLE_META[fsmRole].description}</p>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50">
            <ShieldCheck className="w-3.5 h-3.5" /> {busy ? 'Granting…' : 'Grant Role Scope'}
          </button>
        </div>
      </form>

      {/* Active Scopes Table */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Assigned FSM Role Scopes ({scopes.length})
        </div>
        {scopes.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            No granular FSM scopes assigned yet — Tenant Admins and Operations Managers retain default full tenant access.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {scopes.map((s) => (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[var(--text-main)]">{s.userName || s.userEmail || s.userId}</span>
                    {s.userEmail && <span className="text-[var(--text-muted)]">{s.userEmail}</span>}
                    <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-semibold">
                      {FSM_ROLE_META[s.fsmRole]?.label ?? s.fsmRole}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Territory: <strong>{s.territoryName ?? 'All territories'}</strong> · Team: <strong>{s.teamName ?? 'All teams'}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(s)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
