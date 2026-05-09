'use client';

/**
 * /admin/tenants/[id]/invitations
 * Manage member invitations for a tenant. Available to SUPER_ADMIN
 * (any tenant) and TENANT_ADMIN (their own tenant — middleware enforces).
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Send, Trash2, Copy, Check, AlertCircle, ArrowLeft } from 'lucide-react';

interface Invitation {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  invitedBy: string | null;
  expiresAt: string;
  usedAt: string | null;
  revoked: boolean;
  createdAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

interface Role { id: string; name: string; code: string; }

const STATUS_BADGE: Record<Invitation['status'], string> = {
  pending:  'bg-blue-500/20 text-blue-300 border-blue-500/40',
  accepted: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  revoked:  'bg-slate-600/30 text-slate-400 border-slate-500/40',
  expired:  'bg-amber-500/20 text-amber-300 border-amber-500/40',
};

export default function TenantInvitationsPage() {
  const params = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';

  const [tenantName, setTenantName] = useState('');
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail]   = useState('');
  const [roleId, setRoleId] = useState('');
  const [sending, setSending] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const [invRes, tenantRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}/invitations`),
        fetch(`/api/admin/tenants/${tenantId}`),
      ]);
      if (!invRes.ok) {
        const d = await invRes.json().catch(() => ({}));
        throw new Error(d?.error ?? 'Failed to load invitations');
      }
      const invData = await invRes.json();
      setInvitations(invData.invitations ?? []);

      if (tenantRes.ok) {
        const t = await tenantRes.json();
        setTenantName(t?.name ?? '');
        const list: Role[] = (t?.roles ?? []).map((r: { id: string; name: string; code: string }) => ({
          id: r.id, name: r.name, code: r.code,
        }));
        setRoles(list);
        if (!roleId && list.length > 0) {
          const adminRole = list.find(x => x.code === 'TENANT_ADMIN') ?? list[0];
          setRoleId(adminRole.id);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantId, roleId]);

  useEffect(() => { void load(); }, [load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setDevLink(null);
    if (!email.trim() || !roleId) { setError('Email and role are required.'); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), roleId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? 'Could not send invitation.'); return; }
      // SMTP not configured → API returns acceptUrl so dev can copy/paste.
      if (!data.emailed && data.acceptUrl) {
        setDevLink(data.acceptUrl);
      }
      setEmail('');
      await load();
    } catch {
      setError('Network error.');
    } finally {
      setSending(false);
    }
  };

  const revoke = async (inv: Invitation) => {
    if (!window.confirm(`Revoke invitation for ${inv.email}?`)) return;
    const res = await fetch(`/api/admin/tenants/${tenantId}/invitations/${inv.id}/revoke`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d?.error ?? 'Revoke failed');
      return;
    }
    await load();
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading invitations…</div></div>;
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-400" /> Invitations
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {tenantName ? <>For <strong className="text-white">{tenantName}</strong></> : null}
          </p>
        </div>
        <Link href="/admin/tenants"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 border border-white/10 hover:border-white/20 hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Tenants
        </Link>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {devLink && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 text-amber-200 text-sm space-y-2">
          <div className="font-semibold">SMTP not configured — share this link manually:</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-900/60 border border-white/10 rounded px-2 py-1 font-mono text-xs break-all">{devLink}</code>
            <button onClick={() => copy(devLink)}
              className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded text-xs inline-flex items-center gap-1">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={send} className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Invite a new member</h2>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="person@company.com" required
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Role</label>
            <select value={roleId} onChange={e => setRoleId(e.target.value)} required
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {roles.length === 0 && <option value="">No roles found</option>}
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={sending || !roleId}
            className="self-end px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm inline-flex items-center gap-2">
            <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
        <p className="text-xs text-slate-500">Invitations expire after 7 days. Each invite supersedes any earlier pending invite for the same email.</p>
      </form>

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {invitations.length === 0 ? (
          <div className="text-center text-slate-400 py-8 text-sm">No invitations yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Email', 'Role', 'Status', 'Sent', 'Expires', 'Invited by', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-400 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invitations.map(inv => (
                <tr key={inv.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-sm text-white">{inv.email}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{inv.roleName}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[inv.status]}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(inv.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(inv.expiresAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{inv.invitedBy ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {inv.status === 'pending' && (
                      <button onClick={() => revoke(inv)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
