'use client';

/**
 * The signed-in user's own service requests (Service Tickets they raised),
 * shown on /booking-portal/my-bookings next to their transport bookings.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, ExternalLink, Wrench } from 'lucide-react';

interface Ticket {
  id: string;
  readableId: string | null;
  ticketType: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
  slaTargetHours?: number;
  customFields?: { trackingToken?: string; building?: string; area?: string };
}

const STATUS_STYLE: Record<string, string> = {
  'Awaiting Approval': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Acknowledged: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Assigned: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'In Progress': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  Escalated: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  Resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Closed: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  Rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};
const DONE = new Set(['Resolved', 'Completed', 'Closed', 'Rejected']);

/** Remaining time against the SLA target, for open requests. */
function slaState(t: Ticket): { text: string; tone: string } | null {
  if (DONE.has(t.status) || !t.slaTargetHours) return null;
  const due = new Date(t.createdAt).getTime() + t.slaTargetHours * 3_600_000;
  const left = (due - Date.now()) / 3_600_000;
  if (!Number.isFinite(left)) return null;
  if (left < 0) return { text: 'Past target time', tone: 'text-rose-300' };
  const text = left < 1 ? `${Math.max(1, Math.round(left * 60))} min left` : left < 48 ? `${Math.round(left)} h left` : `${Math.round(left / 24)} days left`;
  return { text, tone: left < t.slaTargetHours * 0.25 ? 'text-amber-300' : 'text-slate-400' };
}

export function MyServiceRequests() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [tRes, fRes] = await Promise.all([
          fetch('/api/service-tickets?mine=1&limit=100'),
          fetch('/api/service-tickets/form-fields'),
        ]);
        const tData = await tRes.json().catch(() => null);
        if (!tRes.ok || !tData?.ok) throw new Error(tData?.error ?? 'Could not load your requests');
        setTickets(tData.tickets ?? []);
        const fData = await fRes.json().catch(() => null);
        const cfg: Record<string, { name: string }> = fData?.typeConfig ?? {};
        setNames(Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, v.name])));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your requests');
        setTickets([]);
      }
    })();
  }, []);

  const open = tickets?.filter((t) => !DONE.has(t.status)).length ?? 0;

  return (
    <section aria-labelledby="my-sr-title" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 id="my-sr-title" className="text-xl font-bold text-white flex items-center gap-2">
          <Wrench className="w-5 h-5 text-cyan-400" /> Service requests
          {tickets && <span className="text-xs font-semibold text-slate-400">{open} open · {tickets.length} total</span>}
        </h2>
        <Link href="/booking-portal/service-request" className="text-sm font-semibold text-cyan-300 hover:text-cyan-200">+ New request</Link>
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-300">{error}</p>}

      {tickets === null ? (
        <div className="h-20 rounded-2xl bg-slate-800/40 animate-pulse" />
      ) : tickets.length === 0 && !error ? (
        <p className="rounded-2xl bg-slate-800/40 border border-white/10 p-6 text-sm text-slate-400">
          You haven&apos;t raised any service requests yet.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-2xl bg-slate-800/40 border border-white/10">
          {tickets.map((t) => {
            const sla = slaState(t);
            const where = [t.customFields?.building, t.customFields?.area].filter(Boolean).join(' · ');
            return (
              <li key={t.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{t.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <span className="font-mono text-cyan-300/90">{t.readableId ?? t.id.slice(0, 8)}</span>
                    {' · '}{names[t.ticketType] ?? t.ticketType}{where ? ` · ${where}` : ''}
                    {' · '}{new Date(t.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {sla && <span className={`inline-flex items-center gap-1 text-xs ${sla.tone}`}><Clock className="w-3.5 h-3.5" />{sla.text}</span>}
                <span className={`self-start sm:self-auto text-[11px] font-semibold px-2.5 py-1 rounded-full border ${STATUS_STYLE[t.status] ?? STATUS_STYLE.Closed}`}>{t.status}</span>
                {t.customFields?.trackingToken && (
                  <a href={`/track-ticket/${t.customFields.trackingToken}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white">
                    Track <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
