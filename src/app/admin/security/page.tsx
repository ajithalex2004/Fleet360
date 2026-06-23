'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRound, MonitorX, RefreshCw, ShieldCheck } from 'lucide-react';

interface SecuritySummary {
  mfa: { totalUsers: number; enabledUsers: number; adminUsers: number; adminUsersWithoutMfa: number };
  policy: {
    enforcedAtLogin: boolean;
    note: string;
    platform?: MfaPolicy;
    tenant?: MfaPolicy | null;
  };
  loginSecurity?: {
    failedLogins24h: number;
    lockedAccounts: number;
    recentFailures: LoginFailure[];
  };
}

interface MfaPolicy {
  scope: 'PLATFORM' | 'TENANT';
  tenantId: string | null;
  requireAllUsers: boolean;
  requireAdminRoles: boolean;
  requiredRoleCodes: string[];
  gracePeriodHours: number;
  isEnabled: boolean;
}

interface SessionRecord {
  id: string;
  userId: string;
  userEmail: string | null;
  role: string | null;
  tenantId: string;
  tenantName: string | null;
  plan: string | null;
  impersonatedBy: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

interface LoginFailure {
  email: string;
  tenantId: string | null;
  userId: string | null;
  failureReason: string | null;
  ipAddress: string | null;
  lockedUntil: string | null;
  occurredAt: string;
}

export default function AdminSecurityPage() {
  const [data, setData] = useState<SecuritySummary | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMsg, setPolicyMsg] = useState('');
  const [sessionMsg, setSessionMsg] = useState('');
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/security/summary');
      setData(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch('/api/admin/security/sessions?limit=50');
      const body = res.ok ? await res.json() : { sessions: [] };
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadSessions();
  }, []);

  const mfaPct = data?.mfa.totalUsers ? Math.round((data.mfa.enabledUsers / data.mfa.totalUsers) * 100) : 0;
  const platformPolicy = data?.policy.platform;

  const savePlatformPolicy = async (patch: Partial<MfaPolicy>) => {
    const current = platformPolicy ?? {
      scope: 'PLATFORM' as const,
      tenantId: null,
      requireAllUsers: false,
      requireAdminRoles: true,
      requiredRoleCodes: [],
      gracePeriodHours: 0,
      isEnabled: false,
    };
    setSavingPolicy(true);
    setPolicyMsg('');
    try {
      const res = await fetch('/api/admin/security/mfa-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...current, ...patch, scope: 'PLATFORM' }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 428) {
        setPolicyMsg(`Policy update queued for approval: ${body.approvalRequest?.id ?? 'pending request'}. Approve it, then retry this change.`);
        return;
      }
      if (!res.ok) {
        setPolicyMsg(body.error ?? 'Policy update failed');
        return;
      }
      setPolicyMsg('MFA policy updated.');
      await load();
    } finally {
      setSavingPolicy(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    setSessionMsg('');
    try {
      const res = await fetch(`/api/admin/security/sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 428) {
        setSessionMsg(`Revocation queued for approval: ${body.approvalRequest?.id ?? 'pending request'}. Approve it, then retry revoke.`);
        return;
      }
      if (!res.ok) {
        setSessionMsg(body.error ?? 'Session revocation failed.');
        return;
      }
      setSessionMsg('Session revoked.');
      await loadSessions();
    } finally {
      setRevokingSessionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Security Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">MFA coverage, policy posture, and recent active-session evidence.</p>
        </div>
        <button onClick={() => { void load(); void loadSessions(); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-white">
          <RefreshCw className={`w-4 h-4 ${loading || sessionsLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Panel icon={<ShieldCheck className="w-5 h-5" />} label="MFA Coverage" value={`${mfaPct}%`} sub={`${data?.mfa.enabledUsers ?? 0}/${data?.mfa.totalUsers ?? 0} users enrolled`} />
        <Panel icon={<KeyRound className="w-5 h-5" />} label="Admins Without MFA" value={String(data?.mfa.adminUsersWithoutMfa ?? 0)} sub={`${data?.mfa.adminUsers ?? 0} admin user(s) detected`} warn={(data?.mfa.adminUsersWithoutMfa ?? 0) > 0} />
        <Panel icon={<MonitorX className="w-5 h-5" />} label="Active Sessions" value={String(sessions.filter(s => s.status === 'ACTIVE').length)} sub={sessionsLoading ? 'Loading sessions...' : `${sessions.length} recent session(s)`} />
        <Panel icon={<KeyRound className="w-5 h-5" />} label="Failed Logins" value={String(data?.loginSecurity?.failedLogins24h ?? 0)} sub={`${data?.loginSecurity?.lockedAccounts ?? 0} account(s) locked`} warn={(data?.loginSecurity?.lockedAccounts ?? 0) > 0} />
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">MFA Enforcement</h2>
            <p className="text-sm text-slate-400 mt-1">{data?.policy.note ?? 'Loading policy posture...'}</p>
          </div>
          <Link href="/admin/security/mfa" className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm text-white">
            My MFA
          </Link>
        </div>
        {!data?.policy.enforcedAtLogin && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            No mandatory MFA policy is enabled. Enable one below to block matching unenrolled users at login.
          </div>
        )}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <input
              type="checkbox"
              checked={!!platformPolicy?.isEnabled}
              disabled={savingPolicy}
              onChange={e => savePlatformPolicy({ isEnabled: e.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-white">Enable platform MFA policy</span>
              <span className="block text-xs text-slate-400 mt-1">Applies to every tenant unless narrowed by role choices.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <input
              type="checkbox"
              checked={platformPolicy?.requireAdminRoles !== false}
              disabled={savingPolicy}
              onChange={e => savePlatformPolicy({ requireAdminRoles: e.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-white">Require MFA for admin roles</span>
              <span className="block text-xs text-slate-400 mt-1">Matches SUPER_ADMIN and TENANT_ADMIN logins.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <input
              type="checkbox"
              checked={!!platformPolicy?.requireAllUsers}
              disabled={savingPolicy}
              onChange={e => savePlatformPolicy({ requireAllUsers: e.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-white">Require MFA for all users</span>
              <span className="block text-xs text-slate-400 mt-1">Stronger than admin-only. Enforces for every role.</span>
            </span>
          </label>
          <label className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
            <span className="block text-sm font-semibold text-white">Grace period hours</span>
            <input
              type="number"
              min={0}
              value={platformPolicy?.gracePeriodHours ?? 0}
              disabled={savingPolicy}
              onChange={e => savePlatformPolicy({ gracePeriodHours: Number(e.target.value || 0) })}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>
        {policyMsg && <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">{policyMsg}</div>}
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Recent Active Sessions</h2>
          {sessionMsg && <p className="text-sm text-blue-200 mt-1">{sessionMsg}</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/60 text-slate-400">
              <tr>
                <th className="text-left px-5 py-3">User</th>
                <th className="text-left px-5 py-3">Role</th>
                <th className="text-left px-5 py-3">Tenant</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Last Seen</th>
                <th className="text-left px-5 py-3">IP</th>
                <th className="text-right px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-white/5">
                  <td className="px-5 py-3">
                    <div className="text-slate-200">{s.userEmail ?? s.userId}</div>
                    <div className="font-mono text-[11px] text-slate-500">{s.id.slice(0, 12)}</div>
                    {s.impersonatedBy && <div className="text-[11px] text-amber-300">Impersonated</div>}
                  </td>
                  <td className="px-5 py-3 text-slate-300">{s.role ?? '-'}</td>
                  <td className="px-5 py-3">
                    <div className="text-slate-300">{s.tenantName ?? s.tenantId}</div>
                    <div className="font-mono text-[11px] text-slate-500">{s.tenantId}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs ${
                      s.status === 'ACTIVE'
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : s.status === 'REVOKED'
                          ? 'bg-rose-500/15 text-rose-200'
                          : 'bg-slate-700 text-slate-300'
                    }`}>
                      {s.status}
                    </span>
                    {s.revokeReason && <div className="mt-1 text-[11px] text-slate-500">{s.revokeReason}</div>}
                  </td>
                  <td className="px-5 py-3 text-slate-300">{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : '-'}</td>
                  <td className="px-5 py-3 text-slate-400">{s.ipAddress ?? '-'}</td>
                  <td className="px-5 py-3 text-right">
                    {s.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        disabled={revokingSessionId === s.id}
                        onClick={() => void revokeSession(s.id)}
                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        {revokingSessionId === s.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">No action</span>
                    )}
                  </td>
                </tr>
              ))}
              {sessionsLoading && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">Loading recent sessions...</td></tr>
              )}
              {!sessionsLoading && sessions.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">No registered sessions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Failed Login & Account Lockout Review</h2>
          <p className="text-sm text-slate-400 mt-1">Recent failed sign-ins and active lockout evidence for the current admin scope.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/60 text-slate-400">
              <tr>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Reason</th>
                <th className="text-left px-5 py-3">Tenant</th>
                <th className="text-left px-5 py-3">IP</th>
                <th className="text-left px-5 py-3">When</th>
                <th className="text-left px-5 py-3">Lockout</th>
              </tr>
            </thead>
            <tbody>
              {(data?.loginSecurity?.recentFailures ?? []).map((failure, idx) => (
                <tr key={`${failure.email}-${failure.occurredAt}-${idx}`} className="border-t border-white/5">
                  <td className="px-5 py-3 text-slate-200">{failure.email}</td>
                  <td className="px-5 py-3 text-slate-300">{failure.failureReason ?? '-'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{failure.tenantId ?? '-'}</td>
                  <td className="px-5 py-3 text-slate-400">{failure.ipAddress ?? '-'}</td>
                  <td className="px-5 py-3 text-slate-300">{failure.occurredAt ? new Date(failure.occurredAt).toLocaleString() : '-'}</td>
                  <td className="px-5 py-3">
                    {failure.lockedUntil ? (
                      <span className="rounded-full bg-rose-500/15 px-2 py-1 text-xs text-rose-200">
                        Until {new Date(failure.lockedUntil).toLocaleTimeString()}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">None</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && (data?.loginSecurity?.recentFailures ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No failed login attempts in this scope.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading failed-login evidence...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Panel({ icon, label, value, sub, warn }: { icon: React.ReactNode; label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`border rounded-2xl p-5 ${warn ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-900/60 border-white/10'}`}>
      <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide">{icon}{label}</div>
      <div className={`mt-3 text-3xl font-bold ${warn ? 'text-amber-300' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-400">{sub}</div>
    </div>
  );
}
