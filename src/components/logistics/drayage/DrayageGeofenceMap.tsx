'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MapPin, Anchor, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle,
  Compass, Layers, Maximize2, X, Sliders, Check, Eye, Navigation, RefreshCw,
} from 'lucide-react';

export interface Terminal {
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
  operatingHours?: string;
  status?: string;
}

export interface Geofence {
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

// Mapbox GL JS typings
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
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM) || radiusM <= 0) {
    return [];
  }
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

function hasWebGLSupport(): boolean {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

function loadMapboxScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('Window not available'));
      return;
    }
    if ((window as any).mapboxgl) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('Mapbox script load timed out'));
    }, 6000);

    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js';
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error('Failed to load Mapbox GL JS from CDN'));
      };
      document.head.appendChild(script);
    } catch (e) {
      clearTimeout(timeout);
      reject(e);
    }
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
  const [mapError, setMapError] = useState(false);
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

  // Helper to update the draft/preview circle source
  const updateDraftCircle = useCallback((circleData: { lat: number; lng: number; radius: number } | null) => {
    try {
      const map = mapRef.current;
      if (!map) return;
      const source = map.getSource('draft-geofence-source') as any;
      if (source) {
        if (!circleData) {
          source.setData({ type: 'FeatureCollection', features: [] });
        } else {
          const ring = circleRing(circleData.lat, circleData.lng, circleData.radius);
          if (ring.length > 0) {
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
      }
    } catch (err) {
      console.warn('Failed to update draft circle on map:', err);
    }
  }, []);

  // Cancel edit mode
  const cancelMapEdit = useCallback(() => {
    setIsEditingOnMap(false);
    setEditorId(null);
    if (editMarkerRef.current) {
      try {
        editMarkerRef.current.remove();
      } catch {}
      editMarkerRef.current = null;
    }
    updateDraftCircle(null);
    onCloseEditMode?.();
  }, [onCloseEditMode, updateDraftCircle]);

  // Start editing a geofence on the map (declared early to prevent TDZ)
  const startEditingGeofence = useCallback((gf: Geofence) => {
    setIsEditingOnMap(true);
    setEditorId(gf.id);
    setEditorName(gf.name);
    setEditorTerminalId(gf.terminalId || '');
    setEditorRadius(gf.radiusMeters || 1500);
    setEditorLat(gf.centerLat || 25.0112);
    setEditorLng(gf.centerLng || 55.0612);

    if (mapRef.current) {
      try {
        mapRef.current.flyTo({
          center: [gf.centerLng, gf.centerLat],
          zoom: 13.5,
          essential: true,
        });
      } catch {}
    }
  }, []);

  // Start creating a new geofence on the map (declared early to prevent TDZ)
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
      try {
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: 13,
          essential: true,
        });
      } catch {}
    }
  }, [terminals, selectedTerminalId]);

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
    } catch (e) {
      console.error('Error saving geofence from map editor:', e);
    } finally {
      setIsSaving(false);
    }
  };

  // Update preview circle when editing parameters change
  useEffect(() => {
    if (isEditingOnMap) {
      updateDraftCircle({ lat: editorLat, lng: editorLng, radius: editorRadius });

      // Keep draggable marker synced
      try {
        const mbgl = (window as any)?.mapboxgl;
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
              try {
                const ll = mk.getLngLat();
                setEditorLat(ll.lat);
                setEditorLng(ll.lng);
              } catch {}
            });
            editMarkerRef.current = mk;
          } else {
            editMarkerRef.current.setLngLat([editorLng, editorLat]);
          }
        }
      } catch (err) {
        console.warn('Marker sync warning:', err);
      }
    } else {
      if (editMarkerRef.current) {
        try {
          editMarkerRef.current.remove();
        } catch {}
        editMarkerRef.current = null;
      }
      updateDraftCircle(null);
    }
  }, [isEditingOnMap, editorLat, editorLng, editorRadius, updateDraftCircle]);

  // Initialize Mapbox map with robust safety fallbacks
  useEffect(() => {
    let cancelled = false;

    if (!hasWebGLSupport()) {
      setMapError(true);
      return;
    }

    const token =
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      'pk.eyJ1IjoiYWppdGhhbGV4IiwiYSI6ImNtcGF3ZTFwczAxZzMya3B2M2x4eXh5eXkifQ.demo';

    loadMapboxScript()
      .then(() => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const mbgl = (window as any).mapboxgl;
        if (!mbgl) {
          setMapError(true);
          return;
        }

        try {
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
            center: [55.0612, 25.0112],
            zoom: 10,
            attributionControl: false,
          });

          map.addControl(new mbgl.NavigationControl({ showCompass: true }), 'top-right');

          map.on('error', (e: any) => {
            console.warn('Mapbox internal map error:', e);
          });

          map.on('load', () => {
            if (cancelled) return;
            setMapLoaded(true);
            mapRef.current = map;

            try {
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

              map.on('click', (e: any) => {
                if (e?.lngLat) {
                  setEditorLat(e.lngLat.lat);
                  setEditorLng(e.lngLat.lng);
                }
              });
            } catch (layerErr) {
              console.warn('Error configuring map layers:', layerErr);
            }
          });
        } catch (initErr) {
          console.warn('Failed to initialize Mapbox instance:', initErr);
          setMapError(true);
        }
      })
      .catch((err) => {
        console.warn('Mapbox script load failed, activating SVG Radar fallback:', err);
        setMapError(true);
      });

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => {
        try {
          m.remove();
        } catch {}
      });
      markersRef.current = [];
      if (editMarkerRef.current) {
        try {
          editMarkerRef.current.remove();
        } catch {}
        editMarkerRef.current = null;
      }
      try {
        mapRef.current?.remove();
      } catch {}
      mapRef.current = null;
    };
  }, []);

  // Update map style when changed
  useEffect(() => {
    if (mapRef.current && mapLoaded) {
      try {
        const styleUrl =
          mapStyle === 'satellite'
            ? 'mapbox://styles/mapbox/satellite-streets-v12'
            : mapStyle === 'streets'
            ? 'mapbox://styles/mapbox/streets-v12'
            : 'mapbox://styles/mapbox/dark-v11';
        mapRef.current.setStyle(styleUrl);
      } catch {}
    }
  }, [mapStyle, mapLoaded]);

  // Update saved geofences GeoJSON polygons & markers on map
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const mbgl = (window as any)?.mapboxgl;
    if (!mbgl) return;

    try {
      markersRef.current.forEach((m) => {
        try {
          m.remove();
        } catch {}
      });
      markersRef.current = [];

      const activeGfs = geofences.filter((g) => g.id !== editorId);
      const features = activeGfs.map((gf) => {
        const ring = circleRing(gf.centerLat, gf.centerLng, gf.radiusMeters || 1500);
        const color = gf.terminalId ? '#10b981' : '#3b82f6';
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: ring.length ? [ring] : [],
          },
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
        if (!Number.isFinite(term.lat) || !Number.isFinite(term.lng)) return;
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
          try {
            map.flyTo({ center: [term.lng, term.lat], zoom: 12.5 });
          } catch {}
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
        if (!Number.isFinite(gf.centerLat) || !Number.isFinite(gf.centerLng)) return;
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
    } catch (err) {
      console.warn('Error refreshing markers and geofences:', err);
    }
  }, [terminals, geofences, selectedTerminalId, isEditingOnMap, editorId, mapLoaded, onSelectTerminal, startEditingGeofence]);

  // Fit all terminals in view
  const handleFitUAE = () => {
    try {
      if (!mapRef.current || terminals.length === 0) return;
      const mbgl = (window as any).mapboxgl;
      if (!mbgl) return;
      const bounds = new mbgl.LngLatBounds();
      terminals.forEach((t) => {
        if (Number.isFinite(t.lat) && Number.isFinite(t.lng)) {
          bounds.extend([t.lng, t.lat]);
        }
      });
      mapRef.current.fitBounds(bounds, { padding: 50 });
    } catch {}
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
          {mapError && (
            <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold">
              Interactive Radar Fallback Active
            </span>
          )}
        </div>

        {/* Right: Controls & Draw Button */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {!mapError && (
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
          )}

          {!mapError && (
            <button
              onClick={handleFitUAE}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-surface)]/95 backdrop-blur-md border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] shadow-md transition-colors"
              title="Fit UAE Ports in View"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Fit UAE
            </button>
          )}

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

      {/* Main Map or Interactive SVG Radar Fallback */}
      {!mapError ? (
        <div ref={containerRef} className="w-full h-[420px] bg-slate-950" />
      ) : (
        /* Bulletproof Interactive SVG Radar Fallback */
        <div className="w-full h-[420px] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 relative flex items-center justify-center p-6 select-none overflow-hidden">
          {/* Radar Circles Grid */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <div className="w-64 h-64 border border-blue-500/40 rounded-full animate-ping" style={{ animationDuration: '4s' }} />
            <div className="absolute w-[500px] h-[500px] border border-cyan-500/20 rounded-full" />
            <div className="absolute w-[350px] h-[350px] border border-cyan-500/30 rounded-full" />
            <div className="absolute w-[200px] h-[200px] border border-cyan-500/40 rounded-full" />
            <div className="absolute inset-x-0 top-1/2 border-t border-cyan-500/20" />
            <div className="absolute inset-y-0 left-1/2 border-l border-cyan-500/20" />
          </div>

          {/* Interactive Terminals Grid in Fallback */}
          <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-4">
            {terminals.slice(0, 6).map((term) => {
              const isSelected = term.id === selectedTerminalId;
              const gfCount = geofences.filter((g) => g.terminalId === term.id).length;
              return (
                <div
                  key={term.id}
                  onClick={() => onSelectTerminal?.(term)}
                  className={`p-4 rounded-xl border backdrop-blur-md cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-blue-600/20 border-blue-500 shadow-lg shadow-blue-500/20 ring-1 ring-blue-500'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/30">
                      ⚓ {term.code}
                    </span>
                    <span className="text-[10px] text-emerald-400 font-semibold">
                      {gfCount} Geofence{gfCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="font-semibold text-xs text-white truncate">{term.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{term.portName} · {term.emirate}</div>
                  <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400">Radius: {term.geofenceRadiusMeters}m</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTerminal?.(term);
                        startCreatingOnMap();
                      }}
                      className="text-blue-400 hover:text-blue-300 font-bold"
                    >
                      + Add Geofence
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                  {mapError ? 'Configure geofence parameters below' : 'Click on map or drag pin to move center point'}
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
