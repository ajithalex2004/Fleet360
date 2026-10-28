'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MapPin, Anchor, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle,
  Compass, Layers, Maximize2, X, Sliders, Check, Eye, Navigation, RefreshCw,
  Hexagon, Circle as CircleIcon, Warehouse, Info, Undo2, Map, Globe, Mountain,
  Move, ShieldCheck,
} from 'lucide-react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
  type GMapsCircle,
  type GMapsPolygon,
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

const DARK_MAP_STYLES = [
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
];

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
  const infoWindowRef = useRef<GMapsInfoWindow | null>(null);

  // Overlays & Markers
  const terminalMarkersRef = useRef<GMapsMarker[]>([]);
  const warehouseMarkersRef = useRef<GMapsMarker[]>([]);
  const geofenceOverlaysRef = useRef<Array<GMapsCircle | GMapsPolygon>>([]);
  const plotMarkerRef = useRef<GMapsMarker | null>(null);

  // Native Drawing Overlays (Bypasses deprecated DrawingManager)
  const draftCircleRef = useRef<GMapsCircle | null>(null);
  const draftPolygonRef = useRef<GMapsPolygon | null>(null);
  const polygonVerticesRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const polygonMarkersRef = useRef<GMapsMarker[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map Type Switcher State: 'roadmap' (Default) | 'satellite' | 'hybrid' | 'terrain'
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');

  const [drawMode, setDrawMode] = useState<'CIRCLE' | 'POLYGON' | null>(null);
  const [circleDraft, setCircleDraft] = useState<{ centerLat: number; centerLng: number; radiusMeters: number } | null>(null);
  const [polygonCount, setPolygonCount] = useState<number>(0);

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

  // Live Stretched Geofence Edit State (for activeEditGeofenceId)
  const [editingStretchedGf, setEditingStretchedGf] = useState<{
    id: string;
    terminalId: string | null;
    terminalName: string;
    name: string;
    type: 'CIRCLE' | 'POLYGON';
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    coordinates?: Array<{ lat: number; lng: number }>;
  } | null>(null);
  const [savingStretched, setSavingStretched] = useState(false);

  // Keep refs synchronized for map click handlers
  const drawModeRef = useRef<'CIRCLE' | 'POLYGON' | null>(drawMode);
  drawModeRef.current = drawMode;

  const plotModeRef = useRef<PlotModeState | null>(plotMode || null);
  plotModeRef.current = plotMode || null;

  // Cleanup native drawing drafts
  const cleanupDraftCircle = useCallback(() => {
    if (draftCircleRef.current) {
      draftCircleRef.current.setMap(null);
      draftCircleRef.current = null;
    }
    setCircleDraft(null);
  }, []);

  const cleanupDraftPolygon = useCallback(() => {
    if (draftPolygonRef.current) {
      draftPolygonRef.current.setMap(null);
      draftPolygonRef.current = null;
    }
    polygonMarkersRef.current.forEach((m) => m.setMap(null));
    polygonMarkersRef.current = [];
    polygonVerticesRef.current = [];
    setPolygonCount(0);
  }, []);

  // When drawMode changes, clean up inactive drafts
  useEffect(() => {
    if (drawMode !== 'CIRCLE') {
      cleanupDraftCircle();
    }
    if (drawMode !== 'POLYGON') {
      cleanupDraftPolygon();
    }
  }, [drawMode, cleanupDraftCircle, cleanupDraftPolygon]);

  // Keep editingStretchedGf in sync when activeEditGeofenceId changes
  useEffect(() => {
    if (activeEditGeofenceId) {
      const gf = geofences.find((g) => g.id === activeEditGeofenceId);
      if (gf) {
        let coords: Array<{ lat: number; lng: number }> = [];
        try {
          if (gf.coordinatesJson) coords = JSON.parse(gf.coordinatesJson);
        } catch {}

        setEditingStretchedGf({
          id: gf.id,
          terminalId: gf.terminalId,
          terminalName: gf.terminalName,
          name: gf.name,
          type: gf.type,
          centerLat: gf.centerLat,
          centerLng: gf.centerLng,
          radiusMeters: gf.radiusMeters || 1000,
          coordinates: coords,
        });
      }
    } else {
      setEditingStretchedGf(null);
    }
  }, [activeEditGeofenceId, geofences]);

  // Switch Map Type: Roadmap | Satellite | Hybrid | Terrain
  const handleSetMapType = useCallback((type: 'roadmap' | 'satellite' | 'hybrid' | 'terrain') => {
    setMapTypeId(type);
    if (!mapRef.current) return;
    mapRef.current.setMapTypeId(type);
    // If roadmap, reapply custom dark styles; for satellite/hybrid/terrain, clear custom styles
    if (type === 'roadmap') {
      mapRef.current.setOptions({ styles: DARK_MAP_STYLES });
    } else {
      mapRef.current.setOptions({ styles: null });
    }
  }, []);

  // Native Circle Click Handler (Circle with vertex stretching handles)
  const handleMapClickCircle = useCallback((lat: number, lng: number) => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    if (draftCircleRef.current) {
      draftCircleRef.current.setCenter({ lat, lng });
      const r = Math.round(draftCircleRef.current.getRadius());
      setCircleDraft({ centerLat: lat, centerLng: lng, radiusMeters: r });
      return;
    }

    const initialRadius = 500;
    const circle = new ctors.Circle({
      map,
      center: { lat, lng },
      radius: initialRadius,
      editable: true,
      draggable: true,
      strokeColor: '#38bdf8',
      strokeWeight: 2.5,
      strokeOpacity: 0.9,
      fillColor: '#0284c7',
      fillOpacity: 0.25,
      zIndex: 100,
    });

    const updateStats = () => {
      const c = circle.getCenter();
      const r = Math.round(circle.getRadius());
      if (c) {
        setCircleDraft({
          centerLat: Number(c.lat().toFixed(6)),
          centerLng: Number(c.lng().toFixed(6)),
          radiusMeters: r,
        });
      }
    };

    circle.addListener('radius_changed', updateStats);
    circle.addListener('center_changed', updateStats);

    draftCircleRef.current = circle;
    setCircleDraft({ centerLat: lat, centerLng: lng, radiusMeters: initialRadius });
  }, []);

  // Confirm Circle Draft & Open Save Modal
  const handleConfirmCircleDraft = useCallback(() => {
    if (!circleDraft) return;
    setDrawnDraft({
      shape: 'CIRCLE',
      centerLat: circleDraft.centerLat,
      centerLng: circleDraft.centerLng,
      radiusMeters: circleDraft.radiusMeters,
    });
    setDraftName(`Port Geofence Zone (${circleDraft.radiusMeters}m)`);
    cleanupDraftCircle();
    setDrawMode(null);
  }, [circleDraft, cleanupDraftCircle]);

  // Native Polygon Click Handler (with Vertex & Midpoint Stretching)
  const handleMapClickPolygon = useCallback((lat: number, lng: number) => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    const newPoint = { lat, lng };
    const updated = [...polygonVerticesRef.current, newPoint];
    polygonVerticesRef.current = updated;
    setPolygonCount(updated.length);

    // Place a visible vertex pin
    const marker = new ctors.Marker({
      position: newPoint,
      map,
      icon: {
        path: ctors.SymbolPath.CIRCLE,
        scale: 4.5,
        fillColor: '#c084fc',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1.5,
      },
    });
    polygonMarkersRef.current.push(marker);

    // Render / update polygon boundary
    if (!draftPolygonRef.current) {
      const poly = new ctors.Polygon({
        map,
        paths: updated,
        strokeColor: '#c084fc',
        strokeWeight: 2.5,
        strokeOpacity: 0.9,
        fillColor: '#9333ea',
        fillOpacity: 0.25,
        clickable: true,
        editable: updated.length >= 3,
        draggable: true,
        zIndex: 100,
      });

      // Synchronize polygon vertex stretching with internal vertex ref
      const path = poly.getPath();
      const syncPathChanges = () => {
        const len = path.getLength();
        const pts: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < len; i++) {
          const pt = path.getAt(i);
          pts.push({
            lat: Number(pt.lat().toFixed(6)),
            lng: Number(pt.lng().toFixed(6)),
          });
        }
        polygonVerticesRef.current = pts;
        setPolygonCount(pts.length);
      };

      path.addListener('set_at', syncPathChanges);
      path.addListener('insert_at', syncPathChanges);
      path.addListener('remove_at', syncPathChanges);

      draftPolygonRef.current = poly;
    } else {
      draftPolygonRef.current.setPath(updated);
      if (updated.length >= 3) {
        draftPolygonRef.current.setEditable(true);
        draftPolygonRef.current.setDraggable(true);
      }
    }
  }, []);

  // Undo Last Polygon Point
  const handleUndoPolygonPoint = useCallback(() => {
    if (polygonVerticesRef.current.length === 0) return;
    polygonVerticesRef.current.pop();
    const lastMarker = polygonMarkersRef.current.pop();
    if (lastMarker) lastMarker.setMap(null);

    setPolygonCount(polygonVerticesRef.current.length);
    if (draftPolygonRef.current) {
      draftPolygonRef.current.setPath(polygonVerticesRef.current);
    }
  }, []);

  // Complete Polygon Draft & Open Save Modal
  const handleCompletePolygonDraft = useCallback(() => {
    // If draft polygon is editable, extract latest stretched coordinates from path
    let points = polygonVerticesRef.current;
    if (draftPolygonRef.current) {
      const path = draftPolygonRef.current.getPath();
      const len = path.getLength();
      if (len >= 3) {
        const pts: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < len; i++) {
          const pt = path.getAt(i);
          pts.push({
            lat: Number(pt.lat().toFixed(6)),
            lng: Number(pt.lng().toFixed(6)),
          });
        }
        points = pts;
      }
    }

    if (points.length < 3) return;

    const avgLat = Number((points.reduce((sum, p) => sum + p.lat, 0) / points.length).toFixed(6));
    const avgLng = Number((points.reduce((sum, p) => sum + p.lng, 0) / points.length).toFixed(6));

    setDrawnDraft({
      shape: 'POLYGON',
      centerLat: avgLat,
      centerLng: avgLng,
      radiusMeters: 1000,
      coordinates: points,
    });
    setDraftName(`Polygon Ramp Zone (${points.length} Vertices)`);
    cleanupDraftPolygon();
    setDrawMode(null);
  }, [cleanupDraftPolygon]);

  // Save Stretched Geofence (Polygon Vertices or Circle Radius/Center)
  const handleSaveStretchedGeofence = async () => {
    if (!editingStretchedGf) return;
    try {
      setSavingStretched(true);
      await onSaveGeofence({
        id: editingStretchedGf.id,
        terminalId: editingStretchedGf.terminalId,
        terminalName: editingStretchedGf.terminalName,
        name: editingStretchedGf.name,
        type: editingStretchedGf.type,
        centerLat: editingStretchedGf.centerLat,
        centerLng: editingStretchedGf.centerLng,
        radiusMeters: editingStretchedGf.radiusMeters,
        coordinates: editingStretchedGf.coordinates,
      });
      setEditingStretchedGf(null);
      if (onCloseEditMode) onCloseEditMode();
    } catch (err) {
      console.error('Failed to save stretched geofence:', err);
    } finally {
      setSavingStretched(false);
    }
  };

  // 1. Initialize Google Maps
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
            mapTypeControlOptions: {
              style: ctors.MapTypeControlStyle.HORIZONTAL_BAR,
              position: ctors.ControlPosition.TOP_RIGHT,
              mapTypeIds: ['roadmap', 'satellite', 'hybrid', 'terrain'],
            },
            streetViewControl: false,
            fullscreenControl: true,
            styles: DARK_MAP_STYLES,
          });
          mapRef.current = map;

          // InfoWindow
          infoWindowRef.current = new ctors.InfoWindow();

          // Unified Map Click Handler (Supports Plot Mode + Native Circle & Polygon Drawing)
          map.addListener('click', (e: any) => {
            if (!e?.latLng) return;
            const lat = Number(e.latLng.lat().toFixed(6));
            const lng = Number(e.latLng.lng().toFixed(6));

            // Case A: Plot Mode (Target Pin Relocation)
            if (plotModeRef.current?.active) {
              if (plotMarkerRef.current) {
                plotMarkerRef.current.setPosition({ lat, lng });
              }
              plotModeRef.current.onPlotSelect(lat, lng);
              return;
            }

            // Case B: Native Circle Drawing Mode
            if (drawModeRef.current === 'CIRCLE') {
              handleMapClickCircle(lat, lng);
              return;
            }

            // Case C: Native Polygon Drawing Mode
            if (drawModeRef.current === 'POLYGON') {
              handleMapClickPolygon(lat, lng);
              return;
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
  }, [handleMapClickCircle, handleMapClickPolygon]);

  // 2. Render Existing Geofences with Interactive Vertex Stretching
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    // Clear old geofence overlays
    geofenceOverlaysRef.current.forEach((o) => o.setMap(null));
    geofenceOverlaysRef.current = [];

    geofences.forEach((gf) => {
      const isSelected = gf.id === activeEditGeofenceId;
      const strokeColor = isSelected ? '#ec4899' : gf.type === 'POLYGON' ? '#c084fc' : '#38bdf8';
      const fillColor = isSelected ? '#db2777' : gf.type === 'POLYGON' ? '#a855f7' : '#0284c7';
      const strokeWeight = isSelected ? 3.5 : 2;
      const fillOpacity = isSelected ? 0.32 : 0.18;

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
            editable: isSelected, // Enables Vertex & Midpoint Drag Handles for Stretching!
            draggable: isSelected, // Enables dragging the whole shape
            zIndex: isSelected ? 100 : 10,
          });

          // If selected for editing, listen to vertex changes on its path
          if (isSelected) {
            const path = poly.getPath();
            const onVertexChange = () => {
              const len = path.getLength();
              const newPts: Array<{ lat: number; lng: number }> = [];
              for (let i = 0; i < len; i++) {
                const pt = path.getAt(i);
                newPts.push({
                  lat: Number(pt.lat().toFixed(6)),
                  lng: Number(pt.lng().toFixed(6)),
                });
              }
              const avgLat = Number((newPts.reduce((s, p) => s + p.lat, 0) / newPts.length).toFixed(6));
              const avgLng = Number((newPts.reduce((s, p) => s + p.lng, 0) / newPts.length).toFixed(6));
              setEditingStretchedGf({
                id: gf.id,
                terminalId: gf.terminalId,
                terminalName: gf.terminalName,
                name: gf.name,
                type: 'POLYGON',
                centerLat: avgLat,
                centerLng: avgLng,
                radiusMeters: gf.radiusMeters,
                coordinates: newPts,
              });
            };

            path.addListener('set_at', onVertexChange);
            path.addListener('insert_at', onVertexChange);
            path.addListener('remove_at', onVertexChange);
          }

          poly.addListener('click', () => {
            if (infoWindowRef.current) {
              infoWindowRef.current.setContent(`
                <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 220px;">
                  <strong style="font-size: 13px; display: block; margin-bottom: 2px;">${gf.name}</strong>
                  <span style="font-size: 11px; color: #7c3aed; font-weight: bold;">⬡ Polygon Ramp Zone</span>
                  <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Linked: ${gf.terminalName}</div>
                  <div style="font-size: 11px; color: #475569; margin-top: 2px;">Vertices: ${polygonCoords.length} points</div>
                  ${isSelected ? '<div style="font-size: 11px; color: #db2777; font-weight: bold; margin-top: 4px;">📐 Stretch handles active! Drag white corners or edge midpoints.</div>' : ''}
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

      // Circular Perimeter (with cardinal perimeter stretch handles when selected)
      const circle = new ctors.Circle({
        map,
        center: { lat: gf.centerLat, lng: gf.centerLng },
        radius: gf.radiusMeters || 1000,
        strokeColor,
        strokeWeight,
        strokeOpacity: 0.85,
        fillColor,
        fillOpacity,
        clickable: true,
        editable: isSelected, // Enables edge perimeter handles for stretching radius!
        draggable: isSelected, // Enables center handle to drag position
        zIndex: isSelected ? 100 : 10,
      });

      if (isSelected) {
        const onCircleChange = () => {
          const c = circle.getCenter();
          const r = Math.round(circle.getRadius());
          if (c) {
            setEditingStretchedGf({
              id: gf.id,
              terminalId: gf.terminalId,
              terminalName: gf.terminalName,
              name: gf.name,
              type: 'CIRCLE',
              centerLat: Number(c.lat().toFixed(6)),
              centerLng: Number(c.lng().toFixed(6)),
              radiusMeters: r,
            });
          }
        };

        circle.addListener('radius_changed', onCircleChange);
        circle.addListener('center_changed', onCircleChange);
      }

      circle.addListener('click', () => {
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`
            <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 220px;">
              <strong style="font-size: 13px; display: block; margin-bottom: 2px;">${gf.name}</strong>
              <span style="font-size: 11px; color: #0284c7; font-weight: bold;">⚪ Circular Perimeter (${gf.radiusMeters}m)</span>
              <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Linked: ${gf.terminalName}</div>
              <div style="font-size: 11px; color: #475569; margin-top: 2px;">Coord: ${gf.centerLat.toFixed(4)}, ${gf.centerLng.toFixed(4)}</div>
              ${isSelected ? '<div style="font-size: 11px; color: #0284c7; font-weight: bold; margin-top: 4px;">⚪ Stretch handles active! Drag edge handles to stretch radius.</div>' : ''}
            </div>
          `);
          infoWindowRef.current.setPosition({ lat: gf.centerLat, lng: gf.centerLng });
          infoWindowRef.current.open({ map });
        }
      });

      geofenceOverlaysRef.current.push(circle);
    });
  }, [geofences, activeEditGeofenceId]);

  // 3. Render Port Terminal Markers
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    // Clear old terminal markers
    terminalMarkersRef.current.forEach((m) => m.setMap(null));
    terminalMarkersRef.current = [];

    terminals.forEach((term) => {
      const isSelected = term.id === selectedTerminalId;

      const marker = new ctors.Marker({
        position: { lat: term.lat, lng: term.lng },
        map,
        title: `${term.code} - ${term.name}`,
        icon: {
          path: ctors.SymbolPath.CIRCLE,
          scale: isSelected ? 10 : 8,
          fillColor: isSelected ? '#3b82f6' : '#2563eb',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: isSelected ? 2.5 : 1.5,
        },
      });

      marker.addListener('click', () => {
        if (onSelectTerminal) onSelectTerminal(term);
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`
            <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 220px;">
              <strong style="font-size: 13px; display: block; margin-bottom: 2px;">${term.name}</strong>
              <span style="font-size: 11px; font-family: monospace; color: #2563eb; font-weight: bold;">[${term.code}]</span>
              <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Port: ${term.portName} (${term.emirate})</div>
              <div style="font-size: 11px; color: #10b981; margin-top: 2px;">Free Days: ${term.freeDaysDry ?? 5} Dry / ${term.freeDaysReefer ?? 3} Reefer</div>
            </div>
          `);
          infoWindowRef.current.open({ anchor: marker, map });
        }
      });

      terminalMarkersRef.current.push(marker);
    });
  }, [terminals, selectedTerminalId, onSelectTerminal]);

  // 4. Render Consignee / Warehouse Markers
  useEffect(() => {
    const ctors = ctorsRef.current;
    const map = mapRef.current;
    if (!ctors || !map) return;

    warehouseMarkersRef.current.forEach((m) => m.setMap(null));
    warehouseMarkersRef.current = [];

    warehouses.forEach((wh) => {
      if (!wh.lat || !wh.lng) return;

      const marker = new ctors.Marker({
        position: { lat: wh.lat, lng: wh.lng },
        map,
        title: `${wh.name} (${wh.customerName || 'Consignee'})`,
        icon: {
          path: ctors.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#10b981',
          fillOpacity: 0.95,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
        },
      });

      marker.addListener('click', () => {
        if (onSelectWarehouse) onSelectWarehouse(wh);
        if (infoWindowRef.current) {
          infoWindowRef.current.setContent(`
            <div style="padding: 8px; font-family: sans-serif; color: #0f172a; max-width: 220px;">
              <strong style="font-size: 13px; display: block; margin-bottom: 2px;">${wh.name}</strong>
              <div style="font-size: 11px; color: #059669; font-weight: bold;">Shipper: ${wh.customerName || 'Consignee'}</div>
              <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Zone: ${wh.zone}</div>
              <div style="font-size: 11px; color: #475569; margin-top: 2px;">Ramps: ${wh.rampsCount || 6} loading bays</div>
            </div>
          `);
          infoWindowRef.current.open({ anchor: marker, map });
        }
      });

      warehouseMarkersRef.current.push(marker);
    });
  }, [warehouses, onSelectWarehouse]);

  // 5. Handle Focus Location
  useEffect(() => {
    if (!focusLocation || !mapRef.current) return;
    mapRef.current.panTo({ lat: focusLocation.lat, lng: focusLocation.lng });
    mapRef.current.setZoom(focusLocation.zoom || 14.5);
  }, [focusLocation]);

  // 6. Handle Plot on Map Mode (Draggable Green Target Pin)
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
        {/* Left: Port / Corridor Selector & Indicator */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold text-xs">
            <Anchor className="w-3.5 h-3.5" />
            <span>Google Maps Live Drayage Radar</span>
          </div>

          <div className="hidden lg:flex items-center gap-1 text-[11px] text-slate-300">
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

        {/* Center: Map Type Selector (Roadmap / Terrain / Satellite / Hybrid) */}
        <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-lg border border-slate-700/80">
          <button
            type="button"
            onClick={() => handleSetMapType('roadmap')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              mapTypeId === 'roadmap'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="Default Roadmap (Dark Theme)"
          >
            <Map className="w-3 h-3" />
            <span>Default</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetMapType('satellite')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              mapTypeId === 'satellite'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="High-Resolution Satellite Imagery"
          >
            <Globe className="w-3 h-3" />
            <span>Satellite</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetMapType('hybrid')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              mapTypeId === 'hybrid'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="Satellite with Road & Berth Labels"
          >
            <Layers className="w-3 h-3" />
            <span>Hybrid</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetMapType('terrain')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
              mapTypeId === 'terrain'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="Topographical Elevation & Physical Terrain"
          >
            <Mountain className="w-3 h-3" />
            <span>Terrain</span>
          </button>
        </div>

        {/* Right: Google Maps Drawing Tools (Native Circle & Polygon) & Fit UAE */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDrawMode((prev) => (prev === 'CIRCLE' ? null : 'CIRCLE'))}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border ${
              drawMode === 'CIRCLE'
                ? 'bg-blue-600 border-blue-400 text-white shadow-lg animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
            title="Draw circular perimeter with interactive radius stretching"
          >
            <CircleIcon className="w-3.5 h-3.5 text-blue-400" />
            <span>⚪ Draw Circle</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawMode((prev) => (prev === 'POLYGON' ? null : 'POLYGON'))}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border ${
              drawMode === 'POLYGON'
                ? 'bg-purple-600 border-purple-400 text-white shadow-lg animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
            title="Draw polygon with stretchable vertices and edge midpoints"
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
            <span className="hidden sm:inline">Fit UAE</span>
          </button>
        </div>
      </div>

      {/* Active Circle Drawing Banner */}
      {drawMode === 'CIRCLE' && (
        <div className="absolute top-16 left-3 right-3 z-30 bg-blue-950/95 backdrop-blur-md border border-blue-500/60 rounded-xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-3 text-white animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
            <span className="text-xs font-bold text-blue-200">
              {circleDraft
                ? `⚪ Drag edge handles to stretch radius (${circleDraft.radiusMeters}m), or drag center to move`
                : '⚪ Click anywhere on Google Maps to place circular perimeter'}
            </span>
            {circleDraft && (
              <span className="text-[11px] font-mono text-blue-300">
                ({circleDraft.centerLat.toFixed(5)}, {circleDraft.centerLng.toFixed(5)}) · {circleDraft.radiusMeters}m
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {circleDraft && (
              <button
                type="button"
                onClick={handleConfirmCircleDraft}
                className="px-3.5 py-1 rounded-lg bg-blue-500 hover:bg-blue-400 text-slate-950 text-xs font-bold shadow-md transition-all flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Confirm & Save Geofence
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawMode(null)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Active Polygon Drawing Banner with Vertex Stretching Info */}
      {drawMode === 'POLYGON' && (
        <div className="absolute top-16 left-3 right-3 z-30 bg-purple-950/95 backdrop-blur-md border border-purple-500/60 rounded-xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-3 text-white animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-ping" />
            <span className="text-xs font-bold text-purple-200">
              {polygonCount >= 3
                ? '⬡ Stretch points active! Drag any white corner vertex to stretch, drag edge midpoints to add corners'
                : '⬡ Click on Google Maps to add polygon corners:'}
            </span>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-purple-900/60 border border-purple-500/40 text-purple-200">
              {polygonCount} {polygonCount === 1 ? 'vertex' : 'vertices'} {polygonCount < 3 ? '(min 3 required)' : '✓'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {polygonCount > 0 && (
              <button
                type="button"
                onClick={handleUndoPolygonPoint}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-600 flex items-center gap-1"
              >
                <Undo2 className="w-3 h-3" />
                Undo Point
              </button>
            )}
            {polygonCount >= 3 && (
              <button
                type="button"
                onClick={handleCompletePolygonDraft}
                className="px-3.5 py-1 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 text-xs font-bold shadow-md transition-all flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Complete & Save Polygon
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawMode(null)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Live Geofence Vertex Stretching Banner (When Editing Existing Geofence) */}
      {editingStretchedGf && (
        <div className="absolute top-16 left-3 right-3 z-30 bg-pink-950/95 backdrop-blur-md border border-pink-500/70 rounded-xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-3 text-white animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-pink-400 animate-ping" />
            <span className="text-xs font-bold text-pink-200 flex items-center gap-1.5">
              <Move className="w-3.5 h-3.5 text-pink-400" />
              <span>Editing & Stretching: {editingStretchedGf.name}</span>
            </span>
            <span className="text-[11px] text-pink-300 font-mono hidden md:inline">
              {editingStretchedGf.type === 'POLYGON'
                ? `(${editingStretchedGf.coordinates?.length || 0} vertices · Drag corner handles to stretch or midpoint handles to add points)`
                : `(${editingStretchedGf.radiusMeters}m radius · Drag edge handles to stretch radius or center to move)`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveStretchedGeofence}
              disabled={savingStretched}
              className="px-3.5 py-1 rounded-lg bg-pink-500 hover:bg-pink-400 text-slate-950 text-xs font-bold shadow-md transition-all flex items-center gap-1 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{savingStretched ? 'Saving Stretched Shape...' : 'Save Stretched Geofence'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingStretchedGf(null);
                if (onCloseEditMode) onCloseEditMode();
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-600"
            >
              Cancel
            </button>
          </div>
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
                <label className="text-slate-300 font-semibold">Geofence Name *</label>
                <input
                  type="text"
                  required
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. Jebel Ali T1 Gate In Perimeter"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-semibold">Assign to Port Terminal</label>
                <select
                  value={draftTerminalId}
                  onChange={(e) => setDraftTerminalId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:border-blue-500"
                >
                  <option value="">General Facility (Not linked to terminal)</option>
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700 space-y-1 text-[11px] text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">Shape:</span>
                  <span className="font-bold text-white">
                    {drawnDraft.shape === 'CIRCLE' ? '⚪ Circular Perimeter' : '⬡ Multi-Point Polygon'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Center:</span>
                  <span className="font-mono text-white">
                    {drawnDraft.centerLat.toFixed(5)}, {drawnDraft.centerLng.toFixed(5)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">
                    {drawnDraft.shape === 'CIRCLE' ? 'Radius:' : 'Boundary Points:'}
                  </span>
                  <span className="font-bold text-blue-400">
                    {drawnDraft.shape === 'CIRCLE'
                      ? `${drawnDraft.radiusMeters} meters`
                      : `${drawnDraft.coordinates?.length || 0} vertices`}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDrawnDraft(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={savingDraft}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
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
