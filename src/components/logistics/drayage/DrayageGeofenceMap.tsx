'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MapPin, Anchor, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle,
  Compass, Layers, Maximize2, X, Sliders, Check, Eye, Navigation,
} from 'lucide-react';

interface Terminal {
  id: string;
  name: string;
  code: string;
  portName: string;
  emirate: string;
  lat: number;
  lng: number;
  geofenceRadiusMeters: number;
  freeDaysDry?: number;
  freeDaysReefer?: number;
}

interface Geofence {
  id: string;
  terminalId: string | null;
  terminalName: string;
  name: string;
  type: 'CIRCLE' | 'POLYGON';
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  coordinatesJson?: string;
}

interface DrayageGeofenceMapProps {
  terminals: Terminal[];
  geofences: Geofence[];
  selectedTerminalId?: string | null;
  onSelectTerminal?: (terminal: Terminal) => void;
  onSaveGeofence: (geofence: {
    id?: string;
    terminalId: string | null;
    terminalName: string;
    name: string;
    type: 'CIRCLE' | 'POLYGON';
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
  }) => Promise<void>;
  onDeleteGeofence: (id: string, name: string) => Promise<void>;
  activeEditGeofenceId?: string | null;
  onCloseEditMode?: () => void;
}

// ── Mapbox GL JS typings ──
interface MapboxMap {
  on(event: string, cb: (e: any) => void): void;
  addControl(control: object, position?: string): void;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  getSource(id: string): { setData: (data: object) => void } | undefined;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  setStyle(style: string): void;
  flyTo(opts: object): void;
  fitBounds(bounds: any, opts?: object): void;
  remove(): void;
}

interface MapboxMarker {
  setLngLat(coords: [number, number]): MapboxMarker;
  setPopup(popup: any): MapboxMarker;
  addTo(map: MapboxMap): MapboxMarker;
  on(event: string, cb: (e: any) => void): MapboxMarker;
  getLngLat(): { lng: number; lat: number };
  remove(): void;
}

const EARTH_R_M = 6_371_000;

function circleRing(lat: number, lng: number, radiusM: number, segments = 64): Array<[number, number]> {
  const rad = Math.PI / 180;
  const latRad = lat * rad;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const dLat = ((radiusM * Math.cos(theta)) / EARTH_R_M) * (180 / Math.PI);
    const dLng = ((radiusM * Math.sin(theta)) / (EARTH_R_M * Math.cos(latRad))) * (180 / Math.PI);
    ring.push([lng + dLng, lat + dLat]);
  }
  return ring;
}

function loadMapboxScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && (window as any).mapboxgl) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
}

export default function DrayageGeofenceMap({
  terminals,
  geofences,
  selectedTerminalId,
  onSelectTerminal,
  onSaveGeofence,
  onDeleteGeofence,
  activeEditGeofenceId,
  onCloseEditMode,
}: DrayageGeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<MapboxMarker[]>([]);
  const editMarkerRef = useRef<MapboxMarker | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'streets'>('dark');

  // Interactive Geofence Editor State
  const [isEditingOnMap, setIsEditingOnMap] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorTerminalId, setEditorTerminalId] = useState('');
  const [editorRadius, setEditorRadius] = useState(1500);
  const [editorLat, setEditorLat] = useState(25.0112);
  const [editorLng, setEditorLng] = useState(55.0612);
  const [isSaving, setIsSaving] = useState(false);

  // Sync with prop when table edit button is clicked
  useEffect(() => {
    if (activeEditGeofenceId === 'NEW') {
      startCreatingOnMap();
    } else if (activeEditGeofenceId) {
      const gf = geofences.find((g) => g.id === activeEditGeofenceId);
      if (gf) {
        startEditingGeofence(gf);
      }
    }
  }, [activeEditGeofenceId, geofences, startCreatingOnMap, startEditingGeofence]);

  // Start editing a geofence on the map
  const startEditingGeofence = useCallback((gf: Geofence) => {
    setIsEditingOnMap(true);
    setEditorId(gf.id);
    setEditorName(gf.name);
    setEditorTerminalId(gf.terminalId || '');
    setEditorRadius(gf.radiusMeters || 1500);
    setEditorLat(gf.centerLat || 25.0112);
    setEditorLng(gf.centerLng || 55.0612);

    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [gf.centerLng, gf.centerLat],
        zoom: 13.5,
        essential: true,
      });
    }
  }, []);

  // Start creating a new geofence on the map
  const startCreatingOnMap = useCallback(() => {
    const term = terminals.find((t) => t.id === selectedTerminalId) || terminals[0];
    const lat = term ? term.lat : 25.0112;
    const lng = term ? term.lng : 55.0612;

    setIsEditingOnMap(true);
    setEditorId(null);
    setEditorName(term ? `${term.name} OCR Gate Perimeter` : 'New Port Geofence Zone');
    setEditorTerminalId(term?.id || '');
    setEditorRadius(term?.geofenceRadiusMeters || 1500);
    setEditorLat(lat);
    setEditorLng(lng);

    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [lng, lat],
        zoom: 13,
        essential: true,
      });
    }
  }, [terminals, selectedTerminalId]);

  // Cancel edit mode
  const cancelMapEdit = useCallback(() => {
    setIsEditingOnMap(false);
    setEditorId(null);
    if (editMarkerRef.current) {
      editMarkerRef.current.remove();
      editMarkerRef.current = null;
    }
    updateDraftCircle(null);
    onCloseEditMode?.();
  }, [onCloseEditMode]);

  // Save changes from map editor
  const handleSaveFromMap = async () => {
    if (!editorName.trim()) return;
    try {
      setIsSaving(true);
      const targetTerm = terminals.find((t) => t.id === editorTerminalId);
      await onSaveGeofence({
        id: editorId || undefined,
        terminalId: editorTerminalId || null,
        terminalName: targetTerm?.name || 'Port Terminal',
        name: editorName.trim(),
        type: 'CIRCLE',
        centerLat: Number(editorLat),
        centerLng: Number(editorLng),
        radiusMeters: Number(editorRadius),
      });
      cancelMapEdit();
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to update the draft/preview circle source
  const updateDraftCircle = useCallback((circleData: { lat: number; lng: number; radius: number } | null) => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('draft-geofence-source') as any;
    if (source) {
      if (!circleData) {
        source.setData({ type: 'FeatureCollection', features: [] });
      } else {
        const ring = circleRing(circleData.lat, circleData.lng, circleData.radius);
        source.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [ring] },
              properties: {},
            },
          ],
        });
      }
    }
  }, []);

  // Update preview circle when editing parameters change
  useEffect(() => {
    if (isEditingOnMap) {
      updateDraftCircle({ lat: editorLat, lng: editorLng, radius: editorRadius });

      // Keep draggable marker synced
      const mbgl = (window as any).mapboxgl;
      if (mbgl && mapRef.current) {
        if (!editMarkerRef.current) {
          const el = document.createElement('div');
          el.className = 'flex flex-col items-center cursor-move';
          el.innerHTML = `
            <div style="background: #f59e0b; color: white; padding: 4px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.5); border: 2px solid white; display: flex; align-items: center; gap: 4px;">
              <span>📍 Drag Center</span>
            </div>
            <div style="width: 2px; height: 12px; background: #f59e0b;"></div>
          `;
          const mk = new mbgl.Marker({ element: el, draggable: true })
            .setLngLat([editorLng, editorLat])
            .addTo(mapRef.current);

          mk.on('dragend', () => {
            const ll = mk.getLngLat();
            setEditorLat(ll.lat);
            setEditorLng(ll.lng);
          });
          editMarkerRef.current = mk;
        } else {
          editMarkerRef.current.setLngLat([editorLng, editorLat]);
        }
      }
    } else {
      if (editMarkerRef.current) {
        editMarkerRef.current.remove();
        editMarkerRef.current = null;
      }
      updateDraftCircle(null);
    }
  }, [isEditingOnMap, editorLat, editorLng, editorRadius, updateDraftCircle]);

  // Initialize Mapbox map
  useEffect(() => {
    const token =
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      'pk.eyJ1IjoiYWppdGhhbGV4IiwiYSI6ImNtcGF3ZTFwczAxZzMya3B2M2x4eXh5eXkifQ.demo';

    let cancelled = false;

    loadMapboxScript().then(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const mbgl = (window as any).mapboxgl;
      if (!mbgl) return;
      mbgl.accessToken = token;

      const styleUrl =
        mapStyle === 'satellite'
          ? 'mapbox://styles/mapbox/satellite-streets-v12'
          : mapStyle === 'streets'
          ? 'mapbox://styles/mapbox/streets-v12'
          : 'mapbox://styles/mapbox/dark-v11';

      const map = new mbgl.Map({
        container: containerRef.current,
        style: styleUrl,
        center: [55.0612, 25.0112], // Jebel Ali Port default
        zoom: 10,
        attributionControl: false,
      });

      map.addControl(new mbgl.NavigationControl({ showCompass: true }), 'top-right');

      map.on('load', () => {
        if (cancelled) return;
        setMapLoaded(true);
        mapRef.current = map;

        // Add layer for active draft geofence circle
        map.addSource('draft-geofence-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'draft-geofence-fill',
          type: 'fill',
          source: 'draft-geofence-source',
          paint: {
            'fill-color': '#f59e0b',
            'fill-opacity': 0.35,
          },
        });

        map.addLayer({
          id: 'draft-geofence-line',
          type: 'line',
          source: 'draft-geofence-source',
          paint: {
            'line-color': '#f59e0b',
            'line-width': 3,
            'line-dasharray': [2, 2],
          },
        });

        // Add layer for existing saved geofence circles
        map.addSource('saved-geofences-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'saved-geofences-fill',
          type: 'fill',
          source: 'saved-geofences-source',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.22,
          },
        });

        map.addLayer({
          id: 'saved-geofences-line',
          type: 'line',
          source: 'saved-geofences-source',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
          },
        });

        // Click to place/move center when in editing/creating mode
        map.on('click', (e: any) => {
          if (e?.lngLat) {
            setEditorLat(e.lngLat.lat);
            setEditorLng(e.lngLat.lng);
          }
        });
      });
    });

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (editMarkerRef.current) {
        editMarkerRef.current.remove();
        editMarkerRef.current = null;
      }
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Update map style when changed
  useEffect(() => {
    if (mapRef.current && mapLoaded) {
      const styleUrl =
        mapStyle === 'satellite'
          ? 'mapbox://styles/mapbox/satellite-streets-v12'
          : mapStyle === 'streets'
          ? 'mapbox://styles/mapbox/streets-v12'
          : 'mapbox://styles/mapbox/dark-v11';
      mapRef.current.setStyle(styleUrl);
    }
  }, [mapStyle, mapLoaded]);

  // Update saved geofences GeoJSON polygons & markers on map
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const mbgl = (window as any).mapboxgl;
    if (!mbgl) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Build GeoJSON polygons for all saved geofences (excluding the one currently being edited)
    const activeGfs = geofences.filter((g) => !isEditingOnMap || g.id !== editorId);
    const features = activeGfs.map((gf, idx) => {
      const ring = circleRing(gf.centerLat, gf.centerLng, gf.radiusMeters);
      const isSelected = selectedTerminalId && gf.terminalId === selectedTerminalId;
      const color = isSelected ? '#3b82f6' : '#10b981';
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          id: gf.id,
          name: gf.name,
          terminalName: gf.terminalName,
          radiusMeters: gf.radiusMeters,
          color,
        },
      };
    });

    const source = map.getSource('saved-geofences-source') as any;
    if (source) {
      source.setData({ type: 'FeatureCollection', features });
    }

    // Add Terminal Markers
    terminals.forEach((term) => {
      const isSelected = term.id === selectedTerminalId;
      const el = document.createElement('div');
      el.className = 'cursor-pointer transform hover:scale-110 transition-transform';
      el.innerHTML = `
        <div style="background: ${isSelected ? '#3b82f6' : '#1e293b'}; color: white; border: 2px solid ${
        isSelected ? '#60a5fa' : '#475569'
      }; border-radius: 12px; padding: 4px 8px; font-size: 10px; font-weight: bold; display: flex; align-items: center; gap: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
          <span>⚓</span>
          <span>${term.code}</span>
        </div>
      `;

      el.addEventListener('click', () => {
        onSelectTerminal?.(term);
        map.flyTo({ center: [term.lng, term.lat], zoom: 12.5 });
      });

      const popup = new mbgl.Popup({ offset: 15, closeButton: false }).setHTML(`
        <div style="padding: 6px; font-size: 12px; color: #0f172a;">
          <strong style="display:block; font-size: 13px;">${term.name}</strong>
          <span style="color: #64748b; font-size: 11px;">${term.portName} · ${term.emirate}</span>
          <div style="margin-top: 4px; font-size: 11px; font-weight: 600; color: #2563eb;">
            Geofence Radius: ${term.geofenceRadiusMeters}m
          </div>
        </div>
      `);

      const marker = new mbgl.Marker({ element: el })
        .setLngLat([term.lng, term.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Add Geofence Center Markers
    activeGfs.forEach((gf) => {
      const el = document.createElement('div');
      el.className = 'cursor-pointer transform hover:scale-110 transition-transform';
      el.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.9); color: white; border: 1.5px solid white; border-radius: 9999px; padding: 2px 6px; font-size: 9px; font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 3px;">
          <span>🎯</span>
          <span>${gf.name.slice(0, 18)}...</span>
        </div>
      `;

      const popup = new mbgl.Popup({ offset: 15 }).setHTML(`
        <div style="padding: 8px; font-size: 12px; color: #0f172a; min-width: 180px;">
          <strong style="display:block; font-size: 13px; color: #0f172a;">${gf.name}</strong>
          <span style="color: #64748b; font-size: 11px; display: block; margin-top: 2px;">Link: ${gf.terminalName}</span>
          <div style="margin-top: 4px; font-size: 11px; font-weight: bold; color: #059669;">
            Radius: ${gf.radiusMeters}m
          </div>
          <div style="margin-top: 8px; display: flex; gap: 6px;">
            <button id="edit-gf-${gf.id}" style="background: #2563eb; color: white; border: none; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
              Edit on Map
            </button>
          </div>
        </div>
      `);

      popup.on('open', () => {
        setTimeout(() => {
          const btn = document.getElementById(`edit-gf-${gf.id}`);
          if (btn) {
            btn.onclick = () => {
              startEditingGeofence(gf);
              popup.remove();
            };
          }
        }, 50);
      });

      const marker = new mbgl.Marker({ element: el })
        .setLngLat([gf.centerLng, gf.centerLat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [terminals, geofences, selectedTerminalId, isEditingOnMap, editorId, mapLoaded, onSelectTerminal, startEditingGeofence]);

  // Fit all terminals in view
  const handleFitUAE = () => {
    if (!mapRef.current || terminals.length === 0) return;
    const mbgl = (window as any).mapboxgl;
    if (!mbgl) return;
    const bounds = new mbgl.LngLatBounds();
    terminals.forEach((t) => bounds.extend([t.lng, t.lat]));
    mapRef.current.fitBounds(bounds, { padding: 50 });
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg">
      {/* Top Map Action Bar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: Map Title & Status */}
        <div className="flex items-center gap-2 bg-[var(--bg-surface)]/95 backdrop-blur-md px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] shadow-md pointer-events-auto">
          <Compass className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-bold text-[var(--text-main)]">Live Port & Geofence Radar</span>
          <span className="text-[10px] text-[var(--text-muted)] border-l border-[var(--border-subtle)] pl-2">
            {geofences.length} Active Geofences · {terminals.length} Ports
          </span>
        </div>

        {/* Right: Controls & Draw Button */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Style Selector */}
          <div className="flex bg-[var(--bg-surface)]/95 backdrop-blur-md rounded-xl p-1 border border-[var(--border-subtle)] shadow-md text-xs">
            <button
              onClick={() => setMapStyle('dark')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                mapStyle === 'dark' ? 'bg-blue-600 text-white font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Dark
            </button>
            <button
              onClick={() => setMapStyle('streets')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                mapStyle === 'streets' ? 'bg-blue-600 text-white font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Streets
            </button>
            <button
              onClick={() => setMapStyle('satellite')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                mapStyle === 'satellite' ? 'bg-blue-600 text-white font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Satellite
            </button>
          </div>

          <button
            onClick={handleFitUAE}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-surface)]/95 backdrop-blur-md border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] shadow-md transition-colors"
            title="Fit UAE Ports in View"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Fit UAE
          </button>

          {!isEditingOnMap ? (
            <button
              onClick={startCreatingOnMap}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg transition-all transform active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Draw on Map
            </button>
          ) : (
            <button
              onClick={cancelMapEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-bold shadow-lg transition-all"
            >
              <X className="w-4 h-4" />
              Exit Map Mode
            </button>
          )}
        </div>
      </div>

      {/* Map Container */}
      <div ref={containerRef} className="w-full h-[420px] bg-slate-950" />

      {/* Floating Interactive Editor Overlay (When Creating or Editing on Map) */}
      {isEditingOnMap && (
        <div className="absolute bottom-3 left-3 right-3 z-20 bg-[var(--bg-surface)]/95 backdrop-blur-md border border-amber-500/50 rounded-2xl p-4 shadow-2xl transition-all">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Header info */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                  {editorId ? 'Editing Geofence on Map' : 'Creating Geofence on Map'}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  Click on map or drag pin to move center point
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editorName}
                  onChange={(e) => setEditorName(e.target.value)}
                  placeholder="Geofence Zone Name (e.g. Khalifa Port South Gate)"
                  className="w-72 bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-main)] font-semibold outline-none focus:border-amber-500"
                />
                <select
                  value={editorTerminalId}
                  onChange={(e) => setEditorTerminalId(e.target.value)}
                  className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-main)] outline-none focus:border-amber-500"
                >
                  <option value="">— Link Port Terminal —</option>
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Interactive Radius Slider & Coordinates */}
            <div className="flex items-center gap-6">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-[var(--text-muted)] font-medium">Radius (Meters)</span>
                  <span className="font-mono font-bold text-amber-400">{editorRadius.toLocaleString()}m</span>
                </div>
                <input
                  type="range"
                  min="300"
                  max="8000"
                  step="100"
                  value={editorRadius}
                  onChange={(e) => setEditorRadius(Number(e.target.value))}
                  className="w-44 accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="hidden sm:block text-[11px] text-[var(--text-muted)] font-mono bg-[var(--bg-main)] px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)]">
                <div>Lat: {editorLat.toFixed(5)}</div>
                <div>Lng: {editorLng.toFixed(5)}</div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={cancelMapEdit}
                  className="px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSaving || !editorName.trim()}
                  onClick={handleSaveFromMap}
                  className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-md transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  {isSaving ? 'Saving...' : editorId ? 'Save Changes' : 'Create Geofence'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
