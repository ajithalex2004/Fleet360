'use client';

/**
 * /service-tickets — Service & Support Ticketing module landing.
 *
 * Phase 1A scope: shows the 7 configured ticket types with per-tenant
 * access state (read from /api/auth/me + /api/admin/tenants/[id]/
 * ticket-types). The actual ticket creation / list UI lands in 1B.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Headphones, Lock, ArrowUpRight, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { TICKET_TYPE_LIST } from '@/lib/service-tickets/config';
import type { TicketType, TenantTicketTypeAccess } from '@/types/service-tickets';

const TONE_GRAD: Record<string, string> = {
  gold:    'from-amber-600 to-orange-600',
  blue:    'from-blue-600 to-indigo-600',
  emerald: 'from-emerald-600 to-teal-600',
  amber:   'from-amber-600 to-orange-600',
  rose:    'from-rose-600 to-pink-600',
  slate:   'from-slate-600 to-slate-700',
  violet:  'from-violet-600 to-purple-600',
};

const TONE_BG: Record<string, string> = {
  gold: 'bg-amber-500/10', blue: 'bg-blue-500/10', emerald: 'bg-emerald-500/10',
  amber: 'bg-amber-500/10', rose: 'bg-rose-500/10', slate: 'bg-slate-500/10',
  violet: 'bg-violet-500/10',
};
const TONE_FG: Record<string, string> = {
  gold: 'text-amber-300', blue: 'text-blue-300', emerald: 'text-emerald-300',
  amber: 'text-amber-300', rose: 'text-rose-300', slate: 'text-slate-300',
  violet: 'text-violet-300',
};

export default function ServiceTicketsHome() {
  const [access, setAccess] = useState<Map<TicketType, TenantTicketTypeAccess> | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch('/api/auth/me');
        if (!meRes.ok) throw new Error('Not authenticated');
        const me = await meRes.json();
        const tid = me.tenantId as string;
        setTenantId(tid);

        const matrixRes = await fetch(`/api/admin/tenants/${tid}/ticket-types`);
        if (matrixRes.ok) {
          const data = await matrixRes.json();
          const map = new Map<TicketType, TenantTicketTypeAccess>(
            (data.matrix as TenantTicketTypeAccess[]).map(r => [r.ticketType, r])
          );
          setAccess(map);
        } else {
          // Default: assume all enabled (matches helper behaviour).
          const map = new Map<TicketType, TenantTicketTypeAccess>(
            TICKET_TYPE_LIST.map(c => [c.type, {
              tenantId: tid, ticketType: c.type, enabled: true, slaOverrideHours: null,
            }])
          );
          setAccess(map);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Service & Support Ticketing"
        subtitle="One module · seven ticket types · shared engines (SLA, assignment, notifications, attachments, history)"
        icon={Headphones}
        accent="violet"
      />

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-5 text-sm text-slate-300">
        <p className="text-white font-semibold mb-1">Phase 1A — Foundation shipped</p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-slate-400">
          <li>Per-tenant access matrix at <Link href={tenantId ? `/admin/tenants/${tenantId}/ticket-types` : '/admin/tenants'} className="text-violet-300 hover:text-violet-200 underline">Admin → Tenants → Ticket Types</Link></li>
          <li>Ticket numbering format: <code className="bg-slate-800 px-1.5 py-0.5 rounded">ST{`{year}`}-{`{TYPE}`}-{`{NNNN}`}</code></li>
          <li>Storage table + ticket creation/list arrives in Phase 1B</li>
          <li>Per-type forms, workflows, approval rules arrive in Phase 1C</li>
          <li>Migration of existing /maintenance/service-requests data arrives in Phase 1D</li>
        </ul>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-3">Configured ticket types</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {TICKET_TYPE_LIST.map(cfg => {
            const row = access?.get(cfg.type);
            const enabled = row?.enabled ?? true; // default enabled until matrix loads
            const sla = row?.slaOverrideHours ?? cfg.defaultSlaHours;
            const Icon = cfg.icon;
            return (
              <div key={cfg.type}
                className={`relative rounded-2xl bg-slate-900/60 border ${enabled ? 'border-white/10' : 'border-white/5'} p-5 ${enabled ? '' : 'opacity-50'}`}>
                {!enabled && (
                  <div className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/40 text-[10px] text-slate-400">
                    <Lock className="w-2.5 h-2.5" /> Disabled
                  </div>
                )}
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${TONE_GRAD[cfg.tone]} flex items-center justify-center shadow-lg`}>
                    <Icon className="w-5 h-5 text-white" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-semibold text-sm">{cfg.longLabel}</div>
                    <div className={`text-[10px] mt-0.5 font-mono ${TONE_FG[cfg.tone]}`}>
                      ST{new Date().getFullYear()}-{cfg.prefix}-NNNN
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mb-3 h-8">{cfg.description}</p>
                <div className={`grid grid-cols-2 gap-2 text-[11px] border-t border-white/5 pt-3 ${TONE_BG[cfg.tone]} -mx-1 px-3 rounded-lg`}>
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider text-[9px]">SLA</div>
                    <div className="text-white font-semibold tabular-nums">
                      {sla < 24 ? `${sla}h` : `${Math.round(sla / 24)}d`}
                      {row?.slaOverrideHours != null && <span className="text-[9px] text-slate-500 ml-1">(override)</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider text-[9px]">Default priority</div>
                    <div className="text-white font-semibold">{cfg.defaultPriority}</div>
                  </div>
                </div>
                {cfg.autoCreatesMaintenanceRequest && (
                  <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-full px-2 py-0.5">
                    <ArrowUpRight className="w-2.5 h-2.5" /> Auto-creates Maintenance Request on Acknowledge
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-slate-900/40 border border-white/5 p-4 text-xs text-slate-500 leading-relaxed">
        <p className="text-white font-semibold mb-1">What stays the same vs Service Requests</p>
        <p>
          Same ticket engine · same SLA engine (with per-type defaults &amp; per-tenant overrides) · same assignment engine
          (Assign/Escalate modal) · same notification engine (SMTP via /admin/settings/integrations) · same attachments
          + comments + history audit. Maintenance tickets retain the special &ldquo;Acknowledge auto-creates a formal
          MaintenanceRequest&rdquo; behaviour from the existing Service Request module.
        </p>
      </div>
    </div>
  );
}
