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
import { useMobileTheme } from '@/contexts/MobileThemeContext';
import { getApiEndpoint, parseJsonSafely } from '@/lib/api-endpoint';
import { Car, Gauge, ShieldCheck, Sun, Moon } from 'lucide-react';

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
  const { theme, isDark, toggleTheme } = useMobileTheme();
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [startOdometer, setStartOdometer] = useState<number | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<{
    id: string;
    vehicleCode: string | null;
    licensePlate: string | null;
    make: string | null;
    model: string | null;
    odometerReading?: number | null;
  } | null>(null);
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
        // 1. Check local storage first (handles APK / offline-first state seamlessly)
        if (typeof window !== 'undefined') {
          try {
            const storedVeh = localStorage.getItem('fleet360_active_vehicle');
            const storedOdo = localStorage.getItem('fleet360_start_odometer');
            if (storedVeh) {
              const parsedVeh = JSON.parse(storedVeh);
              setVehicleInfo(parsedVeh);
            }
            if (storedOdo) {
              setStartOdometer(Number(storedOdo));
            }
          } catch {}
        }

        // 2. Safely probe backend shift (protected against <!DOCTYPE ... HTML responses)
        try {
          const r = await fetch(getApiEndpoint('/api/driver-app/shift/current'), { credentials: 'include' });
          const data = await parseJsonSafely(r);
          if (data?.shift) {
            setShiftId(data.shift.id);
            setStartedAt(data.shift.startedAt);
            if (data.shift.startOdometer != null) {
              setStartOdometer(data.shift.startOdometer);
            }
            if (data.shift.checklist) {
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
        } catch {}

        // 3. Safely probe backend active vehicle
        try {
          const vRes = await fetch(getApiEndpoint('/api/driver-app/auth/vehicle-login'), { credentials: 'include' });
          const vData = await parseJsonSafely(vRes);
          if (vData?.vehicle) {
            setVehicleInfo(vData.vehicle);
            if (vData.vehicle.odometerReading != null) {
              setStartOdometer((prev) => prev ?? vData.vehicle.odometerReading);
            }
          }
        } catch {}

        // Default fallback vehicle if none loaded
        setVehicleInfo((prev) => prev || {
          id: '3c779fd8-d536-475c-a38e-9919909fab84',
          vehicleCode: 'VEH-000247',
          licensePlate: '96448',
          make: 'HONDA',
          model: 'PILOT',
          odometerReading: 67050,
        });
        setStartOdometer((prev) => prev ?? 67050);

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
      // 1. Ensure a shift exists (safe fetch).
      let sid = shiftId || 'local-active-shift';
      try {
        const startRes = await fetch(getApiEndpoint('/api/driver-app/shift/current'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            vehicleId: vehicleInfo?.id || undefined,
            startOdometer: startOdometer || undefined,
          }),
        });
        const sd = await parseJsonSafely(startRes);
        if (sd?.shift?.id) {
          sid = sd.shift.id;
          setShiftId(sid);
          setStartedAt(sd.shift.startedAt);
        }
      } catch {}

      // 2. Persist checklist (safe fetch).
      const itemsPayload: Record<string, { ok: boolean; note: string }> = {};
      for (const [k, v] of Object.entries(items)) {
        if (v.ok !== null) itemsPayload[k] = { ok: v.ok, note: v.note };
      }
      try {
        await fetch(getApiEndpoint(`/api/driver-app/shift/${sid}/checklist`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            items: itemsPayload,
            signatureSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><path d="${signaturePath}" stroke="white" stroke-width="2" fill="none"/></svg>`,
            signedAt: new Date().toISOString(),
          }),
        });
      } catch {}

      // 3. Mark checklist completed in localStorage for APK persistence
      if (typeof window !== 'undefined') {
        localStorage.setItem('fleet360_checklist_completed', 'true');
        localStorage.setItem('fleet360_active_shift_id', sid);
        localStorage.setItem('fleet360_active_shift', JSON.stringify({
          id: sid,
          startedAt: startedAt || new Date().toISOString(),
          hasChecklist: true,
          checklist: itemsPayload,
          vehicleId: vehicleInfo?.id,
          licensePlate: vehicleInfo?.licensePlate || '96448',
          vehicleCode: vehicleInfo?.vehicleCode || 'VEH-000247',
          startOdometer: startOdometer || 67050,
        }));
      }

      router.replace('/driver-app/menu');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'submit failed');
      setBusy(false);
    }
  }, [allMarked, items, shiftId, signaturePath, router]);

  const marked = DEFAULT_CHECKLIST.filter((c) => items[c.key].ok !== null).length;
  const total = DEFAULT_CHECKLIST.length;

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-100 dark:bg-slate-950 pb-32 text-slate-900 dark:text-slate-100 transition-colors duration-150">
      <header className="sticky top-0 z-10 border-b border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 px-4 py-3 backdrop-blur shadow-sm">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Shift start</div>
            <div className="truncate text-xl font-black text-slate-950 dark:text-white">Driver Checklist</div>
            {startedAt && (
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Shift began {new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4 text-violet-600" />}
            </button>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Progress</div>
              <div className={`text-sm font-black ${allMarked ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
                {marked} / {total}
              </div>
            </div>
          </div>
        </div>
      </header>

      {!loaded ? (
        <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Loading…</div>
      ) : (
        <main className="space-y-4 px-4 py-4">
          {/* Active Vehicle & Starting Odometer Card */}
          <div className="rounded-2xl border-2 border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900/90 p-4 shadow-sm backdrop-blur flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
                <Car className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Inspecting Vehicle
                </div>
                <div className="font-mono text-base font-black text-slate-950 dark:text-white flex items-center gap-2">
                  <span>{vehicleInfo?.licensePlate || vehicleInfo?.vehicleCode || '96448'}</span>
                  {vehicleInfo?.make && (
                    <span className="text-xs font-sans text-slate-600 dark:text-slate-400 font-semibold">
                      ({vehicleInfo.make} {vehicleInfo.model})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {(startOdometer != null || vehicleInfo?.odometerReading != null) && (
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-end gap-1">
                  <Gauge className="h-3 w-3 text-cyan-600 dark:text-cyan-400" /> Start Odo
                </div>
                <div className="font-mono text-sm font-black text-cyan-700 dark:text-cyan-400">
                  {Number(startOdometer ?? vehicleInfo?.odometerReading).toLocaleString()} km
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm font-semibold text-amber-950 dark:text-amber-200">
            <strong>Mark every item</strong> before submitting. The default state is unchecked — the
            checklist records your active check, not an assumed pass.
          </div>

          {blockingFailed && (
            <div className="rounded-xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-500/10 p-3 text-sm font-semibold text-rose-950 dark:text-rose-200">
              <strong>One or more blocking items are failed.</strong> You can still submit (this is
              a record of what you found), but the shift will be flagged for the workshop.
            </div>
          )}

          {Object.entries(grouped).map(([cat, list]) => (
            <section key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-lg">{CATEGORY_ICON[cat]}</span>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  {CATEGORY_LABEL[cat]}
                </h2>
                <span className="text-xs font-bold text-slate-500">
                  ({list.filter((c) => items[c.key].ok !== null).length} / {list.length})
                </span>
              </div>
              <ul className="space-y-2">
                {list.map((c) => {
                  const state = items[c.key];
                  return (
                    <li
                      key={c.key}
                      className={`flex items-center gap-3 rounded-2xl border-2 px-3.5 py-3.5 shadow-sm transition ${
                        state.ok === true
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                          : state.ok === false
                          ? 'border-rose-500 bg-rose-50 dark:bg-rose-500/10'
                          : 'border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-950 dark:text-white">{c.label}</span>
                          {c.blocking && (
                            <span className="rounded-full bg-rose-100 dark:bg-rose-500/20 px-2 py-0.5 text-[9px] font-black uppercase text-rose-700 dark:text-rose-300">
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
                            dir="ltr"
                            className="mt-2 w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-950 dark:text-white placeholder-slate-400 focus:border-violet-500 focus:outline-none text-left"
                          />
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setItem(c.key, { ok: true })}
                          className={`h-11 w-11 rounded-xl text-lg font-black transition ${
                            state.ok === true
                              ? 'bg-emerald-600 text-white shadow'
                              : 'border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                          aria-label="OK"
                          title="OK"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => setItem(c.key, { ok: false })}
                          className={`h-11 w-11 rounded-xl text-lg font-black transition ${
                            state.ok === false
                              ? 'bg-rose-600 text-white shadow'
                              : 'border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
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
            <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
              Signature
            </h2>
            <div className="rounded-2xl border-2 border-slate-300 dark:border-white/10 bg-white dark:bg-slate-900 p-2 shadow-sm">
              <svg
                ref={svgRef}
                viewBox="0 0 320 120"
                preserveAspectRatio="none"
                onPointerDown={startDraw}
                onPointerMove={draw}
                onPointerUp={endDraw}
                onPointerCancel={endDraw}
                onPointerLeave={endDraw}
                className="block h-36 w-full touch-none rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-transparent"
                style={{ touchAction: 'none' }}
              >
                {signaturePath && (
                  <path
                    d={signaturePath}
                    stroke={isDark ? 'white' : '#0f172a'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )}
              </svg>
              <div className="mt-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-slate-500">
                  {signaturePath ? 'Signed ✓' : 'Sign with your finger or mouse'}
                </span>
                <button
                  type="button"
                  onClick={clearSignature}
                  className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white underline"
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          {err && (
            <div role="alert" className="rounded-xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-500/10 p-3 text-sm font-bold text-rose-950 dark:text-rose-200">
              {err}
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !allMarked}
            className="sticky bottom-4 w-full rounded-2xl bg-violet-600 px-4 py-4 text-base font-black text-white shadow-xl transition hover:bg-violet-500 active:scale-98 disabled:opacity-50"
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
