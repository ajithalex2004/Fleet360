'use client';

/**
 * /admin/tenants/[id]/branding
 * Configure white-label fields and preview them live on a mock card.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Palette, Save, AlertCircle, ArrowLeft, Upload } from 'lucide-react';

interface Branding {
  productName:  string | null;
  tagline:      string | null;
  logoUrl:      string | null;
  faviconUrl:   string | null;
  primaryColor: string | null;
  accentColor:  string | null;
}

export default function BrandingPage() {
  const params   = useParams<{ id: string }>();
  const tenantId = params?.id ?? '';

  const [tenantName, setTenantName] = useState('');
  const [loading, setLoading] = useState(true);
  const [productName,  setProductName]  = useState('');
  const [tagline,      setTagline]      = useState('');
  const [logoUrl,      setLogoUrl]      = useState('');
  const [faviconUrl,   setFaviconUrl]   = useState('');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [accentColor,  setAccentColor]  = useState('#7c3aed');

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [bRes, tRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}/branding`),
        fetch(`/api/admin/tenants/${tenantId}`),
      ]);
      if (bRes.ok) {
        const data = await bRes.json();
        const b: Branding | null = data.branding;
        if (b) {
          setProductName(b.productName ?? '');
          setTagline(b.tagline ?? '');
          setLogoUrl(b.logoUrl ?? '');
          setFaviconUrl(b.faviconUrl ?? '');
          if (b.primaryColor) setPrimaryColor(b.primaryColor);
          if (b.accentColor)  setAccentColor(b.accentColor);
        }
      }
      if (tRes.ok) {
        const t = await tRes.json();
        setTenantName(t?.name ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName, tagline, logoUrl, faviconUrl,
          primaryColor, accentColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? 'Failed to save'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setUploading(true); setError(null); setSaved(false);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/tenants/${tenantId}/branding/logo`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? 'Upload failed'); return; }
      if (data.logoUrl) setLogoUrl(data.logoUrl);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Network error during upload.');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading branding…</div></div>;
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white inline-flex items-center gap-2">
            <Palette className="w-5 h-5 text-pink-400" /> White-label branding
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
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-300 text-sm">
          Saved. Reload any open tab to see the new branding applied.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6">
        {/* ─── form ─── */}
        <form onSubmit={save} className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Product name</label>
              <input value={productName} onChange={e => setProductName(e.target.value)}
                placeholder="e.g. Acme Mobility"
                maxLength={80}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Tagline</label>
              <input value={tagline} onChange={e => setTagline(e.target.value)}
                placeholder="Smart fleet for your team"
                maxLength={120}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Logo</label>
            <div className="flex items-center gap-2">
              <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                placeholder="https://cdn.example.com/logo.svg or upload below"
                className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-500" />
              <label className={`shrink-0 px-3 py-2.5 rounded-lg text-sm inline-flex items-center gap-2 cursor-pointer ${uploading ? 'bg-slate-700/50 text-slate-500' : 'bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/40 text-pink-200'}`}>
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading…' : 'Upload'}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
                  disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ''; }} />
              </label>
            </div>
            <p className="text-xs text-slate-500">PNG / JPEG / SVG / WebP, up to 1 MB. Around 200×40 px works best in the chrome.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Favicon URL (https)</label>
            <input value={faviconUrl} onChange={e => setFaviconUrl(e.target.value)}
              placeholder="https://cdn.example.com/favicon.png"
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ColorField label="Primary colour" value={primaryColor} onChange={setPrimaryColor} />
            <ColorField label="Accent colour"  value={accentColor}  onChange={setAccentColor} />
          </div>

          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-lg text-white font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-50"
            style={{ background: primaryColor }}>
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save branding'}
          </button>
        </form>

        {/* ─── live preview ─── */}
        <div className="space-y-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Live preview</div>

          <div className="bg-slate-950 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoUrl} alt="" className="h-8 max-w-[160px] object-contain" />
              ) : (
                <div className="text-2xl font-black text-white tracking-tight">
                  {productName || 'Your brand'}
                </div>
              )}
            </div>
            {tagline && <p className="text-slate-400 text-sm">{tagline}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: primaryColor }}>
                Primary action
              </button>
              <button type="button" className="px-4 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: accentColor }}>
                Accent action
              </button>
            </div>
          </div>

          <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4 text-xs text-slate-400 space-y-2">
            <p className="text-white font-semibold">Where this shows</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Document title + favicon (browser tab)</li>
              <li>CSS variables <code>--brand-primary</code> and <code>--brand-accent</code> available everywhere</li>
              <li><code>/api/branding?tenant=&lt;code&gt;</code> for unauthenticated lookups (login pages, white-label landing)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="h-10 w-14 rounded border border-white/10 bg-slate-800 cursor-pointer" />
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="#2563eb" maxLength={7}
          className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-500" />
      </div>
    </div>
  );
}
