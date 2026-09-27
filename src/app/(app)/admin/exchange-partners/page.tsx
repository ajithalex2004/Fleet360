'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Building2, ExternalLink, Mail, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';

/**
 * Exchange partners — platform admin screen.
 *
 * Creates the Exchange's transport partners, records the tenant that
 * onboarded each one, approves the service areas they may be offered work in
 * (partner_capabilities) and gives them users (partner_users), which is what
 * lets a user into the partner portal and marketplace. A new user is invited
 * by email into the onboarding tenant's User Master and linked to the partner
 * when they accept; an existing Fleet360 user is linked directly. Platform
 * administrators only: the /api/admin/exchange/* routes return 403 for anyone
 * else.
 */

const ROLES = [
  { value: 'PARTNER_ADMIN',      label: 'Admin',      hint: 'Everything, including company profile' },
  { value: 'PARTNER_OPERATIONS', label: 'Operations', hint: 'Quotes, jobs, fleet and drivers' },
  { value: 'PARTNER_FINANCE',    label: 'Finance',    hint: 'Invoices and statements' },
  { value: 'PARTNER_VIEWER',     label: 'Viewer',     hint: 'Read only' },
] as const;

const SERVICE_AREAS = [
  { value: 'PASSENGER_TRANSPORT', label: 'Passenger transport', hint: 'Staff buses, shuttles, coaches' },
  { value: 'LIMOUSINE',           label: 'Limousine',           hint: 'Chauffeured cars' },
  { value: 'FREIGHT',             label: 'Freight',             hint: 'Goods and cargo' },
  { value: 'RECOVERY',            label: 'Recovery',            hint: 'Breakdown and towing' },
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
  approvedDomains: string[];
  pendingDocuments: number;
  onboardedByTenantId: string | null;
  onboardedByTenantName: string | null;
}

interface TenantOption { id: string; name: string; isActive?: boolean | null }
interface TenantRole { id: string; name: string; code: string }

interface Invitation {
  id: string;
  email: string;
  partnerRole: string | null;
  tenantRoleName: string | null;
  tenantName: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

/** Tenant roles a partner user may not be given (the API refuses them too). */
const NON_GRANTABLE_TENANT_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN'];
/** Preferred default tenant role for a partner user, in order. */
const DEFAULT_TENANT_ROLE_CODES = ['VIEWER', 'STAFF', 'OPERATOR', 'DISPATCHER'];

const INVITE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400',
  accepted: 'bg-emerald-500/15 text-emerald-400',
  revoked: 'bg-slate-500/15 text-[var(--text-muted)]',
  expired: 'bg-slate-500/15 text-[var(--text-muted)]',
};

interface ComplianceDoc {
  id: string;
  docType: string;
  docNumber: string | null;
  fileUrl: string;
  expiryDate: string | null;
  status: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  TRADE_LICENSE: 'Trade licence',
  TAX_CERTIFICATE: 'Tax certificate (TRN)',
  COMMERCIAL_INSURANCE: 'Commercial insurance',
  RTA_OPERATOR_PERMIT: 'RTA operator permit',
  RTA_PERMIT: 'RTA operator permit',
};

const DOC_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-400',
  VALID: 'bg-emerald-500/15 text-emerald-400',
  REJECTED: 'bg-rose-500/15 text-rose-400',
};

/** Only http(s) links are opened, never javascript: or data: URLs from a partner upload. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; email: string; username: string | null; isActive: boolean };
}

const EMPTY_PARTNER = { legalName: '', partnerCode: '', tradeName: '', city: '', primaryContactName: '', primaryContactEmail: '', primaryContactPhone: '', onboardedByTenantId: '' };

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
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [docs, setDocs] = useState<ComplianceDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantChoice, setTenantChoice] = useState('');
  const [tenantBusy, setTenantBusy] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);

  const [userMode, setUserMode] = useState<'invite' | 'link'>('invite');
  const [tenantRoles, setTenantRoles] = useState<TenantRole[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('PARTNER_OPERATIONS');
  const [inviteTenantRoleId, setInviteTenantRoleId] = useState('');
  const [inviteNotice, setInviteNotice] = useState<{ text: string; link?: string } | null>(null);

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
  useEffect(() => { setServiceError(null); setTenantError(null); setInviteNotice(null); }, [selectedId]);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/tenants?limit=200');
      if (!r.ok) return;
      const list = (await r.json().catch(() => [])) as TenantOption[];
      if (Array.isArray(list)) setTenants(list.filter((t) => t.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)));
    })();
  }, []);

  const loadInvites = useCallback(async (partnerId: string) => {
    const r = await fetch(`/api/admin/exchange/partners/${encodeURIComponent(partnerId)}/invitations`);
    const d = await readJson(r);
    setInvites(r.ok ? ((d.invitations ?? []) as Invitation[]) : []);
  }, []);
  useEffect(() => { if (selectedId) void loadInvites(selectedId); else setInvites([]); }, [selectedId, loadInvites]);

  const loadDocs = useCallback(async (partnerId: string) => {
    setDocsLoading(true); setDocsError(null);
    try {
      const r = await fetch(`/api/admin/exchange/partners/${encodeURIComponent(partnerId)}/compliance`);
      const d = await readJson(r);
      if (!r.ok) { setDocsError(errorOf(d, r.status)); setDocs([]); return; }
      setDocs((d.documents ?? []) as ComplianceDoc[]);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => { if (selectedId) void loadDocs(selectedId); else setDocs([]); }, [selectedId, loadDocs]);
  useEffect(() => { if (selectedId) void loadMembers(selectedId); else setMembers([]); }, [selectedId, loadMembers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) =>
      [p.legalName, p.tradeName, p.partnerCode, p.city].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [partners, query]);

  const selected = partners.find((p) => p.id === selectedId) ?? null;
  const onboardingTenantId = selected?.onboardedByTenantId ?? null;

  // The onboarding tenant's roles a partner user may be given.
  useEffect(() => {
    setTenantChoice(onboardingTenantId ?? '');
    if (!onboardingTenantId) { setTenantRoles([]); setInviteTenantRoleId(''); return; }
    void (async () => {
      const r = await fetch(`/api/admin/roles?tenantId=${encodeURIComponent(onboardingTenantId)}&lite=true`);
      const list = r.ok ? ((await r.json().catch(() => [])) as TenantRole[]) : [];
      const roles = (Array.isArray(list) ? list : []).filter((x) => !NON_GRANTABLE_TENANT_ROLES.includes(x.code));
      setTenantRoles(roles);
      const preferred = DEFAULT_TENANT_ROLE_CODES.map((c) => roles.find((x) => x.code === c)).find(Boolean);
      setInviteTenantRoleId((preferred ?? roles[0])?.id ?? '');
    })();
  }, [onboardingTenantId]);

  const saveOnboardingTenant = async () => {
    if (!selected || !tenantChoice) return;
    const partnerId = selected.id;
    setTenantBusy(true); setTenantError(null);
    try {
      const r = await fetch(`/api/admin/exchange/partners/${encodeURIComponent(partnerId)}/onboarding-tenant`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardedByTenantId: tenantChoice }),
      });
      const d = await readJson(r);
      if (!r.ok) { setTenantError(errorOf(d, r.status)); return; }
      setPartners((list) => list.map((p) => (p.id === partnerId
        ? { ...p, onboardedByTenantId: d.onboardedByTenantId as string, onboardedByTenantName: d.onboardedByTenantName as string }
        : p)));
    } catch (err) {
      setTenantError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTenantBusy(false);
    }
  };

  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !inviteEmail.trim()) return;
    const partnerId = selected.id;
    setBusy(true); setMemberError(null); setInviteNotice(null);
    try {
      const r = await fetch(`/api/admin/exchange/partners/${encodeURIComponent(partnerId)}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), partnerRole: inviteRole, roleId: inviteTenantRoleId }),
      });
      const d = await readJson(r);
      if (!r.ok) { setMemberError(errorOf(d, r.status)); return; }
      setInviteNotice(d.emailed
        ? { text: `Invitation emailed to ${inviteEmail.trim()}. They appear under Users once they accept.` }
        : { text: `The invitation was created but the email could not be sent. Send this link to ${inviteEmail.trim()} yourself:`, link: d.acceptUrl as string });
      setInviteEmail('');
      await loadInvites(partnerId);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (inv: Invitation) => {
    if (!selected) return;
    if (!window.confirm(`Revoke the invitation for ${inv.email}? The link stops working.`)) return;
    const partnerId = selected.id;
    setBusy(true); setMemberError(null);
    try {
      const r = await fetch(`/api/admin/exchange/partners/${encodeURIComponent(partnerId)}/invitations?id=${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
      const d = await readJson(r);
      if (!r.ok) { setMemberError(errorOf(d, r.status)); return; }
      await loadInvites(partnerId);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  };

  // Refreshes the member list and the partner's member count.
  const afterMembershipChange = async (partnerId: string) => {
    await loadMembers(partnerId);
    const r = await fetch('/api/admin/exchange/partners');
    if (r.ok) setPartners(((await readJson(r)).partners ?? []) as Partner[]);
  };

  const reviewDoc = async (doc: ComplianceDoc, decision: 'APPROVE' | 'REJECT') => {
    if (!selected) return;
    const partnerId = selected.id;
    let note: string | null = null;
    if (decision === 'REJECT') {
      note = window.prompt(`Why is this ${DOC_TYPE_LABELS[doc.docType] ?? doc.docType} rejected? The partner will see this note.`);
      if (!note?.trim()) return;
    }
    setReviewingId(doc.id); setDocsError(null);
    try {
      const r = await fetch(
        `/api/admin/exchange/partners/${encodeURIComponent(partnerId)}/compliance/${encodeURIComponent(doc.id)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note }) },
      );
      const d = await readJson(r);
      if (!r.ok) { setDocsError(errorOf(d, r.status)); return; }
      await loadDocs(partnerId);
      const pending = docs.filter((x) => x.status === 'PENDING' && x.id !== doc.id).length;
      setPartners((list) => list.map((p) => (p.id === partnerId ? { ...p, pendingDocuments: pending } : p)));
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setReviewingId(null);
    }
  };

  const setServiceArea = async (domain: string, approved: boolean) => {
    if (!selected) return;
    const partnerId = selected.id;
    setServiceBusy(domain); setServiceError(null);
    try {
      const r = await fetch(`/api/admin/exchange/partners/${encodeURIComponent(partnerId)}/services`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, approved }),
      });
      const d = await readJson(r);
      if (!r.ok) { setServiceError(errorOf(d, r.status)); return; }
      const approvedDomains = (d.approvedDomains ?? []) as string[];
      setPartners((list) => list.map((p) => (p.id === partnerId ? { ...p, approvedDomains } : p)));
    } catch (err) {
      setServiceError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setServiceBusy(null);
    }
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
        subtitle="Transport partners of the Fleet360 Exchange, their approved services and the users who act for them"
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
          <label className="block text-xs font-medium text-[var(--text-muted)] md:max-w-md">
            Onboarded by tenant *
            <select
              className={`${input} mt-1`}
              required
              value={partnerForm.onboardedByTenantId}
              onChange={(e) => setPartnerForm((f) => ({ ...f, onboardedByTenantId: e.target.value }))}
            >
              <option value="">Select the tenant onboarding this partner</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <p className="text-xs text-[var(--text-muted)]">
            The partner code is permanent and unique: 2–24 letters, digits or dashes. The partner&rsquo;s users are
            created in the onboarding tenant&rsquo;s user list.
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
                        {p.approvedDomains.length === 0 && <span className="text-amber-400"> · no approved services</span>}
                        {p.pendingDocuments > 0 && (
                          <span className="text-amber-400"> · {p.pendingDocuments} {p.pendingDocuments === 1 ? 'document' : 'documents'} to review</span>
                        )}
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

              <div className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Building2 className="h-4 w-4" /> Onboarded by</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {selected.onboardedByTenantName
                    ? <>The partner&rsquo;s users are created in <strong className="text-[var(--text-main)]">{selected.onboardedByTenantName}</strong>&rsquo;s user list.</>
                    : 'No onboarding tenant yet. Choose one before inviting users.'}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select className={input} value={tenantChoice} onChange={(e) => setTenantChoice(e.target.value)} aria-label="Onboarding tenant">
                    <option value="">Select a tenant</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button
                    type="button"
                    className={`${primaryBtn} justify-center`}
                    disabled={tenantBusy || !tenantChoice || tenantChoice === selected.onboardedByTenantId}
                    onClick={() => void saveOnboardingTenant()}
                  >
                    {tenantBusy ? 'Saving…' : selected.onboardedByTenantId ? 'Change' : 'Set tenant'}
                  </button>
                </div>
                {tenantError && <p className="text-sm text-rose-400">{tenantError}</p>}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Approved services</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  The marketplace only shows a partner opportunities in the service areas it is approved for. Without
                  any, it sees only jobs a buyer invites it to directly.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SERVICE_AREAS.map((area) => {
                    const on = selected.approvedDomains.includes(area.value);
                    return (
                      <label
                        key={area.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${on ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-[var(--border-subtle)]'}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-cyan-500"
                          checked={on}
                          disabled={serviceBusy !== null}
                          onChange={(e) => void setServiceArea(area.value, e.target.checked)}
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            {area.label}{serviceBusy === area.value ? ' · saving…' : ''}
                          </span>
                          <span className="block text-xs text-[var(--text-muted)]">{area.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {serviceError && <p className="text-sm text-rose-400">{serviceError}</p>}
              </div>

              <div className="space-y-2 border-t border-[var(--border-subtle)] pt-5">
                <h3 className="text-sm font-semibold">Compliance documents</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Documents the partner uploads stay pending until you approve them. Rejecting one asks for a note the partner sees.
                </p>
                {docsError && <p className="text-sm text-rose-400">{docsError}</p>}
                {docsLoading ? (
                  <p className="py-3 text-xs text-[var(--text-muted)]">Loading documents…</p>
                ) : docs.length === 0 ? (
                  <p className="py-3 text-xs text-[var(--text-muted)]">No documents uploaded yet.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                    {docs.map((doc) => {
                      const href = safeHref(doc.fileUrl);
                      return (
                        <li key={doc.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${DOC_STATUS_STYLES[doc.status] ?? 'bg-slate-500/15 text-[var(--text-muted)]'}`}>
                                {doc.status}
                              </span>
                            </div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {doc.docNumber ? `No. ${doc.docNumber}` : 'No number'}
                              {doc.expiryDate ? ` · expires ${new Date(doc.expiryDate).toLocaleDateString()}` : ' · no expiry'}
                              {` · uploaded ${new Date(doc.createdAt).toLocaleDateString()}`}
                            </div>
                            {doc.reviewNote && <div className="text-xs text-rose-300">Note: {doc.reviewNote}</div>}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
                                <ExternalLink className="h-4 w-4" /> View
                              </a>
                            ) : (
                              <span className="text-xs text-[var(--text-muted)]">No viewable file</span>
                            )}
                            {doc.status !== 'VALID' && (
                              <button type="button" className={primaryBtn} disabled={reviewingId !== null} onClick={() => void reviewDoc(doc, 'APPROVE')}>
                                {reviewingId === doc.id ? 'Saving…' : 'Approve'}
                              </button>
                            )}
                            {doc.status !== 'REJECTED' && (
                              <button
                                type="button"
                                className={`${ghostBtn} hover:text-rose-400`}
                                disabled={reviewingId !== null}
                                onClick={() => void reviewDoc(doc, 'REJECT')}
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-5">
                <h3 className="text-sm font-semibold">Users</h3>
                <div className="inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5 text-xs">
                  {([['invite', 'Invite new user'], ['link', 'Link existing user']] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => { setUserMode(mode); setMemberError(null); setInviteNotice(null); }}
                      className={`rounded-md px-2.5 py-1 ${userMode === mode ? 'bg-cyan-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {userMode === 'invite' ? (
                !selected.onboardedByTenantId ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    Set the tenant that onboarded this partner (above) before inviting its users.
                  </p>
                ) : (
                  <form onSubmit={inviteUser} className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="email"
                        required
                        className={input}
                        placeholder="Email of the new user"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                      <select className={`${input} sm:w-40`} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} aria-label="Partner role">
                        {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      <select
                        className={`${input} sm:w-48`}
                        required
                        value={inviteTenantRoleId}
                        onChange={(e) => setInviteTenantRoleId(e.target.value)}
                        aria-label={`Role in ${selected.onboardedByTenantName ?? 'the tenant'}`}
                      >
                        {tenantRoles.length === 0 && <option value="">No roles available</option>}
                        {tenantRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <button type="submit" className={`${primaryBtn} justify-center`} disabled={busy || !inviteTenantRoleId}>
                        <Mail className="h-4 w-4" /> Invite
                      </button>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Partner role: {ROLES.find((r) => r.value === inviteRole)?.hint}. The second list is their role in{' '}
                      {selected.onboardedByTenantName}. They get an email to set their password; accepting creates them in that
                      tenant&rsquo;s user list and links them to {selected.legalName}.
                    </p>
                    {inviteNotice && (
                      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-[var(--text-main)]">
                        {inviteNotice.text}
                        {inviteNotice.link && <code className="mt-1 block break-all text-cyan-300">{inviteNotice.link}</code>}
                      </div>
                    )}
                  </form>
                )
              ) : (
              <>
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
              </>
              )}

              {memberError && <p className="text-sm text-rose-400">{memberError}</p>}

              {invites.some((i) => i.status === 'pending') && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Pending invitations</h4>
                  <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                    {invites.filter((i) => i.status === 'pending').map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{inv.email}</div>
                          <div className="text-xs text-[var(--text-muted)]">
                            {ROLES.find((r) => r.value === inv.partnerRole)?.label ?? inv.partnerRole}
                            {inv.tenantRoleName ? ` · ${inv.tenantRoleName} in ${inv.tenantName ?? 'tenant'}` : ''}
                            {` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVITE_STATUS_STYLES[inv.status]}`}>{inv.status}</span>
                          <button
                            type="button"
                            aria-label={`Revoke invitation for ${inv.email}`}
                            onClick={() => void revokeInvite(inv)}
                            disabled={busy}
                            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
