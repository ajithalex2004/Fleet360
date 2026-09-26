'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

/**
 * Exchange partners — platform admin screen.
 *
 * Creates the Exchange's transport partners and links users to them
 * (partner_users), which is what lets a user into the partner portal and
 * marketplace. Platform administrators only: /api/admin/exchange/partners
 * and /api/admin/exchange/partner-users return 403 for anyone else.
 */

const ROLES = [
  { value: 'PARTNER_ADMIN',      label: 'Admin',      hint: 'Everything, including company profile' },
  { value: 'PARTNER_OPERATIONS', label: 'Operations', hint: 'Quotes, jobs, fleet and drivers' },
  { value: 'PARTNER_FINANCE',    label: 'Finance',    hint: 'Invoices and statements' },
  { value: 'PARTNER_VIEWER',     label: 'Viewer',     hint: 'Read only' },
] as const;

interface Partner {
  id: string;
  legalName: string;
  tradeName: string | null;
  partnerCode: string;
  city: string | null;
  primaryContactEmail: string | null;
  onboardingStatus: string;
  operationalStatus: string;
  marketplaceStatus: string;
  memberCount: number;
}

interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; email: string; username: string | null; isActive: boolean };
}

const EMPTY_PARTNER = { legalName: '', partnerCode: '', tradeName: '', city: '', primaryContactName: '', primaryContactEmail: '', primaryContactPhone: '' };

const input = 'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-cyan-500 focus:outline-none';
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50';
const ghostBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]';

async function readJson(r: Response): Promise<Record<string, unknown>> {
  return r.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function errorOf(d: Record<string, unknown>, status: number): string {
  return typeof d.error === 'string' ? d.error : `Request failed (${status})`;
}

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
      {label}
    </span>
  );
}

export default function ExchangePartnersAdminPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [partnerForm, setPartnerForm] = useState(EMPTY_PARTNER);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [savingPartner, setSavingPartner] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkRole, setLinkRole] = useState<string>('PARTNER_OPERATIONS');
  const [busy, setBusy] = useState(false);

  const loadPartners = useCallback(async () => {
    setLoading(true); setPageError(null);
    try {
      const r = await fetch('/api/admin/exchange/partners');
      const d = await readJson(r);
      if (!r.ok) { setPageError(errorOf(d, r.status)); return; }
      const list = (d.partners ?? []) as Partner[];
      setPartners(list);
      setSelectedId((cur) => (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (partnerId: string) => {
    setMembersLoading(true); setMemberError(null);
    try {
      const r = await fetch(`/api/admin/exchange/partner-users?partnerId=${encodeURIComponent(partnerId)}`);
      const d = await readJson(r);
      if (!r.ok) { setMemberError(errorOf(d, r.status)); setMembers([]); return; }
      setMembers((d.members ?? []) as Member[]);
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => { void loadPartners(); }, [loadPartners]);
  useEffect(() => { if (selectedId) void loadMembers(selectedId); else setMembers([]); }, [selectedId, loadMembers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) =>
      [p.legalName, p.tradeName, p.partnerCode, p.city].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [partners, query]);

  const selected = partners.find((p) => p.id === selectedId) ?? null;

  // Refreshes the member list and the partner's member count.
  const afterMembershipChange = async (partnerId: string) => {
    await loadMembers(partnerId);
    const r = await fetch('/api/admin/exchange/partners');
    if (r.ok) setPartners(((await readJson(r)).partners ?? []) as Partner[]);
  };

  const createPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPartner(true); setPartnerError(null);
    try {
      const r = await fetch('/api/admin/exchange/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partnerForm),
      });
      const d = await readJson(r);
      if (!r.ok) { setPartnerError(errorOf(d, r.status)); return; }
      const created = d.partner as { id: string };
      setShowAdd(false);
      setPartnerForm(EMPTY_PARTNER);
      await loadPartners();
      setSelectedId(created.id);
    } catch (err) {
      setPartnerError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSavingPartner(false);
    }
  };

  // Linking an already-linked user updates their role (the API upserts).
  const saveMembership = async (email: string, role: string) => {
    if (!selected) return false;
    setBusy(true); setMemberError(null);
    try {
      const r = await fetch('/api/admin/exchange/partner-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: selected.id, email, role }),
      });
      const d = await readJson(r);
      if (!r.ok) { setMemberError(errorOf(d, r.status)); return false; }
      await afterMembershipChange(selected.id);
      return true;
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Network error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const linkUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkEmail.trim()) return;
    if (await saveMembership(linkEmail.trim(), linkRole)) setLinkEmail('');
  };

  const removeMember = async (m: Member) => {
    if (!selected) return;
    if (!window.confirm(`Remove ${m.user.email} from ${selected.legalName}? They lose access to the partner portal for this partner.`)) return;
    setBusy(true); setMemberError(null);
    try {
      const r = await fetch(`/api/admin/exchange/partner-users?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      const d = await readJson(r);
      if (!r.ok) { setMemberError(errorOf(d, r.status)); return; }
      await afterMembershipChange(selected.id);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exchange partners"
        subtitle="Transport partners of the Fleet360 Exchange and the users who act for them"
        icon={ArrowLeftRight}
        accent="cyan"
        actions={
          <button type="button" className={primaryBtn} onClick={() => { setShowAdd(true); setPartnerError(null); }}>
            <Plus className="h-4 w-4" /> Add partner
          </button>
        }
      />

      {pageError && (
        <div className="rounded-xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">{pageError}</div>
      )}

      {showAdd && (
        <form onSubmit={createPartner} className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">New transport partner</h2>
            <button type="button" aria-label="Close" onClick={() => setShowAdd(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {([
              ['legalName', 'Legal name *', 'Gulf Coaches LLC'],
              ['partnerCode', 'Partner code *', 'GULF-DXB'],
              ['tradeName', 'Trade name', 'Gulf Coaches'],
              ['city', 'City', 'Dubai'],
              ['primaryContactName', 'Contact name', ''],
              ['primaryContactEmail', 'Contact email', 'ops@example.ae'],
              ['primaryContactPhone', 'Contact phone', '+971 …'],
            ] as const).map(([key, label, placeholder]) => (
              <label key={key} className="block text-xs font-medium text-[var(--text-muted)]">
                {label}
                <input
                  className={`${input} mt-1`}
                  value={partnerForm[key]}
                  placeholder={placeholder}
                  required={key === 'legalName' || key === 'partnerCode'}
                  onChange={(e) => setPartnerForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            The partner code is permanent and unique: 2–24 letters, digits or dashes.
          </p>
          {partnerError && <p className="text-sm text-rose-400">{partnerError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className={primaryBtn} disabled={savingPartner}>
              {savingPartner ? 'Creating…' : 'Create partner'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        {/* Partner list */}
        <section className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
            <input className={`${input} pl-9`} placeholder="Search name, code or city" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {loading ? (
              <p className="p-6 text-center text-sm text-[var(--text-muted)]">Loading partners…</p>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--text-muted)]">
                {partners.length === 0 ? 'No transport partners yet. Use Add partner to create the first one.' : 'No partners match your search.'}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full px-4 py-3 text-left transition ${p.id === selectedId ? 'bg-cyan-500/10' : 'hover:bg-[var(--bg-canvas)]'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{p.legalName}</span>
                        <span className="shrink-0 text-xs text-[var(--text-muted)]">
                          {p.memberCount} {p.memberCount === 1 ? 'user' : 'users'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {p.partnerCode}{p.city ? ` · ${p.city}` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Selected partner */}
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          {!selected ? (
            <p className="py-10 text-center text-sm text-[var(--text-muted)]">Select a partner to manage its users.</p>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">{selected.legalName}</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  {selected.partnerCode}
                  {selected.tradeName ? ` · trading as ${selected.tradeName}` : ''}
                  {selected.primaryContactEmail ? ` · ${selected.primaryContactEmail}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusPill label={`Marketplace: ${selected.marketplaceStatus}`} ok={selected.marketplaceStatus === 'APPROVED'} />
                  <StatusPill label={`Operations: ${selected.operationalStatus}`} ok={selected.operationalStatus === 'ACTIVE'} />
                  <StatusPill label={`Onboarding: ${selected.onboardingStatus}`} ok={selected.onboardingStatus === 'APPROVED'} />
                </div>
              </div>

              <form onSubmit={linkUser} className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  required
                  className={input}
                  placeholder="Email of an existing Fleet360 user"
                  value={linkEmail}
                  onChange={(e) => setLinkEmail(e.target.value)}
                />
                <select className={`${input} sm:w-44`} value={linkRole} onChange={(e) => setLinkRole(e.target.value)}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button type="submit" className={`${primaryBtn} justify-center`} disabled={busy}>
                  <UserPlus className="h-4 w-4" /> Link user
                </button>
              </form>
              <p className="-mt-3 text-xs text-[var(--text-muted)]">
                {ROLES.find((r) => r.value === linkRole)?.hint}. The user must already have a Fleet360 account; linking
                an already-linked user changes their role.
              </p>

              {memberError && <p className="text-sm text-rose-400">{memberError}</p>}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      <th className="py-2 pr-3 font-medium">User</th>
                      <th className="py-2 pr-3 font-medium">Role</th>
                      <th className="py-2 pr-3 font-medium">Linked</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {membersLoading ? (
                      <tr><td colSpan={4} className="py-6 text-center text-[var(--text-muted)]">Loading users…</td></tr>
                    ) : members.length === 0 ? (
                      <tr><td colSpan={4} className="py-6 text-center text-[var(--text-muted)]">No users linked to this partner yet.</td></tr>
                    ) : members.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{m.user.email}</div>
                          <div className="text-xs text-[var(--text-muted)]">
                            {m.user.username ?? ''}{m.user.isActive ? '' : ' · deactivated'}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <select
                            aria-label={`Role for ${m.user.email}`}
                            className={`${input} w-36 py-1.5`}
                            value={m.role}
                            disabled={busy || !m.user.isActive}
                            onChange={(e) => void saveMembership(m.user.email, e.target.value)}
                          >
                            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-[var(--text-muted)]">
                          {new Date(m.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            aria-label={`Remove ${m.user.email}`}
                            onClick={() => void removeMember(m)}
                            disabled={busy}
                            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
