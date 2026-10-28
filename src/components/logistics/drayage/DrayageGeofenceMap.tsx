'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MapPin, Anchor, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle,
  Compass, Layers, Maximize2, X, Sliders, Check, Eye, Navigation, RefreshCw,
  Hexagon, Circle as CircleIcon, Warehouse, Info,
} from 'lucide-react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
  type GMapsCircle,
  type GMapsPolygon,
  type GMapsDrawingManager,
  type GMapsInfoWindow,
  type GoogleCtors,
} from '@/lib/google-maps-loader';

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

export interface WarehouseLocation {
  id: string;
  name: string;
  zone: string;
  lat?: number;
  lng?: number;
  customerName?: string;
  address?: string;
  rampsCount?: number;
}

export interface PlotModeState {
  active: boolean;
  type: 'TERMINAL' | 'CONSIGNEE';
  title: string;
  lat: number;
  lng: number;
  onPlotSelect: (lat: number, lng: number) => void;
  onClose: () => void;
}

interface DrayageGeofenceMapProps {
  terminals: Terminal[];
  geofences: Geofence[];
  warehouses?: WarehouseLocation[];
  selectedTerminalId?: string | null;
  onSelectTerminal?: (terminal: Terminal) => void;
  onSelectWarehouse?: (warehouse: WarehouseLocation) => void;
  onSaveGeofence: (geofence: {
    id?: string;
    terminalId: string | null;
    terminalName: string;
    name: string;
    type: 'CIRCLE' | 'POLYGON';
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    coordinates?: Array<{ lat: number; lng: number }>;
  }) => Promise<void>;
  onDeleteGeofence: (id: string, name: string) => Promise<void>;
  activeEditGeofenceId?: string | null;
  onCloseEditMode?: () => void;
  focusLocation?: { lat: number; lng: number; zoom?: number; title?: string } | null;
  plotMode?: PlotModeState | null;
}

const DEFAULT_CENTER = { lat: 24.9960, lng: 55.0350 }; // Jebel Ali Port Corridor

export default function DrayageGeofenceMap({
  terminals,
  geofences,
  warehouses = [],
  selectedTerminalId,
  onSelectTerminal,
  onSelectWarehouse,
  onSaveGeofence,
  onDeleteGeofence,
  activeEditGeofenceId,
  onCloseEditMode,
  focusLocation,
  plotMode,
}: DrayageGeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  const ctorsRef = useRef<GoogleCtors | null>(null);
  const drawingManagerRef = useRef<GMapsDrawingManager | null>(null);
  const infoWindowRef = useRef<GMapsInfoWindow | null>(null);

  // Overlays & Markers
  const terminalMarkersRef = useRef<GMapsMarker[]>([]);
  const warehouseMarkersRef = useRef<GMapsMarker[]>([]);
  const geofenceOverlaysRef = useRef<Array<GMapsCircle | GMapsPolygon>>([]);
  const plotMarkerRef = useRef<GMapsMarker | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<'CIRCLE' | 'POLYGON' | null>(null);

  // Quick Save Modal after Drawing on Google Maps
  const [drawnDraft, setDrawnDraft] = useState<{
    shape: 'CIRCLE' | 'POLYGON';
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    coordinates?: Array<{ lat: number; lng: number }>;
  } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftTerminalId, setDraftTerminalId] = useState(selectedTerminalId || terminals[0]?.id || '');
  const [savingDraft, setSavingDraft] = useState(false);

  // 1. Initialize Google Maps & DrawingManager
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((ctors) => {
        if (cancelled) return;
        ctorsRef.current = ctors;
        const container = containerRef.current;
        if (!container) return;

        if (!mapRef.current) {
          const map = new ctors.Map(container, {
            center: DEFAULT_CENTER,
            zoom: 11,
            zoomControl: true,
            gestureHandling: 'greedy',
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true,
            styles: [
              {
                featureType: 'water',
                elementType: 'geometry',
                stylers: [{ color: '#0f172a' }],
              },
              {
                featureType: 'landscape',
                elementType: 'geometry',
                stylers: [{ color: '#1e293b' }],
              },
              {
                featureType: 'road',
                elementType: 'geometry',
                stylers: [{ color: '#334155' }],
              },
              {
                featureType: 'poi',
                elementType: 'labels',
                stylers: [{ visibility: 'off' }],
              },
            ],
          });
          mapRef.current = map;

          // InfoWindow
          infoWindowRef.current = new ctors.InfoWindow();

          // Drawing Manager
          const dm = new ctors.DrawingManager({
            drawingMode: null,
            drawingControl: false,
            circleOptions: {
              strokeColor: '#38bdf8',
              strokeWeight: 2.5,
              strokeOpacity: 0.9,
              fillColor: '#0284c7',
              fillOpacity: 0.25,
              clickable: false,
              editable: false,
            },
            polygonOptions: {
              strokeColor: '#c084fc',
              strokeWeight: 2.5,
              strokeOpacity: 0.9,
              fillColor: '#9333ea',
              fillOpacity: 0.25,
              clickable: false,
              editable: false,
            },
          });
          dm.setMap(map);
          drawingManagerRef.current = dm;

          // Drawing Listeners
          dm.addListener('circlecomplete', (circle: any) => {
            const center = circle.getCenter();
            const radius = Math.round(circle.getRadius());
            circle.setMap(null); // Remove raw overlay, we'll open draft save dialog
            dm.setDrawingMode(null);
            setDrawMode(null);

            setDrawnDraft({
              shape: 'CIRCLE',
              centerLat: center.lat(),
              centerLng: center.lng(),
              radiusMeters: radius,
            });
            setDraftName(`Port OCR Geofence (${radius}m)`);
          });

          dm.addListener('polygoncomplete', (polygon: any) => {
            const path = polygon.getPath().getArray().map((p: any) => ({
              lat: p.lat(),
              lng: p.lng(),
            }));
            polygon.setMap(null);
            dm.setDrawingMode(null);
            setDrawMode(null);

            if (path.length > 0) {
              const avgLat = path.reduce((sum: number, p: any) => sum + p.lat, 0) / path.length;
              const avgLng = path.reduce((sum: number, p: any) => sum + p.lng, 0) / path.length;
              setDrawnDraft({
                shape: 'POLYGON',
                centerLat: avgLat,
                centerLng: avgLng,
                radiusMeters: 1000,
                coordinates: path,
              });
              setDraftName(`Polygon Ramp Zone (${path.length} Vertices)`);
            }
          });

          // Click on map to plot coordinates when plotMode is active
          map.addListener('click', (e: any) => {
            if (e?.latLng) {
              const lat = Number(e.latLng.lat().toFixed(6));
              const lng = Number(e.latLng.lng().toFixed(6));
              if (plotMarkerRef.current) {
                plotMarkerRef.current.setPosition({ lat, lng });
              }
            }
          });
        }

        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Sync Drawing Mode Toggle
  useEffect(() => {
    const dm = drawingManagerRef.current;
    const ctors = ctorsRef.current;
    if (!dm || !ctors) return;

    if (drawMode === 'CIRCLE') {
      dm.setDrawingMode(ctors.OverlayType.CIRCLE);
    } else if (drawMode === 'POLYGON') {
      dm.setDrawingMode(ctors.OverlayType.POLYGON);
    } else {
      dm.setDrawingMode(null);
    }
  }, [drawMode]);

  // 3. Render Existing Geofences (Circles & Polygons) on Google Maps
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    // Clear old geofence overlays
    geofenceOverlaysRef.current.forEach((o) => o.setMap(null));
    geofenceOverlaysRef.current = [];

    geofences.forEach((gf) => {
      const isSelected = gf.id === activeEditGeofenceId;
      const strokeColor = gf.type === 'POLYGON' ? '#c084fc' : '#38bdf8';
      const fillColor = gf.type === 'POLYGON' ? '#a855f7' : '#0284c7';
      const strokeWeight = isSelected ? 4 : 2;
      const fillOpacity = isSelected ? 0.35 : 0.18;

      if (gf.type === 'POLYGON') {
        let polygonCoords: Array<{ lat: number; lng: number }> = [];
        try {
          if (gf.coordinatesJson) {
            polygonCoords = JSON.parse(gf.coordinatesJson);
          }
        } catch {}

        if (polygonCoords.length >= 3) {
          const poly = new ctors.Polygon({
            map,
            paths: polygonCoords,
            strokeColor,
            strokeWeight,
            strokeOpacity: 0.9,
            fillColor,
            fillOpacity,
            clickable: true,
          });

          poly.addListener('click', () => {
            if (infoWindowRef.current) {
              infoWindowRef.current.setContent(`
                <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 220px;">
                  <strong style="font-size: 13px; display: block; margin-bottom: 2px;">${gf.name}</strong>
                  <span style="font-size: 11px; color: #7c3aed; font-weight: bold;">⬡ Polygon Ramp Zone</span>
                  <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Linked: ${gf.terminalName}</div>
                  <div style="font-size: 11px; color: #475569; margin-top: 2px;">Vertices: ${polygonCoords.length} points</div>
                </div>
              `);
              if (polygonCoords[0]) {
                infoWindowRef.current.setPosition(polygonCoords[0]);
                infoWindowRef.current.open({ map });
              }
            }
          });

          geofenceOverlaysRef.current.push(poly);
          return;
        }
      }

      // Default: Circular Perimeter
      if (Number.isFinite(gf.centerLat) && Number.isFinite(gf.centerLng)) {
        const circle = new ctors.Circle({
          map,
          center: { lat: gf.centerLat, lng: gf.centerLng },
          radius: gf.radiusMeters || 1500,
          strokeColor,
          strokeWeight,
          strokeOpacity: 0.9,
          fillColor,
          fillOpacity,
          clickable: true,
        });

        circle.addListener('click', () => {
          if (infoWindowRef.current) {
            infoWindowRef.current.setContent(`
              <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 220px;">
                <strong style="font-size: 13px; display: block; margin-bottom: 2px;">${gf.name}</strong>
                <span style="font-size: 11px; color: #0284c7; font-weight: bold;">⚪ Circular Perimeter</span>
                <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Radius: ${(gf.radiusMeters || 1500).toLocaleString()}m</div>
                <div style="font-size: 11px; color: #475569; margin-top: 2px;">Linked: ${gf.terminalName}</div>
              </div>
            `);
            infoWindowRef.current.setPosition({ lat: gf.centerLat, lng: gf.centerLng });
            infoWindowRef.current.open({ map });
          }
        });

        geofenceOverlaysRef.current.push(circle);
      }
    });
  }, [geofences, activeEditGeofenceId]);

  // 4. Render Terminal Markers on Google Maps
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    terminalMarkersRef.current.forEach((m) => m.setMap(null));
    terminalMarkersRef.current = [];

    terminals.forEach((t) => {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) return;
      const isSelected = t.id === selectedTerminalId;

      // Google Maps Marker
      const marker = new ctors.Marker({
        position: { lat: t.lat, lng: t.lng },
        map,
        title: `${t.name} (${t.code})`,
        icon: {
          path: ctors.SymbolPath.CIRCLE,
          scale: isSelected ? 12 : 9,
          fillColor: isSelected ? '#3b82f6' : '#1d4ed8',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
        },
      });

      marker.addListener('click', () => {
        onSelectTerminal?.(t);
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`
            <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 240px;">
              <strong style="font-size: 13px; display: block; color: #1e3a8a;">⚓ ${t.name}</strong>
              <div style="display: flex; gap: 4px; margin: 4px 0;">
                <span style="background: #dbeafe; color: #1d4ed8; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 10px;">${t.code}</span>
                <span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${t.emirate}</span>
              </div>
              <div style="font-size: 11px; color: #64748b;">${t.portName} · Radius: ${t.geofenceRadiusMeters}m</div>
            </div>
          `);
          infoWindowRef.current.open({ map, anchor: marker });
        }
      });

      terminalMarkersRef.current.push(marker);
    });
  }, [terminals, selectedTerminalId, onSelectTerminal]);

  // 5. Render Warehouse / Consignee Markers on Google Maps
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    warehouseMarkersRef.current.forEach((m) => m.setMap(null));
    warehouseMarkersRef.current = [];

    warehouses.forEach((wh) => {
      if (!wh.lat || !wh.lng || !Number.isFinite(wh.lat) || !Number.isFinite(wh.lng)) return;

      const marker = new ctors.Marker({
        position: { lat: wh.lat, lng: wh.lng },
        map,
        title: wh.name,
        icon: {
          path: ctors.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#10b981', // Emerald
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });

      marker.addListener('click', () => {
        onSelectWarehouse?.(wh);
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`
            <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 240px;">
              <strong style="font-size: 13px; display: block; color: #065f46;">🏢 ${wh.name}</strong>
              <div style="font-size: 11px; color: #059669; font-weight: 600; margin-top: 2px;">${wh.zone}</div>
              <div style="font-size: 11px; color: #64748b; margin-top: 4px;">${wh.address || 'Consignee Ramp Facility'}</div>
              <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">Linked Shipper: ${wh.customerName || 'All Customers'}</div>
            </div>
          `);
          infoWindowRef.current.open({ map, anchor: marker });
        }
      });

      warehouseMarkersRef.current.push(marker);
    });
  }, [warehouses, onSelectWarehouse]);

  // 6. Handle focusLocation smoothly on Google Maps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusLocation) return;
    const { lat, lng, zoom } = focusLocation;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.panTo({ lat, lng });
      map.setZoom(zoom || 14);
    }
  }, [focusLocation]);

  // 7. Interactive Google Maps Plot Mode
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    if (plotMode?.active) {
      const lat = plotMode.lat || DEFAULT_CENTER.lat;
      const lng = plotMode.lng || DEFAULT_CENTER.lng;

      map.panTo({ lat, lng });
      map.setZoom(15);

      if (!plotMarkerRef.current) {
        // Create draggable target marker
        const marker = new ctors.Marker({
          position: { lat, lng },
          map,
          draggable: true,
          title: `🎯 ${plotMode.title || 'Target Location'} (Drag to reposition)`,
          icon: {
            path: ctors.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 7,
            fillColor: '#10b981',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            rotation: 180,
          },
        });

        marker.addListener('dragend', () => {
          const pos = marker.getPosition();
          if (pos) {
            plotMode.onPlotSelect(Number(pos.lat().toFixed(6)), Number(pos.lng().toFixed(6)));
          }
        });

        plotMarkerRef.current = marker;
      } else {
        plotMarkerRef.current.setPosition({ lat, lng });
      }
    } else {
      if (plotMarkerRef.current) {
        plotMarkerRef.current.setMap(null);
        plotMarkerRef.current = null;
      }
    }
  }, [plotMode]);

  // Quick Save Geofence from Map Draft
  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawnDraft) return;

    try {
      setSavingDraft(true);
      const term = terminals.find((t) => t.id === draftTerminalId);
      await onSaveGeofence({
        terminalId: draftTerminalId || null,
        terminalName: term?.name || 'Port Terminal',
        name: draftName.trim() || 'Port Geofence Zone',
        type: drawnDraft.shape,
        centerLat: drawnDraft.centerLat,
        centerLng: drawnDraft.centerLng,
        radiusMeters: drawnDraft.radiusMeters,
        coordinates: drawnDraft.coordinates,
      });
      setDrawnDraft(null);
    } catch (err) {
      console.error('Failed to save drawn geofence:', err);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleFitUAE = () => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    const bounds = new ctors.LatLngBounds();
    terminals.forEach((t) => bounds.extend({ lat: t.lat, lng: t.lng }));
    warehouses.forEach((w) => {
      if (w.lat && w.lng) bounds.extend({ lat: w.lat, lng: w.lng });
    });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 50);
    } else {
      map.panTo(DEFAULT_CENTER);
      map.setZoom(11);
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-slate-950 shadow-2xl">
      {/* Top Map Control Bar */}
      <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700/60 shadow-xl text-white">
        {/* Left: Port / Corridor Selector */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold text-xs">
            <Anchor className="w-3.5 h-3.5" />
            <span>Google Maps Live Drayage Radar</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-[11px] text-slate-300">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span>{terminals.length} Ports</span>
            <span className="text-slate-500 mx-1">·</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>{warehouses.length} Consignees</span>
            <span className="text-slate-500 mx-1">·</span>
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span>{geofences.length} Geofences</span>
          </div>
        </div>

        {/* Right: Google Maps Drawing Tools (Circle & Polygon) & Fit UAE */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDrawMode((prev) => (prev === 'CIRCLE' ? null : 'CIRCLE'))}
            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border ${
              drawMode === 'CIRCLE'
                ? 'bg-blue-600 border-blue-400 text-white shadow-lg animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <CircleIcon className="w-3.5 h-3.5 text-blue-400" />
            <span>⚪ Draw Circle</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawMode((prev) => (prev === 'POLYGON' ? null : 'POLYGON'))}
            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border ${
              drawMode === 'POLYGON'
                ? 'bg-purple-600 border-purple-400 text-white shadow-lg animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <Hexagon className="w-3.5 h-3.5 text-purple-400" />
            <span>⬡ Draw Polygon</span>
          </button>

          <button
            type="button"
            onClick={handleFitUAE}
            className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1"
            title="Fit UAE Ports & Corridors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Fit UAE</span>
          </button>
        </div>
      </div>

      {/* Active Drawing Instructions Banner */}
      {drawMode && (
        <div className="absolute top-16 left-3 right-3 z-30 bg-blue-950/95 backdrop-blur-md border border-blue-500/60 rounded-xl px-4 py-2.5 shadow-2xl flex items-center justify-between text-white animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
            <span className="text-xs font-bold text-blue-200">
              {drawMode === 'CIRCLE'
                ? '⚪ Click & drag on Google Maps to draw circular perimeter'
                : '⬡ Click points around the yard to draw polygon boundaries, click first point to close'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDrawMode(null)}
            className="px-2.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-600"
          >
            Cancel Drawing
          </button>
        </div>
      )}

      {/* Active Plot on Map Mode Banner */}
      {plotMode?.active && (
        <div className="absolute top-16 left-3 right-3 z-30 bg-emerald-950/95 backdrop-blur-md border border-emerald-500/60 rounded-xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-3 text-white animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold text-emerald-300">
              📍 Google Maps Plotter: {plotMode.title}
            </span>
            <span className="text-[11px] text-emerald-100/90 font-mono">
              ({plotMode.lat.toFixed(5)}, {plotMode.lng.toFixed(5)})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-emerald-300 hidden md:inline">
              Click anywhere on Google Maps or drag the green pin to set location
            </span>
            <button
              type="button"
              onClick={plotMode.onClose}
              className="px-3.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md transition-all flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              Done Plotting
            </button>
          </div>
        </div>
      )}

      {/* Main Google Maps Viewport */}
      <div ref={containerRef} className="w-full h-[520px] bg-slate-950" />

      {/* Loading & Error Overlays */}
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/80 text-xs text-blue-400 font-medium">
          <Compass className="w-8 h-8 animate-spin" />
          <span>Connecting to Google Maps Platform…</span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 bg-slate-950/95 text-center gap-3 text-rose-300 text-xs">
          <AlertTriangle className="w-8 h-8 text-rose-400" />
          <strong className="text-sm font-bold text-white">Google Maps Integration Notice</strong>
          <p className="max-w-md text-slate-400">{error}</p>
        </div>
      )}

      {/* Quick Modal after Drawing Geofence on Google Maps */}
      {drawnDraft && (
        <div className="absolute inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4 text-white text-xs animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                {drawnDraft.shape === 'CIRCLE' ? (
                  <CircleIcon className="w-4 h-4 text-blue-400" />
                ) : (
                  <Hexagon className="w-4 h-4 text-purple-400" />
                )}
                <h3 className="font-bold text-sm">Save Drawn Geofence Zone</h3>
              </div>
              <button
                type="button"
                onClick={() => setDrawnDraft(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDraft} className="space-y-3">
              <div className="space-y-1">
                <label className="text-slate-400 font-semibold">Terminal / Facility Link</label>
                <select
                  value={draftTerminalId}
                  onChange={(e) => setDraftTerminalId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:border-blue-500"
                >
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-semibold">Geofence Name *</label>
                <input
                  type="text"
                  required
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. Jebel Ali T1 Automated OCR Gate"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 p-2.5 rounded-xl bg-slate-800/60 border border-slate-700 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Type</span>
                  <strong className="text-blue-400 font-sans">
                    {drawnDraft.shape === 'CIRCLE' ? '⚪ Circular Perimeter' : '⬡ Polygon Ramp Zone'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">
                    {drawnDraft.shape === 'CIRCLE' ? 'Radius' : 'Vertices'}
                  </span>
                  <strong className="text-emerald-400">
                    {drawnDraft.shape === 'CIRCLE'
                      ? `${drawnDraft.radiusMeters}m`
                      : `${drawnDraft.coordinates?.length || 0} Points`}
                  </strong>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDrawnDraft(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={savingDraft}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-md disabled:opacity-50"
                >
                  {savingDraft ? 'Saving...' : 'Save Geofence'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
