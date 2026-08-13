'use client';

/**
 * /admin/tenants/[id]/sso
 * Configure OIDC SSO for the tenant: issuer, client ID/secret, allowed
 * email domains, JIT provisioning toggle, default role for new users.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Plus, X, Save, AlertCircle, ArrowLeft, Trash2, Eye, EyeOff } from 'lucide-react';

interface SsoConfig {
  id: string;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  allowedEmailDomains: string[];
  defaultRoleId: string | null;
  jitEnabled: boolean;
  isActive: boolean;
}

interface Role { id: string; name: string; code: string; }

export default function SsoConfigPage() {
  const params   = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';

  const [tenantName, setTenantName] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [config, setConfig] = useState<SsoConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [defaultRoleId, setDefaultRoleId] = useState<string>('');
  const [jitEnabled, setJitEnabled] = useState(true);
  const [isActive,    setIsActive]    = useState(true);

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [saved,  setSaved]  = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [ssoRes, tenantRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}/sso`),
        fetch(`/api/admin/tenants/${tenantId}`),
      ]);
      if (ssoRes.ok) {
        const data = await ssoRes.json();
        if (data.config) {
          const c: SsoConfig = data.config;
          setConfig(c);
          setIssuer(c.issuer);
          setClientId(c.clientId);
          setDomains(c.allowedEmailDomains);
          setDefaultRoleId(c.defaultRoleId ?? '');
          setJitEnabled(c.jitEnabled);
          setIsActive(c.isActive);
        }
      }
      if (tenantRes.ok) {
        const t = await tenantRes.json();
        setTenantName(t?.name ?? '');
        const list: Role[] = (t?.roles ?? []).map((r: { id: string; name: string; code: string }) => ({ id: r.id, name: r.name, code: r.code }));
        setRoles(list);
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const addDomain = () => {
    const d = domainInput.trim().toLowerCase();
    if (!d || domains.includes(d)) return;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      setError('Enter a valid domain like acme.com (no @, no protocol).'); return;
    }
    setDomains(prev => [...prev, d]);
    setDomainInput(''); setError(null);
  };

  const removeDomain = (d: string) => setDomains(prev => prev.filter(x => x !== d));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setSaved(false);
    if (!issuer || !clientId) { setError('Issuer and client ID are required.'); return; }
    if (domains.length === 0) { setError('At least one allowed email domain is required.'); return; }
    if (!config && !clientSecret) { setError('Client secret is required for the first save.'); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/sso`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuer: issuer.trim(),
          clientId: clientId.trim(),
          clientSecret: clientSecret || undefined,
          allowedEmailDomains: domains,
          defaultRoleId: defaultRoleId || null,
          jitEnabled,
          isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? 'Failed to save'); return; }
      setConfig(data.config);
      setClientSecret('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!config) return;
    if (!window.confirm('Delete the SSO configuration?\n\nUsers will fall back to password login on next sign-in.')) return;
    const res = await fetch(`/api/admin/tenants/${tenantId}/sso`, { method: 'DELETE' });
    if (!res.ok) { alert('Delete failed'); return; }
    setConfig(null); setIssuer(''); setClientId(''); setDomains([]);
    setDefaultRoleId(''); setJitEnabled(true); setIsActive(true);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading SSO config…</div></div>;
  }

  const baseUrl = (typeof window !== 'undefined' ? window.location.origin : '');
  const callbackUrl = `${baseUrl}/api/auth/sso/callback`;

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-violet-400" /> Single Sign-On (OIDC)
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {tenantName ? <>For <strong className="text-white">{tenantName}</strong></> : null}
          </p>
        </div>
        <Link href="/admin/tenants"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 border border-white/10 hover:border-white/20 hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Tenants
        </Link>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-300 text-sm">Saved.</div>
      )}

      <div className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-5 text-sm text-slate-300 space-y-2">
        <p className="text-white font-semibold">Configure your IdP to use this redirect URI:</p>
        <code className="block bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-emerald-300 break-all">
          {callbackUrl}
        </code>
        <p className="text-xs text-slate-500">Required scopes: <code>openid email profile</code>. PKCE (S256) is enforced.</p>
      </div>

      <form onSubmit={save} className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-5">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Issuer URL</label>
          <input value={issuer} onChange={e => setIssuer(e.target.value)} required
            placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
          <p className="text-xs text-slate-500">For Entra ID / Azure AD, Google Workspace, Okta, Auth0, etc — the well-known endpoint root.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Client ID</label>
            <input value={clientId} onChange={e => setClientId(e.target.value)} required
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Client Secret {config?.clientSecretSet ? <span className="text-emerald-400 normal-case">· stored</span> : null}
            </label>
            <div className="relative">
              <input type={showSecret ? 'text' : 'password'}
                value={clientSecret} onChange={e => setClientSecret(e.target.value)}
                placeholder={config?.clientSecretSet ? '•••••••• (leave blank to keep existing)' : ''}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 pr-12 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <button type="button" onClick={() => setShowSecret(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Allowed email domains ({domains.length}) — only emails from these domains can sign in via SSO
          </label>
          <div className="flex gap-2">
            <input value={domainInput} onChange={e => setDomainInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); }}}
              placeholder="acme.com"
              className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <button type="button" onClick={addDomain}
              className="px-3 py-2 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 rounded-lg text-violet-200 text-sm inline-flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {domains.map(d => (
              <span key={d} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/20 text-violet-200 border border-violet-500/40 text-xs">
                {d}
                <button type="button" onClick={() => removeDomain(d)} className="hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Default role for new users</label>
            <select value={defaultRoleId} onChange={e => setDefaultRoleId(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
              <option value="">Auto (TENANT_ADMIN)</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="space-y-3 pt-5">
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={jitEnabled} onChange={e => setJitEnabled(e.target.checked)}
                className="accent-violet-500" />
              <span>JIT provisioning — auto-create users on first SSO login</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                className="accent-violet-500" />
              <span>SSO is active</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm inline-flex items-center gap-2">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : config ? 'Update' : 'Save SSO config'}
          </button>
          {config && (
            <button type="button" onClick={remove}
              className="ml-auto px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-lg text-rose-300 text-sm inline-flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Delete config
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
