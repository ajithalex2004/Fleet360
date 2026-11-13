'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  formatRacPortalRole,
  useRacPortal,
  type RacPortalUiRole,
} from '../rac-portal-shell';

interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  hasPassword: boolean;
  isActive: boolean;
  role: RacPortalUiRole;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function RacPortalTeamPage() {
  const { me } = useRacPortal();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<RacPortalUiRole>('RAC_B2B_BOOKER');
  const [inviting, setInviting] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [emailDispatched, setEmailDispatched] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/rac-portal/team', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error ?? 'Failed to load corporate team members.');
        return;
      }
      setMembers(data?.users ?? []);
      setCanManage(Boolean(data?.canManage));
    } catch {
      setLoadError('Network error while loading corporate team members.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setInviteLink(null);
    setEmailDispatched(null);
    try {
      const res = await fetch('/api/rac-portal/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          role,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Failed to invite colleague.');
        return;
      }
      const setupUrl = data?.invitation?.setupUrl as string | undefined;
      if (setupUrl) {
        const fullUrl =
          typeof window !== 'undefined' && setupUrl.startsWith('/')
            ? `${window.location.origin}${setupUrl}`
            : setupUrl;
        setInviteLink(fullUrl);
      }
      setEmailDispatched(Boolean(data?.invitation?.emailDispatched));
      setEmail('');
      setFullName('');
      setPhone('');
      await loadTeam();
    } catch {
      setError('Network error while sending corporate invitation.');
    } finally {
      setInviting(false);
    }
  };

  const toggleActive = async (userId: string, nextActive: boolean) => {
    setBusyMemberId(userId);
    setError(null);
    try {
      const res = await fetch('/api/rac-portal/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isActive: nextActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Failed to update team member status.');
        return;
      }
      await loadTeam();
    } catch {
      setError('Network error while updating team member status.');
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleResendInvite = async (member: TeamMember) => {
    setBusyMemberId(member.id);
    setError(null);
    try {
      const res = await fetch('/api/rac-portal/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.id, resendInvite: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Failed to regenerate invitation link.');
        return;
      }
      const setupUrl = data?.invitation?.setupUrl as string | undefined;
      if (setupUrl) {
        const fullUrl =
          typeof window !== 'undefined' && setupUrl.startsWith('/')
            ? `${window.location.origin}${setupUrl}`
            : setupUrl;
        setInviteLink(fullUrl);
      }
      setEmailDispatched(Boolean(data?.invitation?.emailDispatched));
      await loadTeam();
    } catch {
      setError('Network error while resending invitation.');
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Remove ${member.fullName || member.email} from your corporate B2B portal team?`,
      )
    ) {
      return;
    }
    setBusyMemberId(member.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/rac-portal/team?userId=${encodeURIComponent(member.id)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Failed to remove team member.');
        return;
      }
      await loadTeam();
    } catch {
      setError('Network error while removing team member.');
    } finally {
      setBusyMemberId(null);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Users className="w-6 h-6 text-violet-400" />
          Corporate Team Access
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Manage viewers, authorized bookers, finance signatories, and B2B mobility administrators for{' '}
          <span className="text-slate-200 font-semibold">
            {me?.customer.companyName ?? me?.customer.fullName}
          </span>
          .
        </p>
      </div>

      {loadError && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 text-rose-200 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            {loadError}
          </span>
          <button
            type="button"
            onClick={() => void loadTeam()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 font-bold shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {canManage && (
        <form
          onSubmit={handleInvite}
          className="rounded-2xl border border-white/10 bg-slate-900/90 p-6 space-y-4 shadow-xl"
        >
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-cyan-400" />
            Invite Colleague to Corporate Portal
          </h2>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {inviteLink && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  Single-Use Onboarding Link Generated (Valid 7 Days)
                </p>
                {emailDispatched !== null && (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                      emailDispatched
                        ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                    }`}
                  >
                    <Mail className="w-3 h-3" />
                    {emailDispatched
                      ? 'Onboarding Email Dispatched'
                      : 'Email Not Configured — Share Link Manually'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteLink}
                  className="flex-1 rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-xs font-mono text-cyan-300"
                />
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-bold shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy Link'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Colleague Full Name"
              className="rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white"
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.ae"
              className="rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+971 50 000 0000"
              className="rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RacPortalUiRole)}
              className="rounded-xl bg-slate-800 border border-white/10 px-3.5 py-2.5 text-sm text-white"
            >
              <option value="RAC_B2B_VIEWER">Corporate Viewer (Read-Only)</option>
              <option value="RAC_B2B_BOOKER">Corporate Booker (Reservations &amp; Holds)</option>
              <option value="RAC_B2B_FINANCE">Corporate Finance (Sign &amp; Pay Invoices)</option>
              <option value="RAC_B2B_ADMIN">Corporate B2B Admin (Full Access)</option>
            </select>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={inviting}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white text-xs font-bold disabled:opacity-50"
            >
              {inviting ? 'Creating Invitation…' : 'Send Corporate Invite'}
            </button>
          </div>
        </form>
      )}

      {/* Team Table */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/85 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-xs text-slate-500">Loading team members…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3.5">Member</th>
                  <th className="px-4 py-3.5">Role</th>
                  <th className="px-4 py-3.5">Onboarding</th>
                  <th className="px-4 py-3.5">Last Login</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                  {canManage && <th className="px-4 py-3.5 text-right">Manage</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {members.map((m) => {
                  const roleMeta = formatRacPortalRole(m.role);
                  const isBusy = busyMemberId === m.id;
                  return (
                    <tr key={m.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-white">{m.fullName ?? '—'}</div>
                        <div className="text-xs text-slate-400 font-mono">{m.email}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${roleMeta.badgeClass}`}
                        >
                          {roleMeta.fullLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        {m.hasPassword ? (
                          <span className="text-emerald-300">Password Active</span>
                        ) : (
                          <span className="text-amber-300">Pending Invite Setup</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-400">
                        {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString('en-AE') : 'Never'}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            m.isActive
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {m.isActive ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3.5 text-right">
                          {m.id !== me?.user.id && (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {!m.hasPassword && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleResendInvite(m)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-semibold text-cyan-200 disabled:opacity-50"
                                  title="Regenerate and resend onboarding invitation"
                                >
                                  <Send className="w-3 h-3" />
                                  Resend Invite
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void toggleActive(m.id, !m.isActive)}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs text-slate-200 disabled:opacity-50"
                              >
                                {m.isActive ? 'Deactivate' : 'Reactivate'}
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleRemoveMember(m)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-semibold text-rose-200 disabled:opacity-50"
                                title="Remove corporate portal user"
                              >
                                <Trash2 className="w-3 h-3" />
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
