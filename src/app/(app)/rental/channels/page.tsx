'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Eye,
  KeyRound,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { formatRentalCategoryLabel } from '@/lib/rental/categories';

interface ChannelStat {
  tenantId?: string;
  key: string;
  label: string;
  category: 'internal' | 'ota' | 'fleet';
  supportsInboundWebhook: boolean;
  supportsOutboundSync: boolean;
  configured: boolean;
  isActive?: boolean;
  hasCustomSecret?: boolean;
  secretPreview?: string | null;
  commissionPct?: number;
  defaultMarkupPct?: number;
  autoConfirm?: boolean;
  outboundWebhookUrl?: string | null;
  lastSyncAt?: string | null;
  webhookUrl?: string | null;
  description: string;
  bookingCount: number;
  lastBookingAt: string | null;
}

interface AriCategoryLine {
  category: string;
  availableUnits: number;
  totalUnits: number;
  utilizationPct: number;
  status: 'OPEN' | 'STOP_SELL';
  baseDailyRate: number;
  channelDailyRate: number;
  weeklyRate: number | null;
  channelWeeklyRate: number | null;
  monthlyRate: number | null;
  channelMonthlyRate: number | null;
  vatPct: number;
  currency: string;
}

interface AriSnapshot {
  schemaVersion: string;
  tenantId: string;
  channelKey: string;
  generatedAt: string;
  markupPct: number;
  summary: {
    totalCategories: number;
    totalUnits: number;
    availableUnits: number;
    openCategories: number;
    stopSellCategories: number;
  };
  categories: AriCategoryLine[];
}

const CATEGORY_BADGE: Record<string, string> = {
  internal: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40',
  ota: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  fleet: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelStat[]>([]);
  const [tenantId, setTenantId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Configuration Drawer State
  const [editingChannel, setEditingChannel] = useState<ChannelStat | null>(null);
  const [formActive, setFormActive] = useState(true);
  const [formCommissionPct, setFormCommissionPct] = useState('0');
  const [formMarkupPct, setFormMarkupPct] = useState('0');
  const [formAutoConfirm, setFormAutoConfirm] = useState(false);
  const [formOutboundUrl, setFormOutboundUrl] = useState('');
  const [formRotateSecret, setFormRotateSecret] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [issuedSecretBanner, setIssuedSecretBanner] = useState<{
    channelLabel: string;
    secret: string;
  } | null>(null);

  // Live ARI Sync Preview / Push Modal State
  const [syncingChannelKey, setSyncingChannelKey] = useState<string | null>(null);
  const [ariModal, setAriModal] = useState<{
    channel: ChannelStat;
    mode: 'PREVIEW' | 'WEBHOOK_PUSHED' | 'SANDBOX_SYNCED';
    syncedAt?: string;
    signaturePreview?: string | null;
    ari: AriSnapshot;
  } | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rental/channels');
      const data = res.ok ? await res.json() : null;
      if (Array.isArray(data)) {
        setChannels(data);
        if (data[0]?.tenantId) setTenantId(data[0].tenantId);
      } else if (data && Array.isArray(data.channels)) {
        setChannels(data.channels);
        if (data.tenantId) setTenantId(data.tenantId);
      } else {
        setChannels([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '');
    void loadChannels();
  }, [loadChannels]);

  function copyText(key: string, text: string) {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
  }

  function buildDisplayWebhookUrl(c: ChannelStat): string {
    const tid = c.tenantId || tenantId;
    const base = origin || 'https://app.fleet360.ae';
    if (tid) {
      return `${base}/api/rental/channels/${c.key.toLowerCase()}/webhook?tenantId=${encodeURIComponent(tid)}`;
    }
    return c.webhookUrl || `${base}/api/rental/channels/${c.key.toLowerCase()}/webhook`;
  }

  function openConfigDrawer(c: ChannelStat) {
    setEditingChannel(c);
    setFormActive(c.isActive !== false);
    setFormCommissionPct(String(c.commissionPct ?? 0));
    setFormMarkupPct(String(c.defaultMarkupPct ?? 0));
    setFormAutoConfirm(Boolean(c.autoConfirm));
    setFormOutboundUrl(c.outboundWebhookUrl ?? '');
    setFormRotateSecret(false);
    setCfgError(null);
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!editingChannel) return;
    setSavingCfg(true);
    setCfgError(null);
    try {
      const res = await fetch('/api/rental/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: editingChannel.key,
          isActive: formActive,
          commissionPct: Number(formCommissionPct || 0),
          defaultMarkupPct: Number(formMarkupPct || 0),
          autoConfirm: formAutoConfirm,
          outboundWebhookUrl: formOutboundUrl.trim() || null,
          rotateSecret: formRotateSecret,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCfgError(data.error ?? `Failed to save (${res.status})`);
        return;
      }
      if (data.webhookSecret) {
        setIssuedSecretBanner({
          channelLabel: editingChannel.label,
          secret: data.webhookSecret,
        });
      }
      setEditingChannel(null);
      await loadChannels();
    } catch (err) {
      setCfgError(err instanceof Error ? err.message : 'Failed to update configuration');
    } finally {
      setSavingCfg(false);
    }
  }

  async function handlePreviewAri(c: ChannelStat) {
    setSyncingChannelKey(`preview:${c.key}`);
    setSyncToast(null);
    try {
      const res = await fetch(`/api/rental/channels/${c.key.toLowerCase()}/sync`);
      const data = await res.json();
      if (!res.ok) {
        setSyncToast(data.error ?? `Failed to preview ARI feed (${res.status})`);
        return;
      }
      setAriModal({
        channel: c,
        mode: 'PREVIEW',
        ari: data.ari,
      });
    } catch (err) {
      setSyncToast(err instanceof Error ? err.message : 'ARI preview failed');
    } finally {
      setSyncingChannelKey(null);
    }
  }

  async function handlePushLiveAri(c: ChannelStat) {
    setSyncingChannelKey(`push:${c.key}`);
    setSyncToast(null);
    try {
      const res = await fetch(`/api/rental/channels/${c.key.toLowerCase()}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncToast(data.error ?? `ARI sync failed (${res.status})`);
        return;
      }
      setAriModal({
        channel: c,
        mode: data.mode,
        syncedAt: data.syncedAt,
        signaturePreview: data.signaturePreview,
        ari: data.ari,
      });
      await loadChannels();
    } catch (err) {
      setSyncToast(err instanceof Error ? err.message : 'Outbound ARI sync failed');
    } finally {
      setSyncingChannelKey(null);
    }
  }

  const totalBookings = channels.reduce((s, c) => s + c.bookingCount, 0);
  const externalCount = channels.filter((c) => c.supportsInboundWebhook).length;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">
            OTA &amp; Mobility Channel Manager
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            {channels.length} distribution channels ({externalCount} OTA / mobility connectors) ·{' '}
            {totalBookings} bookings ingested · inbound lifecycle webhooks &amp; live outbound ARI push.
          </p>
        </div>
        {tenantId && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] text-xs">
            <ShieldCheck className="h-4 w-4 text-teal-400" />
            <span className="text-[var(--text-muted)]">X-OTA-Tenant-Id:</span>
            <code className="font-mono text-teal-300">{tenantId}</code>
            <button
              onClick={() => copyText('tenant-id', tenantId)}
              className="ml-1 px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 text-[11px]"
            >
              {copiedKey === 'tenant-id' ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {issuedSecretBanner && (
        <div className="rounded-2xl bg-emerald-950/50 border border-emerald-500/40 p-5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
              <KeyRound className="h-4 w-4" />
              New HMAC Webhook Secret Issued for {issuedSecretBanner.channelLabel}
            </div>
            <button
              onClick={() => setIssuedSecretBanner(null)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-emerald-100/80">
            Copy this secret now — for security, Fleet360 stores it encrypted/masked and will never display the full value again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-emerald-500/30 font-mono text-xs text-emerald-200 break-all">
              {issuedSecretBanner.secret}
            </code>
            <button
              onClick={() => copyText('issued-secret', issuedSecretBanner.secret)}
              className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 text-xs hover:bg-emerald-500/30 shrink-0"
            >
              {copiedKey === 'issued-secret' ? 'Copied!' : 'Copy Secret'}
            </button>
          </div>
        </div>
      )}

      {syncToast && (
        <div className="rounded-xl bg-amber-950/40 border border-amber-500/40 p-4 text-xs text-amber-200 flex items-center justify-between">
          <span>{syncToast}</span>
          <button onClick={() => setSyncToast(null)} className="text-amber-300 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-[var(--text-faint)]">Loading channels…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {channels.map((c) => {
            const webhookUrl = buildDisplayWebhookUrl(c);
            const isExternal = c.supportsInboundWebhook || c.supportsOutboundSync;
            const isActive = c.isActive !== false;

            return (
              <div
                key={c.key}
                className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-[var(--text-main)]">{c.label}</h3>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_BADGE[c.category]}`}
                        >
                          {c.category.toUpperCase()}
                        </span>
                        {isExternal && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border ${
                              !isActive
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : c.configured
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}
                          >
                            {!isActive
                              ? 'Disabled'
                              : c.configured
                                ? '✓ Configured'
                                : '⚠ Secret missing'}
                          </span>
                        )}
                        {c.autoConfirm && (
                          <span className="text-xs px-2 py-0.5 rounded-full border bg-teal-500/20 text-teal-300 border-teal-500/40">
                            Auto-Confirm
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{c.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-bold text-[var(--text-main)]">
                        {c.bookingCount}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                        bookings
                      </div>
                    </div>
                  </div>

                  {isExternal && (
                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      <div className="rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] px-3 py-2">
                        <div className="text-[10px] uppercase text-[var(--text-faint)]">
                          ARI Markup
                        </div>
                        <div className="font-semibold text-[var(--text-main)]">
                          {(c.defaultMarkupPct ?? 0) >= 0 ? '+' : ''}
                          {c.defaultMarkupPct ?? 0}%
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] px-3 py-2">
                        <div className="text-[10px] uppercase text-[var(--text-faint)]">
                          OTA Commission
                        </div>
                        <div className="font-semibold text-[var(--text-main)]">
                          {c.commissionPct ?? 0}%
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] px-3 py-2">
                        <div className="text-[10px] uppercase text-[var(--text-faint)]">
                          HMAC Secret
                        </div>
                        <div className="font-mono text-[11px] text-[var(--text-main)] truncate">
                          {c.secretPreview ?? (c.configured ? 'Platform Derived' : 'Not Set')}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)] flex-wrap gap-2">
                    {c.lastBookingAt ? (
                      <span>
                        Last booking:{' '}
                        <span className="text-[var(--text-main)]">
                          {new Date(c.lastBookingAt).toLocaleString('en-GB')}
                        </span>
                      </span>
                    ) : (
                      <span>No inbound bookings yet</span>
                    )}
                    {c.lastSyncAt && (
                      <span>
                        Last ARI sync:{' '}
                        <span className="text-cyan-300">
                          {new Date(c.lastSyncAt).toLocaleString('en-GB')}
                        </span>
                      </span>
                    )}
                  </div>

                  {c.supportsInboundWebhook && (
                    <div className="border-t border-[var(--border-subtle)] pt-3">
                      <label className="block text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1">
                        Tenant-Scoped Inbound Webhook URL
                      </label>
                      <div className="flex gap-2">
                        <code className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] text-xs text-cyan-300 font-mono truncate">
                          {webhookUrl}
                        </code>
                        <button
                          onClick={() => copyText(`url:${c.key}`, webhookUrl)}
                          className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs hover:bg-cyan-500/30 flex items-center gap-1"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedKey === `url:${c.key}` ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--text-faint)] mt-1.5">
                        Include <code className="text-[var(--text-muted)]">?tenantId={tenantId || '<tenantId>'}</code>{' '}
                        (or header <code className="text-[var(--text-muted)]">X-OTA-Tenant-Id</code>) +{' '}
                        <code className="text-[var(--text-muted)]">X-Channel-Signature</code> HMAC-SHA256.
                      </p>
                    </div>
                  )}
                </div>

                {isExternal && (
                  <div className="border-t border-[var(--border-subtle)] pt-3 flex items-center justify-between gap-2 flex-wrap">
                    <button
                      onClick={() => openConfigDrawer(c)}
                      className="px-3 py-2 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] text-xs text-[var(--text-main)] hover:opacity-90 flex items-center gap-1.5"
                    >
                      <Settings2 className="h-3.5 w-3.5 text-cyan-400" />
                      Configure Channel
                    </button>

                    {c.supportsOutboundSync && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePreviewAri(c)}
                          disabled={syncingChannelKey !== null}
                          className="px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40 flex items-center gap-1.5"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {syncingChannelKey === `preview:${c.key}` ? 'Loading…' : 'Preview ARI'}
                        </button>
                        <button
                          onClick={() => handlePushLiveAri(c)}
                          disabled={syncingChannelKey !== null || !isActive}
                          className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {syncingChannelKey === `push:${c.key}`
                            ? 'Pushing ARI…'
                            : 'Push Live ARI Sync'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Partner Integration Guide */}
      <div className="bg-[var(--bg-surface)]/30 border border-[var(--border-subtle)] rounded-xl p-5 text-sm text-[var(--text-muted)]">
        <h3 className="text-[var(--text-main)] font-semibold mb-2">
          OTA Partner Lifecycle &amp; ARI Integration Reference
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li>
            <strong>Tenant Routing:</strong> Always post to the tenant-scoped URL{' '}
            <code>?tenantId={tenantId || '<tenantId>'}</code> or send{' '}
            <code>X-OTA-Tenant-Id: {tenantId || '<tenantId>'}</code> (note: client-supplied{' '}
            <code>X-Tenant-Id</code> is stripped at the edge gateway for zero-trust isolation).
          </li>
          <li>
            <strong>HMAC Authentication:</strong> Sign the raw JSON body with HMAC-SHA256 (hex) in{' '}
            <code>X-Channel-Signature</code> or <code>X-OTA-Signature</code>.
          </li>
          <li>
            <strong>Full Booking Lifecycle:</strong> Set <code>event</code> /{' '}
            <code>eventType</code> to <code>BOOKING_CREATED</code> (idempotent on{' '}
            <code>externalRef</code>), <code>BOOKING_MODIFIED</code> (re-validates vehicle availability
            &amp; dates; rejects active agreements with <code>409</code>), or{' '}
            <code>BOOKING_CANCELLED</code> (automatically releases held <code>RESERVED</code> vehicles).
          </li>
          <li>
            <strong>Outbound ARI Push:</strong> Configure an HTTPS{' '}
            <code>outboundWebhookUrl</code> per channel to push live category stock, stop-sell flags,
            and channel-marked-up daily/weekly/monthly rates signed with{' '}
            <code>X-Fleet360-Signature</code>.
          </li>
        </ul>
      </div>

      {/* Channel Configuration Drawer / Modal */}
      {editingChannel && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-main)]">
                  Configure {editingChannel.label}
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Channel key: <code className="font-mono">{editingChannel.key}</code>
                </p>
              </div>
              <button
                onClick={() => setEditingChannel(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {cfgError && (
              <div className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-3 text-xs text-rose-200">
                {cfgError}
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Channel Rate Markup (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="-50"
                    max="500"
                    value={formMarkupPct}
                    onChange={(e) => setFormMarkupPct(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                  />
                  <p className="text-[10px] text-[var(--text-faint)] mt-1">
                    Applied to master tariff in outbound ARI pushes.
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    OTA Commission (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formCommissionPct}
                    onChange={(e) => setFormCommissionPct(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
                  />
                  <p className="text-[10px] text-[var(--text-faint)] mt-1">
                    Partner commission tracked on channel bookings.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Outbound Partner ARI Webhook URL (HTTPS)
                </label>
                <input
                  type="url"
                  placeholder="https://partner-ota.example.com/ari/fleet360"
                  value={formOutboundUrl}
                  onChange={(e) => setFormOutboundUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm font-mono"
                />
                <p className="text-[10px] text-[var(--text-faint)] mt-1">
                  Leave blank to run ARI sync in Sandbox Preview mode. Must use <code>https://</code>.
                </p>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 text-xs text-[var(--text-main)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="rounded border-[var(--border-strong)]"
                  />
                  Enable inbound webhooks &amp; outbound ARI sync for this channel
                </label>

                <label className="flex items-center gap-2.5 text-xs text-[var(--text-main)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formAutoConfirm}
                    onChange={(e) => setFormAutoConfirm(e.target.checked)}
                    className="rounded border-[var(--border-strong)]"
                  />
                  Auto-confirm inbound reservations (land directly in <code>CONFIRMED</code> status)
                </label>

                <label className="flex items-center gap-2.5 text-xs text-amber-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formRotateSecret}
                    onChange={(e) => setFormRotateSecret(e.target.checked)}
                    className="rounded border-amber-500/50"
                  />
                  <span className="flex items-center gap-1">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Rotate per-tenant HMAC-SHA256 webhook secret on save
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setEditingChannel(null)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] text-xs text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCfg}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40"
                >
                  {savingCfg ? 'Saving…' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live ARI Sync Preview / Result Modal */}
      {ariModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <h2 className="text-lg font-bold text-[var(--text-main)]">
                    {ariModal.channel.label} — Live ARI Feed
                  </h2>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40">
                    {ariModal.mode === 'WEBHOOK_PUSHED'
                      ? '✓ Pushed to Partner Webhook'
                      : ariModal.mode === 'SANDBOX_SYNCED'
                        ? '✓ Sandbox Synced (Timestamp Updated)'
                        : 'Live Feed Preview'}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Generated {new Date(ariModal.ari.generatedAt).toLocaleString('en-GB')} · Channel
                  Markup: {ariModal.ari.markupPct >= 0 ? '+' : ''}
                  {ariModal.ari.markupPct}% · Available Fleet:{' '}
                  <strong>
                    {ariModal.ari.summary.availableUnits} / {ariModal.ari.summary.totalUnits}
                  </strong>{' '}
                  units ({ariModal.ari.summary.openCategories} OPEN,{' '}
                  {ariModal.ari.summary.stopSellCategories} STOP_SELL)
                </p>
              </div>
              <button
                onClick={() => setAriModal(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-xs text-left">
                <thead className="bg-[var(--bg-surface-hover)]/60 text-[var(--text-muted)] uppercase text-[10px]">
                  <tr>
                    <th className="px-3 py-2.5">Category</th>
                    <th className="px-3 py-2.5">Avail / Fleet</th>
                    <th className="px-3 py-2.5">ARI Status</th>
                    <th className="px-3 py-2.5 text-right">Master Daily</th>
                    <th className="px-3 py-2.5 text-right">Channel Daily</th>
                    <th className="px-3 py-2.5 text-right">Channel Weekly</th>
                    <th className="px-3 py-2.5 text-right">Channel Monthly</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {ariModal.ari.categories.map((line) => (
                    <tr key={line.category} className="text-[var(--text-main)]">
                      <td className="px-3 py-2.5 font-medium">
                        {formatRentalCategoryLabel(line.category, { short: true })}
                      </td>
                      <td className="px-3 py-2.5">
                        {line.availableUnits} / {line.totalUnits}{' '}
                        <span className="text-[var(--text-faint)]">({line.utilizationPct}% util)</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] border ${
                            line.status === 'OPEN'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}
                        >
                          {line.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[var(--text-muted)]">
                        {line.currency} {line.baseDailyRate.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-cyan-300">
                        {line.currency} {line.channelDailyRate.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {line.channelWeeklyRate != null
                          ? `${line.currency} ${line.channelWeeklyRate.toLocaleString()}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {line.channelMonthlyRate != null
                          ? `${line.currency} ${line.channelMonthlyRate.toLocaleString()}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-[var(--text-faint)] font-mono">
                {ariModal.signaturePreview
                  ? `Signed Header X-Fleet360-Signature: ${ariModal.signaturePreview}`
                  : `Schema: ${ariModal.ari.schemaVersion}`}
              </div>
              <div className="flex items-center gap-2">
                {ariModal.mode === 'PREVIEW' && (
                  <button
                    onClick={() => handlePushLiveAri(ariModal.channel)}
                    disabled={syncingChannelKey !== null}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-xs font-semibold hover:opacity-90"
                  >
                    Push Live ARI Sync Now
                  </button>
                )}
                <button
                  onClick={() => setAriModal(null)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] text-xs text-[var(--text-main)]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
