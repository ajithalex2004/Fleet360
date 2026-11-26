'use client';

/**
 * Customer Portal — the company's team. The company's Admin invites colleagues
 * and sets their role in each portal they administer (Admin, Requester,
 * Finance, Viewer). A new colleague gets a one-time setup link to send them;
 * an existing one keeps their password. Your own access is changed by another
 * admin or your service provider.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, Copy, Check, Mail } from 'lucide-react';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, SelectInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';
import {
  PORTAL_LABEL, PORTAL_ROLES, ROLE_LABEL, type CustomerPortal, type PortalRole,
} from '@/lib/customer-portal/catalog';

interface Account {
  id: string; email: string; fullName: string | null; mobile: string | null; isActive: boolean; hasPassword: boolean;
  lastLoginAt: string | null; roles: Partial<Record<CustomerPortal, PortalRole>>;
}
interface TeamData { users: Account[]; me: string; companyPortals: CustomerPortal[]; adminPortals: CustomerPortal[] }
type RoleMap = Partial<Record<CustomerPortal, PortalRole | null>>;

const ROLE_HELP = 'Admin: requests and your company setup · Requester: raise and track requests · Finance: agreements and invoices · Viewer: look only';

async function send(method: string, body: unknown) {
  const res = await fetch('/api/customer-portal/team', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; setupUrl?: string | null; expiresAt?: string; user?: Account } | null;
  return { ok: res.ok && !!data?.ok, data };
}

function RoleSelect({ value, onChange, disabled, label }: { value: PortalRole | null; onChange: (v: PortalRole | null) => void; disabled?: boolean; label: string }) {
  return (
    <SelectInput value={value ?? ''} disabled={disabled} aria-label={label} className="!w-32" onChange={(e) => onChange((e.target.value || null) as PortalRole | null)}>
      <option value="">No access</option>
      {PORTAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </SelectInput>
  );
}

export default function TeamPage() {
  const [team, setTeam] = useState<TeamData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ email: '', fullName: '', mobile: '' });
  const [roles, setRoles] = useState<RoleMap>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/customer-portal/team', { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load your team'); return; }
    setTeam(d);
    setRoles((r) => (Object.keys(r).length ? r : Object.fromEntries((d.adminPortals as CustomerPortal[]).map((p) => [p, 'REQUESTER']))));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const invite = async (email: string, fullName: string, mobile: string, portalRoles: RoleMap) => {
    setErr(null); setNotice(null); setLink(null); setCopied(false);
    const granted = Object.fromEntries(Object.entries(portalRoles).filter(([, r]) => r));
    if (Object.keys(granted).length === 0) { setErr('Choose a role in at least one portal.'); return; }
    setBusy(true);
    try {
      const r = await send('POST', { email, fullName, mobile, roles: granted });
      if (!r.ok) { setErr(r.data?.error ?? 'Could not invite the user'); return; }
      const who = r.data?.user?.email ?? email;
      if (r.data?.setupUrl) setLink({ url: r.data.setupUrl, email: who, expiresAt: r.data.expiresAt ?? '' });
      else setNotice(`Access updated. ${who} already has a password and can sign in with it.`);
      setForm({ email: '', fullName: '', mobile: '' });
      void load();
    } finally { setBusy(false); }
  };

  const update = async (u: Account, patch: { roles?: RoleMap; isActive?: boolean }) => {
    setErr(null); setNotice(null);
    const r = await send('PATCH', { id: u.id, ...patch });
    if (!r.ok) { setErr(r.data?.error ?? 'Could not update the user'); return; }
    void load();
  };

  if (!team) return err ? <FormAlert>{err}</FormAlert> : <p className="text-sm text-[var(--text-muted)]">Loading…</p>;
  const canEdit = (p: CustomerPortal) => team.adminPortals.includes(p);

  return (
    <div className="space-y-4">
      <FormPanel title="Your team" subtitle={`Invite colleagues and set their access. You manage: ${team.adminPortals.map((p) => PORTAL_LABEL[p]).join(', ')}.`} icon={Users}>
        {err && <FormAlert>{err}</FormAlert>}
        {notice && <FormAlert tone="info">{notice}</FormAlert>}
        {link && (
          <FormAlert tone="info">
            <span className="block font-semibold">Invite ready for {link.email}</span>
            <span className="block">Send this link to your colleague. It works once and expires {link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : 'in 7 days'}.</span>
            <span className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-[var(--bg-main)] px-2 py-1 text-[11px]">{link.url}</code>
              <SecondaryButton icon={copied ? Check : Copy} onClick={() => { void navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</SecondaryButton>
            </span>
          </FormAlert>
        )}

        <FormSection title="Users" icon={Users} columns={1}>
          <div className="divide-y divide-[var(--border-subtle)]">
            {team.users.map((u) => {
              const self = u.id === team.me;
              const manageable = !self && team.companyPortals.filter((p) => u.roles[p]).every(canEdit);
              return (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{u.fullName ?? u.email}{self && <span className="text-[var(--text-muted)]"> · you</span>}{!u.isActive && <span className="text-rose-500"> · deactivated</span>}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{u.email} · {u.hasPassword ? (u.lastLoginAt ? `last sign-in ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'never signed in') : 'invite pending'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {team.companyPortals.map((p) => (
                      <label key={p} className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)]">
                        {p === 'FSM' ? 'Field' : 'Transport'}
                        <RoleSelect value={u.roles[p] ?? null} disabled={self || !canEdit(p)} label={`${PORTAL_LABEL[p]} role for ${u.email}`}
                          onChange={(v) => void update(u, { roles: { [p]: v } })} />
                      </label>
                    ))}
                    {!self && !u.hasPassword && u.isActive && (
                      <SecondaryButton icon={Mail} onClick={() => void invite(u.email, u.fullName ?? '', u.mobile ?? '',
                        Object.fromEntries(team.adminPortals.filter((p) => u.roles[p]).map((p) => [p, u.roles[p]!])))}>New link</SecondaryButton>
                    )}
                    {manageable && (
                      <SecondaryButton onClick={() => void update(u, { isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</SecondaryButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </FormSection>

        <form onSubmit={(e) => { e.preventDefault(); void invite(form.email, form.fullName, form.mobile, roles); }}>
          <FormSection title="Invite a colleague" icon={UserPlus} columns={2}>
            <FormField label="Email" required><TextInput type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" /></FormField>
            <FormField label="Full name"><TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></FormField>
            <FormField label="Mobile"><TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+971 5x xxx xxxx" /></FormField>
            {team.adminPortals.map((p) => (
              <FormField key={p} label={`${PORTAL_LABEL[p]} role`} hint={ROLE_HELP}>
                <RoleSelect value={roles[p] ?? null} label={`${PORTAL_LABEL[p]} role`} onChange={(v) => setRoles({ ...roles, [p]: v })} />
              </FormField>
            ))}
          </FormSection>
          <div className="mt-3">
            <FormFooter><PrimaryButton type="submit" icon={UserPlus} busy={busy}>{busy ? 'Inviting…' : 'Invite'}</PrimaryButton></FormFooter>
          </div>
        </form>
      </FormPanel>
    </div>
  );
}
