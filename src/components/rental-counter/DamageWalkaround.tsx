'use client';

/**
 * Vehicle damage walkaround — clickable car silhouette (top-down view)
 * with overlay zones. Tap a zone to add a damage marker; tap a marker
 * to remove. Each marker carries position + zone code.
 *
 * Used by the counter PWA for both BEFORE handover and AFTER return
 * inspections. Markers are submitted with the agreement.
 */

import React, { useRef, useState } from 'react';

export interface DamageMarker {
  zone: string;
  type: 'SCRATCH' | 'DENT' | 'CHIP' | 'BROKEN' | 'STAIN' | 'OTHER';
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
  /** % position within the SVG viewbox (0-100). */
  x: number;
  y: number;
  note?: string;
}

export type BaselineDamageMarker = Partial<DamageMarker> & {
  zoneId?: string;
  description?: string;
};

export interface DamageWalkaroundProps {
  markers: DamageMarker[];
  onChange: (markers: DamageMarker[]) => void;
  readonly?: boolean;
  /** Optional pre-rental (pick-up) markers rendered as non-deletable dashed reference pins for Return diffing. */
  baselineMarkers?: BaselineDamageMarker[];
}

const ZONES: Array<{ code: string; label: string; box: { x: number; y: number; w: number; h: number } }> = [
  // Top-down view, x: 0-100, y: 0-200 (portrait)
  { code: 'HOOD',                label: 'Hood',                box: { x: 25, y: 5,   w: 50, h: 35 } },
  { code: 'WINDSHIELD',          label: 'Windshield',          box: { x: 25, y: 40,  w: 50, h: 15 } },
  { code: 'ROOF',                label: 'Roof',                box: { x: 25, y: 55,  w: 50, h: 50 } },
  { code: 'REAR_WINDOW',         label: 'Rear window',         box: { x: 25, y: 105, w: 50, h: 15 } },
  { code: 'TRUNK',               label: 'Trunk',               box: { x: 25, y: 120, w: 50, h: 30 } },
  { code: 'FRONT_BUMPER',        label: 'Front bumper',        box: { x: 25, y: 0,   w: 50, h: 5  } },
  { code: 'REAR_BUMPER',         label: 'Rear bumper',         box: { x: 25, y: 150, w: 50, h: 5  } },
  { code: 'FRONT_LEFT_FENDER',   label: 'Front L fender',      box: { x: 5,  y: 5,   w: 20, h: 30 } },
  { code: 'FRONT_RIGHT_FENDER',  label: 'Front R fender',      box: { x: 75, y: 5,   w: 20, h: 30 } },
  { code: 'FRONT_LEFT_DOOR',     label: 'Front L door',        box: { x: 5,  y: 50,  w: 20, h: 30 } },
  { code: 'FRONT_RIGHT_DOOR',    label: 'Front R door',        box: { x: 75, y: 50,  w: 20, h: 30 } },
  { code: 'REAR_LEFT_DOOR',      label: 'Rear L door',         box: { x: 5,  y: 80,  w: 20, h: 30 } },
  { code: 'REAR_RIGHT_DOOR',     label: 'Rear R door',         box: { x: 75, y: 80,  w: 20, h: 30 } },
  { code: 'REAR_LEFT_QUARTER',   label: 'Rear L quarter',      box: { x: 5,  y: 110, w: 20, h: 35 } },
  { code: 'REAR_RIGHT_QUARTER',  label: 'Rear R quarter',      box: { x: 75, y: 110, w: 20, h: 35 } },
];

const ZONE_ALIASES: Record<string, string> = {
  BONNET: 'HOOD',
  BOOT: 'TRUNK',
  BUMPER_FRONT: 'FRONT_BUMPER',
  BUMPER_REAR: 'REAR_BUMPER',
  FENDER_FL: 'FRONT_LEFT_FENDER',
  FENDER_FR: 'FRONT_RIGHT_FENDER',
  DOOR_FL: 'FRONT_LEFT_DOOR',
  DOOR_FR: 'FRONT_RIGHT_DOOR',
  DOOR_RL: 'REAR_LEFT_DOOR',
  DOOR_RR: 'REAR_RIGHT_DOOR',
  QUARTER_RL: 'REAR_LEFT_QUARTER',
  QUARTER_RR: 'REAR_RIGHT_QUARTER',
  LEFT_SIDE: 'FRONT_LEFT_DOOR',
  RIGHT_SIDE: 'FRONT_RIGHT_DOOR',
};

const TYPE_OPTIONS: DamageMarker['type'][] = ['SCRATCH', 'DENT', 'CHIP', 'BROKEN', 'STAIN', 'OTHER'];
const SEVERITY_OPTIONS: DamageMarker['severity'][] = ['MINOR', 'MODERATE', 'MAJOR'];

const TYPE_COLORS: Record<DamageMarker['type'], string> = {
  SCRATCH: '#f59e0b',
  DENT: '#ea580c',
  CHIP: '#eab308',
  BROKEN: '#dc2626',
  STAIN: '#a855f7',
  OTHER: '#64748b',
};

function resolveMarkerCoords(m: BaselineDamageMarker, idx: number): { x: number; y: number; zoneLabel: string } {
  const rawZone = String(m.zone ?? m.zoneId ?? 'ROOF').trim().toUpperCase();
  const normalizedCode = ZONE_ALIASES[rawZone] ?? rawZone;
  const zoneDef = ZONES.find((z) => z.code === normalizedCode);

  if (
    typeof m.x === 'number' &&
    typeof m.y === 'number' &&
    Number.isFinite(m.x) &&
    Number.isFinite(m.y) &&
    (m.x > 0 || m.y > 0)
  ) {
    return { x: m.x, y: m.y, zoneLabel: zoneDef?.label ?? rawZone.replace(/_/g, ' ') };
  }

  if (zoneDef) {
    const jitterX = ((idx % 3) - 1) * 4;
    const jitterY = (Math.floor(idx / 3) % 2) * 4 - 2;
    return {
      x: Math.max(4, Math.min(96, zoneDef.box.x + zoneDef.box.w / 2 + jitterX)),
      y: Math.max(3, Math.min(152, zoneDef.box.y + zoneDef.box.h / 2 + jitterY)),
      zoneLabel: zoneDef.label,
    };
  }

  return { x: 50, y: 78, zoneLabel: rawZone.replace(/_/g, ' ') };
}

export function DamageWalkaround({
  markers,
  onChange,
  readonly,
  baselineMarkers,
}: DamageWalkaroundProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pendingPosition, setPendingPosition] = useState<{ zone: string; x: number; y: number } | null>(null);
  const [tempMarker, setTempMarker] = useState<{ type: DamageMarker['type']; severity: DamageMarker['severity']; note: string }>({
    type: 'SCRATCH', severity: 'MINOR', note: '',
  });

  function findZoneAt(x: number, y: number): string | null {
    for (const z of ZONES) {
      if (x >= z.box.x && x <= z.box.x + z.box.w && y >= z.box.y && y <= z.box.y + z.box.h) {
        return z.code;
      }
    }
    return null;
  }

  function handleTap(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    if (readonly) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    let cx: number, cy: number;
    if ('touches' in e && e.touches.length > 0) {
      cx = e.touches[0].clientX - rect.left;
      cy = e.touches[0].clientY - rect.top;
    } else if ('clientX' in e) {
      cx = e.clientX - rect.left;
      cy = e.clientY - rect.top;
    } else {
      return;
    }
    const x = (cx / rect.width) * 100;
    const y = (cy / rect.height) * 155;
    const zone = findZoneAt(x, y);
    if (!zone) return;
    setPendingPosition({ zone, x, y });
  }

  function commitPending() {
    if (!pendingPosition) return;
    onChange([
      ...markers,
      {
        zone: pendingPosition.zone,
        x: pendingPosition.x,
        y: pendingPosition.y,
        type: tempMarker.type,
        severity: tempMarker.severity,
        note: tempMarker.note || undefined,
      },
    ]);
    setPendingPosition(null);
    setTempMarker({ type: 'SCRATCH', severity: 'MINOR', note: '' });
  }

  function removeMarker(idx: number) {
    if (readonly) return;
    const next = markers.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  const showDiffLegend = baselineMarkers !== undefined;
  const baselineList = baselineMarkers ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
          Damage walkaround{' '}
          {markers.length > 0 && (
            <span className="text-rose-400 font-semibold">
              · {markers.length} new marker{markers.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {showDiffLegend && (
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-300">
              <span className="w-3 h-3 rounded-full border border-dashed border-amber-500 bg-amber-400/30 inline-block" />
              Pre-Existing Pick-Up Damage ({baselineList.length})
            </span>
            <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-300">
              <span className="w-3 h-3 rounded-full bg-rose-600 border border-white inline-block" />
              New Return Damage ({markers.length})
            </span>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-slate-100 p-4 select-none touch-none">
        <svg
          ref={svgRef}
          viewBox="0 0 100 155"
          className="w-full max-w-xs mx-auto block"
          style={{ touchAction: 'manipulation' }}
          onClick={handleTap}
        >
          {/* Car silhouette (top-down) */}
          <rect x="25" y="0" width="50" height="155" rx="10" fill="#cbd5e1" stroke="#475569" strokeWidth="0.4" />
          {/* Hood section */}
          <rect x="25" y="5" width="50" height="35" fill="#94a3b8" stroke="#475569" strokeWidth="0.3" />
          {/* Windshield */}
          <polygon points="28,40 72,40 70,55 30,55" fill="#7dd3fc" stroke="#0284c7" strokeWidth="0.3" />
          {/* Roof */}
          <rect x="28" y="55" width="44" height="50" fill="#94a3b8" stroke="#475569" strokeWidth="0.3" />
          {/* Rear window */}
          <polygon points="30,105 70,105 72,120 28,120" fill="#7dd3fc" stroke="#0284c7" strokeWidth="0.3" />
          {/* Trunk */}
          <rect x="25" y="120" width="50" height="30" fill="#94a3b8" stroke="#475569" strokeWidth="0.3" />
          {/* Doors (subtle dividers) */}
          <line x1="25" y1="80" x2="75" y2="80" stroke="#64748b" strokeWidth="0.4" />
          {/* Wheels */}
          <ellipse cx="22" cy="20" rx="4" ry="6" fill="#1e293b" />
          <ellipse cx="78" cy="20" rx="4" ry="6" fill="#1e293b" />
          <ellipse cx="22" cy="135" rx="4" ry="6" fill="#1e293b" />
          <ellipse cx="78" cy="135" rx="4" ry="6" fill="#1e293b" />

          {/* Pre-existing baseline pick-up markers (non-deletable dashed reference pins) */}
          {baselineList.map((bm, idx) => {
            const pos = resolveMarkerCoords(bm, idx);
            const noteLabel = bm.note ?? bm.description ?? '';
            return (
              <g key={`base-${idx}`} style={{ pointerEvents: 'none' }}>
                <title>
                  {`Pick-Up #P${idx + 1}: ${pos.zoneLabel} (${bm.severity ?? 'MINOR'})${noteLabel ? ` — ${noteLabel}` : ''}`}
                </title>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={3.4}
                  fill="#fbbf24"
                  fillOpacity={0.32}
                  stroke="#b45309"
                  strokeWidth="0.7"
                  strokeDasharray="1.1 0.7"
                />
                <text
                  x={pos.x}
                  y={pos.y + 0.9}
                  textAnchor="middle"
                  fontSize="2.4"
                  fill="#78350f"
                  fontWeight="bold"
                >
                  {`P${idx + 1}`}
                </text>
              </g>
            );
          })}

          {/* Existing / new return markers */}
          {markers.map((m, i) => {
            const pos = resolveMarkerCoords(m, i);
            const color = TYPE_COLORS[m.type] ?? '#dc2626';
            return (
              <g
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  removeMarker(i);
                }}
                style={{ cursor: readonly ? 'default' : 'pointer' }}
              >
                <circle cx={pos.x} cy={pos.y} r={3.1} fill={color} stroke="white" strokeWidth="0.7" />
                <text x={pos.x} y={pos.y + 1} textAnchor="middle" fontSize="3" fill="white" fontWeight="bold">
                  {(i + 1).toString()}
                </text>
              </g>
            );
          })}

          {/* Pending position */}
          {pendingPosition && (
            <circle cx={pendingPosition.x} cy={pendingPosition.y} r={3.5} fill="none" stroke="#0d9488" strokeWidth="0.8" strokeDasharray="1.2 0.6">
              <animate attributeName="r" from="3.5" to="5" dur="1s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
        <div className="text-center text-xs text-[var(--text-faint)] mt-2">
          {readonly
            ? 'Read-only view'
            : pendingPosition
              ? `Tap "Save marker" below — selected ${pendingPosition.zone}`
              : showDiffLegend
                ? 'Dashed P-pins are pre-existing pick-up damages. Tap a panel to mark NEW return damage.'
                : 'Tap a panel to mark damage. Tap a marker to remove.'}
        </div>
      </div>

      {/* Pending marker form */}
      {pendingPosition && !readonly && (
        <div className="rounded-xl bg-[var(--bg-surface)]/60 border border-amber-500/30 p-4 space-y-3">
          <div className="text-sm font-medium text-amber-200">
            New marker · <span className="font-mono">{pendingPosition.zone.replace(/_/g, ' ')}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">Type</label>
              <select
                value={tempMarker.type}
                onChange={(e) => setTempMarker({ ...tempMarker, type: e.target.value as DamageMarker['type'] })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
              >
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">Severity</label>
              <select
                value={tempMarker.severity}
                onChange={(e) => setTempMarker({ ...tempMarker, severity: e.target.value as DamageMarker['severity'] })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
              >
                {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <input
            type="text"
            value={tempMarker.note}
            onChange={(e) => setTempMarker({ ...tempMarker, note: e.target.value })}
            placeholder="Note (optional)"
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPendingPosition(null)}
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitPending}
              className="flex-1 px-3 py-2 rounded-lg bg-amber-600 text-[var(--text-main)] hover:bg-amber-500 text-sm font-medium"
            >
              Save marker
            </button>
          </div>
        </div>
      )}

      {/* Pre-existing baseline summary */}
      {baselineList.length > 0 && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-300 mb-1">
            Pre-Existing Pick-Up Damage ({baselineList.length})
          </div>
          {baselineList.map((bm, idx) => {
            const pos = resolveMarkerCoords(bm, idx);
            const noteText = bm.note ?? bm.description;
            return (
              <div key={`bl-${idx}`} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className="px-1.5 py-0.5 rounded border border-dashed border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono text-[10px] font-semibold">
                  P{idx + 1}
                </span>
                <span>{pos.zoneLabel}</span>
                <span className="text-[var(--text-faint)]">·</span>
                <span>{bm.type ? `${bm.type} (${bm.severity ?? 'MINOR'})` : bm.severity ?? 'MINOR'}</span>
                {noteText && <span className="text-[var(--text-faint)] italic">— {noteText}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Markers list */}
      {markers.length > 0 && (
        <div className="rounded-xl bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] p-3 space-y-1">
          {markers.map((m, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ background: TYPE_COLORS[m.type] ?? '#dc2626' }}
                >
                  {i + 1}
                </span>
                <span className="text-[var(--text-muted)]">{m.zone.replace(/_/g, ' ')}</span>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[var(--text-muted)]">{m.type} ({m.severity})</span>
                {m.note && <span className="text-[var(--text-faint)] italic">— {m.note}</span>}
              </div>
              {!readonly && (
                <button
                  type="button"
                  onClick={() => removeMarker(i)}
                  className="text-rose-400 hover:text-rose-300"
                  title="Remove"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
