'use client';

import React, { useEffect, useState } from 'react';

interface ChannelStat {
  key: string;
  label: string;
  category: 'website' | 'social' | 'agent' | 'classified' | 'phone';
  supportsInboundWebhook: boolean;
  configured: boolean;
  description: string;
  leadCount: number;
  lastLeadAt: string | null;
}

const CATEGORY_BADGE: Record<string, string> = {
  website:    'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  social:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  agent:      'bg-violet-500/20 text-violet-300 border-violet-500/40',
  classified: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  phone:      'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40',
};

export default function LeasingLeadChannelsPage() {
  const [channels, setChannels] = useState<ChannelStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '');
    (async () => {
      try {
        const res = await fetch('/api/leasing/lead-channels');
        const data = res.ok ? await res.json() : [];
        setChannels(Array.isArray(data) ? data : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalLeads = channels.reduce((s, c) => s + c.leadCount, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-[var(--text-main)] mb-2">Lead Channels</h1>
        <p className="text-[var(--text-muted)]">
          {channels.length} channels · {totalLeads} leads ingested · external sources post into the inbound webhook URLs below.
        </p>
      </div>

      {loading ? (
        <div className="text-[var(--text-faint)]">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {channels.map(c => (
            <div key={c.key} className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-[var(--text-main)]">{c.label}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_BADGE[c.category]}`}>
                      {c.category.toUpperCase()}
                    </span>
                    {c.supportsInboundWebhook && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${c.configured ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border-amber-500/40'}`}>
                        {c.configured ? '✓ Configured' : '⚠ Secret missing'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{c.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold text-[var(--text-main)]">{c.leadCount}</div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">leads</div>
                </div>
              </div>

              {c.lastLeadAt && (
                <div className="text-xs text-[var(--text-muted)]">
                  Last lead: <span className="text-[var(--text-main)]">{new Date(c.lastLeadAt).toLocaleString('en-GB')}</span>
                </div>
              )}

              {c.supportsInboundWebhook && (
                <div className="border-t border-[var(--border-subtle)] pt-3">
                  <label className="block text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1">Inbound webhook URL</label>
                  <div className="flex gap-2">
                    <code className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] text-xs text-cyan-300 font-mono truncate">
                      {origin}/api/leasing/lead-channels/{c.key}/webhook
                    </code>
                    <button
                      onClick={() => navigator.clipboard?.writeText(`${origin}/api/leasing/lead-channels/${c.key}/webhook`)}
                      className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs hover:bg-cyan-500/30"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--text-faint)] mt-2">
                    HMAC-SHA256 signed body in <code className="text-[var(--text-muted)]">x-channel-signature</code> header.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-[var(--bg-surface)]/30 border border-[var(--border-subtle)] rounded-xl p-5 text-sm text-[var(--text-muted)]">
        <h3 className="text-[var(--text-main)] font-semibold mb-2">Integration notes</h3>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li>POST raw JSON, sign the body with HMAC-SHA256 hex using the channel secret, send hex in <code>x-channel-signature</code>.</li>
          <li>Same external ID twice → idempotent: existing inquiry is returned, no duplicate created.</li>
          <li>Web form: <code>{'{ submissionId, fullName, email, phone, vehicleType, vehicleCount, leaseTermMonths, message }'}</code></li>
          <li>WhatsApp: <code>{'{ messageId, from (E.164), profileName, text }'}</code></li>
          <li>Agent referral: <code>{'{ agentId, agentName, referralId, customer:{...}, vehicle:{type,count}, termMonths, notes }'}</code></li>
          <li>Classifieds (CarTrade / Dubizzle / PF): <code>{'{ leadId, buyer:{name,email,phone}, listing:{title,vehicleCategory}, message }'}</code></li>
          <li>All leads land in <code>NEW</code> status with the source tagged in notes — assign to a sales rep via the Inquiries page.</li>
        </ul>
      </div>
    </div>
  );
}
