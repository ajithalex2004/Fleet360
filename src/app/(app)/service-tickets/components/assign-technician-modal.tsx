'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  X,
  Search,
  UserCheck,
  Users,
  Mail,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  ShieldAlert,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import {
  getCertificationStatus,
  scoreTechnicianForAssignment,
  type FsmTeam,
  type FsmTechnician,
} from '@/lib/service-tickets/workforce';

export interface AssignSelection {
  assignedTo: string;
  primaryTechnicianId: string | null;
  assignedTeamId: string | null;
  territoryId: string | null;
  displayLabel: string;
}

interface AssignTechnicianModalProps {
  isOpen: boolean;
  mode: 'Assigned' | 'Escalated';
  ticketLabel: string;
  department?: string | null;
  currentAssignee?: string | null;
  onClose: () => void;
  onConfirm: (selection: AssignSelection) => Promise<void> | void;
}

const AVAIL_BADGE: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  ON_JOB: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  EN_ROUTE: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  ON_BREAK: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  OFF_SHIFT: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
  ON_LEAVE: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
};

export function AssignTechnicianModal({
  isOpen,
  mode,
  ticketLabel,
  department,
  currentAssignee,
  onClose,
  onConfirm,
}: AssignTechnicianModalProps) {
  const [tab, setTab] = useState<'technicians' | 'teams' | 'email'>('technicians');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [technicians, setTechnicians] = useState<FsmTechnician[]>([]);
  const [teams, setTeams] = useState<FsmTeam[]>([]);
  const [search, setSearch] = useState('');
  const [customEmail, setCustomEmail] = useState(currentAssignee ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setCustomEmail(currentAssignee ?? '');
    setSearch('');
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      fetch('/api/service-tickets/technicians?activeOnly=true').then((r) => (r.ok ? r.json() : { technicians: [] })),
      fetch('/api/service-tickets/teams').then((r) => (r.ok ? r.json() : { teams: [] })),
    ])
      .then(([techRes, teamRes]) => {
        if (cancelled) return;
        const tList: FsmTechnician[] = Array.isArray(techRes.technicians) ? techRes.technicians : [];
        const tmList: FsmTeam[] = Array.isArray(teamRes.teams) ? teamRes.teams.filter((x: FsmTeam) => x.isActive) : [];
        setTechnicians(tList);
        setTeams(tmList);
        if (tList.length === 0 && tmList.length > 0) setTab('teams');
        else if (tList.length === 0 && tmList.length === 0) setTab('email');
        else setTab('technicians');
      })
      .catch(() => {
        if (!cancelled) setTab('email');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentAssignee]);

  const rankedTechs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return technicians
      .filter((t) => {
        if (!q) return true;
        return (
          t.fullName.toLowerCase().includes(q) ||
          t.email.toLowerCase().includes(q) ||
          t.employeeCode.toLowerCase().includes(q) ||
          t.primaryDepartment.toLowerCase().includes(q) ||
          t.skills.some((s) => s.skillName.toLowerCase().includes(q) || s.skillCode.toLowerCase().includes(q))
        );
      })
      .map((tech) => ({
        tech,
        rec: scoreTechnicianForAssignment({ tech, department }),
      }))
      .sort((a, b) => Number(b.rec.eligible) - Number(a.rec.eligible) || b.rec.score - a.rec.score);
  }, [technicians, search, department]);

  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (tm) =>
        tm.name.toLowerCase().includes(q) ||
        tm.code.toLowerCase().includes(q) ||
        tm.departmentKey.toLowerCase().includes(q) ||
        (tm.territoryName ?? '').toLowerCase().includes(q),
    );
  }, [teams, search]);

  if (!isOpen) return null;

  const submitSelection = async (sel: AssignSelection) => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(sel);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assignment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCustomEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    await submitSelection({
      assignedTo: trimmed,
      primaryTechnicianId: null,
      assignedTeamId: null,
      territoryId: null,
      displayLabel: trimmed,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
              {mode === 'Escalated' ? (
                <ShieldAlert className="w-4 h-4 text-rose-500" />
              ) : (
                <UserCheck className="w-4 h-4 text-violet-500" />
              )}
              {mode === 'Escalated' ? 'Escalate' : 'Assign'} {ticketLabel}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Select a qualified technician, dispatch to a persistent team/squad, or enter an email directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3 flex-wrap">
          <button
            type="button"
            onClick={() => setTab('technicians')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'technicians'
                ? 'bg-violet-600 text-white'
                : 'bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)]'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" /> Technicians ({technicians.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('teams')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'teams'
                ? 'bg-violet-600 text-white'
                : 'bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)]'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Teams / Squads ({teams.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('email')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'email'
                ? 'bg-violet-600 text-white'
                : 'bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] border border-[var(--border-subtle)]'
            }`}
          >
            <Mail className="w-3.5 h-3.5" /> Direct Email
          </button>
          <Link
            href="/service-tickets/technicians"
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300 hover:underline"
          >
            Manage roster <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-3">
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {tab !== 'email' && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'technicians' ? 'Search by name, code, skill, or department…' : 'Search teams or territories…'}
                className="w-full bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-lg pl-9 pr-3 py-2 text-xs text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          )}

          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading workforce roster…
            </div>
          ) : tab === 'technicians' ? (
            rankedTechs.length === 0 ? (
              <div className="py-10 text-center space-y-2 text-xs text-[var(--text-muted)]">
                <p>No active technicians match your search yet.</p>
                <div className="flex items-center justify-center gap-3">
                  <Link
                    href="/service-tickets/technicians"
                    className="px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold"
                  >
                    + Add Technicians
                  </Link>
                  <button
                    type="button"
                    onClick={() => setTab('email')}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] font-semibold"
                  >
                    Assign by email instead
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {rankedTechs.map(({ tech, rec }) => {
                  const primaryTerr = tech.territories.find((x) => x.isPrimary) ?? tech.territories[0];
                  return (
                    <div
                      key={tech.id}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 flex items-start justify-between gap-3 hover:border-violet-500/40 transition-colors"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-[var(--text-main)]">{tech.fullName}</span>
                          <span className="text-[10px] font-mono text-[var(--text-faint)]">{tech.employeeCode}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${AVAIL_BADGE[tech.availabilityStatus] ?? ''}`}>
                            {tech.availabilityStatus.replace('_', ' ')}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
                            Match {rec.score}%
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)] flex items-center gap-3 flex-wrap">
                          <span>{tech.email}</span>
                          <span>· {tech.primaryDepartment}</span>
                          {primaryTerr && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {primaryTerr.territoryName}
                            </span>
                          )}
                        </div>
                        {tech.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {tech.skills.slice(0, 6).map((s) => {
                              const cert = getCertificationStatus(s);
                              const tone =
                                s.isCertification && cert.status === 'EXPIRED'
                                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                                  : s.isCertification && cert.status === 'EXPIRING_SOON'
                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-subtle)]';
                              return (
                                <span key={s.id} className={`px-2 py-0.5 rounded text-[10px] border ${tone}`}>
                                  {s.skillName}
                                  {s.isCertification && cert.status === 'EXPIRED' ? ' (Expired)' : ''}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {rec.warnings.length > 0 && (
                          <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>{rec.warnings.join(' · ')}</span>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          void submitSelection({
                            assignedTo: tech.email,
                            primaryTechnicianId: tech.id,
                            assignedTeamId: null,
                            territoryId: primaryTerr?.territoryId ?? null,
                            displayLabel: `${tech.fullName} (${tech.email})`,
                          })
                        }
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Select
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === 'teams' ? (
            filteredTeams.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--text-muted)] space-y-2">
                <p>No active teams/squads configured yet.</p>
                <Link
                  href="/service-tickets/technicians"
                  className="inline-flex px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold"
                >
                  + Create Team
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTeams.map((tm) => (
                  <div
                    key={tm.id}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 flex items-start justify-between gap-3 hover:border-violet-500/40"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[var(--text-main)]">{tm.name}</span>
                        <span className="text-[10px] font-mono text-[var(--text-faint)]">{tm.code}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 font-semibold">
                          {tm.members.length} member(s)
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">
                        Dept: {tm.departmentKey}
                        {tm.territoryName ? ` · Zone: ${tm.territoryName}` : ''}
                        {tm.leadTechnicianName ? ` · Lead: ${tm.leadTechnicianName}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        void submitSelection({
                          assignedTo: tm.leadTechnicianEmail || tm.members[0]?.email || `${tm.code.toLowerCase()}@team.local`,
                          primaryTechnicianId: tm.leadTechnicianId ?? tm.members[0]?.technicianId ?? null,
                          assignedTeamId: tm.id,
                          territoryId: tm.territoryId,
                          displayLabel: `Team ${tm.name}${tm.leadTechnicianName ? ` (Lead: ${tm.leadTechnicianName})` : ''}`,
                        })
                      }
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
                    >
                      <Users className="w-3.5 h-3.5" /> Assign Team
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <form onSubmit={(e) => void handleCustomEmailSubmit(e)} className="space-y-3 pt-1">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Assignee Email Address
                </label>
                <input
                  type="email"
                  required
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  placeholder="technician@company.ae"
                  className="w-full bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <p className="text-[11px] text-[var(--text-faint)]">
                  Use this for ad-hoc escalations or contacts not yet in the Technician Roster.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : mode === 'Escalated' ? 'Escalate Ticket' : 'Assign Ticket'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
