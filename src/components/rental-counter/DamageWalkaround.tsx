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

export interface DamageWalkaroundProps {
  markers: DamageMarker[];
  onChange: (markers: DamageMarker[]) => void;
  readonly?: boolean;
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

export function DamageWalkaround({ markers, onChange, readonly }: DamageWalkaroundProps) {
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

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400 uppercase tracking-wider">
        Damage walkaround {markers.length > 0 && <span className="text-amber-300">· {markers.length} marker{markers.length === 1 ? '' : 's'}</span>}
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

          {/* Existing markers */}
          {markers.map((m, i) => (
            <g key={i} onClick={(e) => { e.stopPropagation(); removeMarker(i); }} style={{ cursor: 'pointer' }}>
              <circle cx={m.x} cy={m.y} r={3} fill={TYPE_COLORS[m.type]} stroke="white" strokeWidth="0.6" />
              <text x={m.x} y={m.y + 1} textAnchor="middle" fontSize="3" fill="white" fontWeight="bold">
                {(i + 1).toString()}
              </text>
            </g>
          ))}

          {/* Pending position */}
          {pendingPosition && (
            <circle cx={pendingPosition.x} cy={pendingPosition.y} r={3.5} fill="none" stroke="#0d9488" strokeWidth="0.8" strokeDasharray="1.2 0.6">
              <animate attributeName="r" from="3.5" to="5" dur="1s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
        <div className="text-center text-xs text-slate-500 mt-2">
          {readonly ? 'Read-only view' : pendingPosition ? `Tap "Save marker" below — selected ${pendingPosition.zone}` : 'Tap a panel to mark damage. Tap a marker to remove.'}
        </div>
      </div>

      {/* Pending marker form */}
      {pendingPosition && !readonly && (
        <div className="rounded-xl bg-slate-800/60 border border-amber-500/30 p-4 space-y-3">
          <div className="text-sm font-medium text-amber-200">
            New marker · <span className="font-mono">{pendingPosition.zone.replace(/_/g, ' ')}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Type</label>
              <select
                value={tempMarker.type}
                onChange={(e) => setTempMarker({ ...tempMarker, type: e.target.value as DamageMarker['type'] })}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
              >
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Severity</label>
              <select
                value={tempMarker.severity}
                onChange={(e) => setTempMarker({ ...tempMarker, severity: e.target.value as DamageMarker['severity'] })}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
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
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setPendingPosition(null)}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={commitPending}
              className="flex-1 px-3 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500 text-sm font-medium"
            >
              Save marker
            </button>
          </div>
        </div>
      )}

      {/* Markers list */}
      {markers.length > 0 && (
        <div className="rounded-xl bg-slate-800/40 border border-slate-700 p-3 space-y-1">
          {markers.map((m, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ background: TYPE_COLORS[m.type] }}
                >
                  {i + 1}
                </span>
                <span className="text-slate-300">{m.zone.replace(/_/g, ' ')}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{m.type} ({m.severity})</span>
                {m.note && <span className="text-slate-500 italic">— {m.note}</span>}
              </div>
              {!readonly && (
                <button
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
