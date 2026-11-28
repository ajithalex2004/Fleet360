'use client';

/**
 * FsmLiveFieldMap — Interactive live map of FSM technicians, service territories,
 * and scheduled visit sites.
 *
 * - Uses Mapbox GL JS (CDN) automatically when NEXT_PUBLIC_MAPBOX_TOKEN is present.
 * - Automatically renders a crisp interactive SVG geographic coordinate map with
 *   territory rings, live technician pins, visit site pins, and EN_ROUTE connectors
 *   whenever no Mapbox token is configured — ensuring zero blank map panels in any env.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Navigation, Radio, Users, Clock, Battery, Compass } from 'lucide-react';
import type { FsmTechnician, FsmTerritory } from '@/lib/service-tickets/workforce';
import type { FsmWorkVisit, UnscheduledTicketCard } from '@/lib/service-tickets/dispatch';

interface FsmLiveFieldMapProps {
  technicians: FsmTechnician[];
  visits: FsmWorkVisit[];
  territories: FsmTerritory[];
  unscheduledTickets?: UnscheduledTicketCard[];
  selectedVisitId?: string | null;
  onSelectVisit?: (visit: FsmWorkVisit) => void;
  onSelectTech?: (tech: FsmTechnician) => void;
  className?: string;
}

const TECH_COLORS: Record<string, string> = {
  AVAILABLE: '#10b981',
  EN_ROUTE: '#06b6d4',
  ON_JOB: '#3b82f6',
  ON_BREAK: '#f59e0b',
  OFF_SHIFT: '#64748b',
  ON_LEAVE: '#f43f5e',
};

const VISIT_COLORS: Record<string, string> = {
  SCHEDULED: '#8b5cf6',
  DISPATCHED: '#6366f1',
  EN_ROUTE: '#06b6d4',
  ON_SITE: '#0ea5e9',
  IN_PROGRESS: '#f59e0b',
  PAUSED: '#f97316',
  COMPLETED: '#10b981',
  INCOMPLETE: '#f43f5e',
  CANCELLED: '#94a3b8',
};

interface MapboxMapLike {
  on(event: string, cb: () => void): void;
  addControl(control: object, position?: string): void;
  fitBounds(bounds: MapboxBoundsLike, opts: object): void;
  remove(): void;
}
interface MapboxMarkerLike {
  setLngLat(coords: [number, number]): MapboxMarkerLike;
  setPopup(popup: MapboxPopupLike): MapboxMarkerLike;
  addTo(map: MapboxMapLike): MapboxMarkerLike;
  remove(): void;
}
interface MapboxBoundsLike {
  extend(coords: [number, number]): MapboxBoundsLike;
}
interface MapboxPopupLike {
  setHTML(html: string): MapboxPopupLike;
}
interface MapboxGLLike {
  accessToken: string;
  Map: new (opts: object) => MapboxMapLike;
  Marker: new (opts?: object) => MapboxMarkerLike;
  NavigationControl: new (opts?: object) => object;
  LngLatBounds: new () => MapboxBoundsLike;
  Popup: new (opts?: object) => MapboxPopupLike;
}

function getMapbox(): MapboxGLLike | null {
  return (window as unknown as { mapboxgl?: MapboxGLLike }).mapboxgl ?? null;
}

function loadMapboxCdn(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (getMapbox()) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[data-mapbox-gl="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
    script.dataset.mapboxGl = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export function FsmLiveFieldMap({
  technicians,
  visits,
  territories,
  unscheduledTickets = [],
  selectedVisitId,
  onSelectVisit,
  onSelectTech,
  className = 'h-[460px]',
}: FsmLiveFieldMapProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  const mapboxContainerRef = useRef<HTMLDivElement>(null);
  const mapboxMapRef = useRef<MapboxMapLike | null>(null);
  const markersRef = useRef<MapboxMarkerLike[]>([]);
  const [mapboxReady, setMapboxReady] = useState(false);
  const [mapboxFailed, setMapboxFailed] = useState(false);
  const [focused, setFocused] = useState<
    | { kind: 'tech'; tech: FsmTechnician }
    | { kind: 'visit'; visit: FsmWorkVisit }
    | { kind: 'territory'; territory: FsmTerritory }
    | null
  >(null);

  const techPins = useMemo(
    () =>
      technicians
        .map((t) => {
          const lat = t.location?.latitude ?? t.homeBaseLat;
          const lng = t.location?.longitude ?? t.homeBaseLng;
          if (typeof lat !== 'number' || typeof lng !== 'number') return null;
          return { tech: t, lat, lng, isLiveGps: Boolean(t.location) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [technicians],
  );

  const visitPins = useMemo(
    () =>
      visits
        .map((v) => {
          const lat = v.siteLat ?? v.checkinLat;
          const lng = v.siteLng ?? v.checkinLng;
          if (typeof lat !== 'number' || typeof lng !== 'number') return null;
          return { visit: v, lat, lng };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [visits],
  );

  const territoryPins = useMemo(
    () =>
      territories
        .filter((tr) => typeof tr.centerLat === 'number' && typeof tr.centerLng === 'number')
        .map((tr) => ({ territory: tr, lat: tr.centerLat!, lng: tr.centerLng!, radiusKm: tr.radiusKm ?? 10 })),
    [territories],
  );

  // Initialize Mapbox if token exists
  useEffect(() => {
    if (!token || !mapboxContainerRef.current) return;
    let disposed = false;
    loadMapboxCdn()
      .then(() => {
        if (disposed || !mapboxContainerRef.current || mapboxMapRef.current) return;
        const mb = getMapbox();
        if (!mb) {
          setMapboxFailed(true);
          return;
        }
        mb.accessToken = token;
        const map = new mb.Map({
          container: mapboxContainerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [55.2708, 25.2048], // Dubai default
          zoom: 10,
        });
        map.addControl(new mb.NavigationControl({}), 'top-right');
        map.on('load', () => {
          if (!disposed) setMapboxReady(true);
        });
        mapboxMapRef.current = map;
      })
      .catch(() => {
        if (!disposed) setMapboxFailed(true);
      });

    return () => {
      disposed = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapboxMapRef.current?.remove();
      mapboxMapRef.current = null;
    };
  }, [token]);

  // Sync Mapbox markers whenever data updates
  useEffect(() => {
    const mb = getMapbox();
    const map = mapboxMapRef.current;
    if (!mapboxReady || !mb || !map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const bounds = new mb.LngLatBounds();
    let count = 0;

    for (const p of techPins) {
      const el = document.createElement('div');
      el.style.cssText = `width:28px;height:28px;border-radius:9999px;background:${TECH_COLORS[p.tech.availabilityStatus] ?? '#6366f1'};border:2px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;cursor:pointer;`;
      el.textContent = p.tech.fullName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
      el.addEventListener('click', () => {
        setFocused({ kind: 'tech', tech: p.tech });
        onSelectTech?.(p.tech);
      });
      const popup = new mb.Popup().setHTML(
        `<div style="font-size:12px;color:#0f172a"><strong>${escapeHtml(p.tech.fullName)}</strong><br/>${escapeHtml(p.tech.availabilityStatus)} · ${p.isLiveGps ? 'Live GPS' : 'Home Base'}</div>`,
      );
      const marker = new mb.Marker({ element: el }).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
      markersRef.current.push(marker);
      bounds.extend([p.lng, p.lat]);
      count++;
    }

    for (const vp of visitPins) {
      const el = document.createElement('div');
      el.style.cssText = `width:22px;height:22px;border-radius:6px;background:${VISIT_COLORS[vp.visit.status] ?? '#8b5cf6'};border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;cursor:pointer;`;
      el.textContent = `V${vp.visit.visitNumber}`;
      el.addEventListener('click', () => {
        setFocused({ kind: 'visit', visit: vp.visit });
        onSelectVisit?.(vp.visit);
      });
      const popup = new mb.Popup().setHTML(
        `<div style="font-size:12px;color:#0f172a"><strong>${escapeHtml(vp.visit.ticketReadableId ?? 'Visit')}</strong><br/>${escapeHtml(vp.visit.ticketTitle)}<br/><em>${escapeHtml(vp.visit.status)}</em></div>`,
      );
      const marker = new mb.Marker({ element: el }).setLngLat([vp.lng, vp.lat]).setPopup(popup).addTo(map);
      markersRef.current.push(marker);
      bounds.extend([vp.lng, vp.lat]);
      count++;
    }

    if (count > 0) {
      map.fitBounds(bounds, { padding: 55, maxZoom: 13 });
    }
  }, [mapboxReady, techPins, visitPins, onSelectTech, onSelectVisit]);

  // Compute SVG projection bounds for fallback interactive map
  const projection = useMemo(() => {
    const lats: number[] = [];
    const lngs: number[] = [];
    techPins.forEach((p) => {
      lats.push(p.lat);
      lngs.push(p.lng);
    });
    visitPins.forEach((p) => {
      lats.push(p.lat);
      lngs.push(p.lng);
    });
    territoryPins.forEach((p) => {
      lats.push(p.lat);
      lngs.push(p.lng);
    });
    // Default bounding box around UAE / Dubai if no coordinates are populated yet
    const minLat = lats.length ? Math.min(...lats) - 0.06 : 25.05;
    const maxLat = lats.length ? Math.max(...lats) + 0.06 : 25.32;
    const minLng = lngs.length ? Math.min(...lngs) - 0.08 : 55.1;
    const maxLng = lngs.length ? Math.max(...lngs) + 0.08 : 55.45;
    const latSpan = Math.max(0.08, maxLat - minLat);
    const lngSpan = Math.max(0.1, maxLng - minLng);

    const project = (lat: number, lng: number) => ({
      x: 40 + ((lng - minLng) / lngSpan) * 520,
      y: 340 - ((lat - minLat) / latSpan) * 280,
    });
    const kmToPx = (km: number) => Math.max(18, Math.min(95, (km / (latSpan * 111)) * 280));
    return { project, kmToPx, hasPoints: lats.length > 0 };
  }, [techPins, visitPins, territoryPins]);

  // Active tech-to-visit links for EN_ROUTE / ON_SITE / IN_PROGRESS
  const activeLinks = useMemo(() => {
    const techMap = new Map(techPins.map((p) => [p.tech.id, p]));
    const links: Array<{ id: string; from: { x: number; y: number }; to: { x: number; y: number }; color: string }> = [];
    for (const vp of visitPins) {
      if (!['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(vp.visit.status)) continue;
      const lead = vp.visit.crew.find((c) => c.role === 'LEAD') ?? vp.visit.crew[0];
      if (!lead) continue;
      const tp = techMap.get(lead.technicianId);
      if (!tp) continue;
      links.push({
        id: `${tp.tech.id}-${vp.visit.id}`,
        from: projection.project(tp.lat, tp.lng),
        to: projection.project(vp.lat, vp.lng),
        color: VISIT_COLORS[vp.visit.status] ?? '#06b6d4',
      });
    }
    return links;
  }, [techPins, visitPins, projection]);

  const useMapbox = Boolean(token) && !mapboxFailed;
  const unscheduledWithCoords = unscheduledTickets.filter(
    (t) => typeof t.siteLat === 'number' && typeof t.siteLng === 'number',
  );

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden flex flex-col">
      {/* Header strip */}
      <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-main)]">
          <Compass className="w-4 h-4 text-cyan-500" />
          <span>Live Field Operations Map</span>
          <span className="text-[11px] font-normal text-[var(--text-muted)]">
            ({techPins.length} techs · {visitPins.length} visit sites · {territoryPins.length} zones)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Available
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> En Route
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> On Job
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-violet-500" /> Visit Site
          </span>
        </div>
      </div>

      {/* Map canvas */}
      <div className={`relative w-full ${className} bg-slate-100 dark:bg-slate-950`}>
        {useMapbox ? (
          <div ref={mapboxContainerRef} className="w-full h-full" />
        ) : (
          <svg viewBox="0 0 600 380" className="w-full h-full select-none" role="img" aria-label="Live Field Map">
            {/* Subtle coordinate grid */}
            <defs>
              <pattern id="fsm-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="600" height="380" fill="url(#fsm-map-grid)" className="text-slate-600 dark:text-slate-300" />

            {/* Service territories */}
            {territoryPins.map((tp) => {
              const pt = projection.project(tp.lat, tp.lng);
              const r = projection.kmToPx(tp.radiusKm);
              return (
                <g
                  key={tp.territory.id}
                  className="cursor-pointer"
                  onClick={() => setFocused({ kind: 'territory', territory: tp.territory })}
                >
                  <circle cx={pt.x} cy={pt.y} r={r} fill="#8b5cf6" fillOpacity="0.09" stroke="#8b5cf6" strokeOpacity="0.4" strokeDasharray="4 4" />
                  <text x={pt.x} y={pt.y - r + 14} textAnchor="middle" className="fill-violet-700 dark:fill-violet-300 text-[9px] font-semibold">
                    {tp.territory.name}
                  </text>
                </g>
              );
            })}

            {/* Active travel/work connectors */}
            {activeLinks.map((lnk) => (
              <line
                key={lnk.id}
                x1={lnk.from.x}
                y1={lnk.from.y}
                x2={lnk.to.x}
                y2={lnk.to.y}
                stroke={lnk.color}
                strokeWidth="2"
                strokeDasharray="5 4"
                strokeOpacity="0.75"
              />
            ))}

            {/* Unscheduled tickets with site coordinates */}
            {unscheduledWithCoords.map((t) => {
              const pt = projection.project(t.siteLat!, t.siteLng!);
              return (
                <g key={`u-${t.id}`}>
                  <circle cx={pt.x} cy={pt.y} r="5" fill="#f43f5e" fillOpacity="0.85" stroke="#ffffff" strokeWidth="1.5" />
                  <title>{`Unscheduled: ${t.readableId ?? ''} ${t.title}`}</title>
                </g>
              );
            })}

            {/* Scheduled visit site pins */}
            {visitPins.map((vp) => {
              const pt = projection.project(vp.lat, vp.lng);
              const isSelected = vp.visit.id === selectedVisitId;
              const color = VISIT_COLORS[vp.visit.status] ?? '#8b5cf6';
              return (
                <g
                  key={vp.visit.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setFocused({ kind: 'visit', visit: vp.visit });
                    onSelectVisit?.(vp.visit);
                  }}
                >
                  {isSelected && <circle cx={pt.x} cy={pt.y} r="18" fill={color} fillOpacity="0.22" />}
                  <rect x={pt.x - 10} y={pt.y - 10} width="20" height="20" rx="5" fill={color} stroke="#ffffff" strokeWidth="2" />
                  <text x={pt.x} y={pt.y + 3} textAnchor="middle" fill="#ffffff" className="text-[8px] font-bold">
                    V{vp.visit.visitNumber}
                  </text>
                  <text x={pt.x} y={pt.y + 21} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200 text-[8.5px] font-semibold">
                    {vp.visit.ticketReadableId ?? vp.visit.siteName ?? 'Visit'}
                  </text>
                </g>
              );
            })}

            {/* Live technician pins */}
            {techPins.map((tp) => {
              const pt = projection.project(tp.lat, tp.lng);
              const color = TECH_COLORS[tp.tech.availabilityStatus] ?? '#6366f1';
              const initials = tp.tech.fullName
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              return (
                <g
                  key={tp.tech.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setFocused({ kind: 'tech', tech: tp.tech });
                    onSelectTech?.(tp.tech);
                  }}
                >
                  {tp.isLiveGps && <circle cx={pt.x} cy={pt.y} r="17" fill={color} fillOpacity="0.18" />}
                  <circle cx={pt.x} cy={pt.y} r="11" fill={color} stroke="#ffffff" strokeWidth="2" />
                  <text x={pt.x} y={pt.y + 3.5} textAnchor="middle" fill="#ffffff" className="text-[8.5px] font-bold">
                    {initials}
                  </text>
                  <text x={pt.x} y={pt.y - 14} textAnchor="middle" className="fill-slate-800 dark:fill-slate-100 text-[9px] font-semibold">
                    {tp.tech.fullName.split(' ')[0]}
                  </text>
                </g>
              );
            })}

            {!projection.hasPoints && (
              <text x="300" y="190" textAnchor="middle" className="fill-slate-500 dark:fill-slate-400 text-[12px]">
                Add territory coordinates, technician home bases, or send a live GPS ping to plot pins here.
              </text>
            )}
          </svg>
        )}

        {/* Floating inspector card */}
        {focused && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-80 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur p-3 shadow-xl text-xs space-y-1.5">
            {focused.kind === 'tech' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--text-main)] flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-500" /> {focused.tech.fullName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocused(null)}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    Close
                  </button>
                </div>
                <div className="text-[var(--text-muted)]">
                  {focused.tech.employeeCode} · {focused.tech.availabilityStatus.replace('_', ' ')} ·{' '}
                  {focused.tech.primaryDepartment}
                </div>
                {focused.tech.location ? (
                  <div className="flex items-center gap-3 text-[11px] text-cyan-700 dark:text-cyan-300">
                    <span className="inline-flex items-center gap-1">
                      <Navigation className="w-3 h-3" /> {focused.tech.location.latitude.toFixed(4)},{' '}
                      {focused.tech.location.longitude.toFixed(4)}
                    </span>
                    {focused.tech.location.batteryPct !== null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Battery className="w-3 h-3" /> {focused.tech.location.batteryPct}%
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-[var(--text-faint)]">
                    Home base: {focused.tech.homeBaseAddress || 'Configured coordinates'}
                  </div>
                )}
              </>
            )}

            {focused.kind === 'visit' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--text-main)] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-violet-500" /> {focused.visit.ticketReadableId ?? 'Visit'} · #
                    {focused.visit.visitNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocused(null)}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    Close
                  </button>
                </div>
                <div className="font-medium text-[var(--text-main)] truncate">{focused.visit.ticketTitle}</div>
                <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {focused.visit.scheduledStartAt.slice(11, 16)}–
                    {focused.visit.scheduledEndAt.slice(11, 16)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3 h-3" /> {focused.visit.crew.map((c) => c.fullName).join(', ') || 'Unassigned'}
                  </span>
                </div>
                {focused.visit.siteName && (
                  <div className="text-[11px] text-[var(--text-faint)]">{focused.visit.siteName}</div>
                )}
              </>
            )}

            {focused.kind === 'territory' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[var(--text-main)]">{focused.territory.name}</span>
                  <button
                    type="button"
                    onClick={() => setFocused(null)}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    Close
                  </button>
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {focused.territory.city || 'Zone'} · {focused.territory.radiusKm ?? 10} km radius ·{' '}
                  {focused.territory.technicianCount} technicians · {focused.territory.teamCount} teams
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
