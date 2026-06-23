'use client';

/**
 * /admin/shipper-portal-config — single page that lets a tenant admin:
 *   • Set the tenant-wide default tracking-visibility level
 *   • See every customer's current portal status + visibility level
 *   • Change per-customer defaults via the modal
 *   • Invite a portal user for a customer that doesn't have one yet
 *
 * Per-shipment overrides happen on the (existing) operator-side shipment
 * detail page, NOT here — this page is about customer + tenant-level config.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ship, Settings, Mail, UserPlus, RefreshCw, Activity, Eye, Navigation, ShieldOff,
  Search, AlertCircle, CheckCircle2, Clock,
} from 'lucide-react';
import { TrackingVisibilityModal } from '@/components/TrackingVisibilityModal';
import type { TrackingLevel } from '@/lib/shipper-portal/visibility';

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  trackingLevel: TrackingLevel;
  usingDefault: boolean;
  activeUserCount: number;
  pendingUserCount: number;
  pendingInvitationCount: number;
  lastLoginAt: string | null;
}

const LEVEL_META: Record<TrackingLevel, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  NONE:           { label: 'Notifications only', icon: ShieldOff,  tone: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  STATUS_ONLY:    { label: 'Status updates',     icon: Eye,        tone: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  STATUS_AND_ETA: { label: 'Status + ETA',       icon: Navigation, tone: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  FULL_TRACKING:  { label: 'Live tracking',      icon: Activity,   tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
};

export default function ShipperPortalConfigPage() {
  const [tenantDefault, setTenantDefault] = useState<TrackingLevel | null>(null);
  const [customers, setCustomers]         = useState<CustomerRow[]>([]);
  const [search, setSearch]               = useState('');
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);

  // Modal state: tenant-default, customer-default, or null (closed)
  const [editing, setEditing] = useState<
    | { kind: 'tenant';   current: TrackingLevel }
    | { kind: 'customer'; current: TrackingLevel; customerId: string; customerName: string }
    | null
  >(null);

  // Inviting state — keyed by customer id; opens an inline form
  const [inviting, setInviting] = useState<{ customerId: string; customerName: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tenantRes, customersRes] = await Promise.all([
        fetch('/api/admin/tenant-settings/tracking-visibility'),
        fetch('/api/admin/customers/portal-status'),
      ]);
      if (tenantRes.ok) {
        const t = await tenantRes.json();
        setTenantDefault(t.level as TrackingLevel);
      }
      if (customersRes.ok) {
        const c = await customersRes.json();
        setCustomers(c.customers ?? []);
      } else {
        setError(`Failed to load customers (${customersRes.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q)
      || (c.email ?? '').toLowerCase().includes(q),
    );
  }, [customers, search]);

  const stats = useMemo(() => ({
    total: customers.length,
    onboarded: customers.filter(c => c.activeUserCount > 0).length,
    pending: customers.filter(c => c.pendingInvitationCount > 0 || c.pendingUserCount > 0).length,
    notInvited: customers.filter(c => c.activeUserCount === 0 && c.pendingInvitationCount === 0 && c.pendingUserCount === 0).length,
  }), [customers]);

  // ── Save handlers ────────────────────────────────────────────────────

  const saveTenantDefault = async (args: { level: TrackingLevel | null; reason: string | null }) => {
    if (!args.level) return; // tenant level can't be null
    const res = await fetch('/api/admin/tenant-settings/tracking-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: args.level }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.error ?? 'Update failed');
    }
    setTenantDefault(args.level);
    await load();
  };

  const saveCustomerLevel = async (customerId: string, args: { level: TrackingLevel | null; reason: string | null }) => {
    if (!args.level) return;
    const res = await fetch(`/api/admin/customers/${customerId}/tracking-visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: args.level }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.error ?? 'Update failed');
    }
    await load();
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center">
          <Ship className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Shipper Portal Configuration</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage portal access and tracking visibility per customer. Per-shipment overrides live on each shipment's detail page.
          </p>
        </div>
        <SeedDemoButton onSeeded={() => void load()} />
        <button onClick={() => void load()}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tenant default */}
      <div className="bg-gradient-to-br from-emerald-900/30 to-slate-900 border border-emerald-500/30 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Settings className="w-5 h-5 text-emerald-300 mt-1" />
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wider text-emerald-300/80">Tenant default</p>
            <p className="text-sm text-white mt-1">
              When a customer hasn't been given a specific level, shipments default to:
            </p>
            {tenantDefault && (
              <div className="mt-2 inline-flex items-center gap-2">
                <LevelPill level={tenantDefault} />
                <button onClick={() => setEditing({ kind: 'tenant', current: tenantDefault })}
                  className="text-xs text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline">
                  Change
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Customers"      value={stats.total}     tone="slate" />
        <StatCard label="Onboarded"      value={stats.onboarded} tone="emerald" icon={CheckCircle2} />
        <StatCard label="Pending invite" value={stats.pending}   tone="amber"   icon={Clock} />
        <StatCard label="Not invited"    value={stats.notInvited} tone="rose"   icon={AlertCircle} />
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customers by name or email…"
          className="w-full bg-slate-900 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>

      {/* Customers table */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/40 text-slate-400 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5 text-left">Customer</th>
              <th className="px-4 py-2.5 text-left">Portal access</th>
              <th className="px-4 py-2.5 text-left">Tracking visibility</th>
              <th className="px-4 py-2.5 text-left">Last login</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td colSpan={5} className="px-4 py-3"><div className="h-5 rounded bg-slate-800/60 animate-pulse" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500 text-sm">
                {customers.length === 0 ? 'No customers yet.' : 'No customers match your search.'}
              </td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{c.name}</p>
                    {c.email && <p className="text-[11px] text-slate-500">{c.email}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {c.activeUserCount > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" /> {c.activeUserCount} active user{c.activeUserCount === 1 ? '' : 's'}
                      </span>
                    ) : c.pendingInvitationCount > 0 || c.pendingUserCount > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">Not invited</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <LevelPill level={c.trackingLevel} />
                      {c.usingDefault && (
                        <span className="text-[10px] text-slate-500 italic">(inherited)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {c.lastLoginAt ? formatRelative(c.lastLoginAt) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing({
                      kind: 'customer',
                      current: c.trackingLevel,
                      customerId: c.id,
                      customerName: c.name,
                    })}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-amber-300 hover:bg-amber-500/10 text-xs">
                      <Settings className="w-3 h-3" /> Visibility
                    </button>
                    <button onClick={() => setInviting({ customerId: c.id, customerName: c.name })}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-emerald-300 hover:bg-emerald-500/10 text-xs ml-1">
                      <UserPlus className="w-3 h-3" /> Invite
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Tenant-default modal */}
      {editing?.kind === 'tenant' && (
        <TrackingVisibilityModal
          title="Default tracking visibility for all customers"
          subtitle="Applies to every customer who hasn't been given a specific level."
          currentLevel={editing.current}
          onSave={saveTenantDefault}
          onClose={() => setEditing(null)} />
      )}

      {/* Customer-default modal */}
      {editing?.kind === 'customer' && (
        <TrackingVisibilityModal
          title={`Tracking visibility for ${editing.customerName}`}
          subtitle="Applies to every shipment of this customer unless explicitly overridden on the shipment."
          currentLevel={editing.current}
          onSave={(args) => saveCustomerLevel(editing.customerId, args)}
          onClose={() => setEditing(null)} />
      )}

      {/* Invite modal */}
      {inviting && (
        <InvitePortalUserModal
          customerId={inviting.customerId}
          customerName={inviting.customerName}
          onClose={() => setInviting(null)}
          onInvited={() => { setInviting(null); void load(); }} />
      )}
    </div>
  );
}

// ── Seed-demo button (dev/QA convenience) ─────────────────────────────

function SeedDemoButton({ onSeeded }: { onSeeded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ setupUrl: string; shipments: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const seed = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/shipper-portal/seed-demo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Seed failed'); return; }
      setResult({ setupUrl: data.setupUrl, shipments: (data.shipmentsCreated ?? []).length });
      onSeeded();
    } finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={seed} disabled={busy}
        title="Create a demo customer + portal user + sample shipments"
        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-50">
        <Settings className="w-3.5 h-3.5" /> {busy ? 'Seeding…' : 'Seed demo'}
      </button>
      {(result || err) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => { setResult(null); setErr(null); }}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3"
            onClick={e => e.stopPropagation()}>
            {err ? (
              <>
                <p className="text-sm font-bold text-rose-300 inline-flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Seed failed
                </p>
                <p className="text-xs text-slate-400">{err}</p>
              </>
            ) : result && (
              <>
                <p className="text-sm font-bold text-white inline-flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" /> Demo data created
                </p>
                <p className="text-xs text-slate-400">
                  Created a demo customer, a portal user, and {result.shipments} sample shipments.
                  Open the setup link in an incognito window to log in as the shipper.
                </p>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Setup link</p>
                  <input readOnly value={result.setupUrl}
                    onClick={e => (e.target as HTMLInputElement).select()}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </>
            )}
            <div className="flex justify-end">
              <button onClick={() => { setResult(null); setErr(null); }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Inline invitation modal ───────────────────────────────────────────

function InvitePortalUserModal({
  customerId, customerName, onClose, onInvited,
}: {
  customerId: string;
  customerName: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail]       = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [result, setResult]     = useState<{ setupUrl: string; emailSent: boolean } | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/portal-invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error ?? 'Invite failed'); return; }
      setResult({ setupUrl: data.invitation.setupUrl, emailSent: data.emailSent });
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-emerald-300" />
          <h2 className="text-base font-bold text-white">Invite portal user — {customerName}</h2>
        </div>

        {result ? (
          <div className="p-5 space-y-3">
            <div className={`rounded-lg border p-3 ${
              result.emailSent
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-amber-500/10 border-amber-500/30'
            }`}>
              <p className="text-sm font-bold text-white inline-flex items-center gap-2">
                {result.emailSent
                  ? <><CheckCircle2 className="w-4 h-4 text-emerald-300" /> Invitation sent</>
                  : <><AlertCircle className="w-4 h-4 text-amber-300" /> Invitation created — email not sent</>}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {result.emailSent
                  ? 'The invitee will receive a setup link by email.'
                  : 'SMTP is not configured. Copy the link below and share it manually.'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Setup link</p>
              <input readOnly value={result.setupUrl}
                onClick={e => (e.target as HTMLInputElement).select()}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              <p className="text-[10px] text-slate-500 mt-1">Single-use, expires in 7 days.</p>
            </div>
            <div className="flex justify-end">
              <button onClick={onInvited}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            <Field label="Email" required>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="ahmed@acme.com"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </Field>
            <Field label="Full name (optional)">
              <input value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Ahmed Khan"
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </Field>
            {err && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" /> {err}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose}
                className="px-3 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
              <button onClick={submit} disabled={busy || !email.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
                <Mail className="w-4 h-4" /> {busy ? 'Sending…' : 'Send invitation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Re-usable bits ─────────────────────────────────────────────────────

function LevelPill({ level }: { level: TrackingLevel }) {
  const m = LEVEL_META[level];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${m.tone}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
}

function StatCard({
  label, value, tone, icon: Icon,
}: {
  label: string; value: number;
  tone: 'slate' | 'emerald' | 'amber' | 'rose';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const cls = {
    slate:   'bg-slate-700/30   border-white/10       text-slate-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
    amber:   'bg-amber-500/10   border-amber-500/30   text-amber-300',
    rose:    'bg-rose-500/10    border-rose-500/30    text-rose-300',
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
        {Icon && <Icon className="w-3.5 h-3.5 opacity-70" />}
      </div>
      <p className="text-2xl font-bold tabular-nums mt-1">{value.toLocaleString()}</p>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {label}{required && <span className="text-rose-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
    if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return iso; }
}
