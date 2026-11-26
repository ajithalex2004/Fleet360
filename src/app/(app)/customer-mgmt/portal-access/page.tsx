'use client';

/**
 * Customer Management → Customer Portal access.
 *
 * Onboarding: choose which portals each customer gets (Field Service,
 * Transport) and invite the customer's users. An invite produces a
 * single-use setup link (valid 7 days) to send to the user.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Users, Mail, Copy, X, UserPlus, Check } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, SelectInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';

type Portal = 'FSM' | 'TRANSPORT';
interface CustomerRow { customerId: string; code: string | null; name: string; status: string | null; portals: Portal[]; activeUsers: number; invitedUsers: number }
interface PortalUser { id: string; email: string; fullName: string | null; mobile: string | null; role: 'ADMIN' | 'REQUESTER' | 'VIEWER'; isActive: boolean; hasPassword: boolean; lastLoginAt: string | null }

const ROLE_HELP: Record<PortalUser['role'], string> = {
  ADMIN: 'Admin: raise requests, manage sites, equipment and inventory',
  REQUESTER: 'Requester: raise and track requests',
  VIEWER: 'Viewer: track requests only',
};

export default function CustomerPortalAccessPage() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [managing, setManaging] = useState<CustomerRow | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/customers/portal-access', { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load customers'); return; }
    setRows(d.customers); setCanEdit(!!d.canEdit);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (c: CustomerRow, portal: Portal) => {
    setErr(null);
    const enabled = !c.portals.includes(portal);
    const res = await fetch('/api/customers/portal-access', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: c.customerId, portal, enabled }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not update portal access'); return; }
    void load();
  }, [load]);

  const columns = useMemo<SmartDataGridColumn<CustomerRow>[]>(() => {
    const portalCol = (portal: Portal, header: string): SmartDataGridColumn<CustomerRow> => ({
      key: portal, header, align: 'center', filter: 'select',
      accessor: (c) => (c.portals.includes(portal) ? 'Enabled' : 'Off'),
      render: (c) => (
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={c.portals.includes(portal)} disabled={!canEdit} onChange={() => void toggle(c, portal)}
            aria-label={`${header} for ${c.name}`} className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" />
          {c.portals.includes(portal) ? 'Enabled' : 'Off'}
        </label>
      ),
    });
    return [
      { key: 'code', header: 'Customer ID', accessor: (c) => c.code ?? '', render: (c) => <span className="font-mono text-[11px]">{c.code ?? '—'}</span> },
      { key: 'name', header: 'Customer', accessor: (c) => c.name, render: (c) => <span className="text-xs font-semibold">{c.name}</span> },
      portalCol('FSM', 'Field Service portal'),
      portalCol('TRANSPORT', 'Transport portal'),
      { key: 'users', header: 'Portal users', align: 'center', filter: false, accessor: (c) => c.activeUsers, render: (c) => <span className="text-xs">{c.activeUsers} active{c.invitedUsers ? ` · ${c.invitedUsers} invited` : ''}</span> },
      {
        key: 'actions', header: '', filter: false, sortable: false,
        render: (c) => <SecondaryButton icon={Users} onClick={(e) => { e.stopPropagation(); setManaging(c); }}>Manage users</SecondaryButton>,
      },
    ];
  }, [canEdit, toggle]);

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader title="Customer Portal access" icon={KeyRound} accent="blue"
        subtitle="Choose which portals each customer gets and invite their users. Customers sign in at /customer-portal." />
      {err && <FormAlert>{err}</FormAlert>}
      {!canEdit && rows && <FormAlert tone="info">View only. A tenant admin can change portal access and invite users.</FormAlert>}
      <SmartDataGrid<CustomerRow>
        rows={rows ?? []} columns={columns} getRowId={(c) => c.customerId} loading={!rows}
        emptyMessage="No customers yet. Add customers in Customer Management first."
        toolbar={{ title: 'Customers', exportName: 'customer-portal-access' }}
      />
      {managing && <UsersPanel customer={managing} canEdit={canEdit} onClose={() => { setManaging(null); void load(); }} />}
    </div>
  );
}

function UsersPanel({ customer, canEdit, onClose }: { customer: CustomerRow; canEdit: boolean; onClose: () => void }) {
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', mobile: '', role: 'REQUESTER' as PortalUser['role'] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/portal-users?customerId=${encodeURIComponent(customer.customerId)}`, { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.ok) setUsers(d.users); else setErr(d?.error ?? 'Could not load users');
  }, [customer.customerId]);
  useEffect(() => { void load(); }, [load]);

  const invite = async (email = form.email, fullName = form.fullName, mobile = form.mobile, role = form.role) => {
    setErr(null); setLink(null); setCopied(false);
    setBusy(true);
    try {
      const res = await fetch('/api/customers/portal-users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.customerId, email, fullName, mobile, role }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not invite the user'); return; }
      setLink({ url: d.setupUrl, email: d.user.email, expiresAt: d.expiresAt });
      setForm({ email: '', fullName: '', mobile: '', role: 'REQUESTER' });
      void load();
    } finally { setBusy(false); }
  };

  const update = async (u: PortalUser, patch: { isActive?: boolean; role?: string }) => {
    setErr(null);
    const res = await fetch('/api/customers/portal-users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: u.id, ...patch }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not update the user'); return; }
    void load();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`Portal users for ${customer.name}`}>
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-[var(--bg-main)] p-4 space-y-4">
        <FormPanel title={`Portal users — ${customer.name}`} subtitle={`Customer ID ${customer.code ?? '—'} · ${customer.portals.length ? customer.portals.map((p) => (p === 'FSM' ? 'Field Service' : 'Transport')).join(', ') : 'No portal enabled yet'}`}
          icon={Users} actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          {customer.portals.length === 0 && <FormAlert tone="warning">Enable at least one portal for this customer, or invited users will not be able to sign in.</FormAlert>}
          {link && (
            <FormAlert tone="info">
              <span className="block font-semibold">Invite ready for {link.email}</span>
              <span className="block">Send this link to the user. It works once and expires {new Date(link.expiresAt).toLocaleDateString()}.</span>
              <span className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-[var(--bg-main)] px-2 py-1 text-[11px]">{link.url}</code>
                <SecondaryButton icon={copied ? Check : Copy} onClick={() => { void navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</SecondaryButton>
              </span>
            </FormAlert>
          )}

          <FormSection title="Users" icon={Users} columns={1}>
            {!users && <p className="text-[var(--text-muted)]">Loading…</p>}
            {users?.length === 0 && <p className="text-[var(--text-muted)]">No portal users yet.</p>}
            <div className="divide-y divide-[var(--border-subtle)]">
              {users?.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{u.fullName ?? u.email}{!u.isActive && <span className="text-rose-500"> · deactivated</span>}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{u.email} · {u.hasPassword ? (u.lastLoginAt ? `last sign-in ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'never signed in') : 'invite pending'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SelectInput value={u.role} disabled={!canEdit} onChange={(e) => void update(u, { role: e.target.value })} className="!w-32" aria-label={`Role for ${u.email}`}>
                      <option value="ADMIN">Admin</option><option value="REQUESTER">Requester</option><option value="VIEWER">Viewer</option>
                    </SelectInput>
                    {canEdit && !u.hasPassword && u.isActive && (
                      <SecondaryButton icon={Mail} onClick={() => void invite(u.email, u.fullName ?? '', u.mobile ?? '', u.role)}>New link</SecondaryButton>
                    )}
                    {canEdit && (
                      <SecondaryButton onClick={() => void update(u, { isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</SecondaryButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </FormSection>

          {canEdit && (
            <form onSubmit={(e) => { e.preventDefault(); void invite(); }}>
              <FormSection title="Invite a user" icon={UserPlus} columns={2}>
                <FormField label="Email" required><TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" required /></FormField>
                <FormField label="Full name"><TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></FormField>
                <FormField label="Mobile"><TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+971 5x xxx xxxx" /></FormField>
                <FormField label="Role" hint={ROLE_HELP[form.role]}>
                  <SelectInput value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PortalUser['role'] })}>
                    <option value="ADMIN">Admin</option><option value="REQUESTER">Requester</option><option value="VIEWER">Viewer</option>
                  </SelectInput>
                </FormField>
              </FormSection>
              <div className="mt-3">
                <FormFooter><PrimaryButton type="submit" icon={UserPlus} busy={busy}>{busy ? 'Inviting…' : 'Invite user'}</PrimaryButton></FormFooter>
              </div>
            </form>
          )}
        </FormPanel>
      </div>
    </div>
  );
}
