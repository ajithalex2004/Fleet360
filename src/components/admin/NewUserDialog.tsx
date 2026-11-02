'use client';
/**
 * The New User form — one form wherever a user is added (Admin > Users,
 * Tenant > Users, Tenant > Invitations). Everything is chosen up front:
 * profile, company, role, department and module access (narrowing the
 * role), and how the user signs in: an invitation, where they set their own
 * password, or a password set now.
 *
 * Server: /api/admin/tenants/[id]/members (src/lib/admin/member-onboarding.ts).
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import PhoneInput from '@/components/ui/PhoneInput';
import PasswordInput from '@/components/ui/PasswordInput';
import ModuleAccessGrid, {
  maskFromSelection, toggleLevel, type AccessLevel, type AccessModuleRow,
} from '@/components/admin/ModuleAccessGrid';

interface Options {
  tenant: { id: string; name: string };
  roles: { id: string; name: string; code: string; scope: 'company' | 'platform' }[];
  departments: { id: string; name: string }[];
  modules: AccessModuleRow[] | null;
}

interface Props {
  /** The companies to choose from (platform admins), or one fixed company. */
  tenants: { id: string; name: string }[];
  defaultTenantId?: string;
  defaultOnboarding?: 'invite' | 'password';
  onClose: () => void;
  /** Called after a successful create or invite, with a message to show. */
  onDone: (message: string) => void;
}

const USER_TYPES = ['STAFF', 'MANAGER', 'ADMIN', 'DRIVER', 'VIEWER'];
const INPUT = 'w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-violet-500 focus:outline-none placeholder-[var(--text-faint)]';
const LABEL = 'block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5';

export default function NewUserDialog({ tenants, defaultTenantId, defaultOnboarding = 'invite', onClose, onDone }: Props) {
  const [tenantId, setTenantId] = useState(defaultTenantId ?? (tenants.length === 1 ? tenants[0].id : ''));
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', username: '', mobileNumber: '', position: '', userType: 'STAFF',
    roleId: '', departmentId: '',
  });
  const [onboarding, setOnboarding] = useState<'invite' | 'password'>(defaultOnboarding);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [options, setOptions] = useState<Options | null>(null);
  const [edits, setEdits] = useState<Record<string, AccessLevel[]>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  // The company's roles and departments, and what the chosen role grants per module.
  const load = useCallback(async (tid: string, roleId: string) => {
    if (!tid) { setOptions(null); return; }
    setLoading(true); setError('');
    try {
      const q = roleId ? `?roleId=${encodeURIComponent(roleId)}` : '';
      const res = await fetch(`/api/admin/tenants/${tid}/members${q}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `Failed to load (${res.status})`);
      setOptions(d as Options);
    } catch (e) {
      setOptions(null);
      setError(e instanceof Error ? e.message : 'Failed to load the form');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(tenantId, form.roleId); }, [load, tenantId, form.roleId]);

  const changeTenant = (id: string) => {
    setTenantId(id);
    setForm((p) => ({ ...p, roleId: '', departmentId: '' }));
    setEdits({});
  };
  const changeRole = (id: string) => {
    setForm((p) => ({ ...p, roleId: id }));
    setEdits({}); // start from the new role's access
  };

  const rows = options?.modules ?? [];
  const selectionOf = (key: string): AccessLevel[] =>
    key in edits ? edits[key] : (rows.find((r) => r.key === key)?.roleAccess ?? []);
  const roleName = options?.roles.find((r) => r.id === form.roleId)?.name ?? '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setErrors([]);
    if (!tenantId) { setError('Choose a company'); return; }
    if (!form.roleId) { setError('Choose a role'); return; }
    if (onboarding === 'password' && password !== password2) { setError('The passwords do not match'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          departmentId: form.departmentId || null,
          moduleAccess: maskFromSelection(rows, selectionOf),
          onboarding,
          ...(onboarding === 'password' ? { password } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? `Failed (${res.status})`);
        setErrors(Array.isArray(d.errors) ? d.errors : []);
        return;
      }
      const company = options?.tenant.name ?? 'the company';
      if (d.outcome === 'invited') {
        if (!d.emailed && d.acceptUrl) { setInviteLink(d.acceptUrl); return; } // email not configured: show the link
        onDone(`Invitation sent to ${form.email} for ${company}.`);
      } else if (d.outcome === 'added') {
        onDone(`${form.email} already had an account and was added to ${company}.`);
      } else {
        onDone(`${form.firstName} ${form.lastName} was created in ${company}.`);
      }
    } catch {
      setError('Network error — please try again');
    } finally { setSaving(false); }
  };

  if (inviteLink) {
    return (
      <Shell title="Invitation created" onClose={onClose}>
        <div className="p-6 space-y-4">
          <p className="text-sm text-[var(--text-main)]">
            Email is not configured, so no message was sent. Send {form.email} this link to accept the invitation:
          </p>
          <input readOnly value={inviteLink} className={INPUT} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(inviteLink); }}
              className="px-5 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] text-sm">Copy link</button>
            <button type="button" onClick={() => onDone(`Invitation created for ${form.email}.`)}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold">Done</button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="New User" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
              {error}
              {errors.length > 0 && <ul className="list-disc ml-5 mt-1">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
            </div>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-main)]">1. Person</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label htmlFor="nu-first" className={LABEL}>First name{onboarding === 'password' ? ' *' : ''}</label>
                <input id="nu-first" className={INPUT} value={form.firstName} onChange={set('firstName')} required={onboarding === 'password'} maxLength={100} /></div>
              <div><label htmlFor="nu-last" className={LABEL}>Last name{onboarding === 'password' ? ' *' : ''}</label>
                <input id="nu-last" className={INPUT} value={form.lastName} onChange={set('lastName')} required={onboarding === 'password'} maxLength={100} /></div>
              <div><label htmlFor="nu-email" className={LABEL}>Email *</label>
                <input id="nu-email" type="email" className={INPUT} value={form.email} onChange={set('email')} required maxLength={254} placeholder="name@company.com" /></div>
              <div><label htmlFor="nu-mobile" className={LABEL}>Mobile Number</label>
                <PhoneInput id="nu-mobile" value={form.mobileNumber} onChange={(full) => setForm((p) => ({ ...p, mobileNumber: full }))} placeholder="50 123 4567" /></div>
              <div><label htmlFor="nu-position" className={LABEL}>Position</label>
                <input id="nu-position" className={INPUT} value={form.position} onChange={set('position')} maxLength={100} placeholder="Fleet Supervisor" /></div>
              {onboarding === 'password' && (
                <div><label htmlFor="nu-username" className={LABEL}>Username</label>
                  <input id="nu-username" className={INPUT} value={form.username} onChange={set('username')} maxLength={100} placeholder="Defaults to the email" /></div>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-main)]">2. Company, role and department</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="nu-tenant" className={LABEL}>Company *</label>
                {tenants.length === 1 ? (
                  <div className="text-sm text-[var(--text-main)] font-medium pt-2.5">{tenants[0].name}</div>
                ) : (
                  <select id="nu-tenant" className={INPUT} value={tenantId} onChange={(e) => changeTenant(e.target.value)} required>
                    <option value="">Select a company</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label htmlFor="nu-role" className={LABEL}>Role *</label>
                <select id="nu-role" className={INPUT} value={form.roleId} onChange={(e) => changeRole(e.target.value)} required disabled={!options}>
                  <option value="">Select a role</option>
                  {(options?.roles ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}{r.scope === 'company' ? ' (company role)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="nu-dept" className={LABEL}>Department</label>
                <select id="nu-dept" className={INPUT} value={form.departmentId} onChange={set('departmentId')} disabled={!options}>
                  <option value="">— None —</option>
                  {(options?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {options && options.departments.length === 0 && (
                  <p className="text-xs text-[var(--text-faint)] mt-1">
                    None yet: <Link href={`/admin/departments?tenantId=${encodeURIComponent(options.tenant.id)}`} className="text-blue-500 hover:underline">add departments</Link>.
                  </p>
                )}
              </div>
            </div>
            <div>
              <label htmlFor="nu-type" className={LABEL}>User type</label>
              <select id="nu-type" className={`${INPUT} sm:w-60`} value={form.userType} onChange={set('userType')}>
                {USER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-main)]">3. Module access</h3>
            {!form.roleId ? (
              <p className="text-sm text-[var(--text-muted)]">Choose a role to see what it allows; you can then narrow it per module.</p>
            ) : loading && !options?.modules ? (
              <p className="text-sm text-[var(--text-muted)] animate-pulse">Loading…</p>
            ) : (
              <>
                <p className="text-xs text-[var(--text-faint)]">
                  Starts from everything the {roleName} role allows. Untick to narrow it; access the role does not include
                  cannot be added here — choose another role or create one in <Link href="/admin/roles" className="text-blue-500 hover:underline">Roles &amp; Permissions</Link>.
                </p>
                <ModuleAccessGrid
                  rows={rows}
                  tenantName={options?.tenant.name ?? ''}
                  roleName={roleName}
                  selectionOf={selectionOf}
                  onToggle={(row, level) => setEdits((p) => ({ ...p, [row.key]: toggleLevel(selectionOf(row.key), level, row) }))}
                />
                {Object.keys(edits).length > 0 && (
                  <button type="button" onClick={() => setEdits({})} className="text-xs text-blue-500 hover:underline">Reset to the role&apos;s access</button>
                )}
              </>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-main)]">4. How they sign in</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ['invite', 'Send an invitation (recommended)', 'They get an email and choose their own password. People who already have an account accept with it.'],
                ['password', 'Set a password now', 'The account is created now. Give them the password securely.'],
              ] as const).map(([key, title, help]) => (
                <label key={key} className={`p-3 rounded-xl border cursor-pointer ${onboarding === key ? 'border-violet-500 bg-violet-500/10' : 'border-[var(--border-subtle)]'}`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="nu-onboarding" checked={onboarding === key} onChange={() => setOnboarding(key)} className="accent-violet-600" />
                    <span className="text-sm font-medium text-[var(--text-main)]">{title}</span>
                  </div>
                  <p className="text-xs text-[var(--text-faint)] mt-1 ml-6">{help}</p>
                </label>
              ))}
            </div>
            {onboarding === 'password' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label htmlFor="nu-pw" className={LABEL}>Password *</label>
                  <PasswordInput id="nu-pw" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" className={INPUT} /></div>
                <div><label htmlFor="nu-pw2" className={LABEL}>Confirm password *</label>
                  <PasswordInput id="nu-pw2" value={password2} onChange={(e) => setPassword2(e.target.value)} required autoComplete="new-password" className={INPUT} /></div>
              </div>
            )}
          </section>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button type="submit" disabled={saving || !options}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : onboarding === 'invite' ? 'Send invitation' : 'Create user'}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl">
        <div className="px-6 py-5 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text-main)]">{title}</h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
