'use client';
/**
 * /logistics/shippers — operator console for onboarding shippers.
 *
 * Model A: a shipper IS a customer. This console is the freight-onboarding view
 * of the tenant's customers — capture trade-license / TRN / credit, advance the
 * onboarding + compliance lifecycle, and grant portal access (which reuses the
 * existing customer_portal invitation flow). Once a customer has portal access,
 * they track their job orders in the existing shipper portal.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Building2, Plus, X, ShieldCheck, Mail, Phone, FileText,
  CheckCircle2, Clock, Users, BadgeCheck, Send, PackageCheck, Inbox, AlertCircle, Copy,
} from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/ui/page-theme';
import LogisticsDataGrid, { type DataGridColumn } from '@/components/logistics/LogisticsDataGrid';

interface Shipper {
  id: string;
  name: string;
  customerCode: string | null;
  email: string | null;
  phone: string | null;
  tradeLicense: string | null;
  taxRegistrationNumber: string | null;
  creditLimit: number | null;
  onboardingStatus: string;
  complianceStatus: string;
  trackingLevel: string | null;
  activePortalUsers: number;
  pendingPortalUsers: number;
  portalEnabled: boolean;
  shipmentOrderCount: number;
  openRequestCount: number;
}

const ONBOARDING_STATES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUSPENDED'];
const COMPLIANCE_STATES = ['PENDING', 'VERIFIED', 'REJECTED'];

const chipColor = (s: string): string => {
  switch (s) {
    case 'APPROVED': case 'VERIFIED': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'IN_REVIEW': case 'PENDING': return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'SUSPENDED': case 'REJECTED': return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    default: return 'bg-slate-600/30 text-slate-300 border-slate-500/40';
  }
};
function Chip({ value }: { value: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${chipColor(value)}`}>{value.replace(/_/g, ' ')}</span>;
}

const EMPTY_FORM = {
  name: '', email: '', phone: '', tradeLicense: '', taxRegistrationNumber: '', creditLimit: '',
};

export default function ShippersPage() {
  const [shippers, setShippers] = useState<Shipper[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Shipper | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('onboardingStatus', statusFilter);
      const res = await fetch(`/api/logistics/shippers?${qs.toString()}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setShippers(body.data ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const submit = async () => {
    if (!form.name.trim()) { setFormError('Shipper name is required.'); return; }
    setSaving(true); setFormError(null);
    try {
      const res = await fetch('/api/logistics/shippers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to onboard shipper');
      setShowForm(false); setForm({ ...EMPTY_FORM });
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to onboard shipper');
    } finally { setSaving(false); }
  };

  const total = shippers.length;
  const approved = shippers.filter(s => s.onboardingStatus === 'APPROVED').length;
  const inOnboarding = shippers.filter(s => s.onboardingStatus !== 'APPROVED' && s.onboardingStatus !== 'SUSPENDED').length;
  const withPortal = shippers.filter(s => s.portalEnabled).length;

  const columns = useMemo<DataGridColumn<Shipper>[]>(() => [
    {
      key: 'shipper', header: 'Shipper', accessor: s => s.name,
      render: s => (<div><div className="text-white font-medium">{s.name}</div><div className="text-xs text-slate-500 font-mono">{s.customerCode ?? '—'}</div></div>),
    },
    {
      key: 'contact', header: 'Contact', accessor: s => s.email ?? '',
      render: s => (<div><div className="text-slate-300">{s.email ?? '—'}</div><div className="text-xs text-slate-500">{s.phone ?? ''}</div></div>),
    },
    { key: 'onboarding', header: 'Onboarding', accessor: s => s.onboardingStatus, filter: 'select', render: s => <Chip value={s.onboardingStatus} /> },
    { key: 'compliance', header: 'Compliance', accessor: s => s.complianceStatus, filter: 'select', render: s => <Chip value={s.complianceStatus} /> },
    {
      key: 'portal', header: 'Portal', filter: 'select',
      accessor: s => s.activePortalUsers > 0 ? 'Active' : s.pendingPortalUsers > 0 ? 'Invited' : 'None',
      render: s => s.activePortalUsers > 0
        ? <span className="text-emerald-300 text-xs inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> {s.activePortalUsers} active</span>
        : s.pendingPortalUsers > 0
          ? <span className="text-amber-300 text-xs">{s.pendingPortalUsers} invited</span>
          : <span className="text-slate-600 text-xs">—</span>,
    },
    {
      key: 'activity', header: 'Activity', align: 'right', filter: false, accessor: s => s.shipmentOrderCount,
      render: s => (<span className="text-xs text-slate-400">
        <span title="Job orders" className="inline-flex items-center gap-1"><PackageCheck className="w-3 h-3" /> {s.shipmentOrderCount}</span>
        <span className="mx-1.5 text-slate-700">·</span>
        <span title="Open requests" className="inline-flex items-center gap-1"><Inbox className="w-3 h-3" /> {s.openRequestCount}</span>
      </span>),
    },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shippers"
        subtitle="Onboard cargo owners, verify compliance, and grant tracking-portal access"
        icon={Building2}
        accent="emerald"
        actions={
          <button type="button" onClick={() => { setForm({ ...EMPTY_FORM }); setFormError(null); setShowForm(true); }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-emerald-500/30">
            <Plus className="w-4 h-4" /> Onboard shipper
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Shippers"       value={total}        sub="In your network"     icon={Users}        accent="emerald" />
        <KpiCard label="Approved"       value={approved}     sub="Onboarding complete"  icon={CheckCircle2} accent="emerald" />
        <KpiCard label="In onboarding"  value={inOnboarding} sub="Draft / under review" icon={Clock}        accent="amber"   />
        <KpiCard label="Portal access"  value={withPortal}   sub="Can self-track"       icon={ShieldCheck}  accent="emerald" />
      </div>

      <LogisticsDataGrid
        rows={shippers}
        columns={columns}
        getRowId={s => s.id}
        onRowClick={s => setSelected(s)}
        selectedId={selected?.id ?? null}
        loading={loading}
        emptyMessage="No shippers yet — onboard your first cargo owner."
        toolbar={{
          title: 'Shipper network',
          exportName: 'shippers',
          actions: (
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/40">
              <option value="">All onboarding</option>
              {ONBOARDING_STATES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          ),
        }}
      />

      {showForm && (
        <OnboardDrawer
          form={form} setForm={setForm} saving={saving} error={formError}
          onClose={() => setShowForm(false)} onSubmit={submit}
        />
      )}

      {selected && (
        <ShipperDetail
          shipper={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => { setShippers(prev => prev.map(s => s.id === updated.id ? updated : s)); setSelected(updated); }}
        />
      )}
    </div>
  );
}

/* ── Onboard drawer ───────────────────────────────────────────────────────── */
function OnboardDrawer({
  form, setForm, saving, error, onClose, onSubmit,
}: {
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  saving: boolean; error: string | null;
  onClose: () => void; onSubmit: () => void;
}) {
  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-slate-950 border-l border-white/10 h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Building2 className="w-5 h-5 text-emerald-300" /> Onboard shipper</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-slate-500">Creates a customer record (the shipper identity). You can grant portal access from the shipper&rsquo;s detail panel once onboarded.</p>
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

        <Field label="Company name *"><input value={form.name} onChange={set('name')} className={inputCls} placeholder="Albs Trans LLC" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trade license"><input value={form.tradeLicense} onChange={set('tradeLicense')} className={inputCls} placeholder="CN-1234567" /></Field>
          <Field label="TRN / VAT no."><input value={form.taxRegistrationNumber} onChange={set('taxRegistrationNumber')} className={inputCls} placeholder="1003…" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><input value={form.email} onChange={set('email')} className={inputCls} placeholder="ops@shipper.com" /></Field>
          <Field label="Phone"><input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+9715…" /></Field>
        </div>
        <Field label="Credit limit (AED)"><input value={form.creditLimit} onChange={set('creditLimit')} className={inputCls} placeholder="50000" inputMode="decimal" /></Field>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onSubmit} disabled={saving}
            className="flex-1 rounded-xl bg-emerald-600 text-white font-medium px-4 py-2.5 text-sm hover:bg-emerald-500 disabled:opacity-50">
            {saving ? 'Onboarding…' : 'Onboard shipper'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 text-slate-300 px-4 py-2.5 text-sm hover:bg-slate-800">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail / status + grant-access drawer ────────────────────────────────── */
function ShipperDetail({
  shipper, onClose, onSaved,
}: {
  shipper: Shipper;
  onClose: () => void;
  onSaved: (s: Shipper) => void;
}) {
  const [onboarding, setOnboarding] = useState(shipper.onboardingStatus);
  const [compliance, setCompliance] = useState(shipper.complianceStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grant-access state
  const [inviteEmail, setInviteEmail] = useState(shipper.email ?? '');
  const [inviteName, setInviteName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ setupUrl: string; emailSent: boolean; emailError: string | null } | null>(null);

  const dirty = onboarding !== shipper.onboardingStatus || compliance !== shipper.complianceStatus;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/logistics/shippers/${shipper.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingStatus: onboarding, complianceStatus: compliance }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to update shipper');
      onSaved(body.data as Shipper);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update shipper'); }
    finally { setSaving(false); }
  };

  const grantAccess = async () => {
    if (!inviteEmail.trim()) { setInviteError('Email is required.'); return; }
    setInviting(true); setInviteError(null); setInviteResult(null);
    try {
      const res = await fetch(`/api/admin/customers/${shipper.id}/portal-invitations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), fullName: inviteName.trim() || undefined, role: 'SHIPPER_ADMIN' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to grant access');
      setInviteResult({ setupUrl: body.invitation?.setupUrl ?? '', emailSent: !!body.emailSent, emailError: body.emailError ?? null });
      onSaved({ ...shipper, pendingPortalUsers: shipper.pendingPortalUsers + 1, portalEnabled: true });
    } catch (e) { setInviteError(e instanceof Error ? e.message : 'Failed to grant access'); }
    finally { setInviting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-slate-950 border-l border-white/10 h-full overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{shipper.name}</h2>
            <p className="text-xs text-slate-500 font-mono">{shipper.customerCode ?? '—'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info icon={FileText} label="Trade license" value={shipper.tradeLicense} />
          <Info icon={ShieldCheck} label="TRN / VAT" value={shipper.taxRegistrationNumber} />
          <Info icon={Mail} label="Email" value={shipper.email} />
          <Info icon={Phone} label="Phone" value={shipper.phone} />
          <Info icon={PackageCheck} label="Job orders" value={String(shipper.shipmentOrderCount)} />
          <Info icon={BadgeCheck} label="Credit limit" value={shipper.creditLimit != null ? `AED ${shipper.creditLimit.toLocaleString()}` : null} />
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500 font-medium">Onboarding & compliance</h3>
          {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
          <SelectRow label="Onboarding" value={onboarding} options={ONBOARDING_STATES} onChange={setOnboarding} />
          <SelectRow label="Compliance" value={compliance} options={COMPLIANCE_STATES} onChange={setCompliance} />
          <button type="button" onClick={save} disabled={saving || !dirty}
            className="w-full rounded-xl bg-emerald-600 text-white font-medium px-4 py-2.5 text-sm hover:bg-emerald-500 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500 font-medium flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Portal access</h3>
          <p className="text-xs text-slate-500">
            {shipper.activePortalUsers > 0
              ? `${shipper.activePortalUsers} active user(s). Invite another below.`
              : shipper.pendingPortalUsers > 0
                ? `${shipper.pendingPortalUsers} pending invitation(s). Resend below.`
                : 'Invite a user so the shipper can submit requests and track their job orders.'}
          </p>
          {inviteError && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{inviteError}</div>}
          {inviteResult ? (
            <div className="space-y-2">
              {inviteResult.emailSent ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /> Invitation created &amp; emailed to the shipper.
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium"><AlertCircle className="w-4 h-4 shrink-0" /> Invitation created — but the email could not be sent.</div>
                  <p className="text-xs text-amber-200/80">{inviteResult.emailError ?? 'No email transport is configured.'} Copy the setup link below and send it to the shipper yourself.</p>
                </div>
              )}
              {inviteResult.setupUrl && (
                <div className="rounded-lg border border-white/10 bg-slate-900/60 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">Setup link</span>
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(inviteResult.setupUrl); }}
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200">
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-300 font-mono break-all">{inviteResult.setupUrl}</div>
                  <p className="text-[10px] text-slate-500">Opens against this server. For an external shipper, the app must be reachable at a public URL — set <span className="font-mono">NEXT_PUBLIC_APP_URL</span> accordingly.</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} className={inputCls} placeholder="user@shipper.com" />
                <input value={inviteName} onChange={e => setInviteName(e.target.value)} className={inputCls} placeholder="Full name (optional)" />
              </div>
              <button type="button" onClick={grantAccess} disabled={inviting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium px-4 py-2.5 text-sm hover:opacity-90 disabled:opacity-50">
                <Send className="w-4 h-4" /> {inviting ? 'Granting…' : 'Grant portal access'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── small bits ───────────────────────────────────────────────────────────── */
const inputCls = 'w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/40 mt-1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-slate-500">{label}</label>
      {children}
    </div>
  );
}
function Info({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
      <div className="text-slate-200 mt-0.5 truncate">{value || '—'}</div>
    </div>
  );
}
function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-400">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-slate-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500/40">
        {options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </div>
  );
}
