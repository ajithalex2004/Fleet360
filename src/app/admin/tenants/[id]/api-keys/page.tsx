'use client';

/**
 * /admin/tenants/[id]/api-keys
 * Manage tenant API keys: create (with optional scopes), list, revoke.
 * The plaintext key is displayed once, immediately after creation.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { KeyRound, Plus, Trash2, Copy, Check, AlertCircle, ArrowLeft, Eye, EyeOff } from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdBy: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revoked: boolean;
  revokedAt: string | null;
  createdAt: string;
}

const SUGGESTED_SCOPES = [
  'fleet.read', 'fleet.write',
  'bookings.read', 'bookings.write',
  'maintenance.read', 'maintenance.write',
  'finance.read', 'reports.read',
];

export default function TenantApiKeysPage() {
  const params = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';

  const [tenantName, setTenantName] = useState('');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Newly created key (shown once)
  const [newKey, setNewKey] = useState<{ name: string; plaintext: string } | null>(null);
  const [showPlain, setShowPlain] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const [keysRes, tenantRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}/api-keys`),
        fetch(`/api/admin/tenants/${tenantId}`),
      ]);
      if (!keysRes.ok) {
        const d = await keysRes.json().catch(() => ({}));
        throw new Error(d?.error ?? 'Failed to load API keys');
      }
      const data = await keysRes.json();
      setKeys(data.keys ?? []);
      if (tenantRes.ok) {
        const t = await tenantRes.json();
        setTenantName(t?.name ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setNewKey(null); setShowPlain(false); setCopied(false);
    if (!name.trim()) { setError('Name is required.'); return; }
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? 'Failed to create key.'); return; }
      setNewKey({ name: data.key.name, plaintext: data.key.plaintext });
      setName(''); setScopes([]);
      await load();
    } catch {
      setError('Network error.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!window.confirm(`Revoke key "${k.name}"?\n\nAny integration using this key will stop working immediately. This can't be undone.`)) return;
    const res = await fetch(`/api/admin/tenants/${tenantId}/api-keys/${k.id}/revoke`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d?.error ?? 'Revoke failed');
      return;
    }
    await load();
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleScope = (s: string) => {
    setScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading API keys…</div></div>;
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <Link href="/admin/tenants" className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3 h-3" /> Back to tenants
        </Link>
        <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-amber-400" /> API Keys
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          {tenantName ? <>For <strong className="text-white">{tenantName}</strong></> : null}
          <span className="ml-2 text-slate-500">· server-to-server integrations and ERP connectors</span>
        </p>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {newKey && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-300 font-semibold">
            <KeyRound className="w-5 h-5" /> Save this API key
          </div>
          <p className="text-sm text-slate-300">
            <strong>{newKey.name}</strong> — copy this key now. We don&rsquo;t store the
            plaintext, so you won&rsquo;t see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-900/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-emerald-300 break-all">
              {showPlain ? newKey.plaintext : newKey.plaintext.replace(/^(xlk_.{8}).*/, '$1' + '•'.repeat(40))}
            </code>
            <button onClick={() => setShowPlain(v => !v)}
              className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 text-sm inline-flex items-center gap-2">
              {showPlain ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showPlain ? 'Hide' : 'Show'}
            </button>
            <button onClick={() => copy(newKey.plaintext)}
              className="px-3 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-200 text-sm inline-flex items-center gap-2">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="bg-slate-900/40 border border-white/5 rounded-lg p-3 text-xs text-slate-400 font-mono overflow-x-auto">
{`curl -H "Authorization: Bearer ${showPlain ? newKey.plaintext : 'xlk_…'}" \\
  https://api.your-domain.com/v1/...`}
          </pre>
          <button onClick={() => setNewKey(null)}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Dismiss</button>
        </div>
      )}

      <form onSubmit={create} className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create new key
        </h2>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Acme ERP integration"
            className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            maxLength={80} required />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Scopes ({scopes.length}) — leave empty to grant tenant-wide access
          </label>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_SCOPES.map(s => (
              <button type="button" key={s} onClick={() => toggleScope(s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  scopes.includes(s)
                    ? 'bg-amber-500/30 text-amber-200 border-amber-500/60'
                    : 'bg-slate-800/50 text-slate-400 border-white/10 hover:border-white/30'
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={creating}
          className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg text-white font-semibold text-sm inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create API key'}
        </button>
      </form>

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-x-auto">
        {keys.length === 0 ? (
          <div className="text-center text-slate-400 py-8 text-sm">No API keys yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Name', 'Prefix', 'Scopes', 'Last used', 'Created', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-400 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id} className={`border-b border-white/5 hover:bg-white/5 ${k.revoked ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 text-sm text-white">{k.name}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-400">xlk_{k.prefix}…</td>
                  <td className="px-4 py-3">
                    {k.scopes.length === 0 ? (
                      <span className="text-xs text-slate-500 italic">tenant-wide</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map(s => (
                          <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">{s}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {k.lastUsedAt
                      ? <>{new Date(k.lastUsedAt).toLocaleString()}{k.lastUsedIp ? <span className="text-slate-500"> ({k.lastUsedIp})</span> : null}</>
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {new Date(k.createdAt).toLocaleString()}
                    {k.createdBy ? <div className="text-slate-500">by {k.createdBy}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                      k.revoked
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    }`}>
                      {k.revoked ? 'revoked' : 'active'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!k.revoked && (
                      <button onClick={() => revoke(k)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-5 text-xs text-slate-400 space-y-2">
        <p className="text-white font-semibold mb-1">How to use</p>
        <pre className="bg-slate-900/60 border border-white/5 rounded-lg p-3 font-mono overflow-x-auto">
{`curl -H "Authorization: Bearer xlk_..." \\
  https://api.your-domain.com/v1/...`}
        </pre>
        <p>Or send the key in <code>X-Api-Key</code> instead of <code>Authorization</code>.</p>
        <p>Keys with explicit scopes can only call routes that match the scope. Keys with no scopes
          have tenant-wide access — use only when integrating systems you fully trust.</p>
      </div>
    </div>
  );
}
