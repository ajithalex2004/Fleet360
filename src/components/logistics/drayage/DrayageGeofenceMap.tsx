'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MapPin, Anchor, Plus, Edit2, Trash2, CheckCircle2, AlertTriangle,
  Compass, Layers, Maximize2, X, Sliders, Check, Eye, Navigation, RefreshCw,
  Pentagon, Circle, Undo, RotateCcw,
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

function parsePolygonCoordinates(jsonStr?: string): Array<[number, number]> {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed) || parsed.length < 3) return [];
    const pts: Array<[number, number]> = [];
    for (const p of parsed) {
      if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        pts.push([Number(p[0]), Number(p[1])]);
      } else if (p && typeof p === 'object' && 'lng' in p && 'lat' in p) {
        pts.push([Number(p.lng), Number(p.lat)]);
      }
    }
    return pts;
  } catch {
    return [];
  }
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
      script.onerror = () => {
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
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<MapboxMarker[]>([]);
  const editMarkerRef = useRef<MapboxMarker | null>(null);
  const polygonVertexMarkersRef = useRef<MapboxMarker[]>([]);
  const plotMarkerRef = useRef<MapboxMarker | null>(null);
  const warehouseMarkersRef = useRef<MapboxMarker[]>([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'streets'>('dark');

  // Interactive Geofence Editor State
  const [isEditingOnMap, setIsEditingOnMap] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorTerminalId, setEditorTerminalId] = useState('');
  const [editorShape, setEditorShape] = useState<'CIRCLE' | 'POLYGON'>('CIRCLE');
  const [editorRadius, setEditorRadius] = useState(1500);
  const [editorLat, setEditorLat] = useState(25.0112);
  const [editorLng, setEditorLng] = useState(55.0612);
  const [polygonVertices, setPolygonVertices] = useState<Array<[number, number]>>([]); // [[lng, lat], ...]
  const [isSaving, setIsSaving] = useState(false);

  // Helper to update the draft/preview circle or polygon source
  const updateDraftGeometry = useCallback((
    shape: 'CIRCLE' | 'POLYGON',
    circleData: { lat: number; lng: number; radius: number } | null,
    polyVertices: Array<[number, number]>
  ) => {
    try {
      const map = mapRef.current;
      if (!map) return;
      const source = map.getSource('draft-geofence-source') as any;
      if (!source) return;

      if (shape === 'CIRCLE') {
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
      } else {
        // Polygon Mode
        if (polyVertices.length < 3) {
          // If fewer than 3 vertices, draw line if >= 2, or empty
          if (polyVertices.length === 2) {
            source.setData({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: polyVertices },
                  properties: {},
                },
              ],
            });
          } else {
            source.setData({ type: 'FeatureCollection', features: [] });
          }
        } else {
          // Complete ring (first point repeated at end)
          const closedRing = [...polyVertices, polyVertices[0]];
          source.setData({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [closedRing] },
                properties: {},
              },
            ],
          });
        }
      }
    } catch (err) {
      console.warn('Failed to update draft geometry on map:', err);
    }
  }, []);

  // Cancel edit mode
  const cancelMapEdit = useCallback(() => {
    setIsEditingOnMap(false);
    setEditorId(null);
    setPolygonVertices([]);
    if (editMarkerRef.current) {
      try { editMarkerRef.current.remove(); } catch {}
      editMarkerRef.current = null;
    }
    polygonVertexMarkersRef.current.forEach(m => {
      try { m.remove(); } catch {}
    });
    polygonVertexMarkersRef.current = [];
    updateDraftGeometry('CIRCLE', null, []);
    onCloseEditMode?.();
  }, [onCloseEditMode, updateDraftGeometry]);

  // Start editing a geofence on the map (declared early to prevent TDZ)
  const startEditingGeofence = useCallback((gf: Geofence) => {
    setIsEditingOnMap(true);
    setEditorId(gf.id);
    setEditorName(gf.name);
    setEditorTerminalId(gf.terminalId || '');
    setEditorRadius(gf.radiusMeters || 1500);
    setEditorLat(gf.centerLat || 25.0112);
    setEditorLng(gf.centerLng || 55.0612);

    const isPoly = gf.type === 'POLYGON';
    setEditorShape(isPoly ? 'POLYGON' : 'CIRCLE');

    if (isPoly && gf.coordinatesJson) {
      const parsed = parsePolygonCoordinates(gf.coordinatesJson);
      setPolygonVertices(parsed);
    } else {
      setPolygonVertices([]);
    }

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
    setEditorShape('CIRCLE');
    setEditorRadius(term?.geofenceRadiusMeters || 1500);
    setEditorLat(lat);
    setEditorLng(lng);
    setPolygonVertices([]);

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

  // Save changes from map editor (both Circle and Polygon support)
  const handleSaveFromMap = async () => {
    if (!editorName.trim()) return;
    if (editorShape === 'POLYGON' && polygonVertices.length < 3) {
      alert('Please place at least 3 points on the map to define the polygon boundary.');
      return;
    }

    try {
      setIsSaving(true);
      const targetTerm = terminals.find((t) => t.id === editorTerminalId);

      let finalCenterLat = Number(editorLat);
      let finalCenterLng = Number(editorLng);
      let finalRadius = Number(editorRadius);

      let coordinatesPayload: Array<{ lat: number; lng: number }> | undefined = undefined;

      if (editorShape === 'POLYGON' && polygonVertices.length >= 3) {
        // Calculate centroid
        finalCenterLng = polygonVertices.reduce((sum, p) => sum + p[0], 0) / polygonVertices.length;
        finalCenterLat = polygonVertices.reduce((sum, p) => sum + p[1], 0) / polygonVertices.length;
        // Convert to payload
        coordinatesPayload = polygonVertices.map(([lng, lat]) => ({ lat, lng }));
      }

      await onSaveGeofence({
        id: editorId || undefined,
        terminalId: editorTerminalId || null,
        terminalName: targetTerm?.name || 'Port Terminal',
        name: editorName.trim(),
        type: editorShape,
        centerLat: finalCenterLat,
        centerLng: finalCenterLng,
        radiusMeters: finalRadius,
        coordinates: coordinatesPayload,
      });
      cancelMapEdit();
    } catch (e) {
      console.error('Error saving geofence from map editor:', e);
    } finally {
      setIsSaving(false);
    }
  };

  // Click on map to add vertex in Polygon mode or move center in Circle mode
  const handleMapClick = useCallback((e: any) => {
    if (!e?.lngLat) return;
    const { lng, lat } = e.lngLat;

    if (plotMode?.active) {
      plotMode.onPlotSelect(lat, lng);
      if (plotMarkerRef.current) {
        plotMarkerRef.current.setLngLat([lng, lat]);
      }
      return;
    }

    if (!isEditingOnMap) return;

    if (editorShape === 'POLYGON') {
      setPolygonVertices((prev) => [...prev, [lng, lat]]);
    } else {
      setEditorLat(lat);
      setEditorLng(lng);
    }
  }, [isEditingOnMap, editorShape, plotMode]);

  // Undo last polygon point
  const handleUndoPolygonPoint = () => {
    setPolygonVertices((prev) => prev.slice(0, -1));
  };

  // Clear all polygon points
  const handleClearPolygon = () => {
    setPolygonVertices([]);
  };

  // Update preview circle/polygon when editing parameters change
  useEffect(() => {
    if (isEditingOnMap) {
      updateDraftGeometry(
        editorShape,
        editorShape === 'CIRCLE' ? { lat: editorLat, lng: editorLng, radius: editorRadius } : null,
        polygonVertices
      );

      const mbgl = (window as any)?.mapboxgl;
      if (mbgl && mapRef.current) {
        // 1. Circle Mode: Draggable Center Pin
        if (editorShape === 'CIRCLE') {
          // Remove polygon markers
          polygonVertexMarkersRef.current.forEach(m => { try { m.remove(); } catch {} });
          polygonVertexMarkersRef.current = [];

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
        } else {
          // 2. Polygon Mode: Vertex Markers
          if (editMarkerRef.current) {
            try { editMarkerRef.current.remove(); } catch {}
            editMarkerRef.current = null;
          }

          // Refresh polygon vertex dots
          polygonVertexMarkersRef.current.forEach(m => { try { m.remove(); } catch {} });
          polygonVertexMarkersRef.current = [];

          polygonVertices.forEach(([lng, lat], idx) => {
            const el = document.createElement('div');
            el.className = 'cursor-pointer transform hover:scale-125 transition-transform';
            el.innerHTML = `
              <div style="background: #f59e0b; color: #0f172a; border: 2px solid white; width: 22px; height: 22px; border-radius: 9999px; font-size: 10px; font-weight: bold; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.5);">
                ${idx + 1}
              </div>
            `;
            const mk = new mbgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([lng, lat])
              .addTo(mapRef.current);
            polygonVertexMarkersRef.current.push(mk);
          });
        }
      }
    } else {
      if (editMarkerRef.current) {
        try { editMarkerRef.current.remove(); } catch {}
        editMarkerRef.current = null;
      }
      polygonVertexMarkersRef.current.forEach(m => { try { m.remove(); } catch {} });
      polygonVertexMarkersRef.current = [];
      updateDraftGeometry('CIRCLE', null, []);
    }
  }, [isEditingOnMap, editorShape, editorLat, editorLng, editorRadius, polygonVertices, updateDraftGeometry]);


  // Effect to smoothly fly to focusLocation when requested (e.g. from Terminal or Consignee Edit/Plot)
  useEffect(() => {
    if (!mapRef.current || !focusLocation) return;
    const { lat, lng, zoom } = focusLocation;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      try {
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: zoom || 14,
          essential: true,
        });
      } catch (e) {
        console.warn('flyTo focus location failed:', e);
      }
    }
  }, [focusLocation]);

  // Effect for interactive Plot on Map mode
  useEffect(() => {
    if (!mapRef.current) return;
    const mbgl = (window as any)?.mapboxgl;
    if (!mbgl) return;

    if (plotMode?.active) {
      const lat = plotMode.lat || 25.0112;
      const lng = plotMode.lng || 55.0612;

      try {
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: 14.5,
          essential: true,
        });
      } catch {}

      if (!plotMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'flex flex-col items-center cursor-move';
        el.innerHTML = `
          <div style="background: #10b981; color: white; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: bold; box-shadow: 0 4px 14px rgba(0,0,0,0.5); border: 2px solid white; display: flex; align-items: center; gap: 4px;">
            <span>🎯</span>
            <span>Plot: ${plotMode.title || 'Location'} (Drag to set)</span>
          </div>
          <div style="width: 2px; height: 14px; background: #10b981;"></div>
        `;
        const mk = new mbgl.Marker({ element: el, draggable: true })
          .setLngLat([lng, lat])
          .addTo(mapRef.current);

        mk.on('dragend', () => {
          try {
            const ll = mk.getLngLat();
            plotMode.onPlotSelect(ll.lat, ll.lng);
          } catch {}
        });
        plotMarkerRef.current = mk;
      } else {
        plotMarkerRef.current.setLngLat([lng, lat]);
      }
    } else {
      if (plotMarkerRef.current) {
        try { plotMarkerRef.current.remove(); } catch {}
        plotMarkerRef.current = null;
      }
    }
  }, [plotMode]);

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

              // Click listener for geofence drawing
              map.on('click', (e: any) => {
                handleMapClick(e);
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
      markersRef.current.forEach((m) => { try { m.remove(); } catch {} });
      markersRef.current = [];
      if (editMarkerRef.current) {
        try { editMarkerRef.current.remove(); } catch {}
        editMarkerRef.current = null;
      }
      polygonVertexMarkersRef.current.forEach((m) => { try { m.remove(); } catch {} });
      polygonVertexMarkersRef.current = [];
      warehouseMarkersRef.current.forEach((m) => { try { m.remove(); } catch {} });
      warehouseMarkersRef.current = [];
      if (plotMarkerRef.current) {
        try { plotMarkerRef.current.remove(); } catch {}
        plotMarkerRef.current = null;
      }
      try { mapRef.current?.remove(); } catch {}
      mapRef.current = null;
    };
  }, [handleMapClick]);

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
      markersRef.current.forEach((m) => { try { m.remove(); } catch {} });
      markersRef.current = [];

      const activeGfs = geofences.filter((g) => g.id !== editorId);
      const features: any[] = [];

      activeGfs.forEach((gf) => {
        let ring: Array<[number, number]> = [];

        if (gf.type === 'POLYGON' && gf.coordinatesJson) {
          const parsed = parsePolygonCoordinates(gf.coordinatesJson);
          if (parsed.length >= 3) {
            ring = [...parsed, parsed[0]]; // Close ring
          }
        }

        // Fallback to circle if not polygon or coordinates empty
        if (ring.length === 0) {
          ring = circleRing(gf.centerLat, gf.centerLng, gf.radiusMeters || 1500);
        }

        const color = gf.type === 'POLYGON' ? '#8b5cf6' : gf.terminalId ? '#10b981' : '#3b82f6';

        if (ring.length > 0) {
          features.push({
            type: 'Feature' as const,
            geometry: {
              type: 'Polygon' as const,
              coordinates: [ring],
            },
            properties: {
              id: gf.id,
              name: gf.name,
              terminalName: gf.terminalName,
              type: gf.type,
              radiusMeters: gf.radiusMeters,
              color,
            },
          });
        }
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


      // Add Warehouse & Consignee Markers
      warehouseMarkersRef.current.forEach((m) => { try { m.remove(); } catch {} });
      warehouseMarkersRef.current = [];

      warehouses.forEach((wh) => {
        if (!wh.lat || !wh.lng || !Number.isFinite(wh.lat) || !Number.isFinite(wh.lng)) return;
        const el = document.createElement('div');
        el.className = 'cursor-pointer transform hover:scale-110 transition-transform';
        el.innerHTML = `
          <div style="background: #065f46; color: white; border: 1.5px solid #34d399; border-radius: 10px; padding: 3px 6px; font-size: 9px; font-weight: bold; display: flex; align-items: center; gap: 3px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);">
            <span>🏢</span>
            <span style="max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${wh.name}</span>
          </div>
        `;

        el.addEventListener('click', () => {
          onSelectWarehouse?.(wh);
          try {
            map.flyTo({ center: [wh.lng!, wh.lat!], zoom: 14 });
          } catch {}
        });

        const popup = new mbgl.Popup({ offset: 15, closeButton: false }).setHTML(`
          <div style="padding: 6px; font-size: 12px; color: #0f172a;">
            <strong style="display:block; font-size: 13px;">${wh.name}</strong>
            <span style="color: #64748b; font-size: 11px;">${wh.zone} · ${wh.customerName || 'Consignee Facility'}</span>
            <div style="margin-top: 4px; font-size: 11px; font-weight: 600; color: #059669;">
              ${wh.address || 'Consignee Ramp Location'}
            </div>
          </div>
        `);

        const marker = new mbgl.Marker({ element: el })
          .setLngLat([wh.lng, wh.lat])
          .setPopup(popup)
          .addTo(map);

        warehouseMarkersRef.current.push(marker);
      });

      // Add Geofence Center Markers
      activeGfs.forEach((gf) => {
        if (!Number.isFinite(gf.centerLat) || !Number.isFinite(gf.centerLng)) return;
        const isPoly = gf.type === 'POLYGON';
        const el = document.createElement('div');
        el.className = 'cursor-pointer transform hover:scale-110 transition-transform';
        el.innerHTML = `
          <div style="background: ${isPoly ? 'rgba(139, 92, 246, 0.95)' : 'rgba(16, 185, 129, 0.95)'}; color: white; border: 1.5px solid white; border-radius: 9999px; padding: 2px 7px; font-size: 9px; font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 3px;">
            <span>${isPoly ? '⬡' : '🎯'}</span>
            <span>${gf.name.slice(0, 18)}${gf.name.length > 18 ? '...' : ''}</span>
          </div>
        `;

        const popup = new mbgl.Popup({ offset: 15 }).setHTML(`
          <div style="padding: 8px; font-size: 12px; color: #0f172a; min-width: 190px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <strong style="font-size: 13px; color: #0f172a;">${gf.name}</strong>
              <span style="font-size: 10px; font-weight: bold; padding: 1px 5px; border-radius: 4px; background: ${isPoly ? '#ede9fe; color: #6d28d9' : '#dcfce7; color: #15803d'}">${isPoly ? 'POLYGON' : 'CIRCLE'}</span>
            </div>
            <span style="color: #64748b; font-size: 11px; display: block; margin-top: 3px;">Link: ${gf.terminalName}</span>
            <div style="margin-top: 4px; font-size: 11px; font-weight: bold; color: ${isPoly ? '#7c3aed' : '#059669'};">
              ${isPoly ? 'Custom Multi-point Ramp Boundary' : `Radius: ${gf.radiusMeters}m`}
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
  }, [terminals, geofences, warehouses, selectedTerminalId, isEditingOnMap, editorId, mapLoaded, onSelectTerminal, onSelectWarehouse, startEditingGeofence]);

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


      {/* Top Banner when Plot on Map is Active */}
      {plotMode?.active && (
        <div className="absolute top-14 left-3 right-3 z-30 bg-emerald-950/95 backdrop-blur-md border border-emerald-500/60 rounded-xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-3 text-white animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold text-emerald-300">
              📍 Plot on Map Active: {plotMode.title}
            </span>
            <span className="text-[11px] text-emerald-100/90 font-mono">
              ({plotMode.lat.toFixed(5)}, {plotMode.lng.toFixed(5)})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-emerald-300 hidden md:inline">
              Click anywhere on map or drag pin to set coordinates
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

      {/* Main Map or Interactive SVG Radar Fallback */}
      {!mapError ? (
        <div ref={containerRef} className="w-full h-[450px] bg-slate-950" />
      ) : (
        /* Bulletproof Interactive SVG Radar Fallback */
        <div className="w-full h-[450px] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 relative flex items-center justify-center p-6 select-none overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <div className="w-64 h-64 border border-blue-500/40 rounded-full animate-ping" style={{ animationDuration: '4s' }} />
            <div className="absolute w-[500px] h-[500px] border border-cyan-500/20 rounded-full" />
            <div className="absolute w-[350px] h-[350px] border border-cyan-500/30 rounded-full" />
            <div className="absolute w-[200px] h-[200px] border border-cyan-500/40 rounded-full" />
            <div className="absolute inset-x-0 top-1/2 border-t border-cyan-500/20" />
            <div className="absolute inset-y-0 left-1/2 border-l border-cyan-500/20" />
          </div>

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
            {/* Header info & Shape Switcher */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                  {editorId ? 'Editing Geofence' : 'Creating Geofence'}
                </span>

                {/* Shape Selector: Circle vs Polygon */}
                <div className="flex bg-[var(--bg-main)] p-0.5 rounded-lg border border-[var(--border-subtle)] text-[11px]">
                  <button
                    type="button"
                    onClick={() => setEditorShape('CIRCLE')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      editorShape === 'CIRCLE'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    <Circle className="w-3.5 h-3.5" />
                    <span>Circular Perimeter</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorShape('POLYGON')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      editorShape === 'POLYGON'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    <Pentagon className="w-3.5 h-3.5" />
                    <span>Polygon Ramp Zone</span>
                  </button>
                </div>

                <span className="text-[11px] text-[var(--text-muted)]">
                  {editorShape === 'CIRCLE'
                    ? 'Click on map or drag center pin'
                    : 'Click on map to place perimeter vertices'}
                </span>
              </div>

              {/* Name and Port Link Inputs */}
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

            {/* Shape-Specific Controls */}
            <div className="flex flex-wrap items-center gap-4">
              {editorShape === 'CIRCLE' ? (
                /* Circle: Radius Slider & Lat/Lng */
                <div className="flex items-center gap-4">
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
                      className="w-40 accent-amber-500 cursor-pointer"
                    />
                  </div>

                  <div className="hidden sm:block text-[11px] text-[var(--text-muted)] font-mono bg-[var(--bg-main)] px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)]">
                    <div>Lat: {editorLat.toFixed(5)}</div>
                    <div>Lng: {editorLng.toFixed(5)}</div>
                  </div>
                </div>
              ) : (
                /* Polygon: Vertex Points Counter & Actions */
                <div className="flex items-center gap-3">
                  <div className="bg-[var(--bg-main)] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11px]">
                    <div className="text-[var(--text-muted)]">Polygon Vertices</div>
                    <div className="font-mono font-bold text-amber-400">
                      {polygonVertices.length} {polygonVertices.length === 1 ? 'Point' : 'Points'}{' '}
                      {polygonVertices.length < 3 && (
                        <span className="text-[10px] text-rose-400 font-normal">(Min 3 needed)</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={polygonVertices.length === 0}
                    onClick={handleUndoPolygonPoint}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40 transition-colors"
                    title="Undo last placed vertex"
                  >
                    <Undo className="w-3.5 h-3.5" />
                    <span>Undo</span>
                  </button>

                  <button
                    type="button"
                    disabled={polygonVertices.length === 0}
                    onClick={handleClearPolygon}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] text-xs font-medium text-[var(--text-muted)] hover:text-rose-400 disabled:opacity-40 transition-colors"
                    title="Clear all points"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>
              )}

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
                  disabled={isSaving || !editorName.trim() || (editorShape === 'POLYGON' && polygonVertices.length < 3)}
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
