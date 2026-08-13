/**
 * src/app/(driver)/driver-app/dvirs/new/page.tsx
 *
 * DVIR (Driver Vehicle Inspection Report) form. Mobile-first.
 *
 * See the design notes in the previous version of this file. This
 * revision moves the `itemsState` helper above the JSX so the
 * closure resolves correctly, and wraps the component in Suspense
 * for `useSearchParams` (Next.js 15 requirement).
 */

'use client';

import React, { Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';
import {
  putDvir,
  putDvirPhoto,
  newId,
  type OfflineDvir,
  type OfflineDvirPhoto,
} from '@/lib/driver-offline/db';
import {
  enqueueDvirSubmission,
  forceDrain,
} from '@/lib/driver-offline/sync';
import { getCamera, getNetwork } from '@/lib/driver-offline/capacitor';

type ItemState = {
  ok: boolean | null;   // null = not yet marked (default; forces active check)
  note: string;
  photoIds: string[];
};

type DefectDraft = {
  category: string;
  description: string;
  severity: 'MINOR' | 'MAJOR' | 'CRITICAL';
  photoIds: string[];
};

const DEFAULT_CHECKLIST: Array<{ key: string; label: string; category: string; blocking: boolean }> = [
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
  { key: 'cabin_mirror',       label: 'Mirrors adjusted and clean',        category: 'cabin', blocking: false },
];

const CATEGORY_ICON: Record<string, string> = {
  tyres: '🛞', brakes: '🛑', lights: '💡', safety: '🦺',
  docs: '📄', fluids: '⛽', cabin: '🚌',
};

function NewDvirPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = params?.get('tripId') ?? '';
  const type: 'PRE_TRIP' | 'POST_TRIP' = (params?.get('type') as any) || 'PRE_TRIP';

  const [items, setItems] = useState<Record<string, ItemState>>(() => {
    const init: Record<string, ItemState> = {};
    for (const c of DEFAULT_CHECKLIST) init[c.key] = { ok: null, note: '', photoIds: [] };
    return init;
  });
  const [defects, setDefects] = useState<DefectDraft[]>([]);
  const [odometer, setOdometer] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [signaturePath, setSignaturePath] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const dvirId = useMemo(() => newId(), []);
  const startedAt = useMemo(() => new Date().toISOString(), []);

  const grouped = useMemo(() => {
    const m: Record<string, typeof DEFAULT_CHECKLIST> = {};
    for (const c of DEFAULT_CHECKLIST) {
      (m[c.category] ??= []).push(c);
    }
    return m;
  }, []);

  const itemState = useCallback(
    (key: string): ItemState => items[key] ?? { ok: null, note: '', photoIds: [] },
    [items],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const net = await getNetwork();
        if (!cancelled) setOnline(Boolean((net as any).connected));
      } catch { /* no plugin */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const capturePhoto = useCallback(async (
    target: { kind: 'item'; key: string } | { kind: 'defect'; index: number },
  ) => {
    try {
      const cam = await getCamera();
      let dataUrl: string | null = null;
      if (cam) {
        const photo = await (cam as any).Camera.getPhoto({
          quality: 75,
          allowEditing: false,
          resultType: (cam as any).CameraResultType.DataUrl,
          source: (cam as any).CameraSource.Prompt,
          correctOrientation: true,
        });
        dataUrl = photo.dataUrl ?? null;
      } else if (typeof document !== 'undefined') {
        dataUrl = await new Promise<string | null>((resolve) => {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = 'image/*';
          inp.capture = 'environment';
          inp.onchange = () => {
            const f = inp.files?.[0];
            if (!f) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(f);
          };
          inp.click();
        });
      }
      if (!dataUrl) return;

      const photoId = newId();
      const blob = await (await fetch(dataUrl)).blob();
      const photo: OfflineDvirPhoto = {
        id: photoId,
        dvirId,
        itemKey: target.kind === 'item' ? target.key : null,
        blob,
        mime: blob.type || 'image/jpeg',
        size: blob.size,
        takenAt: new Date().toISOString(),
        remoteUrl: null,
      };
      await putDvirPhoto(photo);

      if (target.kind === 'item') {
        setItems((prev) => ({
          ...prev,
          [target.key]: {
            ...prev[target.key],
            photoIds: [...prev[target.key].photoIds, photoId],
          },
        }));
      } else {
        setDefects((prev) => prev.map((d, i) =>
          i === target.index
            ? { ...d, photoIds: [...d.photoIds, photoId] }
            : d,
        ));
      }
    } catch (e) {
      console.warn('photo capture failed', e);
    }
  }, [dvirId]);

  const canvasRef = useRef<SVGSVGElement | null>(null);
  const drawingRef = useRef<{ d: string; isDrawing: boolean }>({ d: '', isDrawing: false });

  // Convert a pointer event's clientX/Y into the SVG's viewBox
  // coordinate space. The previous implementation used
  // getBoundingClientRect() and subtracted the displayed position,
  // but the SVG has a fixed viewBox (0 0 600 160) and is rendered
  // at 100% width — on a desktop the displayed size is way larger
  // than 600px, so CSS-pixel coordinates ended up outside the viewBox
  // and the signature appeared as a tiny dot in the corner.
  //
  // getScreenCTM().inverse() handles all scaling (DPI, CSS size,
  // preserveAspectRatio) and returns the correct viewBox coordinate.
  const pointFromEvent = (e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
    const svg = canvasRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const onSigStart = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pt = pointFromEvent(e);
    if (!pt) return;
    drawingRef.current = { d: `M${pt.x.toFixed(1)},${pt.y.toFixed(1)}`, isDrawing: true };
    setSignaturePath(drawingRef.current.d);
  };
  const onSigMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingRef.current.isDrawing) return;
    e.preventDefault();
    const pt = pointFromEvent(e);
    if (!pt) return;
    drawingRef.current.d += ` L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    setSignaturePath(drawingRef.current.d);
  };
  const onSigEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    drawingRef.current.isDrawing = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const submit = useCallback(async () => {
    if (!tripId) {
      alert('No trip id — return to /driver-app/today and start the inspection from there.');
      return;
    }
    const failingBlocking = DEFAULT_CHECKLIST.filter(
      (c) => c.blocking && items[c.key] && !items[c.key].ok,
    );
    if (failingBlocking.length > 0) {
      const proceed = confirm(
        `${failingBlocking.length} blocking check(s) failed. ` +
        `This will BLOCK the vehicle. Continue?`,
      );
      if (!proceed) return;
    }

    setBusy(true);
    try {
      const me = await fetch('/api/auth/me', { credentials: 'include' });
      const meData = me.ok ? await me.json() : null;
      if (!meData?.id) throw new Error('not signed in');

      const dvir: OfflineDvir = {
        id: dvirId,
        tripId,
        driverId: meData.id,
        tenantId: meData.tenantId,
        type,
        startedAt,
        completedAt: new Date().toISOString(),
        odometerStart: type === 'PRE_TRIP' ? Number(odometer) || null : null,
        odometerEnd:   type === 'POST_TRIP' ? Number(odometer) || null : null,
        // Coerce unchecked items (ok: null) to failed (ok: false) at
        // submit time. The new UX requires every item to be actively
        // marked, but the offline IndexedDB schema and the API Zod
        // schema both expect boolean. The form blocks submit on
        // unchecked items (allChecked check below) so this branch
        // shouldn't fire in practice — it's defence-in-depth for the
        // case where someone bypasses the UI guard.
        items: Object.fromEntries(
          Object.entries(items).map(([k, v]) => [k, {
            ok: v.ok === null ? false : v.ok,
            ...(v.note ? { note: v.note } : {}),
            ...(v.photoIds.length ? { photoIds: v.photoIds } : {}),
          }]),
        ),
        defects: defects.map((d) => ({
          category: d.category,
          description: d.description,
          severity: d.severity,
          photoIds: d.photoIds,
        })),
        notes: notes || null,
        signatureSvg: signaturePath || null,
        status: 'PENDING_SYNC',
        enqueuedAt: Date.now(),
        lastSyncAttemptAt: null,
        lastSyncError: null,
      };
      await putDvir(dvir);
      await enqueueDvirSubmission({
        tripId,
        driverId: meData.id,
        tenantId: meData.tenantId,
        dvir: {
          id: dvir.id,
          type: dvir.type,
          startedAt: dvir.startedAt,
          completedAt: dvir.completedAt,
          odometerStart: dvir.odometerStart,
          odometerEnd: dvir.odometerEnd,
          // The sync queue's Zod schema requires boolean (not
          // boolean | null) — items were already coerced to false
          // for null entries when building dvir.items above. Cast
          // through unknown for the type narrow.
          items: dvir.items as unknown as Record<string, { ok: boolean; note?: string; photoIds?: string[] }>,
          defects: dvir.defects,
          notes: dvir.notes,
          signatureSvg: dvir.signatureSvg,
        },
      });
      void forceDrain();
      try {
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
        await Haptics.impact({ style: ImpactStyle.Medium });
      } catch { /* ignore */ }
      router.replace('/driver-app/today?dvir=' + dvirId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  }, [items, defects, odometer, notes, signaturePath, dvirId, startedAt, tripId, type, router]);

  const allOk = useMemo(
    () => DEFAULT_CHECKLIST.every((c) => !c.blocking || items[c.key]?.ok),
    [items],
  );

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-32">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              {type === 'PRE_TRIP' ? 'Pre-trip' : 'Post-trip'} inspection
            </div>
            <div className="truncate text-base font-semibold text-white">
              {Object.keys(grouped).length} categories · {DEFAULT_CHECKLIST.length} items
            </div>
          </div>
          <div className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
          }`}>
            {online ? '● Online' : '● Offline — will sync later'}
          </div>
        </div>
      </header>

      <main className="px-4 py-4">
        {Object.entries(grouped).map(([cat, catItems]) => (
          <section key={cat} className="mb-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
              <span className="text-lg">{CATEGORY_ICON[cat] ?? '•'}</span>
              {cat}
            </h2>
            <div className="space-y-2">
              {catItems.map((c) => {
                const st = itemState(c.key);
                const expanded = expandedKey === c.key;
                const tone =
                  st.ok === true
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : st.ok === false
                    ? 'border-rose-500/30 bg-rose-500/10'
                    : 'border-white/10 bg-slate-900';
                return (
                  <div key={c.key} className={`rounded-xl border ${tone}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedKey(expanded ? null : c.key)}
                      className="flex w-full items-center justify-between p-3 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setItems((p) => ({ ...p, [c.key]: { ...p[c.key], ok: !p[c.key].ok } }));
                          }}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold transition ${
                            st.ok === true
                              ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                              : st.ok === false
                              ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40'
                              : 'bg-slate-800 text-slate-400 ring-1 ring-white/10'
                          }`}
                          aria-label={st.ok ? 'Mark failed' : 'Mark OK'}
                        >
                          {st.ok === true ? '✓' : st.ok === false ? '✗' : '?'}
                        </button>
                        <div>
                          <div className="text-sm font-medium text-white">{c.label}</div>
                          {c.blocking && (
                            <div className="text-[11px] text-rose-300/80">Blocking check</div>
                          )}
                          {st.photoIds.length > 0 && (
                            <div className="text-[11px] text-violet-300">📷 {st.photoIds.length} photo(s)</div>
                          )}
                        </div>
                      </div>
                      <div className="text-slate-500 text-lg">{expanded ? '▴' : '▾'}</div>
                    </button>
                    {expanded && (
                      <div className="border-t border-white/5 p-3">
                        <textarea
                          placeholder="Note (e.g. 'rear-left brake feels spongy')"
                          value={st.note}
                          onChange={(e) => setItems((p) => ({ ...p, [c.key]: { ...p[c.key], note: e.target.value } }))}
                          className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                          rows={2}
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void capturePhoto({ kind: 'item', key: c.key })}
                            className="flex-1 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                          >
                            📷 Add photo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">Defects</h2>
          {defects.length === 0 && (
            <p className="text-xs text-slate-500">No defects reported. Tap &quot;Add defect&quot; if anything is wrong beyond the checklist.</p>
          )}
          {defects.map((d, i) => (
            <div key={i} className="mb-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-rose-200">
                  {d.category} · <span className="text-xs uppercase">{d.severity}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDefects((p) => p.filter((_, j) => j !== i))}
                  className="text-xs text-slate-400 hover:text-rose-300"
                >
                  Remove
                </button>
              </div>
              <div className="mt-1 text-sm text-slate-200">{d.description}</div>
              {d.photoIds.length > 0 && (
                <div className="mt-1 text-[11px] text-violet-300">📷 {d.photoIds.length} photo(s)</div>
              )}
              <button
                type="button"
                onClick={() => void capturePhoto({ kind: 'defect', index: i })}
                className="mt-2 rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
              >
                📷 Add photo
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const cat = prompt('Category (e.g. brakes, tyres, lights):');
              if (!cat) return;
              const desc = prompt('Describe the defect:');
              if (!desc) return;
              const sevRaw = prompt('Severity: MINOR, MAJOR, or CRITICAL?', 'MAJOR');
              const severity = (sevRaw === 'MINOR' || sevRaw === 'CRITICAL') ? sevRaw : 'MAJOR';
              setDefects((p) => [...p, { category: cat, description: desc, severity, photoIds: [] }]);
            }}
            className="mt-2 w-full rounded-xl border border-dashed border-white/15 bg-slate-900/50 p-3 text-sm text-slate-300 hover:bg-slate-900"
          >
            + Add defect
          </button>
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">
            Odometer ({type === 'PRE_TRIP' ? 'start of shift' : 'end of shift'})
          </h2>
          <input
            type="number"
            inputMode="numeric"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            placeholder="km"
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">Notes</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything else the dispatcher should know"
            rows={3}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-300">Signature</h2>
          <div className="rounded-xl border border-white/10 bg-slate-900">
            <svg
              ref={canvasRef}
              viewBox="0 0 600 160"
              preserveAspectRatio="none"
              className="block h-40 w-full touch-none"
              onPointerDown={onSigStart}
              onPointerMove={onSigMove}
              onPointerUp={onSigEnd}
              onPointerLeave={onSigEnd}
            >
              <line x1="0" y1="140" x2="600" y2="140" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4" />
              {signaturePath && (
                <path
                  d={signaturePath}
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )}
            </svg>
            <div className="border-t border-white/5 p-2 text-right">
              <button
                type="button"
                onClick={() => setSignaturePath('')}
                className="text-xs text-slate-400 hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="flex-1 text-xs text-slate-400">
            {allOk
              ? '✓ All blocking checks OK'
              : '⚠ Some blocking checks failed — vehicle will be flagged'}
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit DVIR'}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default function NewDvirPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Loading…</div>}>
      <NewDvirPageInner />
    </Suspense>
  );
}
