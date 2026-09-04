'use client';
/**
 * /bus-ops/gis — Multilayer GIS view.
 *
 * Renders a Dubai-centric map with toggleable layers:
 *   - Bus routes       (polyline)
 *   - Stops            (points)
 *   - Service area     (filled polygons, density heatmap)
 *   - Demographics     (population density points)
 *   - Major roads      (context polyline)
 *   - Landmarks        (POI points)
 *
 * The view uses a pure-SVG map renderer (no third-party map provider
 * needed — the projection is a simple lat/lng → SVG conversion good
 * enough for a planning-grade map at city scale). For production, swap
 * for Mapbox/Leaflet with the same data layer shape.
 */
import React, { useMemo, useState } from 'react';
import { Map, Layers, Eye, EyeOff, X, MapPin, Clock, Building2 } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import {
  GIS_LAYERS, GIS_DATA,
  type GisLayerId, type RouteFeature, type StopFeature,
  type PolygonFeature, type LineFeature, type PointFeature,
} from '@/lib/gis/serviceAreas';

interface ViewBox { minLat: number; maxLat: number; minLng: number; maxLng: number; }

// Fallback viewport for tenants who load the page before any GIS data has been
// ingested. Uses Dubai (where Fleet360 was launched) so the demo dataset still
// looks sensible — but the real per-render viewport is computed from GIS_DATA
// in `useMemo` inside the component. See audit risk #20.
const FALLBACK_VIEW: ViewBox = { minLat: 24.93, maxLat: 25.32, minLng: 54.95, maxLng: 55.40 };
const W = 980;
const H = 600;

function project(lat: number, lng: number, view: ViewBox = FALLBACK_VIEW): [number, number] {
  const x = ((lng - view.minLng) / (view.maxLng - view.minLng)) * W;
  const y = H - ((lat - view.minLat) / (view.maxLat - view.minLat)) * H;
  return [x, y];
}

function polylinePath(coords: Array<[number, number]>, view?: ViewBox): string {
  return coords.map(([lat, lng], i) => {
    const [x, y] = project(lat, lng, view);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function polygonPath(ring: Array<[number, number]>, view?: ViewBox): string {
  return ring.map(([lat, lng], i) => {
    const [x, y] = project(lat, lng, view);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

function densityColor(density: number): string {
  // 0..100 → purple → pink → orange
  if (density < 25) return '#6366f133';
  if (density < 50) return '#a855f733';
  if (density < 75) return '#ec489933';
  return '#f43f5e33';
}
function densityStroke(density: number): string {
  if (density < 25) return '#6366f1';
  if (density < 50) return '#a855f7';
  if (density < 75) return '#ec4899';
  return '#f43f5e';
}

export default function GisPage() {
  const [enabled, setEnabled] = useState<Set<GisLayerId>>(
    new Set(GIS_LAYERS.filter((l) => l.defaultVisible).map((l) => l.id))
  );
  const [selectedRoute, setSelectedRoute] = useState<RouteFeature | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);

  // Auto-fit viewport to the actual GIS data (audit risk #20). Collects every
  // coordinate across the visible layers, finds the bounding box, and pads it
  // by 5% on each edge so features aren't flush against the SVG border.
  const view: ViewBox = useMemo(() => {
    const pts: Array<[number, number]> = [];
    (GIS_DATA.routes    as RouteFeature[]).forEach(r => r.coordinates.forEach(c => pts.push(c)));
    (GIS_DATA.stops     as StopFeature[]).forEach(s => pts.push([s.lat, s.lng]));
    (GIS_DATA.traffic   as LineFeature[]).forEach(l => l.coordinates.forEach(c => pts.push(c)));
    (GIS_DATA.serviceArea as PolygonFeature[]).forEach(p => p.ring.forEach(c => pts.push(c)));
    (GIS_DATA.landmarks as PointFeature[]).forEach(p => pts.push([p.lat, p.lng]));
    (GIS_DATA.demographics as PointFeature[]).forEach(p => pts.push([p.lat, p.lng]));
    if (pts.length === 0) return FALLBACK_VIEW;
    let minLat = pts[0][0], maxLat = pts[0][0], minLng = pts[0][1], maxLng = pts[0][1];
    for (const [lat, lng] of pts) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    }
    // 5% padding on each edge
    const padLat = Math.max((maxLat - minLat) * 0.05, 0.001);
    const padLng = Math.max((maxLng - minLng) * 0.05, 0.001);
    return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
  }, []);

  const toggle = (id: GisLayerId) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const routeStops = useMemo(() => {
    if (!selectedRoute) return [];
    return (GIS_DATA.stops as StopFeature[]).filter((s) => s.routeId === selectedRoute.id);
  }, [selectedRoute]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Multilayer GIS"
        subtitle="Spatial planning view: routes, stops, service area, demographics, traffic, and landmarks. Toggle layers in the panel; click any route for a stop list."
        icon={Map}
        accent="cyan"
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Layer panel */}
        <div className="rounded-2xl bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] p-4 lg:col-span-1">
          <h3 className="text-sm font-bold text-[var(--text-main)] mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" /> Layers
          </h3>
          <div className="space-y-2">
            {GIS_LAYERS.map((l) => {
              const isOn = enabled.has(l.id);
              return (
                <button key={l.id} onClick={() => toggle(l.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                    isOn ? 'bg-[var(--bg-surface)]/60 border-cyan-500/40' : 'bg-[var(--bg-surface)]/30 border-[var(--border-subtle)] hover:border-[var(--border-subtle)]'
                  }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
                      <span className={`text-xs font-semibold truncate ${isOn ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>{l.label}</span>
                    </div>
                    {isOn ? <Eye className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" /> : <EyeOff className="w-3.5 h-3.5 text-[var(--text-faint)] flex-shrink-0" />}
                  </div>
                  <p className="text-[10px] text-[var(--text-faint)]">{l.description}</p>
                </button>
              );
            })}
          </div>
          {legendOpen && (
            <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)] font-semibold mb-2">Density legend</p>
              <div className="space-y-1">
                {[
                  { l: 'Low (0-25)',  c: '#6366f1' },
                  { l: 'Medium (25-50)', c: '#a855f7' },
                  { l: 'High (50-75)',   c: '#ec4899' },
                  { l: 'Very high (75-100)', c: '#f43f5e' },
                ].map((x) => (
                  <div key={x.l} className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    <span className="w-3 h-3 rounded" style={{ backgroundColor: x.c }} />
                    {x.l}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Map + details */}
        <div className="rounded-2xl bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] p-4 lg:col-span-3 relative">
          <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)]">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-[var(--bg-canvas)]" style={{ maxHeight: 600 }}>
              {/* Subtle grid */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width={W} height={H} fill="url(#grid)" />

              {/* Coast / Persian Gulf water gradient on the right edge */}
              <defs>
                <linearGradient id="water" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#0c4a6e" stopOpacity="0" />
                  <stop offset="1" stopColor="#0c4a6e" stopOpacity="0.4" />
                </linearGradient>
              </defs>
              <rect x={W * 0.85} y={0} width={W * 0.15} height={H} fill="url(#water)" />

              {/* Major roads */}
              {enabled.has('traffic') && (
                <g>
                  {(GIS_DATA.traffic as LineFeature[]).map((line) => (
                    <path key={line.id} d={polylinePath(line.coordinates, view)}
                      fill="none" stroke="#64748b" strokeWidth="2.5" strokeOpacity="0.55" />
                  ))}
                </g>
              )}

              {/* Service area polygons */}
              {enabled.has('serviceArea') && (
                <g>
                  {(GIS_DATA.serviceArea as PolygonFeature[]).map((p) => (
                    <path key={p.id} d={polygonPath(p.ring, view)}
                      fill={densityColor(p.density)} stroke={densityStroke(p.density)}
                      strokeWidth="1.5" strokeOpacity="0.7" />
                  ))}
                </g>
              )}

              {/* Demographics heatmap */}
              {enabled.has('demographics') && (
                <g>
                  {(GIS_DATA.demographics as PointFeature[]).map((d, i) => {
                    const [x, y] = project(d.lat, d.lng, view);
                    return <circle key={d.id} cx={x} cy={y} r="3" fill="#ec4899" fillOpacity="0.4" />;
                  })}
                </g>
              )}

              {/* Routes */}
              {enabled.has('routes') && (
                <g>
                  {(GIS_DATA.routes as RouteFeature[]).map((r) => {
                    const isSelected = selectedRoute?.id === r.id;
                    return (
                      <path key={r.id} d={polylinePath(r.coordinates, view)}
                        fill="none"
                        stroke={isSelected ? '#f59e0b' : '#8b5cf6'}
                        strokeWidth={isSelected ? 4 : 2.5}
                        strokeOpacity={selectedRoute && !isSelected ? 0.35 : 1}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedRoute(r)} />
                    );
                  })}
                </g>
              )}

              {/* Stops */}
              {enabled.has('stops') && (
                <g>
                  {(GIS_DATA.stops as StopFeature[]).map((s) => {
                    const [x, y] = project(s.lat, s.lng, view);
                    const isOnRoute = selectedRoute?.id === s.routeId;
                    return (
                      <g key={s.id}>
                        <circle cx={x} cy={y} r={isOnRoute ? 5.5 : 4}
                          fill={isOnRoute ? '#fbbf24' : '#22d3ee'}
                          stroke="#0f172a" strokeWidth="1.5" />
                        {isOnRoute && (
                          <text x={x + 8} y={y + 4} fontSize="10" fill="#fff" fontWeight="500">{s.name}</text>
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {/* Landmarks */}
              {enabled.has('landmarks') && (
                <g>
                  {(GIS_DATA.landmarks as PointFeature[]).map((p) => {
                    const [x, y] = project(p.lat, p.lng, view);
                    const icon = p.category === 'HOSPITAL' ? '🏥' : p.category === 'SCHOOL' ? '🏫' : p.category === 'MALL' ? '🛍' : p.category === 'TRANSIT' ? '🚇' : '🏢';
                    return (
                      <g key={p.id}>
                        <circle cx={x} cy={y} r="6" fill="#10b981" fillOpacity="0.6" stroke="#10b981" strokeWidth="1" />
                        <text x={x} y={y + 2} fontSize="8" textAnchor="middle">{icon}</text>
                      </g>
                    );
                  })}
                </g>
              )}

              {/* Scale + compass */}
              <g transform={`translate(${W - 130} ${H - 30})`}>
                <line x1="0" y1="0" x2="80" y2="0" stroke="#94a3b8" strokeWidth="1" />
                <line x1="0" y1="-3" x2="0" y2="3" stroke="#94a3b8" strokeWidth="1" />
                <line x1="80" y1="-3" x2="80" y2="3" stroke="#94a3b8" strokeWidth="1" />
                <text x="40" y="-6" fontSize="9" fill="#94a3b8" textAnchor="middle">~5 km</text>
              </g>
              <g transform={`translate(20 30)`}>
                <circle cx="0" cy="0" r="14" fill="rgba(15,23,42,0.6)" stroke="rgba(148,163,184,0.4)" />
                <text x="0" y="-16" fontSize="9" fill="#94a3b8" textAnchor="middle">N</text>
                <path d="M 0 -10 L -4 4 L 0 0 L 4 4 Z" fill="#94a3b8" />
              </g>
            </svg>
          </div>

          {selectedRoute && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                    <MapPin className="w-4 h-4" /> {selectedRoute.name}
                  </h4>
                  <p className="text-[11px] text-[var(--text-muted)]">{selectedRoute.origin} → {selectedRoute.destination} · {routeStops.length} stops on this route</p>
                </div>
                <button onClick={() => setSelectedRoute(null)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X className="w-4 h-4" /></button>
              </div>
              {routeStops.length > 0 ? (
                <ol className="text-[11px] text-[var(--text-muted)] grid grid-cols-1 md:grid-cols-2 gap-1">
                  {routeStops.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="text-amber-300 font-mono w-4 text-right">{i + 1}.</span>
                      <span className="text-[var(--text-main)]">{s.name}</span>
                      <span className="text-[var(--text-faint)] text-[10px] ml-auto">{s.lat.toFixed(3)}, {s.lng.toFixed(3)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[11px] text-[var(--text-faint)] italic">No demo stops on this route.</p>
              )}
            </div>
          )}

          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <Mini label="Routes" value={(GIS_DATA.routes as RouteFeature[]).length} />
            <Mini label="Stops" value={(GIS_DATA.stops as StopFeature[]).length} />
            <Mini label="Landmarks" value={(GIS_DATA.landmarks as PointFeature[]).length} />
            <Mini label="Layers on" value={`${enabled.size} / ${GIS_LAYERS.length}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] px-3 py-2">
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-[var(--text-main)] mt-0.5">{value}</p>
    </div>
  );
}
