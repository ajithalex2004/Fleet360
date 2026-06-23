'use client';

/**
 * NotifyPicker — smart input for an EscalationLevel.notify field.
 *
 * Lets a Super/Tenant Admin choose:
 *   • a Role (dropdown of the tenant's roles, with live preview of how many
 *     users are in that role and their emails)
 *   • specific Users (multi-select of the tenant's users by name + email)
 *   • a Custom string (free-form fallback — preserves any legacy data that
 *     was hand-typed before this picker existed)
 *
 * The component takes the parent's single `notify: string` field and parses
 * it on mount. It writes back using a forward-compatible encoding the Phase
 * 2C escalation engine can resolve at run-time without ambiguity:
 *
 *   "role:CODE"                    → notify everyone with that role
 *   "email:alice@x.com,bob@y.com"  → notify the listed emails
 *   <anything else>                → custom (legacy, treated as opaque)
 *
 * Roles + users are fetched from /api/admin/roles and /api/admin/users
 * scoped to the current session's tenant, with a module-level cache so
 * stamping one of these into 5 escalation levels doesn't fire 10 fetches.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Mail, Shield, Type, X, Users } from 'lucide-react';

// ── Tenant-scoped data caches (module-level — survive remounts) ────────────
interface MeLite { tenantId: string }
interface RoleLite { id: string; name: string; code: string; isSystem?: boolean | null }
interface UserLite {
  id: string; email: string;
  firstName: string | null; lastName: string | null;
  roleId?: string | null; roleCode?: string | null; roleName?: string | null;
}

let _mePromise: Promise<MeLite | null> | null = null;
let _rolesByTenant: Record<string, RoleLite[]> = {};
let _usersByTenant: Record<string, UserLite[]> = {};

async function loadMe(): Promise<MeLite | null> {
  if (!_mePromise) {
    _mePromise = fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _mePromise;
}
async function loadRoles(tenantId: string): Promise<RoleLite[]> {
  if (_rolesByTenant[tenantId]) return _rolesByTenant[tenantId];
  const res = await fetch(`/api/admin/roles?tenantId=${tenantId}&lite=true`);
  if (!res.ok) return [];
  const data = await res.json();
  const list: RoleLite[] = Array.isArray(data) ? data : (data.roles ?? []);
  _rolesByTenant[tenantId] = list;
  return list;
}
async function loadUsers(tenantId: string): Promise<UserLite[]> {
  if (_usersByTenant[tenantId]) return _usersByTenant[tenantId];
  const res = await fetch(`/api/admin/users?tenantId=${tenantId}`);
  if (!res.ok) return [];
  const data = await res.json();
  const list: UserLite[] = Array.isArray(data) ? data : (data.users ?? []);
  _usersByTenant[tenantId] = list;
  return list;
}

// ── Encoding helpers ───────────────────────────────────────────────────────
type Mode = 'role' | 'users' | 'custom';

interface Parsed {
  mode: Mode;
  roleCode: string;     // when mode='role'
  emails: string[];     // when mode='users'
  custom: string;       // when mode='custom'
}

function parse(value: string): Parsed {
  const v = (value ?? '').trim();
  if (v.startsWith('role:')) {
    return { mode: 'role', roleCode: v.slice(5).trim(), emails: [], custom: '' };
  }
  if (v.startsWith('email:')) {
    const list = v.slice(6).split(',').map(s => s.trim()).filter(Boolean);
    return { mode: 'users', roleCode: '', emails: list, custom: '' };
  }
  return { mode: 'custom', roleCode: '', emails: [], custom: v };
}
function encode(p: Parsed): string {
  if (p.mode === 'role')  return p.roleCode ? `role:${p.roleCode}` : '';
  if (p.mode === 'users') return p.emails.length ? `email:${p.emails.join(',')}` : '';
  return p.custom;
}

function userLabel(u: UserLite): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name ? `${name} (${u.email})` : u.email;
}

// ── Picker ─────────────────────────────────────────────────────────────────
export function NotifyPicker({ value, onChange, placeholder }: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [roles, setRoles]       = useState<RoleLite[]>([]);
  const [users, setUsers]       = useState<UserLite[]>([]);
  const [loading, setLoading]   = useState(true);

  // Local parsed state mirrors the encoded `value` prop. We re-parse only
  // when the parent string actually changes (e.g. on history rollback) so
  // mid-edit keystrokes aren't clobbered.
  const [parsed, setParsed] = useState<Parsed>(() => parse(value));
  useEffect(() => { setParsed(parse(value)); }, [value]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await loadMe();
      if (cancelled || !me?.tenantId) { setLoading(false); return; }
      setTenantId(me.tenantId);
      const [r, u] = await Promise.all([loadRoles(me.tenantId), loadUsers(me.tenantId)]);
      if (cancelled) return;
      setRoles(r); setUsers(u); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const usersByRoleCode = useMemo(() => {
    const out: Record<string, UserLite[]> = {};
    for (const u of users) {
      const code = u.roleCode ?? '';
      if (!code) continue;
      (out[code] ??= []).push(u);
    }
    return out;
  }, [users]);

  const setMode = (mode: Mode) => {
    const next: Parsed = { ...parsed, mode };
    setParsed(next);
    onChange(encode(next));
  };

  const setRoleCode = (code: string) => {
    const next: Parsed = { ...parsed, mode: 'role', roleCode: code };
    setParsed(next);
    onChange(encode(next));
  };

  const toggleEmail = (email: string) => {
    const has = parsed.emails.includes(email);
    const list = has ? parsed.emails.filter(e => e !== email) : [...parsed.emails, email];
    const next: Parsed = { ...parsed, mode: 'users', emails: list };
    setParsed(next);
    onChange(encode(next));
  };

  const setCustom = (v: string) => {
    const next: Parsed = { ...parsed, mode: 'custom', custom: v };
    setParsed(next);
    onChange(encode(next));
  };

  // ── Resolved-emails preview (for role mode) ──────────────────────────────
  const resolvedFromRole = parsed.mode === 'role' && parsed.roleCode
    ? usersByRoleCode[parsed.roleCode] ?? []
    : [];

  return (
    <div className="space-y-1.5">
      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-white/10 bg-slate-800/60 p-0.5 text-[11px]">
        <ModeBtn active={parsed.mode === 'role'}   onClick={() => setMode('role')}   icon={<Shield className="w-3 h-3" />} label="Role" />
        <ModeBtn active={parsed.mode === 'users'}  onClick={() => setMode('users')}  icon={<Mail   className="w-3 h-3" />} label="Users" />
        <ModeBtn active={parsed.mode === 'custom'} onClick={() => setMode('custom')} icon={<Type   className="w-3 h-3" />} label="Custom" />
      </div>

      {/* Body — varies by mode */}
      {parsed.mode === 'role' && (
        <RoleMode
          loading={loading}
          roles={roles}
          value={parsed.roleCode}
          onChange={setRoleCode}
          resolved={resolvedFromRole} />
      )}

      {parsed.mode === 'users' && (
        <UsersMode
          loading={loading}
          users={users}
          selected={parsed.emails}
          onToggle={toggleEmail} />
      )}

      {parsed.mode === 'custom' && (
        <input
          value={parsed.custom}
          onChange={e => setCustom(e.target.value)}
          placeholder={placeholder ?? 'email or role key'}
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
      )}

      {!loading && !tenantId && (
        <p className="text-[10px] text-amber-400">Tenant context unavailable — using custom mode only.</p>
      )}
    </div>
  );
}

function ModeBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
        active ? 'bg-violet-600/30 text-violet-100 border border-violet-500/40' : 'text-slate-400 hover:text-white border border-transparent'
      }`}>
      {icon} {label}
    </button>
  );
}

// ── Role sub-picker ────────────────────────────────────────────────────────
function RoleMode({ loading, roles, value, onChange, resolved }: {
  loading: boolean;
  roles: RoleLite[];
  value: string;
  onChange: (code: string) => void;
  resolved: UserLite[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-slate-800 border border-white/10 rounded-lg pl-3 pr-9 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
          <option value="">{loading ? 'Loading roles…' : '— Select a role —'}</option>
          {roles.map(r => (
            <option key={r.id} value={r.code}>
              {r.name}{r.isSystem ? ' • system' : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>

      {value && (
        <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
          <Users className="w-3 h-3 mt-0.5 shrink-0" />
          {resolved.length === 0 ? (
            <span>No active users currently hold this role.</span>
          ) : (
            <span>
              Resolves to <strong className="text-slate-200">{resolved.length}</strong>{' '}
              user{resolved.length === 1 ? '' : 's'}:{' '}
              <span className="text-slate-300">
                {resolved.slice(0, 3).map(u => u.email).join(', ')}
                {resolved.length > 3 && ` +${resolved.length - 3} more`}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Users sub-picker (combobox + selected chips) ───────────────────────────
function UsersMode({ loading, users, selected, onToggle }: {
  loading: boolean; users: UserLite[]; selected: string[]; onToggle: (email: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 10);
    return users
      .filter(u => {
        const hay = `${u.email} ${u.firstName ?? ''} ${u.lastName ?? ''} ${u.roleName ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [users, query]);

  return (
    <div className="space-y-1.5">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(email => (
            <span key={email}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-200 border border-violet-500/30">
              {email}
              <button type="button" onClick={() => onToggle(email)} className="hover:text-rose-300">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={loading ? 'Loading users…' : 'Search by name, email, or role…'}
          disabled={loading}
          className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        {open && filtered.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-slate-900 border border-white/10 rounded-lg shadow-xl">
            {filtered.map(u => {
              const picked = selected.includes(u.email);
              return (
                <li key={u.id}>
                  <button type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { onToggle(u.email); setQuery(''); }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                      picked ? 'bg-violet-500/20 text-violet-100' : 'text-slate-200 hover:bg-white/5'
                    }`}>
                    <span className="flex-1 min-w-0 truncate">{userLabel(u)}</span>
                    {u.roleName && (
                      <span className="text-[10px] text-slate-500 shrink-0">{u.roleName}</span>
                    )}
                    {picked && <span className="text-[10px] text-violet-300 shrink-0">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
