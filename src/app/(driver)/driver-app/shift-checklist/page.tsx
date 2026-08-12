/**
 * src/app/(driver)/driver-app/shift-checklist/page.tsx
 *
 * SHIFT CHECKLIST — the driver does this ONCE at the start of their
 * shift, NOT before every trip (that was the old "Trip Checklist" /
 * DVIR pre-trip pattern). The user explicitly requested this rename
 * and the timing change.
 *
 * Differences from the per-trip DVIR form:
 *   1. No trip association — this is shift-level.
 *   2. Items start UNCHECKED, not auto-OK. The driver has to
 *      actively mark each item. (Old DVIR form defaulted every
 *      item to `ok: true` — a real safety issue, drivers would
 *      tap "Submit" without ever looking.)
 *   3. Submit blocks until every item has been explicitly marked.
 *
 * On submit:
 *   1. POST /api/driver-app/shift/current (creates the shift if
 *      there isn't an active one — this also closes any stale
 *      active shift first)
 *   2. POST /api/driver-app/shift/[id]/checklist (persists items)
 *   3. Redirect to /driver-app/menu
 *
 * If a shift already exists and the checklist is already filled in,
 * the page lets the driver update it (used for the "I missed
 * something" re-check flow).
 */

'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';

type ItemState = {
  ok: boolean | null;   // null = not yet marked (the new default)
  note: string;
};

type DefaultItem = { key: string; label: string; category: string; blocking: boolean };

// Same 18 items as the DVIR form. This is the production-default
// checklist; per-tenant customisation is a roadmap item.
//
// Labels are intentionally concise for the small mobile cards —
// drivers see them at a glance and tap OK/Failed. Long phrasing
// ("Insurance Disc Valid", "Warning Triangle in Cabin") blows out
// the card height on a phone screen.
const DEFAULT_CHECKLIST: DefaultItem[] = [
  { key: 'tyres_tread',      label: 'Tyre tread depth OK',                category: 'tyres',  blocking: true  },
  { key: 'tyres_pressure',   label: 'Tyre pressure OK',                  category: 'tyres',  blocking: true  },
  { key: 'brakes_service',    label: 'Service brake responsive',          category: 'brakes', blocking: true  },
  { key: 'brakes_park',       label: 'Park brake holds',                  category: 'brakes', blocking: true  },
  { key: 'lights_head',       label: 'Headlights working',                category: 'lights', blocking: true  },
  { key: 'lights_tail',       label: 'Tail / brake lights working',       category: 'lights', blocking: true  },
  { key: 'lights_indicators', label: 'Indicators / hazards working',     category: 'lights', blocking: true  },
  { key: 'safety_triangle',   label: 'Warning triangle',                  category: 'safety', blocking: true  },
  { key: 'safety_extinguisher',label: 'Fire extinguisher',                category: 'safety', blocking: true  },
  { key: 'safety_seatbelts',  label: 'All seatbelts functional',         category: 'safety', blocking: false },
  { key: 'safety_first_aid',  label: 'First aid kit',                     category: 'safety', blocking: false },
  { key: 'docs_insurance',     label: 'Insurance valid',                   category: 'docs',   blocking: true  },
  { key: 'docs_registration',  label: 'Registration valid',                category: 'docs',   blocking: false },
  { key: 'fluids_oil',         label: 'Engine oil level OK',               category: 'fluids', blocking: true  },
  { key: 'fluids_coolant',     label: 'Coolant level OK',                  category: 'fluids', blocking: true  },
  { key: 'fluids_washer',      label: 'Washer fluid level OK',             category: 'fluids', blocking: false },
  { key: 'cabin_clean',        label: 'Cabin clean (no hazards, no rubbish)', category: 'cabin', blocking: false },
  { key: 'cabin_mirror',       label: 'Mirrors adjusted and clean',       category: 'cabin', blocking: false },
];

const CATEGORY_LABEL: Record<string, string> = {
  tyres: 'Tyres', brakes: 'Brakes', lights: 'Lights', safety: 'Safety',
  docs: 'Documents', fluids: 'Fluids', cabin: 'Cabin',
};

const CATEGORY_ICON: Record<string, string> = {
  tyres: '🛞', brakes: '🛑', lights: '💡', safety: '🦺',
  docs: '📄', fluids: '⛽', cabin: '🚌',
};

export default function ShiftChecklistPage() {
  const router = useRouter();
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, ItemState>>(() => {
    const init: Record<string, ItemState> = {};
    for (const c of DEFAULT_CHECKLIST) init[c.key] = { ok: null, note: '' };
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [signaturePath, setSignaturePath] = useState<string>('');
  const drawingRef = useRef(false);

  // Load: if there's an active shift with a checklist, populate from it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/driver-app/shift/current', { credentials: 'include' });
        if (!r.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        if (data.shift) {
          setShiftId(data.shift.id);
          setStartedAt(data.shift.startedAt);
          if (data.shift.checklist) {
            // Hydrate items from server JSONB. We trust the keys
            // match DEFAULT_CHECKLIST — anything else is ignored.
            const next = { ...items };
            for (const [k, v] of Object.entries(data.shift.checklist as Record<string, { ok: boolean; note?: string }>)) {
              if (k in next) {
                next[k] = { ok: v.ok, note: v.note ?? '' };
              }
            }
            setItems(next);
          }
          if (data.shift.checklistSignatureSvg) {
            setSignaturePath(data.shift.checklistSignatureSvg);
          }
        }
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allMarked = useMemo(() => DEFAULT_CHECKLIST.every((c) => items[c.key].ok !== null), [items]);
  const anyFailed = useMemo(() => DEFAULT_CHECKLIST.some((c) => items[c.key].ok === false), [items]);
  const blockingFailed = useMemo(
    () => DEFAULT_CHECKLIST.some((c) => c.blocking && items[c.key].ok === false),
    [items]
  );

  const setItem = (key: string, patch: Partial<ItemState>) => {
    setItems((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  // Signature pad: render the path live in an SVG (so the user sees
  // what they're drawing) and capture the path for submission.
  //
  // Why SVG over <canvas>: the canvas version was capturing pointer
  // events but never drawing anything (it only stored the path string),
  // so the user saw no feedback and assumed the signature was broken.
  // With SVG, the <path> element is the source of truth for both the
  // display and the submit payload — what you see is what gets sent.
  //
  // We use viewBox="0 0 320 120" with width="100%". The pointer
  // coordinates are converted from screen space to viewBox space via
  // getScreenCTM().inverse(), so the path is always in the same
  // coordinate system regardless of CSS size / DPI.
  const pointFromEvent = (e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const startDraw = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    drawingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pt = pointFromEvent(e);
    if (!pt) return;
    setSignaturePath(`M${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
  };
  const draw = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const pt = pointFromEvent(e);
    if (!pt) return;
    setSignaturePath((prev) => prev + ` L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`);
  };
  const endDraw = (e: React.PointerEvent<SVGSVGElement>) => {
    drawingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const clearSignature = () => setSignaturePath('');

  // Group items by category for the accordion-style display.
  const grouped = useMemo(() => {
    const m: Record<string, DefaultItem[]> = {};
    for (const c of DEFAULT_CHECKLIST) (m[c.category] ??= []).push(c);
    return m;
  }, []);

  const submit = useCallback(async () => {
    if (!allMarked) {
      setErr('Please mark every item before submitting.');
      return;
    }
    if (!signaturePath) {
      setErr('Please sign at the bottom before submitting.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // 1. Ensure a shift exists.
      let sid = shiftId;
      if (!sid) {
        const startRes = await fetch('/api/driver-app/shift/current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        if (!startRes.ok) throw new Error(`shift start failed: ${startRes.status}`);
        const sd = await startRes.json();
        sid = sd.shift.id;
        setShiftId(sid);
        setStartedAt(sd.shift.startedAt);
      }
      // 2. Persist checklist.
      const itemsPayload: Record<string, { ok: boolean; note: string }> = {};
      for (const [k, v] of Object.entries(items)) {
        if (v.ok !== null) itemsPayload[k] = { ok: v.ok, note: v.note };
      }
      const res = await fetch(`/api/driver-app/shift/${sid}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: itemsPayload,
          signatureSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><path d="${signaturePath}" stroke="white" stroke-width="2" fill="none"/></svg>`,
          signedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`checklist save failed: ${res.status}`);
      router.replace('/driver-app/menu');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'submit failed');
      setBusy(false);
    }
  }, [allMarked, items, shiftId, signaturePath, router]);

  const marked = DEFAULT_CHECKLIST.filter((c) => items[c.key].ok !== null).length;
  const total = DEFAULT_CHECKLIST.length;

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-32">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Shift start</div>
            <div className="truncate text-xl font-bold text-white">Driver Checklist</div>
            {startedAt && (
              <div className="mt-0.5 text-xs text-slate-500">
                Shift began {new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Progress</div>
            <div className={`text-sm font-bold ${allMarked ? 'text-emerald-300' : 'text-amber-300'}`}>
              {marked} / {total}
            </div>
          </div>
        </div>
      </header>

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-slate-400">Loading…</div>
      ) : (
        <main className="space-y-4 px-4 py-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <strong>Mark every item</strong> before submitting. The default state is unchecked — the
            checklist records your active check, not an assumed pass.
          </div>

          {blockingFailed && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
              <strong>One or more blocking items are failed.</strong> You can still submit (this is
              a record of what you found), but the shift will be flagged for the workshop.
            </div>
          )}

          {Object.entries(grouped).map(([cat, list]) => (
            <section key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-lg">{CATEGORY_ICON[cat]}</span>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                  {CATEGORY_LABEL[cat]}
                </h2>
                <span className="text-xs text-slate-500">
                  ({list.filter((c) => items[c.key].ok !== null).length} / {list.length})
                </span>
              </div>
              <ul className="space-y-1.5">
                {list.map((c) => {
                  const state = items[c.key];
                  return (
                    <li
                      key={c.key}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
                        state.ok === true
                          ? 'border-emerald-500/30 bg-emerald-500/10'
                          : state.ok === false
                          ? 'border-rose-500/40 bg-rose-500/10'
                          : 'border-white/10 bg-slate-900'
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{c.label}</span>
                          {c.blocking && (
                            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[9px] font-medium uppercase text-rose-300">
                              blocking
                            </span>
                          )}
                        </div>
                        {state.ok === false && (
                          <input
                            type="text"
                            placeholder="Note the issue (optional)"
                            value={state.note}
                            onChange={(e) => setItem(c.key, { note: e.target.value })}
                            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                          />
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setItem(c.key, { ok: true })}
                          className={`h-11 w-11 rounded-lg text-lg transition ${
                            state.ok === true
                              ? 'bg-emerald-500 text-white'
                              : 'border border-white/10 bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}
                          aria-label="OK"
                          title="OK"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setItem(c.key, { ok: false })}
                          className={`h-11 w-11 rounded-lg text-lg transition ${
                            state.ok === false
                              ? 'bg-rose-500 text-white'
                              : 'border border-white/10 bg-slate-800 text-slate-400 hover:bg-slate-700'
                          }`}
                          aria-label="Failed"
                          title="Failed"
                        >
                          ✗
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
              Signature
            </h2>
            <div className="rounded-xl border border-white/10 bg-slate-900 p-2">
              <svg
                ref={svgRef}
                viewBox="0 0 320 120"
                preserveAspectRatio="none"
                onPointerDown={startDraw}
                onPointerMove={draw}
                onPointerUp={endDraw}
                onPointerCancel={endDraw}
                onPointerLeave={endDraw}
                className="block h-36 w-full touch-none rounded-lg bg-slate-950"
                style={{ touchAction: 'none' }}
              >
                {signaturePath && (
                  <path
                    d={signaturePath}
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )}
              </svg>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {signaturePath ? 'Signed ✓' : 'Sign with your finger or mouse'}
                </span>
                <button
                  type="button"
                  onClick={clearSignature}
                  className="text-xs text-slate-400 underline"
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          {err && (
            <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              {err}
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !allMarked}
            className="sticky bottom-4 w-full rounded-2xl bg-violet-600 px-4 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-violet-500 disabled:opacity-50"
          >
            {busy
              ? 'Submitting…'
              : !allMarked
              ? `Mark all ${total} items to submit`
              : blockingFailed
              ? 'Submit (blocking items failed)'
              : 'Submit checklist'}
          </button>
        </main>
      )}
    </div>
  );
}
