/**
 * src/app/(driver)/driver-app/shift-history/page.tsx
 *
 * List of the driver's past (CLOSED) shifts with per-shift summaries:
 * checklist completion, fuel entry count + total, expense count + total.
 *
 * Each row is expandable to show the checklist items + a list of the
 * fuel and expense entries from that shift. The detail view is loaded
 * lazily on expand so the initial list is fast even with 50+ shifts.
 *
 * Linked from the menu's "Shift History" card. No actions on this
 * page — closed shifts are immutable (the partial unique index on
 * ACTIVE shifts makes a re-open impossible without a manual DB edit).
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';

interface ShiftSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  checklistSignedAt: string | null;
  checklistItemCount: number | null;
  fuel: { count: number; totalMinor: number; currency: string };
  expenses: { count: number; totalMinor: number; currency: string };
}

interface ShiftDetail {
  id: string;
  startedAt: string;
  endedAt: string | null;
  checklist: Record<string, { ok: boolean | null; note?: string }> | null;
  fuelEntries: Array<{
    id: string;
    liters: number;
    costMinor: number;
    currency: string;
    locationName: string | null;
    filledAt: string;
  }>;
  expenseEntries: Array<{
    id: string;
    category: string;
    amountMinor: number;
    currency: string;
    description: string | null;
    incurredAt: string;
  }>;
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMinor(minor: number, currency: string): string {
  // Convert minor units (fils) back to major units (AED) for display.
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function ShiftHistoryPage() {
  const router = useRouter();
  const [shifts, setShifts] = useState<ShiftSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ShiftDetail | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/driver-app/shift/history?limit=20', { credentials: 'include' });
        if (!r.ok) throw new Error(`load failed: ${r.status}`);
        const data = await r.json();
        if (cancelled) return;
        setShifts(data.shifts);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'load failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    // Lazy load details on first expand
    if (!details[id] && !loading[id]) {
      setLoading((p) => ({ ...p, [id]: true }));
      try {
        const r = await fetch(`/api/driver-app/shift/${id}`, { credentials: 'include' });
        if (!r.ok) throw new Error(`detail failed: ${r.status}`);
        const data = await r.json();
        setDetails((p) => ({ ...p, [id]: data.shift }));
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'detail failed');
      } finally {
        setLoading((p) => ({ ...p, [id]: false }));
      }
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Past</div>
            <div className="text-xl font-bold text-white truncate">Shift History</div>
          </div>
        </div>
      </header>

      <main className="space-y-3 px-4 py-4">
        {err && (
          <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        {shifts === null && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">
            Loading…
          </div>
        )}

        {shifts !== null && shifts.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">
            No closed shifts yet. End your current shift from the menu to see it here.
          </div>
        )}

        {shifts?.map((s) => {
          const isExpanded = expanded === s.id;
          const detail = details[s.id];
          const isLoading = loading[s.id];
          return (
            <article key={s.id} className="rounded-2xl border border-white/10 bg-slate-900">
              <button
                type="button"
                onClick={() => toggleExpand(s.id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    {new Date(s.startedAt).toLocaleDateString(undefined, {
                      weekday: 'short', day: 'numeric', month: 'short',
                    })}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-white">
                    {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {s.endedAt
                      ? new Date(s.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                    <span className="ml-2 text-xs text-slate-500">
                      ({formatDuration(s.startedAt, s.endedAt)})
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    {s.checklistItemCount != null ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                        ✓ {s.checklistItemCount} checklist items
                      </span>
                    ) : (
                      <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300">
                        ✗ no checklist
                      </span>
                    )}
                    {s.fuel.count > 0 && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                        ⛽ {s.fuel.count} ({formatMinor(s.fuel.totalMinor, s.fuel.currency)})
                      </span>
                    )}
                    {s.expenses.count > 0 && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                        🧾 {s.expenses.count} ({formatMinor(s.expenses.totalMinor, s.expenses.currency)})
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-slate-500 text-lg">{isExpanded ? '▴' : '▾'}</div>
              </button>

              {isExpanded && (
                <div className="border-t border-white/5 p-4">
                  {isLoading && (
                    <div className="text-xs text-slate-500">Loading details…</div>
                  )}
                  {detail && (
                    <div className="space-y-3">
                      {/* Checklist */}
                      {detail.checklist && (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Checklist
                          </div>
                          <ul className="space-y-0.5 text-xs">
                            {Object.entries(detail.checklist).map(([k, v]) => (
                              <li key={k} className="flex items-center gap-2">
                                <span className={
                                  v.ok === true ? 'text-emerald-300' :
                                  v.ok === false ? 'text-rose-300' :
                                  'text-slate-500'
                                }>
                                  {v.ok === true ? '✓' : v.ok === false ? '✗' : '·'}
                                </span>
                                <span className="text-slate-300">{k.replace(/_/g, ' ')}</span>
                                {v.note && <span className="text-slate-500">— {v.note}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Fuel */}
                      {detail.fuelEntries.length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Fuel
                          </div>
                          <ul className="space-y-0.5 text-xs">
                            {detail.fuelEntries.map((f) => (
                              <li key={f.id} className="flex items-center justify-between text-slate-300">
                                <span>
                                  ⛽ {Number(f.liters ?? 0).toFixed(2)}L · {formatMinor(f.costMinor, f.currency)}
                                  {f.locationName && <span className="text-slate-500"> · {f.locationName}</span>}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {new Date(f.filledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Expenses */}
                      {detail.expenseEntries.length > 0 && (
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Expenses
                          </div>
                          <ul className="space-y-0.5 text-xs">
                            {detail.expenseEntries.map((e) => (
                              <li key={e.id} className="flex items-center justify-between text-slate-300">
                                <span>
                                  🧾 {e.category} · {formatMinor(e.amountMinor, e.currency)}
                                  {e.description && <span className="text-slate-500"> · {e.description}</span>}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {new Date(e.incurredAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </main>
    </div>
  );
}
