'use client';

/**
 * Customer Management → Customer Portal access.
 *
 * Onboarding: choose which portals each customer gets (Field Services,
 * Transport Services), and for Transport which categories (Rent-a-Car,
 * Logistics, …). Then invite the customer's users with a role in each
 * portal. One account per person: giving an existing user another portal
 * keeps their password. A new user gets a single-use setup link (7 days).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Users, Mail, Copy, X, UserPlus, Check, Truck, Save } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, SelectInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';
import {
  PORTAL_LABEL, PORTAL_ROLES, ROLE_LABEL, TRANSPORT_CATEGORIES, TRANSPORT_CATEGORY_LABEL,
  type CustomerPortal, type PortalRole, type TransportCategory,
} from '@/lib/customer-portal/catalog';

interface CustomerRow {
  customerId: string; code: string | null; name: string; status: string | null;
  portals: CustomerPortal[]; transportCategories: TransportCategory[]; activeUsers: number; invitedUsers: number;
}
interface PortalAccount {
  id: string; email: string; fullName: string | null; mobile: string | null; isActive: boolean; hasPassword: boolean;
  lastLoginAt: string | null; roles: Partial<Record<CustomerPortal, PortalRole>>;
}

const ROLE_HELP = 'Admin: requests plus the company\'s sites, assets and users · Requester: raise and track requests · Finance: agreements and invoices, no requests · Viewer: track only';
const PORTALS: CustomerPortal[] = ['FSM', 'TRANSPORT'];

interface SendResult { ok?: boolean; error?: string; setupUrl?: string | null; expiresAt?: string; user?: { email: string } }

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: SendResult | null }> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok && !!data?.ok, data };
}

export default function CustomerPortalAccessPage() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [managing, setManaging] = useState<CustomerRow | null>(null);
  const [pickingCategories, setPickingCategories] = useState<CustomerRow | null>(null);
  const [offered, setOffered] = useState<TransportCategory[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/customers/portal-access', { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load customers'); return; }
    setRows(d.customers); setCanEdit(!!d.canEdit); setOffered(d.offeredCategories ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (c: CustomerRow, portal: CustomerPortal) => {
    setErr(null);
    const enabled = !c.portals.includes(portal);
    // Turning Transport on starts with choosing its categories.
    if (portal === 'TRANSPORT' && enabled) { setPickingCategories(c); return; }
    if (portal === 'TRANSPORT' && !window.confirm(`Turn off Transport Services for ${c.name}? Their users lose Transport access, including the Shipper portal.`)) return;
    const r = await send('/api/customers/portal-access', 'PUT', { customerId: c.customerId, portal, enabled });
    if (!r.ok) { setErr(r.data?.error ?? 'Could not update portal access'); return; }
    void load();
  }, [load]);

  const columns = useMemo<SmartDataGridColumn<CustomerRow>[]>(() => [
    { key: 'code', header: 'Customer ID', accessor: (c) => c.code ?? '', render: (c) => <span className="font-mono text-[11px]">{c.code ?? '—'}</span> },
    { key: 'name', header: 'Customer', accessor: (c) => c.name, render: (c) => <span className="text-xs font-semibold">{c.name}</span> },
    {
      key: 'FSM', header: PORTAL_LABEL.FSM, align: 'center', filter: 'select',
      accessor: (c) => (c.portals.includes('FSM') ? 'Enabled' : 'Off'),
      render: (c) => (
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={c.portals.includes('FSM')} disabled={!canEdit} onChange={() => void toggle(c, 'FSM')}
            aria-label={`${PORTAL_LABEL.FSM} for ${c.name}`} className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" />
          {c.portals.includes('FSM') ? 'Enabled' : 'Off'}
        </label>
      ),
    },
    {
      key: 'TRANSPORT', header: PORTAL_LABEL.TRANSPORT, filter: 'select',
      accessor: (c) => (c.portals.includes('TRANSPORT') ? 'Enabled' : 'Off'),
      render: (c) => {
        const on = c.portals.includes('TRANSPORT');
        return (
          <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={on} disabled={!canEdit} onChange={() => void toggle(c, 'TRANSPORT')}
                aria-label={`${PORTAL_LABEL.TRANSPORT} for ${c.name}`} className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" />
              {on ? '' : 'Off'}
            </label>
            {on && (c.transportCategories.length
              ? c.transportCategories.map((k) => (
                  <span key={k} className="px-1.5 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-[10px] font-semibold text-blue-600">{TRANSPORT_CATEGORY_LABEL[k]}</span>
                ))
              : <span className="text-[10px] font-semibold text-amber-600">No categories</span>)}
            {on && canEdit && (
              <button type="button" onClick={() => setPickingCategories(c)} className="text-[10px] font-semibold text-blue-600 hover:underline">Edit</button>
            )}
          </div>
        );
      },
    },
    { key: 'users', header: 'Portal users', align: 'center', filter: false, accessor: (c) => c.activeUsers, render: (c) => <span className="text-xs">{c.activeUsers} active{c.invitedUsers ? ` · ${c.invitedUsers} invited` : ''}</span> },
    {
      key: 'actions', header: '', filter: false, sortable: false,
      render: (c) => <SecondaryButton icon={Users} onClick={(e) => { e.stopPropagation(); setManaging(c); }}>Manage users</SecondaryButton>,
    },
  ], [canEdit, toggle]);

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader title="Customer Portal access" icon={KeyRound} accent="blue"
        subtitle="Choose the portals and Transport categories each customer gets, and invite their users. Customers sign in at /customer-portal." />
      {err && <FormAlert>{err}</FormAlert>}
      {!canEdit && rows && <FormAlert tone="info">View only. A tenant admin can change portal access and invite users.</FormAlert>}
      <SmartDataGrid<CustomerRow>
        rows={rows ?? []} columns={columns} getRowId={(c) => c.customerId} loading={!rows}
        emptyMessage="No customers yet. Add customers in Customer Management first."
        toolbar={{ title: 'Customers', exportName: 'customer-portal-access' }}
      />
      {managing && <UsersPanel customer={managing} canEdit={canEdit} onClose={() => { setManaging(null); void load(); }} />}
      {pickingCategories && (
        <CategoriesDialog customer={pickingCategories} offered={offered} onClose={() => setPickingCategories(null)}
          onSaved={() => { setPickingCategories(null); void load(); }} />
      )}
    </div>
  );
}

function CategoriesDialog({ customer, offered, onClose, onSaved }: {
  customer: CustomerRow; offered: TransportCategory[]; onClose: () => void; onSaved: () => void;
}) {
  // Categories the tenant offers, plus any the customer already has that are no longer offered.
  const choices = TRANSPORT_CATEGORIES.filter((k) => offered.includes(k) || customer.transportCategories.includes(k));
  const [picked, setPicked] = useState<TransportCategory[]>(customer.transportCategories);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = (k: TransportCategory) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const save = async () => {
    if (picked.length === 0) { setErr('Choose at least one category.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await send('/api/customers/portal-access', 'PUT', { customerId: customer.customerId, portal: 'TRANSPORT', enabled: true, categories: picked });
      if (!r.ok) { setErr(r.data?.error ?? 'Could not save the categories'); return; }
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Transport categories for ${customer.name}`}>
      <div className="w-full max-w-xl">
        <FormPanel title={`Transport Services — ${customer.name}`} subtitle="The vehicle request types this customer can use" icon={Truck}
          actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          {choices.length === 0 && (
            <FormAlert tone="warning">
              Your Transport catalogue offers no categories yet. Turn them on in{' '}
              <Link href="/customer-mgmt/transport-catalog" className="underline">Transport Services catalogue</Link>.
            </FormAlert>
          )}
          <FormSection title="Categories" icon={Truck} columns={2}>
            {choices.map((k) => (
              <label key={k} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs cursor-pointer hover:bg-[var(--bg-surface-hover)]">
                <input type="checkbox" checked={picked.includes(k)} onChange={() => flip(k)} className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" />
                <span className="font-semibold">{TRANSPORT_CATEGORY_LABEL[k]}</span>
                {k === 'LOGISTICS' && <span className="text-[10px] text-[var(--text-muted)]">Shipper portal</span>}
                {!offered.includes(k) && <span className="text-[10px] font-semibold text-amber-600">No longer offered</span>}
              </label>
            ))}
          </FormSection>
          <FormFooter secondary={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}>
            <PrimaryButton icon={Save} busy={busy} onClick={() => void save()}>Save</PrimaryButton>
          </FormFooter>
        </FormPanel>
      </div>
    </div>
  );
}

function RoleSelect({ value, onChange, disabled, label }: { value: PortalRole | null; onChange: (v: PortalRole | null) => void; disabled?: boolean; label: string }) {
  return (
    <SelectInput value={value ?? ''} disabled={disabled} aria-label={label} className="!w-32"
      onChange={(e) => onChange((e.target.value || null) as PortalRole | null)}>
      <option value="">No access</option>
      {PORTAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </SelectInput>
  );
}

function UsersPanel({ customer, canEdit, onClose }: { customer: CustomerRow; canEdit: boolean; onClose: () => void }) {
  const initialRoles = (): Partial<Record<CustomerPortal, PortalRole | null>> =>
    Object.fromEntries(customer.portals.map((p) => [p, 'REQUESTER']));
  const [users, setUsers] = useState<PortalAccount[] | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', mobile: '' });
  const [roles, setRoles] = useState(initialRoles);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/portal-users?customerId=${encodeURIComponent(customer.customerId)}`, { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.ok) setUsers(d.users); else setErr(d?.error ?? 'Could not load users');
  }, [customer.customerId]);
  useEffect(() => { void load(); }, [load]);

  const invite = async (email: string, fullName: string, mobile: string, portalRoles: Partial<Record<CustomerPortal, PortalRole | null>>) => {
    setErr(null); setLink(null); setNotice(null); setCopied(false);
    const granted = Object.fromEntries(Object.entries(portalRoles).filter(([, r]) => r));
    if (Object.keys(granted).length === 0) { setErr('Choose a role in at least one portal.'); return; }
    setBusy(true);
    try {
      const r = await send('/api/customers/portal-users', 'POST', { customerId: customer.customerId, email, fullName, mobile, roles: granted });
      if (!r.ok) { setErr(r.data?.error ?? 'Could not invite the user'); return; }
      const who = r.data?.user?.email ?? '';
      if (r.data?.setupUrl) setLink({ url: r.data.setupUrl, email: who, expiresAt: r.data.expiresAt ?? '' });
      else setNotice(`Access updated. ${who} already has a password and can sign in with it.`);
      setForm({ email: '', fullName: '', mobile: '' }); setRoles(initialRoles());
      void load();
    } finally { setBusy(false); }
  };

  const update = async (u: PortalAccount, patch: { isActive?: boolean; roles?: Partial<Record<CustomerPortal, PortalRole | null>> }) => {
    setErr(null); setNotice(null);
    const r = await send('/api/customers/portal-users', 'PATCH', { id: u.id, ...patch });
    if (!r.ok) { setErr(r.data?.error ?? 'Could not update the user'); return; }
    void load();
  };

  // Show a portal's role picker when the customer has it, or the user still holds a role there.
  const portalsFor = (u?: PortalAccount) => PORTALS.filter((p) => customer.portals.includes(p) || !!u?.roles[p]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`Portal users for ${customer.name}`}>
      <div className="w-full max-w-3xl h-full overflow-y-auto bg-[var(--bg-main)] p-4 space-y-4">
        <FormPanel title={`Portal users — ${customer.name}`}
          subtitle={`Customer ID ${customer.code ?? '—'} · ${customer.portals.length ? customer.portals.map((p) => PORTAL_LABEL[p]).join(', ') : 'No portal enabled yet'}`}
          icon={Users} actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          {notice && <FormAlert tone="info">{notice}</FormAlert>}
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
                  <div className="flex flex-wrap items-center gap-2">
                    {portalsFor(u).map((p) => (
                      <label key={p} className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)]">
                        {p === 'FSM' ? 'Field' : 'Transport'}
                        <RoleSelect value={u.roles[p] ?? null} disabled={!canEdit} label={`${PORTAL_LABEL[p]} role for ${u.email}`}
                          onChange={(v) => void update(u, { roles: { [p]: v } })} />
                      </label>
                    ))}
                    {canEdit && !u.hasPassword && u.isActive && (
                      <SecondaryButton icon={Mail} onClick={() => void invite(u.email, u.fullName ?? '', u.mobile ?? '', u.roles)}>New link</SecondaryButton>
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
            <form onSubmit={(e) => { e.preventDefault(); void invite(form.email, form.fullName, form.mobile, roles); }}>
              <FormSection title="Invite a user" icon={UserPlus} columns={2}>
                <FormField label="Email" required><TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" required /></FormField>
                <FormField label="Full name"><TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></FormField>
                <FormField label="Mobile"><TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+971 5x xxx xxxx" /></FormField>
                {portalsFor().map((p) => (
                  <FormField key={p} label={`${PORTAL_LABEL[p]} role`} hint={ROLE_HELP}>
                    <RoleSelect value={roles[p] ?? null} label={`${PORTAL_LABEL[p]} role`} onChange={(v) => setRoles({ ...roles, [p]: v })} />
                  </FormField>
                ))}
              </FormSection>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">If this email already has an account for {customer.name}, it keeps its password and gets the roles chosen here.</p>
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
