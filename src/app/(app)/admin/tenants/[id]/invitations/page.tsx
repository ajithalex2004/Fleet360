'use client';

/**
 * /admin/tenants/[id]/invitations
 * Manage member invitations for a tenant. Available to SUPER_ADMIN
 * (any tenant) and TENANT_ADMIN (their own tenant — middleware enforces).
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Send, Trash2, AlertCircle, ArrowLeft } from 'lucide-react';
import NewUserDialog from '@/components/admin/NewUserDialog';
import { BACK_BUTTON } from '@/lib/ui/toggle';

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

const STATUS_BADGE: Record<Invitation['status'], string> = {
  pending:  'bg-blue-500/20 text-blue-300 border-blue-500/40',
  accepted: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  revoked:  'bg-[var(--bg-surface-hover)]/30 text-[var(--text-muted)] border-slate-500/40',
  expired:  'bg-amber-500/20 text-amber-300 border-amber-500/40',
};

export default function TenantInvitationsPage() {
  const params = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';

  const [tenantName, setTenantName] = useState('');
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [notice, setNotice]   = useState('');

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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

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

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-[var(--text-muted)] animate-pulse">Loading invitations…</div></div>;
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] inline-flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-400" /> Invitations
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            {tenantName ? <>For <strong className="text-[var(--text-main)]">{tenantName}</strong></> : null}
          </p>
        </div>
        <Link href="/admin/tenants"
          className={`${BACK_BUTTON} shrink-0`}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Tenants
        </Link>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-600 text-sm flex justify-between gap-4">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-main)]">Invite a new member</h2>
          <p className="text-xs text-[var(--text-faint)] mt-1">
            Choose their role, department and module access; they set their own password when they accept.
            Invitations expire after 7 days, and a new one replaces any earlier pending invitation for the same email.
          </p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-semibold text-sm inline-flex items-center gap-2">
          <Send className="w-4 h-4" /> New invitation
        </button>
      </div>
      {showNew && (
        <NewUserDialog
          tenants={[{ id: tenantId, name: tenantName || 'This company' }]}
          defaultTenantId={tenantId}
          defaultOnboarding="invite"
          onClose={() => setShowNew(false)}
          onDone={(message) => { setShowNew(false); setNotice(message); void load(); }}
        />
      )}

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {invitations.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-8 text-sm">No invitations yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {['Email', 'Role', 'Status', 'Sent', 'Expires', 'Invited by', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)] text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invitations.map(inv => (
                <tr key={inv.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]">
                  <td className="px-4 py-3 text-sm text-[var(--text-main)]">{inv.email}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{inv.roleName}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[inv.status]}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{new Date(inv.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{new Date(inv.expiresAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{inv.invitedBy ?? '—'}</td>
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
