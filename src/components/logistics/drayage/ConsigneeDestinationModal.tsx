'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Warehouse,
  Building2,
  Navigation,
  Compass,
  Plus,
  X,
  ShieldCheck,
  DollarSign,
  User,
  Phone,
  Check,
  RefreshCw,
  Map,
  Globe,
  Layers,
  Mountain,
  Info,
  Edit3,
  Undo2,
  RotateCcw,
  MousePointerClick,
  Hexagon,
  Search,
} from 'lucide-react';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
  type GMapsCircle,
  type GMapsPolygon,
  type GMapsPolyline,
  type GMapsAutocomplete,
  type GMapsGeocoder,
  type GMapsLatLng,
  type GoogleCtors,
} from '@/lib/google-maps-loader';

export interface DrayageClientOption {
  id: string;
  name: string;
  code: string;
  contactPerson?: string | null;
  contactNo?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  trn?: string | null;
  tradeLicense?: string | null;
  defaultTripAmountAed?: number;
  defaultDriverAllowanceAed?: number;
}

export interface DrayageWarehouseData {
  id?: string;
  customerId: string | null;
  customerName: string;
  name: string;
  code?: string | null;
  zone: string;
  address?: string;
  lat?: number;
  lng?: number;
  rampsCount?: number;
  contactPerson?: string | null;
  contactPhone?: string | null;
  geofenceConfigured?: boolean;
  geofenceType?: 'CIRCLE' | 'POLYGON';
  geofenceRadiusMeters?: number;
  geofenceCoordinatesJson?: string;
  tripAmountAed?: number | null;
  driverAllowanceAed?: number | null;
}

interface ConsigneeDestinationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (savedWarehouse: DrayageWarehouseData) => void;
  initialData?: DrayageWarehouseData | null;
  clients: DrayageClientOption[];
  onClientCreated?: (newClient: DrayageClientOption) => void;
  defaultClientId?: string | null;
}

const DEFAULT_INDUSTRIAL_ZONES = [
  'JAFZA South',
  'JAFZA North',
  'NIP / TechnoPark',
  'Dubai South (DWC) Logistics District',
  'Dubai Industrial City (DIC)',
  'Al Quoz Industrial Area',
  'Ras Al Khor Industrial',
  'KIZAD / KEZAD, Abu Dhabi',
  'Hamriyah Free Zone, Sharjah',
];

/**
 * Perform reverse geocoding via Google Maps Geocoder with OpenStreetMap Nominatim fallback.
 */
async function reverseGeocodeCoords(lat: number, lng: number): Promise<string | null> {
  // 1. Google Maps JS API Geocoder
  try {
    const ctors = await loadGoogleMaps();
    const geocoder = new ctors.Geocoder();
    const gResult = await new Promise<string | null>((resolve) => {
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results && results.length > 0 && results[0]?.formatted_address) {
          resolve(results[0].formatted_address);
        } else {
          resolve(null);
        }
      });
    });
    if (gResult) return gResult;
  } catch (err) {
    console.warn('Google reverse geocoder failed or not available:', err);
  }

  // 2. OpenStreetMap Nominatim fallback
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.display_name) return data.display_name;
    }
  } catch (err) {
    console.warn('Nominatim reverse geocoder failed:', err);
  }

  return null;
}

export function ConsigneeDestinationModal({
  isOpen,
  onClose,
  onSaved,
  initialData,
  clients,
  onClientCreated,
  defaultClientId,
}: ConsigneeDestinationModalProps) {
  // Main form state
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [zone, setZone] = useState('JAFZA South');
  const [rampsCount, setRampsCount] = useState(4);
  const [lat, setLat] = useState(24.9642);
  const [lng, setLng] = useState(55.0915);
  const [address, setAddress] = useState('');
  const [driverAllowanceAed, setDriverAllowanceAed] = useState(150);
  const [tripAmountAed, setTripAmountAed] = useState(1550);
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [geofenceConfigured, setGeofenceConfigured] = useState(false);
  const [geofenceType, setGeofenceType] = useState<'CIRCLE' | 'POLYGON'>('CIRCLE');
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(800);
  const [geofenceCoordinatesJson, setGeofenceCoordinatesJson] = useState('[]');
  const [submitting, setSubmitting] = useState(false);
  const [reverseGeocoding, setReverseGeocoding] = useState(false);

  // Quick Add Client modal state
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [newCliName, setNewCliName] = useState('');
  const [newCliCode, setNewCliCode] = useState('');
  const [newCliContact, setNewCliContact] = useState('');
  const [newCliPhone, setNewCliPhone] = useState('');
  const [newCliAddress, setNewCliAddress] = useState('');
  const [newCliCity, setNewCliCity] = useState('Dubai');
  const [newCliTrn, setNewCliTrn] = useState('');
  const [newCliTradeLicense, setNewCliTradeLicense] = useState('');
  const [submittingCli, setSubmittingCli] = useState(false);

  // Plot on Map modal state
  const [showPlotModal, setShowPlotModal] = useState(false);
  const [plotCoordinates, setPlotCoordinates] = useState({ lat: 24.9642, lng: 55.0915 });
  const [plotRadius, setPlotRadius] = useState(800);
  const [plotType, setPlotType] = useState<'CIRCLE' | 'POLYGON'>('CIRCLE');
  const [plotPolygonCoords, setPlotPolygonCoords] = useState<Array<{ lat: number; lng: number }>>([]);
  const [plotMapTypeId, setPlotMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');

  // Interactive Polygon Click-to-Draw state
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [drawingVertices, setDrawingVertices] = useState<Array<{ lat: number; lng: number }>>([]);

  // Google Maps Search in Map state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<GMapsAutocomplete | null>(null);
  const geocoderRef = useRef<GMapsGeocoder | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<GMapsMap | null>(null);
  const markerRef = useRef<GMapsMarker | null>(null);
  const circleRef = useRef<GMapsCircle | null>(null);
  const polygonRef = useRef<GMapsPolygon | null>(null);
  const ctorsRef = useRef<GoogleCtors | null>(null);

  // Drawing refs for real-time map event handlers
  const isDrawingPolygonRef = useRef(false);
  isDrawingPolygonRef.current = isDrawingPolygon;
  const drawingVerticesRef = useRef<Array<{ lat: number; lng: number }>>([]);
  const drawingMarkersRef = useRef<GMapsMarker[]>([]);
  const drawingPolylineRef = useRef<GMapsPolyline | null>(null);

  // Synchronized state refs for map events
  const plotCoordinatesRef = useRef(plotCoordinates);
  plotCoordinatesRef.current = plotCoordinates;
  const plotRadiusRef = useRef(plotRadius);
  plotRadiusRef.current = plotRadius;
  const plotTypeRef = useRef(plotType);
  plotTypeRef.current = plotType;
  const plotPolygonCoordsRef = useRef(plotPolygonCoords);
  plotPolygonCoordsRef.current = plotPolygonCoords;

  // Geometry helper: Distance between two points in km (Haversine formula)
  const getPointsDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Geometry helper: Generate a 4-corner bounding box centered on a point
  const generateCenteredPolygon = (center: { lat: number; lng: number }, radiusMeters: number = 250) => {
    const dLat = radiusMeters / 111320;
    const cosLat = Math.cos((center.lat * Math.PI) / 180);
    const dLng = radiusMeters / (111320 * (cosLat === 0 ? 1 : Math.abs(cosLat)));
    return [
      { lat: Number((center.lat + dLat).toFixed(6)), lng: Number((center.lng - dLng).toFixed(6)) }, // NW
      { lat: Number((center.lat + dLat).toFixed(6)), lng: Number((center.lng + dLng).toFixed(6)) }, // NE
      { lat: Number((center.lat - dLat).toFixed(6)), lng: Number((center.lng + dLng).toFixed(6)) }, // SE
      { lat: Number((center.lat - dLat).toFixed(6)), lng: Number((center.lng - dLng).toFixed(6)) }, // SW
    ];
  };

  // Geometry helper: Calculate center centroid of a polygon
  const getPolygonCentroid = (coords: Array<{ lat: number; lng: number }>) => {
    if (!coords || !coords.length) return { lat: 24.9642, lng: 55.0915 };
    const sumLat = coords.reduce((acc, p) => acc + p.lat, 0);
    const sumLng = coords.reduce((acc, p) => acc + p.lng, 0);
    return {
      lat: Number((sumLat / coords.length).toFixed(6)),
      lng: Number((sumLng / coords.length).toFixed(6)),
    };
  };

  // Lock body scroll when modal or plot on map is open to prevent duplicate background scrollbars
  useEffect(() => {
    if (isOpen || showPlotModal) {
      const origOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = origOverflow;
      };
    }
  }, [isOpen, showPlotModal]);

  // Populate initial values when opening modal
  useEffect(() => {
    if (!isOpen) return;

    if (initialData) {
      setName(initialData.name || '');
      setCode(initialData.code || '');
      setCustomerId(initialData.customerId || '');
      setCustomerName(initialData.customerName || '');
      setZone(initialData.zone || 'JAFZA South');
      setRampsCount(initialData.rampsCount || 4);
      setLat(initialData.lat ?? 24.9642);
      setLng(initialData.lng ?? 55.0915);
      setAddress(initialData.address || '');
      setDriverAllowanceAed(initialData.driverAllowanceAed ?? 150);
      setTripAmountAed(initialData.tripAmountAed ?? 1550);
      setContactPerson(initialData.contactPerson || '');
      setContactPhone(initialData.contactPhone || '');
      setGeofenceConfigured(Boolean(initialData.geofenceConfigured));
      setGeofenceType(initialData.geofenceType || 'CIRCLE');
      setGeofenceRadiusMeters(initialData.geofenceRadiusMeters ?? 800);
      setGeofenceCoordinatesJson(initialData.geofenceCoordinatesJson || '[]');
    } else {
      const selectedClient = clients.find((c) => c.id === defaultClientId) || clients[0];
      const initialCid = selectedClient?.id || '';
      const initialCName = selectedClient?.name || '';
      setName(initialCName ? `${initialCName} - Facility / Ramp` : '');
      setCode('');
      setCustomerId(initialCid);
      setCustomerName(initialCName);
      setZone('JAFZA South');
      setRampsCount(4);
      setLat(24.9642);
      setLng(55.0915);
      setAddress(selectedClient?.streetAddress || '');
      setDriverAllowanceAed(150);
      setTripAmountAed(1550);
      setContactPerson(selectedClient?.contactPerson || '');
      setContactPhone(selectedClient?.contactNo || '');
      setGeofenceConfigured(false);
      setGeofenceType('CIRCLE');
      setGeofenceRadiusMeters(800);
      setGeofenceCoordinatesJson('[]');
    }
  }, [isOpen, initialData, clients, defaultClientId]);

  // Handle client selection change
  const handleClientChange = (cId: string) => {
    setCustomerId(cId);
    const client = clients.find((c) => c.id === cId);
    if (client) {
      setCustomerName(client.name);
      if (!name || name.includes('- Facility / Ramp')) {
        setName(`${client.name} - Facility / Ramp`);
      }
      if (!address && client.streetAddress) {
        setAddress(client.streetAddress);
      }
      if (!contactPerson && client.contactPerson) {
        setContactPerson(client.contactPerson);
      }
      if (!contactPhone && client.contactNo) {
        setContactPhone(client.contactNo);
      }
    } else {
      setCustomerName('');
    }
  };

  // Open the interactive Plot on Map modal
  const handleOpenPlotOnMap = () => {
    const center = { lat, lng };
    setPlotCoordinates(center);
    plotCoordinatesRef.current = center;
    setPlotRadius(geofenceRadiusMeters || 800);
    plotRadiusRef.current = geofenceRadiusMeters || 800;
    setPlotType(geofenceType || 'CIRCLE');
    plotTypeRef.current = geofenceType || 'CIRCLE';

    let initialPoly: Array<{ lat: number; lng: number }> = [];
    try {
      const parsed = JSON.parse(geofenceCoordinatesJson);
      if (Array.isArray(parsed) && parsed.length >= 3) {
        initialPoly = parsed;
      }
    } catch {
      // ignore
    }

    let needNewBox = false;
    if (initialPoly.length < 3) {
      needNewBox = true;
    } else {
      const centroid = getPolygonCentroid(initialPoly);
      const dist = getPointsDistanceKm(centroid.lat, centroid.lng, center.lat, center.lng);
      if (dist > 1.2) {
        needNewBox = true;
      }
    }

    if (needNewBox) {
      initialPoly = generateCenteredPolygon(center, Math.max(250, Math.min(geofenceRadiusMeters || 800, 600)));
    }

    setPlotPolygonCoords(initialPoly);
    plotPolygonCoordsRef.current = initialPoly;
    setShowPlotModal(true);
  };

  // Cleanup interactive drawing mode markers and polyline
  const cleanupDrawingMode = () => {
    drawingMarkersRef.current.forEach((m) => m.setMap(null));
    drawingMarkersRef.current = [];
    if (drawingPolylineRef.current) {
      drawingPolylineRef.current.setMap(null);
      drawingPolylineRef.current = null;
    }
    drawingVerticesRef.current = [];
    setDrawingVertices([]);
    setIsDrawingPolygon(false);
    isDrawingPolygonRef.current = false;
  };

  // Render Circle overlay with editable handles
  const renderCircleOverlay = (center: { lat: number; lng: number }, radius: number) => {
    const map = mapInstanceRef.current;
    const ctors = ctorsRef.current;
    if (!map || !ctors) return;

    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }

    if (circleRef.current) {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radius);
      circleRef.current.setMap(map);
    } else {
      const circle = new ctors.Circle({
        center,
        radius,
        map,
        fillColor: '#059669',
        fillOpacity: 0.22,
        strokeColor: '#10b981',
        strokeOpacity: 0.9,
        strokeWeight: 2.5,
        editable: true,
        draggable: true,
        zIndex: 50,
      });

      circle.addListener('radius_changed', () => {
        const r = Math.round(circle.getRadius());
        setPlotRadius(r);
        plotRadiusRef.current = r;
      });

      circle.addListener('center_changed', () => {
        const c = circle.getCenter();
        if (c) {
          const newPos = {
            lat: Number(c.lat().toFixed(6)),
            lng: Number(c.lng().toFixed(6)),
          };
          setPlotCoordinates(newPos);
          plotCoordinatesRef.current = newPos;
          if (markerRef.current) markerRef.current.setPosition(newPos);
        }
      });

      circleRef.current = circle;
    }
  };

  // Render Polygon overlay with editable handles and vertex listeners
  const renderPolygonOverlay = (coords: Array<{ lat: number; lng: number }>) => {
    const map = mapInstanceRef.current;
    const ctors = ctorsRef.current;
    if (!map || !ctors) return;

    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }

    if (polygonRef.current) {
      polygonRef.current.setPath(coords);
      polygonRef.current.setMap(map);
    } else {
      const polygon = new ctors.Polygon({
        paths: coords,
        map,
        fillColor: '#9333ea',
        fillOpacity: 0.25,
        strokeColor: '#c084fc',
        strokeOpacity: 0.95,
        strokeWeight: 2.5,
        editable: true,
        draggable: true,
        zIndex: 50,
      });

      const updatePolyPath = () => {
        const path = polygon.getPath();
        const updated: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < path.getLength(); i++) {
          const pt = path.getAt(i);
          updated.push({
            lat: Number(pt.lat().toFixed(6)),
            lng: Number(pt.lng().toFixed(6)),
          });
        }
        setPlotPolygonCoords(updated);
        plotPolygonCoordsRef.current = updated;

        // Keep center pin at polygon centroid
        const centroid = getPolygonCentroid(updated);
        setPlotCoordinates(centroid);
        plotCoordinatesRef.current = centroid;
        if (markerRef.current) {
          markerRef.current.setPosition(centroid);
        }
      };

      polygon.getPath().addListener('set_at', updatePolyPath);
      polygon.getPath().addListener('insert_at', updatePolyPath);
      polygon.getPath().addListener('remove_at', updatePolyPath);

      polygonRef.current = polygon;
    }
  };

  // Mode Switch Handlers
  const handleSelectCircle = () => {
    cleanupDrawingMode();
    setPlotType('CIRCLE');
    plotTypeRef.current = 'CIRCLE';
    renderCircleOverlay(plotCoordinatesRef.current, plotRadiusRef.current);
  };

  const handleSelectPolygon = () => {
    cleanupDrawingMode();
    setPlotType('POLYGON');
    plotTypeRef.current = 'POLYGON';

    let coords = plotPolygonCoordsRef.current;
    const center = plotCoordinatesRef.current;
    let needNewBox = false;

    if (!coords || coords.length < 3) {
      needNewBox = true;
    } else {
      const centroid = getPolygonCentroid(coords);
      const dist = getPointsDistanceKm(centroid.lat, centroid.lng, center.lat, center.lng);
      if (dist > 1.2) {
        needNewBox = true;
      }
    }

    if (needNewBox) {
      coords = generateCenteredPolygon(center, Math.max(250, Math.min(plotRadiusRef.current, 600)));
      setPlotPolygonCoords(coords);
      plotPolygonCoordsRef.current = coords;
    }

    renderPolygonOverlay(coords);
  };

  // Reset to 4-corner box centered on current marker
  const handleResetPolygonToCenterBox = () => {
    cleanupDrawingMode();
    const center = plotCoordinatesRef.current;
    const newBox = generateCenteredPolygon(center, Math.max(250, Math.min(plotRadiusRef.current, 600)));
    setPlotPolygonCoords(newBox);
    plotPolygonCoordsRef.current = newBox;
    renderPolygonOverlay(newBox);
  };

  // Interactive Click-to-Draw Polygon mode
  const startDrawingPolygon = () => {
    cleanupDrawingMode();
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    setIsDrawingPolygon(true);
    isDrawingPolygonRef.current = true;
    setDrawingVertices([]);
    drawingVerticesRef.current = [];
  };

  const handleMapClickWhileDrawing = (newPt: { lat: number; lng: number }) => {
    const map = mapInstanceRef.current;
    const ctors = ctorsRef.current;
    if (!map || !ctors) return;

    const updated = [...drawingVerticesRef.current, newPt];
    drawingVerticesRef.current = updated;
    setDrawingVertices(updated);

    const pin = new ctors.Marker({
      position: newPt,
      map,
      title: `Vertex #${updated.length}`,
      icon: {
        path: ctors.SymbolPath.CIRCLE,
        scale: 5,
        fillColor: '#c084fc',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
    });
    drawingMarkersRef.current.push(pin);

    // If clicking first point with >= 3 points, auto-close
    if (updated.length === 1) {
      pin.addListener('click', () => {
        if (drawingVerticesRef.current.length >= 3) {
          finishDrawingPolygon();
        }
      });
    }

    if (!drawingPolylineRef.current) {
      drawingPolylineRef.current = new ctors.Polyline({
        path: updated,
        map,
        strokeColor: '#c084fc',
        strokeOpacity: 0.95,
        strokeWeight: 2.5,
      });
    } else {
      drawingPolylineRef.current.setPath(updated);
    }
  };

  const handleUndoDrawingPoint = () => {
    if (drawingVerticesRef.current.length === 0) return;
    const updated = [...drawingVerticesRef.current];
    updated.pop();
    drawingVerticesRef.current = updated;
    setDrawingVertices(updated);

    const lastMarker = drawingMarkersRef.current.pop();
    if (lastMarker) lastMarker.setMap(null);

    if (drawingPolylineRef.current) {
      drawingPolylineRef.current.setPath(updated);
    }
  };

  const finishDrawingPolygon = () => {
    const pts = drawingVerticesRef.current;
    if (pts.length < 3) return;

    const centroid = getPolygonCentroid(pts);
    setPlotCoordinates(centroid);
    plotCoordinatesRef.current = centroid;
    if (markerRef.current) markerRef.current.setPosition(centroid);

    setPlotPolygonCoords(pts);
    plotPolygonCoordsRef.current = pts;

    cleanupDrawingMode();
    renderPolygonOverlay(pts);
  };

  // Apply a search result or coordinate jump from Google Maps search
  const handleApplySearchResult = (newLat: number, newLng: number, label?: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const newPos = { lat: newLat, lng: newLng };
    setPlotCoordinates(newPos);
    plotCoordinatesRef.current = newPos;

    if (markerRef.current) {
      markerRef.current.setPosition(newPos);
    }

    map.panTo(newPos);
    map.setZoom(16);

    if (label) {
      setSearchQuery(label);
      if (!address) {
        setAddress(label);
      }
    }

    if (plotTypeRef.current === 'CIRCLE') {
      if (circleRef.current) {
        circleRef.current.setCenter(newPos);
      } else {
        renderCircleOverlay(newPos, plotRadiusRef.current);
      }
    } else if (plotTypeRef.current === 'POLYGON') {
      // Re-center a clean 4-corner box right on this searched location
      const newBox = generateCenteredPolygon(newPos, Math.max(250, Math.min(plotRadiusRef.current, 600)));
      setPlotPolygonCoords(newBox);
      plotPolygonCoordsRef.current = newBox;
      renderPolygonOverlay(newBox);
    }
  };

  // Search submit (Enter key or 🔍 button click)
  const handleSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    // 1. Check if user entered coordinates (e.g., "24.6780, 54.9643")
    const coordMatch = query.match(/^\s*(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)\s*$/);
    if (coordMatch) {
      const parsedLat = parseFloat(coordMatch[1]);
      const parsedLng = parseFloat(coordMatch[3]);
      if (!isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat >= -90 && parsedLat <= 90 && parsedLng >= -180 && parsedLng <= 180) {
        handleApplySearchResult(
          Number(parsedLat.toFixed(6)),
          Number(parsedLng.toFixed(6)),
          `${parsedLat.toFixed(5)}, ${parsedLng.toFixed(5)}`
        );
        return;
      }
    }

    // 2. Geocode address or facility name via Google Geocoder
    setSearchLoading(true);
    try {
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ address: query }, async (results, status) => {
          if (status === 'OK' && results && results[0]?.geometry?.location) {
            const loc = results[0].geometry.location;
            const newLat = Number(loc.lat().toFixed(6));
            const newLng = Number(loc.lng().toFixed(6));
            handleApplySearchResult(newLat, newLng, results[0].formatted_address || query);
            setSearchLoading(false);
          } else {
            // 3. Fallback to OpenStreetMap Nominatim if Google Geocoder doesn't return
            try {
              const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, {
                headers: { Accept: 'application/json' },
              });
              if (res.ok) {
                const data = await res.json();
                if (data && data[0]) {
                  const newLat = Number(parseFloat(data[0].lat).toFixed(6));
                  const newLng = Number(parseFloat(data[0].lon).toFixed(6));
                  handleApplySearchResult(newLat, newLng, data[0].display_name || query);
                }
              }
            } catch (nomErr) {
              console.warn('Nominatim fallback search error:', nomErr);
            } finally {
              setSearchLoading(false);
            }
          }
        });
      } else {
        setSearchLoading(false);
      }
    } catch (err) {
      console.warn('Geocoding search error:', err);
      setSearchLoading(false);
    }
  };

  // Fly / Re-center on Pin
  const handleFlyToPin = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.panTo(plotCoordinatesRef.current);
    map.setZoom(16);
  };

  // Google Maps setup in Plot Modal
  useEffect(() => {
    if (!showPlotModal || !mapContainerRef.current) return;
    let isMounted = true;

    async function initPlotMap() {
      try {
        const ctors = await loadGoogleMaps();
        if (!isMounted || !mapContainerRef.current) return;
        ctorsRef.current = ctors;

        const center = plotCoordinatesRef.current;

        if (!mapInstanceRef.current) {
          const map = new ctors.Map(mapContainerRef.current, {
            center,
            zoom: 16,
            mapTypeId: plotMapTypeId,
            fullscreenControl: false,
            streetViewControl: false,
            mapTypeControl: false, // We use custom top buttons for clean UI
          });
          mapInstanceRef.current = map;

          map.addListener('click', (e) => {
            if (!e.latLng) return;
            const newPt = {
              lat: Number(e.latLng.lat().toFixed(6)),
              lng: Number(e.latLng.lng().toFixed(6)),
            };

            // If user is currently in interactive Click-to-Draw Polygon mode
            if (isDrawingPolygonRef.current) {
              handleMapClickWhileDrawing(newPt);
              return;
            }

            // Normal mode: relocate center marker & circle
            setPlotCoordinates(newPt);
            plotCoordinatesRef.current = newPt;
            if (markerRef.current) {
              markerRef.current.setPosition(newPt);
            }

            if (plotTypeRef.current === 'CIRCLE') {
              if (circleRef.current) {
                circleRef.current.setCenter(newPt);
              }
            }
          });
        } else {
          mapInstanceRef.current?.setCenter?.(center);
          mapInstanceRef.current?.setMapTypeId?.(plotMapTypeId);
        }

        const map = mapInstanceRef.current;

        // Geocoder instance
        geocoderRef.current = new ctors.Geocoder();

        // Initialize Google Places Autocomplete on the Search Input
        if (searchInputRef.current && !autocompleteRef.current) {
          const ac = new ctors.Autocomplete(searchInputRef.current, {
            fields: ['geometry', 'name', 'formatted_address'],
          });
          autocompleteRef.current = ac;
          ac.addListener('place_changed', () => {
            const place = ac.getPlace();
            const loc = place.geometry?.location;
            if (!loc) return;
            const newLat = Number(loc.lat().toFixed(6));
            const newLng = Number(loc.lng().toFixed(6));
            handleApplySearchResult(newLat, newLng, place.formatted_address || place.name || '');
          });
        }

        // Center Pin Marker
        if (markerRef.current) {
          markerRef.current.setPosition(center);
        } else {
          markerRef.current = new ctors.Marker({
            position: center,
            map,
            draggable: true,
            title: name || 'Ramp Location',
          });
          markerRef.current.addListener('dragend', (e?: unknown) => {
            const latLng = (e as { latLng?: GMapsLatLng } | undefined)?.latLng;
            if (!latLng) return;
            const newPt = {
              lat: Number(latLng.lat().toFixed(6)),
              lng: Number(latLng.lng().toFixed(6)),
            };
            setPlotCoordinates(newPt);
            plotCoordinatesRef.current = newPt;

            if (plotTypeRef.current === 'CIRCLE' && circleRef.current) {
              circleRef.current.setCenter(newPt);
            }
          });
        }

        // Render current shape
        if (plotTypeRef.current === 'POLYGON') {
          renderPolygonOverlay(plotPolygonCoordsRef.current);
        } else {
          renderCircleOverlay(plotCoordinatesRef.current, plotRadiusRef.current);
        }
      } catch (err) {
        console.warn('Error loading Google Maps in Plot Modal:', err);
      }
    }

    initPlotMap();

    return () => {
      isMounted = false;
    };
  }, [showPlotModal]);

  // Clean up overlays when plot modal closes
  useEffect(() => {
    if (!showPlotModal) {
      cleanupDrawingMode();
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
      if (polygonRef.current) {
        polygonRef.current.setMap(null);
        polygonRef.current = null;
      }
      mapInstanceRef.current = null;
      autocompleteRef.current = null;
      geocoderRef.current = null;
      setSearchQuery('');
    }
  }, [showPlotModal]);

  // Apply Plot on Map & Reverse Geocode exact street address
  const handleApplyPlotLocation = async () => {
    let finalLat = plotCoordinates.lat;
    let finalLng = plotCoordinates.lng;
    let finalRadius = plotRadius;

    if (plotType === 'POLYGON' && plotPolygonCoords.length >= 3) {
      const centroid = getPolygonCentroid(plotPolygonCoords);
      finalLat = centroid.lat;
      finalLng = centroid.lng;

      // Compute bounding radius in meters from centroid to furthest vertex
      let maxDistMeters = 0;
      for (const pt of plotPolygonCoords) {
        const dMeters = getPointsDistanceKm(centroid.lat, centroid.lng, pt.lat, pt.lng) * 1000;
        if (dMeters > maxDistMeters) maxDistMeters = dMeters;
      }
      finalRadius = Math.max(100, Math.round(maxDistMeters));

      setGeofenceCoordinatesJson(JSON.stringify(plotPolygonCoords));
    }

    setLat(finalLat);
    setLng(finalLng);
    setGeofenceRadiusMeters(finalRadius);
    setGeofenceType(plotType);
    setGeofenceConfigured(true); // Automatically enables Geofence Configured switch!

    setShowPlotModal(false);

    // Perform reverse geocoding to capture exact physical street address
    setReverseGeocoding(true);
    try {
      const resolvedAddress = await reverseGeocodeCoords(finalLat, finalLng);
      if (resolvedAddress) {
        setAddress(resolvedAddress);
      }
    } catch (err) {
      console.warn('Reverse geocoding error:', err);
    } finally {
      setReverseGeocoding(false);
    }
  };

  // Quick Client Creation Handler
  const handleCreateQuickClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCliName.trim()) return;

    const generatedCode =
      newCliCode.trim().toUpperCase() || newCliName.slice(0, 3).toUpperCase();
    try {
      setSubmittingCli(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_client',
          name: newCliName.trim(),
          code: generatedCode,
          contactPerson: newCliContact.trim() || undefined,
          contactNo: newCliPhone.trim() || undefined,
          streetAddress: newCliAddress.trim() || undefined,
          city: newCliCity.trim() || 'Dubai',
          trn: newCliTrn.trim() || undefined,
          tradeLicense: newCliTradeLicense.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create client');

      const createdClient: DrayageClientOption = data.client || {
        id: data.clientId || `client-${Date.now()}`,
        name: newCliName.trim(),
        code: generatedCode,
        contactPerson: newCliContact.trim() || null,
        contactNo: newCliPhone.trim() || null,
        streetAddress: newCliAddress.trim() || null,
        city: newCliCity.trim() || 'Dubai',
        trn: newCliTrn.trim() || null,
        tradeLicense: newCliTradeLicense.trim() || null,
      };

      if (onClientCreated) {
        onClientCreated(createdClient);
      }

      // Automatically map this newly created client
      setCustomerId(createdClient.id);
      setCustomerName(createdClient.name);
      if (!name || name.includes('- Facility / Ramp')) {
        setName(`${createdClient.name} - Facility / Ramp`);
      }
      if (createdClient.streetAddress) {
        setAddress(createdClient.streetAddress);
      }
      if (createdClient.contactPerson) {
        setContactPerson(createdClient.contactPerson);
      }
      if (createdClient.contactNo) {
        setContactPhone(createdClient.contactNo);
      }

      setShowAddClientModal(false);
    } catch (err) {
      console.error('Error creating client:', err);
    } finally {
      setSubmittingCli(false);
    }
  };

  // Form submission handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setSubmitting(true);
      const payload: DrayageWarehouseData = {
        id: initialData?.id,
        customerId: customerId || null,
        customerName: customerName || (clients.find((c) => c.id === customerId)?.name || 'Direct Client'),
        name: name.trim(),
        code: code.trim().toUpperCase() || undefined,
        zone: zone || 'JAFZA South',
        address: address.trim() || undefined,
        lat,
        lng,
        rampsCount: Number(rampsCount) || 4,
        contactPerson: contactPerson.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        geofenceConfigured,
        geofenceType,
        geofenceRadiusMeters: Number(geofenceRadiusMeters) || 800,
        geofenceCoordinatesJson: geofenceCoordinatesJson || '[]',
        tripAmountAed: Number(tripAmountAed) || 1550,
        driverAllowanceAed: Number(driverAllowanceAed) || 150,
      };

      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_warehouse',
          ...payload,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save consignee destination');

      onSaved(payload);
      onClose();
    } catch (err) {
      console.error('Error saving consignee destination:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* UNIFIED MODAL WINDOW: Add Consignee Destination (Client Facility / Warehouse) */}
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-xl max-h-[92vh] rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-emerald-400" />
              <span>
                {initialData?.id
                  ? 'Edit Consignee Destination (Client Facility / Warehouse)'
                  : 'Add Consignee Destination (Client Facility / Warehouse)'}
              </span>
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            {/* Consignee Facility / Warehouse Name (Client) * */}
            <div className="space-y-1">
              <label className="font-semibold text-[var(--text-muted)]">
                Consignee Facility / Warehouse Name (Client) *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Landmark Distribution Center NIP, Chalhoub DWC Hub"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500 font-medium"
              />
            </div>

            {/* Warehouse / Facility Code */}
            <div className="space-y-1">
              <label className="font-semibold text-[var(--text-muted)]">
                Warehouse / Facility Code (Optional)
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. AF-LOG-DIC-WH1"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono uppercase outline-none focus:border-emerald-500"
              />
            </div>

            {/* Map to Client / Consignee * with + Add Client button */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-[var(--text-main)] flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Map to Client / Consignee *</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowAddClientModal(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[11px] shadow-sm transition-all"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Client</span>
                </button>
              </div>
              <select
                required
                value={customerId}
                onChange={(e) => handleClientChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500 font-medium"
              >
                <option value="">-- Select Client from Master --</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Industrial Zone / Area & Loading Ramps / Bays */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Industrial Zone / Area *
                </label>
                <input
                  type="text"
                  required
                  list="zones-list"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  placeholder="e.g. JAFZA South"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
                <datalist id="zones-list">
                  {DEFAULT_INDUSTRIAL_ZONES.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Loading Ramps / Bays
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={rampsCount}
                  onChange={(e) => setRampsCount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold outline-none focus:border-emerald-500 text-cyan-400"
                />
              </div>
            </div>

            {/* GPS Ramp Coordinates with Plot on Map button (Right before Street Address!) */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text-muted)] text-[11px] flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                  GPS Ramp Coordinates
                </span>
                <button
                  type="button"
                  onClick={handleOpenPlotOnMap}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#057a55] hover:bg-[#046c4e] text-white text-xs font-semibold shadow-sm transition-all"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>📍 Plot on Map</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--text-muted)]">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[var(--text-muted)]">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* Physical Street Address (Populated exactly via reverse Geocoding!) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-[var(--text-muted)]">
                  Physical Street Address
                </label>
                {reverseGeocoding && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1 animate-pulse">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Reverse-geocoding street address...</span>
                  </span>
                )}
              </div>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Plot S-204, Road 4, JAFZA South"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
              />
            </div>

            {/* Commercial Rates: Driver Allowance & Trip Amount against each warehouse */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <div className="space-y-1">
                <label className="font-semibold text-amber-400 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Driver Allowance (AED)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={driverAllowanceAed}
                  onChange={(e) => setDriverAllowanceAed(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-amber-500/30 text-[var(--text-main)] font-mono font-bold outline-none focus:border-amber-500 text-amber-400"
                />
                <p className="text-[10px] text-[var(--text-muted)]">Per trip driver allowance.</p>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-emerald-400 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Trip Amount (AED)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={tripAmountAed}
                  onChange={(e) => setTripAmountAed(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-emerald-500/30 text-[var(--text-main)] font-mono font-bold outline-none focus:border-emerald-500 text-emerald-400"
                />
                <p className="text-[10px] text-[var(--text-muted)]">Contracted corridor billing.</p>
              </div>
            </div>

            {/* Receiving Contact Person & Receiving Contact Phone */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)] flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-blue-400" />
                  <span>Receiving Contact Person</span>
                </label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="Tariq Al-Mansoori"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)] flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-blue-400" />
                  <span>Receiving Contact Phone</span>
                </label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+971 50 482 9910"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Geofence Configured Card */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text-main)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Geofence Configured
                </span>
                <button
                  type="button"
                  onClick={() => setGeofenceConfigured(!geofenceConfigured)}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                    geofenceConfigured ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <div className="bg-white w-4 h-4 rounded-full shadow-md" />
                </button>
              </div>

              {geofenceConfigured && (
                <div className="space-y-2.5 pt-2 border-t border-[var(--border-subtle)] animate-in fade-in duration-150">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-[var(--text-muted)] font-semibold">Perimeter Type</label>
                      <select
                        value={geofenceType}
                        onChange={(e) => setGeofenceType(e.target.value as 'CIRCLE' | 'POLYGON')}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                      >
                        <option value="CIRCLE">Circular Perimeter (Radius)</option>
                        <option value="POLYGON">Custom Polygon Bounds</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-[var(--text-muted)] font-semibold">
                        {geofenceType === 'POLYGON' ? 'Bounding Radius (meters)' : 'Geofence Radius (meters)'}
                      </label>
                      <input
                        type="number"
                        step="50"
                        min="100"
                        max="5000"
                        value={geofenceRadiusMeters}
                        onChange={(e) => setGeofenceRadiusMeters(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  {geofenceType === 'POLYGON' && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs">
                      <div className="flex items-center gap-2 text-purple-300">
                        <Hexagon className="w-4 h-4 text-purple-400 shrink-0" />
                        <span>
                          {(() => {
                            try {
                              const parsed = JSON.parse(geofenceCoordinatesJson);
                              if (Array.isArray(parsed) && parsed.length >= 3) {
                                return `${parsed.length} custom polygon boundary vertices configured`;
                              }
                            } catch {}
                            return '4-point default bounding box ready on map';
                          })()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenPlotOnMap}
                        className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 underline"
                      >
                        Fine-tune on Map
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-[#057a55] hover:bg-[#046c4e] text-white font-semibold shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>
                  {initialData?.id ? 'Update Consignee Destination' : 'Save Consignee Destination'}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* INTERACTIVE GOOGLE MAPS PLOT MODAL */}
      {showPlotModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-4xl h-[85vh] rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                    <span>Plot on Map: {name || 'Consignee Facility'}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30">
                      Google Maps Radar
                    </span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Drag the center marker or stretch perimeter handles. Reverse-geocodes exact street address upon applying.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPlotModal(false)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Map Canvas */}
            <div className="flex-1 relative bg-slate-900 overflow-hidden">
              <div ref={mapContainerRef} className="w-full h-full" />

              {/* Google Places Autocomplete Styling */}
              <style>{`
                .pac-container {
                  z-index: 100000 !important;
                  font-family: inherit;
                  border-radius: 12px;
                  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                  border: 1px solid rgba(0, 0, 0, 0.1);
                  margin-top: 4px;
                  background-color: #ffffff;
                }
                .pac-item {
                  padding: 8px 12px;
                  font-size: 13px;
                  cursor: pointer;
                  line-height: 1.4;
                }
                .pac-item:hover {
                  background-color: #f1f5f9;
                }
                .pac-item-query {
                  font-size: 13px;
                  font-weight: 600;
                  color: #0f172a;
                }
                .pac-matched {
                  font-weight: 700;
                  color: #008080;
                }
              `}</style>

              {/* Floating Google Maps Search & Control Overlay */}
              <div className="absolute top-3 left-3 right-3 z-20 flex flex-col gap-2 pointer-events-none">
                {/* Row 1: Google Maps Search Bar (Left) + Map Type Switcher (Right) */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Google Maps Search Bar — Matches user screenshot exactly */}
                  <div className="pointer-events-auto flex items-center bg-white rounded-xl shadow-2xl border border-slate-200 px-3 py-1.5 gap-2 w-full sm:w-[380px] transition-all focus-within:ring-2 focus-within:ring-teal-500/50">
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSearchSubmit();
                        }
                      }}
                      placeholder="Search Google Maps"
                      className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none"
                    />

                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="text-slate-400 hover:text-slate-600 p-0.5 transition-colors"
                        title="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Magnifying Glass Search Button */}
                    <button
                      type="button"
                      onClick={() => handleSearchSubmit()}
                      disabled={searchLoading}
                      className="text-slate-500 hover:text-teal-600 p-1 transition-colors"
                      title="Search place or coordinates"
                    >
                      {searchLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-teal-600" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                    </button>

                    {/* Teal Diamond Navigation / Directions Icon */}
                    <button
                      type="button"
                      onClick={handleFlyToPin}
                      className="w-7 h-7 rounded-lg bg-[#008080] hover:bg-[#006666] active:scale-95 text-white flex items-center justify-center shadow-md transition-all shrink-0"
                      title="Center map on pin"
                    >
                      <Navigation className="w-3.5 h-3.5 rotate-45" />
                    </button>
                  </div>

                  {/* Map Type Switcher (Default, Satellite, Hybrid, Terrain) */}
                  <div className="pointer-events-auto flex items-center gap-1 bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700/60 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setPlotMapTypeId('roadmap');
                        mapInstanceRef.current?.setMapTypeId?.('roadmap');
                      }}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
                        plotMapTypeId === 'roadmap'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <Map className="w-3 h-3" />
                      <span>Default</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlotMapTypeId('satellite');
                        mapInstanceRef.current?.setMapTypeId?.('satellite');
                      }}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
                        plotMapTypeId === 'satellite'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <Globe className="w-3 h-3" />
                      <span>Satellite</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlotMapTypeId('hybrid');
                        mapInstanceRef.current?.setMapTypeId?.('hybrid');
                      }}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
                        plotMapTypeId === 'hybrid'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>Hybrid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlotMapTypeId('terrain');
                        mapInstanceRef.current?.setMapTypeId?.('terrain');
                      }}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
                        plotMapTypeId === 'terrain'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      <Mountain className="w-3 h-3" />
                      <span>Terrain</span>
                    </button>
                  </div>
                </div>

                {/* Row 2: Drawing Tools & Coordinates */}
                <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700/60 shadow-xl text-xs">
                  {/* Left: Shape Mode & Tools */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex items-center gap-1 bg-[var(--bg-card)] p-0.5 rounded-lg border border-[var(--border-subtle)]">
                      <button
                        type="button"
                        onClick={handleSelectCircle}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 ${
                          plotType === 'CIRCLE'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        <span>⚪</span>
                        <span>Draw Circle</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectPolygon}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 ${
                          plotType === 'POLYGON'
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        <Hexagon className="w-3.5 h-3.5" />
                        <span>Draw Polygon</span>
                      </button>
                    </div>

                    {/* Circle Tools */}
                    {plotType === 'CIRCLE' && (
                      <div className="flex items-center gap-2 pl-1 border-l border-[var(--border-subtle)]">
                        <span className="text-[var(--text-muted)]">Radius:</span>
                        <input
                          type="range"
                          min="200"
                          max="3000"
                          step="50"
                          value={plotRadius}
                          onChange={(e) => {
                            const r = Number(e.target.value);
                            setPlotRadius(r);
                            plotRadiusRef.current = r;
                            if (circleRef.current) circleRef.current.setRadius(r);
                          }}
                          className="w-24 accent-emerald-500 cursor-pointer"
                        />
                        <span className="font-mono font-bold text-emerald-400">{plotRadius}m</span>
                      </div>
                    )}

                    {/* Polygon Tools */}
                    {plotType === 'POLYGON' && (
                      <div className="flex flex-wrap items-center gap-2 pl-1 border-l border-[var(--border-subtle)]">
                        {!isDrawingPolygon ? (
                          <>
                            <span className="px-2 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-purple-300 font-mono text-[11px] flex items-center gap-1">
                              <Hexagon className="w-3 h-3 text-purple-400" />
                              <span>{plotPolygonCoords.length} Vertices</span>
                            </span>

                            <button
                              type="button"
                              onClick={startDrawingPolygon}
                              className="px-2.5 py-1 rounded-md bg-purple-600/20 hover:bg-purple-600/35 border border-purple-500/40 text-purple-200 text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                              title="Click on map to drop custom perimeter points"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Click-to-Draw Boundary</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleResetPolygonToCenterBox}
                              className="px-2.5 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-[11px] font-semibold flex items-center gap-1.5 transition-all"
                              title="Reset to 4-corner bounding box centered on pin"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reset Box</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold text-[11px] flex items-center gap-1.5 animate-pulse">
                              <MousePointerClick className="w-3 h-3 text-amber-400" />
                              <span>Click map to add points ({drawingVertices.length})</span>
                            </span>

                            <button
                              type="button"
                              onClick={finishDrawingPolygon}
                              disabled={drawingVertices.length < 3}
                              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white text-[11px] font-semibold flex items-center gap-1 transition-all shadow-sm"
                              title="Close and complete polygon (requires at least 3 vertices)"
                            >
                              <Check className="w-3 h-3" />
                              <span>Complete Polygon</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleUndoDrawingPoint}
                              disabled={drawingVertices.length === 0}
                              className="px-2.5 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] disabled:opacity-40 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-[11px] font-semibold flex items-center gap-1 transition-all"
                              title="Remove last point"
                            >
                              <Undo2 className="w-3 h-3" />
                              <span>Undo</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                cleanupDrawingMode();
                                renderPolygonOverlay(plotPolygonCoordsRef.current);
                              }}
                              className="px-2.5 py-1 rounded-md bg-[var(--bg-card)] hover:bg-rose-500/20 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-rose-300 text-[11px] font-semibold transition-all"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-slate-300 font-mono bg-slate-950/60 px-2 py-0.5 rounded-md border border-slate-700/50">
                      📍 {plotCoordinates.lat.toFixed(5)}, {plotCoordinates.lng.toFixed(5)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Guidance Banner */}
              <div className="absolute bottom-4 left-4 right-4 z-10 pointer-events-none flex justify-center">
                <div className="px-3.5 py-1.5 rounded-full bg-slate-900/90 backdrop-blur-md border border-white/10 text-[11px] text-slate-300 shadow-xl flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  {plotType === 'CIRCLE' && (
                    <span>
                      Drag the center marker to reposition. Drag perimeter handles or use slider to adjust circular radius.
                    </span>
                  )}
                  {plotType === 'POLYGON' && !isDrawingPolygon && (
                    <span>
                      Drag white corner & midpoint handles to stretch boundary over depot walls. Or click <strong>Click-to-Draw</strong> for custom bounds.
                    </span>
                  )}
                  {plotType === 'POLYGON' && isDrawingPolygon && (
                    <span className="text-amber-200">
                      Click anywhere on the map to place boundary corners. When finished, click <strong>Complete Polygon</strong>.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="text-xs text-[var(--text-muted)] flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Geofence radius and street address will be auto-populated into the destination form.</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPlotModal(false)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyPlotLocation}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#057a55] hover:bg-[#046c4e] text-white text-xs font-semibold shadow-md transition-all"
                >
                  <Check className="w-4 h-4" />
                  <span>Apply Geofence & Location</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QUICK ADD CLIENT MODAL */}
      {showAddClientModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                <span>Add New Client</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddClientModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateQuickClient} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">
                    Client / Consignee Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCliName}
                    onChange={(e) => {
                      setNewCliName(e.target.value);
                      if (!newCliCode) {
                        setNewCliCode(e.target.value.slice(0, 3).toUpperCase());
                      }
                    }}
                    placeholder="e.g. Al-Futtaim Logistics LLC"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Client Code *</label>
                  <input
                    type="text"
                    required
                    value={newCliCode}
                    onChange={(e) => setNewCliCode(e.target.value.toUpperCase())}
                    placeholder="ALF-LOG"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono uppercase outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Contact Person</label>
                  <input
                    type="text"
                    value={newCliContact}
                    onChange={(e) => setNewCliContact(e.target.value)}
                    placeholder="Tariq Al-Mansoori"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Contact Phone</label>
                  <input
                    type="text"
                    value={newCliPhone}
                    onChange={(e) => setNewCliPhone(e.target.value)}
                    placeholder="+971 50 482 9910"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Street Address</label>
                  <input
                    type="text"
                    value={newCliAddress}
                    onChange={(e) => setNewCliAddress(e.target.value)}
                    placeholder="Plot S-204, Road 4, JAFZA South"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Emirate / City</label>
                  <select
                    value={newCliCity}
                    onChange={(e) => setNewCliCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="Dubai">Dubai</option>
                    <option value="Abu Dhabi">Abu Dhabi</option>
                    <option value="Sharjah">Sharjah</option>
                    <option value="Ajman">Ajman</option>
                    <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                    <option value="Fujairah">Fujairah</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">TRN (Tax Reg. No.)</label>
                  <input
                    type="text"
                    value={newCliTrn}
                    onChange={(e) => setNewCliTrn(e.target.value)}
                    placeholder="100294820100003"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Trade License</label>
                  <input
                    type="text"
                    value={newCliTradeLicense}
                    onChange={(e) => setNewCliTradeLicense(e.target.value)}
                    placeholder="CN-1029481"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowAddClientModal(false)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCli}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{submittingCli ? 'Creating...' : 'Create & Map to Destination'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
