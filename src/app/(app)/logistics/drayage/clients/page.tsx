'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Users, Building2, Warehouse, MapPin, Plus, Edit2, Trash2, CheckCircle2,
  AlertTriangle, Search, Filter, RefreshCw, X, ShieldCheck, DollarSign,
  Phone, User, Compass, Layers, Check, ExternalLink, ArrowRight, Sliders,
  Navigation, Eye, Info, ChevronRight, FileText, ChevronDown, ChevronUp, Map, Globe, Mountain, Move,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
  type GMapsCircle,
  type GoogleCtors,
} from '@/lib/google-maps-loader';

interface DrayageClient {
  id: string;
  tenantId?: string;
  name: string;
  code: string;
  contactPerson: string | null;
  contactNo: string | null;
  streetAddress: string | null;
  city: string;
  trn: string | null;
  tradeLicense: string | null;
  defaultTripAmountAed: number;
  defaultDriverAllowanceAed: number;
  notes: string | null;
  warehouseCount: number;
  warehouses?: DrayageWarehouse[];
  createdAt?: string;
  updatedAt?: string;
}

interface DrayageWarehouse {
  id: string;
  tenantId?: string;
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

const INDUSTRIAL_ZONES = [
  'JAFZA South, Dubai',
  'JAFZA North, Dubai',
  'NIP / TechnoPark, Dubai',
  'Dubai South (DWC) Logistics District',
  'Dubai Industrial City (DIC)',
  'Al Quoz Industrial Area, Dubai',
  'Ras Al Khor Industrial, Dubai',
  'KEZAD Abu Dhabi (Khalifa Economic Zone)',
  'ICAD (Industrial City of Abu Dhabi)',
  'Sharjah Industrial Area 13',
  'Hamriyah Free Zone, Sharjah',
];

export default function DrayageClientMasterPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.clients);
  const [clients, setClients] = useState<DrayageClient[]>(cached?.clients || []);
  const [warehouses, setWarehouses] = useState<DrayageWarehouse[]>(cached?.warehouses || []);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [geofenceFilter, setGeofenceFilter] = useState<'ALL' | 'GEOFENCED' | 'NOT_GEOFENCED'>('ALL');
  const [viewMode, setViewMode] = useState<'CLIENTS' | 'FACILITIES'>('CLIENTS');

  // Selected Client for Warehouse Management Drawer
  const [selectedClientForWarehouses, setSelectedClientForWarehouses] = useState<DrayageClient | null>(null);

  // Client Modal State
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState<DrayageClient | null>(null);
  const [clientForm, setClientForm] = useState({
    name: '',
    code: '',
    contactPerson: '',
    contactNo: '',
    streetAddress: '',
    city: 'Dubai',
    trn: '',
    tradeLicense: '',
    defaultTripAmountAed: 1550,
    defaultDriverAllowanceAed: 150,
    notes: '',
  });

  // Warehouse Modal State
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<DrayageWarehouse | null>(null);
  const [warehouseForm, setWarehouseForm] = useState({
    customerId: '',
    customerName: '',
    name: '',
    code: '',
    zone: 'JAFZA South, Dubai',
    address: '',
    lat: 24.9642,
    lng: 55.0915,
    rampsCount: 8,
    contactPerson: '',
    contactPhone: '',
    geofenceConfigured: true,
    geofenceType: 'CIRCLE' as 'CIRCLE' | 'POLYGON',
    geofenceRadiusMeters: 800,
    geofenceCoordinatesJson: '[]',
    tripAmountAed: 1550,
    driverAllowanceAed: 150,
  });

  // Plot on Map Modal State
  const [showPlotModal, setShowPlotModal] = useState(false);
  const [plottingWarehouse, setPlottingWarehouse] = useState<DrayageWarehouse | null>(null);
  const [plotCoordinates, setPlotCoordinates] = useState<{ lat: number; lng: number }>({ lat: 24.9642, lng: 55.0915 });
  const [plotRadius, setPlotRadius] = useState<number>(800);
  const [plotType, setPlotType] = useState<'CIRCLE' | 'POLYGON'>('CIRCLE');
  const [plotMapTypeId, setPlotMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('roadmap');
  const [savingPlot, setSavingPlot] = useState(false);

  // Google Map Refs for Plot Modal
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<GMapsMap | null>(null);
  const markerRef = useRef<GMapsMarker | null>(null);
  const circleRef = useRef<GMapsCircle | null>(null);

  // Toast / Status Message
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  };

  const loadData = useCallback(async (forceFresh = false) => {
    try {
      setLoading(true);
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      if (data) {
        setClients(data.clients || []);
        setWarehouses(data.warehouses || []);
      }
    } catch (err: unknown) {
      console.error('Failed to load drayage workspace data:', err);
      showToast('error', 'Failed to load client and warehouse master records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Keep selectedClientForWarehouses in sync when clients change
  useEffect(() => {
    if (selectedClientForWarehouses) {
      const updated = clients.find(c => c.id === selectedClientForWarehouses.id);
      if (updated) setSelectedClientForWarehouses(updated);
    }
  }, [clients, selectedClientForWarehouses]);

  // Filtered Clients
  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (c.contactPerson && c.contactPerson.toLowerCase().includes(q)) ||
        (c.contactNo && c.contactNo.toLowerCase().includes(q)) ||
        (c.streetAddress && c.streetAddress.toLowerCase().includes(q)) ||
        (c.city && c.city.toLowerCase().includes(q));

      if (!matchSearch) return false;

      // If zone filter is active, check if any warehouse matches
      if (zoneFilter !== 'ALL') {
        const clientWhs = warehouses.filter(
          w => w.customerId === c.id || (w.customerName && w.customerName.toLowerCase() === c.name.toLowerCase())
        );
        const hasZone = clientWhs.some(w => w.zone.toLowerCase().includes(zoneFilter.toLowerCase()));
        if (!hasZone) return false;
      }

      // If geofence filter is active
      if (geofenceFilter !== 'ALL') {
        const clientWhs = warehouses.filter(
          w => w.customerId === c.id || (w.customerName && w.customerName.toLowerCase() === c.name.toLowerCase())
        );
        if (geofenceFilter === 'GEOFENCED' && !clientWhs.some(w => Boolean(w.geofenceConfigured))) return false;
        if (geofenceFilter === 'NOT_GEOFENCED' && clientWhs.every(w => Boolean(w.geofenceConfigured))) return false;
      }

      return true;
    });
  }, [clients, warehouses, search, zoneFilter, geofenceFilter]);

  // Filtered Warehouses (for All Facilities view)
  const filteredWarehouses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouses.filter((w) => {
      const matchSearch =
        !q ||
        w.name.toLowerCase().includes(q) ||
        (w.code && w.code.toLowerCase().includes(q)) ||
        w.customerName.toLowerCase().includes(q) ||
        w.zone.toLowerCase().includes(q) ||
        (w.address && w.address.toLowerCase().includes(q)) ||
        (w.contactPerson && w.contactPerson.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (zoneFilter !== 'ALL' && !w.zone.toLowerCase().includes(zoneFilter.toLowerCase())) return false;
      if (geofenceFilter === 'GEOFENCED' && !w.geofenceConfigured) return false;
      if (geofenceFilter === 'NOT_GEOFENCED' && w.geofenceConfigured) return false;

      return true;
    });
  }, [warehouses, search, zoneFilter, geofenceFilter]);

  // Summary Metrics
  const totalWarehouses = warehouses.length;
  const geofencedCount = warehouses.filter(w => Boolean(w.geofenceConfigured)).length;
  const avgTripAmount = clients.length
    ? Math.round(clients.reduce((s, c) => s + (c.defaultTripAmountAed || 1550), 0) / clients.length)
    : 1550;
  const avgDriverAllowance = clients.length
    ? Math.round(clients.reduce((s, c) => s + (c.defaultDriverAllowanceAed || 150), 0) / clients.length)
    : 150;

  // Client Form Handlers
  const openAddClient = () => {
    setEditingClient(null);
    setClientForm({
      name: '',
      code: '',
      contactPerson: '',
      contactNo: '',
      streetAddress: '',
      city: 'Dubai',
      trn: '',
      tradeLicense: '',
      defaultTripAmountAed: 1550,
      defaultDriverAllowanceAed: 150,
      notes: '',
    });
    setShowClientModal(true);
  };

  const openEditClient = (client: DrayageClient) => {
    setEditingClient(client);
    setClientForm({
      name: client.name,
      code: client.code,
      contactPerson: client.contactPerson || '',
      contactNo: client.contactNo || '',
      streetAddress: client.streetAddress || '',
      city: client.city || 'Dubai',
      trn: client.trn || '',
      tradeLicense: client.tradeLicense || '',
      defaultTripAmountAed: client.defaultTripAmountAed || 1550,
      defaultDriverAllowanceAed: client.defaultDriverAllowanceAed || 150,
      notes: client.notes || '',
    });
    setShowClientModal(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientForm.name.trim()) {
      showToast('error', 'Client Name is required.');
      return;
    }
    const code = clientForm.code.trim().toUpperCase() || clientForm.name.slice(0, 3).toUpperCase();
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_client',
          id: editingClient?.id,
          name: clientForm.name.trim(),
          code,
          contactPerson: clientForm.contactPerson.trim() || null,
          contactNo: clientForm.contactNo.trim() || null,
          streetAddress: clientForm.streetAddress.trim() || null,
          city: clientForm.city.trim() || 'Dubai',
          trn: clientForm.trn.trim() || null,
          tradeLicense: clientForm.tradeLicense.trim() || null,
          defaultTripAmountAed: Number(clientForm.defaultTripAmountAed) || 1550,
          defaultDriverAllowanceAed: Number(clientForm.defaultDriverAllowanceAed) || 150,
          notes: clientForm.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to save client');
      setShowClientModal(false);
      invalidateDrayageClientCache();
      await loadData(true);
      showToast('success', `Client "${clientForm.name}" saved successfully.`);
    } catch (err: unknown) {
      console.error('Error saving client:', err);
      showToast('error', 'Error saving client. Please try again.');
    }
  };

  const handleDeleteClient = async (client: DrayageClient) => {
    if (!confirm(`Are you sure you want to delete client "${client.name}"? This will not delete historical completed jobs.`)) {
      return;
    }
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_client',
          id: client.id,
        }),
      });
      if (!res.ok) throw new Error('Failed to delete client');
      if (selectedClientForWarehouses?.id === client.id) {
        setSelectedClientForWarehouses(null);
      }
      invalidateDrayageClientCache();
      await loadData(true);
      showToast('success', `Client "${client.name}" removed.`);
    } catch (err: unknown) {
      console.error('Error deleting client:', err);
      showToast('error', 'Error deleting client.');
    }
  };

  // Warehouse Form Handlers
  const openAddWarehouse = (defaultClient?: DrayageClient) => {
    setEditingWarehouse(null);
    const client = defaultClient || clients[0];
    setWarehouseForm({
      customerId: client?.id || '',
      customerName: client?.name || '',
      name: '',
      code: '',
      zone: 'JAFZA South, Dubai',
      address: '',
      lat: 24.9642,
      lng: 55.0915,
      rampsCount: 8,
      contactPerson: client?.contactPerson || '',
      contactPhone: client?.contactNo || '',
      geofenceConfigured: true,
      geofenceType: 'CIRCLE',
      geofenceRadiusMeters: 800,
      geofenceCoordinatesJson: '[]',
      tripAmountAed: client?.defaultTripAmountAed || 1550,
      driverAllowanceAed: client?.defaultDriverAllowanceAed || 150,
    });
    setShowWarehouseModal(true);
  };

  const openEditWarehouse = (warehouse: DrayageWarehouse) => {
    setEditingWarehouse(warehouse);
    setWarehouseForm({
      customerId: warehouse.customerId || '',
      customerName: warehouse.customerName || '',
      name: warehouse.name,
      code: warehouse.code || '',
      zone: warehouse.zone || 'JAFZA South, Dubai',
      address: warehouse.address || '',
      lat: Number(warehouse.lat ?? 24.9642),
      lng: Number(warehouse.lng ?? 55.0915),
      rampsCount: Number(warehouse.rampsCount ?? 6),
      contactPerson: warehouse.contactPerson || '',
      contactPhone: warehouse.contactPhone || '',
      geofenceConfigured: Boolean(warehouse.geofenceConfigured),
      geofenceType: warehouse.geofenceType || 'CIRCLE',
      geofenceRadiusMeters: Number(warehouse.geofenceRadiusMeters ?? 800),
      geofenceCoordinatesJson: warehouse.geofenceCoordinatesJson || '[]',
      tripAmountAed: warehouse.tripAmountAed != null ? Number(warehouse.tripAmountAed) : 1550,
      driverAllowanceAed: warehouse.driverAllowanceAed != null ? Number(warehouse.driverAllowanceAed) : 150,
    });
    setShowWarehouseModal(true);
  };

  const handleSaveWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseForm.name.trim()) {
      showToast('error', 'Warehouse Name is required.');
      return;
    }
    const client = clients.find(c => c.id === warehouseForm.customerId);
    const customerName = client ? client.name : warehouseForm.customerName || 'Enterprise Shipper';
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_warehouse',
          id: editingWarehouse?.id,
          customerId: warehouseForm.customerId || null,
          customerName,
          name: warehouseForm.name.trim(),
          code: warehouseForm.code.trim().toUpperCase() || null,
          zone: warehouseForm.zone.trim(),
          address: warehouseForm.address.trim(),
          lat: Number(warehouseForm.lat),
          lng: Number(warehouseForm.lng),
          rampsCount: Number(warehouseForm.rampsCount) || 6,
          contactPerson: warehouseForm.contactPerson.trim() || null,
          contactPhone: warehouseForm.contactPhone.trim() || null,
          geofenceConfigured: Boolean(warehouseForm.geofenceConfigured),
          geofenceType: warehouseForm.geofenceType,
          geofenceRadiusMeters: Number(warehouseForm.geofenceRadiusMeters) || 800,
          geofenceCoordinatesJson: warehouseForm.geofenceCoordinatesJson || '[]',
          tripAmountAed: Number(warehouseForm.tripAmountAed) || 1550,
          driverAllowanceAed: Number(warehouseForm.driverAllowanceAed) || 150,
        }),
      });
      if (!res.ok) throw new Error('Failed to save warehouse');
      setShowWarehouseModal(false);
      invalidateDrayageClientCache();
      await loadData(true);
      showToast('success', `Warehouse "${warehouseForm.name}" saved successfully.`);
    } catch (err: unknown) {
      console.error('Error saving warehouse:', err);
      showToast('error', 'Error saving warehouse facility.');
    }
  };

  const handleDeleteWarehouse = async (warehouse: DrayageWarehouse) => {
    if (!confirm(`Are you sure you want to delete warehouse "${warehouse.name}"?`)) {
      return;
    }
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_warehouse',
          id: warehouse.id,
        }),
      });
      if (!res.ok) throw new Error('Failed to delete warehouse');
      invalidateDrayageClientCache();
      await loadData(true);
      showToast('success', `Warehouse "${warehouse.name}" removed.`);
    } catch (err: unknown) {
      console.error('Error deleting warehouse:', err);
      showToast('error', 'Error deleting warehouse.');
    }
  };

  // Plot on Map Modal Initializer
  const openPlotModal = (wh: DrayageWarehouse) => {
    setPlottingWarehouse(wh);
    const lat = Number(wh.lat ?? 24.9642);
    const lng = Number(wh.lng ?? 55.0915);
    const radius = Number(wh.geofenceRadiusMeters ?? 800);
    const type = wh.geofenceType || 'CIRCLE';
    setPlotCoordinates({ lat, lng });
    setPlotRadius(radius);
    setPlotType(type);
    setShowPlotModal(true);
  };

  // Initialize and update Google Map in Plot Modal
  useEffect(() => {
    if (!showPlotModal || !mapContainerRef.current) return;

    let isMounted = true;

    async function initMap() {
      try {
        const ctors = await loadGoogleMaps();
        if (!isMounted || !mapContainerRef.current) return;

        const center = { lat: plotCoordinates.lat, lng: plotCoordinates.lng };

        if (!mapInstanceRef.current) {
          const map = new ctors.Map(mapContainerRef.current, {
            center,
            zoom: 14,
            mapTypeId: plotMapTypeId,
            fullscreenControl: false,
            streetViewControl: false,
            mapTypeControl: true,
            mapTypeControlOptions: {
              style: ctors.MapTypeControlStyle?.HORIZONTAL_BAR ?? 1,
              position: ctors.ControlPosition?.TOP_RIGHT ?? 3,
              mapTypeIds: ['roadmap', 'satellite', 'hybrid', 'terrain'],
            },
          });
          mapInstanceRef.current = map;

          // Click map to reposition pin
          map.addListener('click', (e: any) => {
            if (!e.latLng) return;
            const newLat = Number(e.latLng.lat().toFixed(6));
            const newLng = Number(e.latLng.lng().toFixed(6));
            setPlotCoordinates({ lat: newLat, lng: newLng });
          });
        } else {
          mapInstanceRef.current?.setCenter?.(center);
          mapInstanceRef.current?.setMapTypeId?.(plotMapTypeId);
        }

        const map = mapInstanceRef.current;

        // Create or update Marker
        if (markerRef.current) {
          markerRef.current.setPosition(center);
        } else {
          markerRef.current = new ctors.Marker({
            position: center,
            map,
            draggable: true,
            title: plottingWarehouse?.name || 'Warehouse Location',
          });

          markerRef.current.addListener('dragend', (e: any) => {
            if (!e.latLng) return;
            setPlotCoordinates({ lat: e.latLng.lat(), lng: e.latLng.lng() });
          });
        }

        // Create or update Circle with Interactive Radius & Center Stretching
        if (circleRef.current) {
          circleRef.current.setCenter(center);
          circleRef.current.setRadius(plotRadius);
        } else {
          const circle = new ctors.Circle({
            center,
            radius: plotRadius,
            map,
            fillColor: '#3b82f6',
            fillOpacity: 0.22,
            strokeColor: '#2563eb',
            strokeOpacity: 0.9,
            strokeWeight: 2.5,
            editable: true, // Enables cardinal edge handles to stretch radius!
            draggable: true, // Enables center handle to drag position
            zIndex: 50,
          });

          // Live vertex & radius stretching listener
          circle.addListener('radius_changed', () => {
            const r = Math.round(circle.getRadius());
            setPlotRadius(r);
          });

          circle.addListener('center_changed', () => {
            const c = circle.getCenter();
            if (c) {
              const newPos = {
                lat: Number(c.lat().toFixed(6)),
                lng: Number(c.lng().toFixed(6)),
              };
              setPlotCoordinates(newPos);
              if (markerRef.current) markerRef.current.setPosition(newPos);
            }
          });

          circleRef.current = circle;
        }
      } catch (err) {
        console.warn('Error initializing Google Maps for plot modal:', err);
      }
    }

    initMap();

    return () => {
      isMounted = false;
    };
  }, [showPlotModal, plotCoordinates.lat, plotCoordinates.lng, plotRadius]);

  // Clean up map when modal closes
  useEffect(() => {
    if (!showPlotModal) {
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
      mapInstanceRef.current = null;
    }
  }, [showPlotModal]);

  const handleSavePlotOnMap = async () => {
    if (!plottingWarehouse) return;
    try {
      setSavingPlot(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_warehouse',
          id: plottingWarehouse.id,
          customerId: plottingWarehouse.customerId,
          customerName: plottingWarehouse.customerName,
          name: plottingWarehouse.name,
          code: plottingWarehouse.code,
          zone: plottingWarehouse.zone,
          address: plottingWarehouse.address,
          lat: plotCoordinates.lat,
          lng: plotCoordinates.lng,
          rampsCount: plottingWarehouse.rampsCount || 6,
          contactPerson: plottingWarehouse.contactPerson,
          contactPhone: plottingWarehouse.contactPhone,
          geofenceConfigured: true,
          geofenceType: plotType,
          geofenceRadiusMeters: plotRadius,
          geofenceCoordinatesJson: plottingWarehouse.geofenceCoordinatesJson || '[]',
          tripAmountAed: plottingWarehouse.tripAmountAed || 1550,
          driverAllowanceAed: plottingWarehouse.driverAllowanceAed || 150,
        }),
      });
      if (!res.ok) throw new Error('Failed to update warehouse geofence');
      setShowPlotModal(false);
      invalidateDrayageClientCache();
      await loadData(true);
      showToast('success', `Geofence perimeter and coordinates updated for "${plottingWarehouse.name}".`);
    } catch (err: unknown) {
      console.error('Error saving plot:', err);
      showToast('error', 'Failed to save geofence perimeter.');
    } finally {
      setSavingPlot(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-semibold transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Client Master & Consignee Directory"
        subtitle="Manage client codes, designated unloading ramps, industrial zones, geofence perimeters, contractual trip rates, and driver allowances."
        icon={Users}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadData(true)}
              disabled={loading}
              className="p-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)] transition-all shadow-sm"
              title="Refresh Client Master"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => openAddWarehouse()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs font-semibold shadow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add Facility / Warehouse</span>
            </button>
            <button
              type="button"
              onClick={openAddClient}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add Client Master</span>
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Active Clients"
          value={clients.length}
          icon={Users}
          sub="Corporate consignees"
          accent="blue"
        />
        <KpiCard
          label="Total Warehouses"
          value={totalWarehouses}
          icon={Warehouse}
          sub="Unloading facilities"
          accent="cyan"
        />
        <KpiCard
          label="Geofenced Facilities"
          value={`${geofencedCount} / ${totalWarehouses}`}
          icon={ShieldCheck}
          sub={`${totalWarehouses ? Math.round((geofencedCount / totalWarehouses) * 100) : 0}% geofence coverage`}
          accent="emerald"
        />
        <KpiCard
          label="Avg Trip Rate"
          value={`AED ${avgTripAmount.toLocaleString()}`}
          icon={DollarSign}
          sub="FCL container corridor"
          accent="amber"
        />
        <KpiCard
          label="Avg Driver Allowance"
          value={`AED ${avgDriverAllowance.toLocaleString()}`}
          icon={DollarSign}
          sub="Per standard roundtrip"
          accent="violet"
        />
      </div>

      {/* View Switcher, Search, and Filters */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 p-3 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm">
        {/* View Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] w-fit">
          <button
            type="button"
            onClick={() => setViewMode('CLIENTS')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'CLIENTS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Clients View ({clients.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('FACILITIES')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'FACILITIES'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <Warehouse className="w-3.5 h-3.5" />
            <span>All Facilities / Warehouses ({warehouses.length})</span>
          </button>
        </div>

        {/* Search & Select Filters */}
        <div className="flex flex-wrap items-center gap-2 flex-1 lg:justify-end">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client, code, address, contact..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Industrial Zones</option>
            {INDUSTRIAL_ZONES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>

          <select
            value={geofenceFilter}
            onChange={(e) => setGeofenceFilter(e.target.value as any)}
            className="px-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Geofence Status</option>
            <option value="GEOFENCED">Geofenced Only (Yes)</option>
            <option value="NOT_GEOFENCED">Pending Geofence (No)</option>
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'CLIENTS' ? (
        /* CLIENT MASTER TABLE */
        <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)] text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="py-3 px-4">Client / Consignee</th>
                  <th className="py-3 px-3">Client Code</th>
                  <th className="py-3 px-3">Contact Person</th>
                  <th className="py-3 px-3">Contact No.</th>
                  <th className="py-3 px-3">Street Address</th>
                  <th className="py-3 px-3 text-right">Trip Amount</th>
                  <th className="py-3 px-3 text-right">Driver Allowance</th>
                  <th className="py-3 px-3 text-center">Warehouses</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                {filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[var(--text-muted)]">
                      <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40 text-blue-400" />
                      <p className="font-medium">No clients found matching current filter.</p>
                      <button
                        type="button"
                        onClick={openAddClient}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 text-xs font-semibold transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add First Client Master</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((client) => {
                    const clientWhs = warehouses.filter(
                      (w) => w.customerId === client.id || (w.customerName && w.customerName.toLowerCase() === client.name.toLowerCase())
                    );
                    const geofencedWhsCount = clientWhs.filter(w => Boolean(w.geofenceConfigured)).length;
                    const isSelected = selectedClientForWarehouses?.id === client.id;

                    return (
                      <tr
                        key={client.id}
                        className={`transition-colors hover:bg-[var(--bg-card)]/60 ${
                          isSelected ? 'bg-blue-500/5 border-l-2 border-l-blue-500' : ''
                        }`}
                      >
                        {/* Client Name */}
                        <td className="py-3.5 px-4 font-medium text-[var(--text-main)]">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-xs shrink-0">
                              {client.code?.slice(0, 2) || client.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-sm text-[var(--text-main)] flex items-center gap-2">
                                <span>{client.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                                  {client.city || 'Dubai'}
                                </span>
                              </div>
                              {client.trn && (
                                <div className="text-[10px] text-[var(--text-muted)]">
                                  TRN: {client.trn}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Client Code */}
                        <td className="py-3.5 px-3">
                          <span className="font-mono px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 font-bold text-xs">
                            {client.code}
                          </span>
                        </td>

                        {/* Contact Person */}
                        <td className="py-3.5 px-3 text-[var(--text-main)]">
                          {client.contactPerson ? (
                            <div className="flex items-center gap-1.5">
                              <User className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                              <span>{client.contactPerson}</span>
                            </div>
                          ) : (
                            <span className="text-[var(--text-muted)] italic">Not set</span>
                          )}
                        </td>

                        {/* Contact No */}
                        <td className="py-3.5 px-3">
                          {client.contactNo ? (
                            <a
                              href={`tel:${client.contactNo}`}
                              className="flex items-center gap-1.5 text-blue-400 hover:underline font-mono text-[11px]"
                            >
                              <Phone className="w-3 h-3 text-blue-400" />
                              <span>{client.contactNo}</span>
                            </a>
                          ) : (
                            <span className="text-[var(--text-muted)] italic">Not set</span>
                          )}
                        </td>

                        {/* Street Address */}
                        <td className="py-3.5 px-3 text-[var(--text-muted)] max-w-xs truncate" title={client.streetAddress || ''}>
                          {client.streetAddress ? (
                            <div className="flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                              <span className="truncate">{client.streetAddress}</span>
                            </div>
                          ) : (
                            <span className="italic">Not specified</span>
                          )}
                        </td>

                        {/* Trip Amount */}
                        <td className="py-3.5 px-3 text-right font-mono font-semibold text-emerald-400">
                          AED {(client.defaultTripAmountAed || 1550).toLocaleString()}
                        </td>

                        {/* Driver Allowance */}
                        <td className="py-3.5 px-3 text-right font-mono font-semibold text-amber-400">
                          AED {(client.defaultDriverAllowanceAed || 150).toLocaleString()}
                        </td>

                        {/* Warehouse Count & Manage Option */}
                        <td className="py-3.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedClientForWarehouses(client)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 font-semibold text-xs transition-all shadow-sm group"
                            title="Manage warehouses under this client"
                          >
                            <Warehouse className="w-3.5 h-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
                            <span>
                              Manage ({clientWhs.length})
                            </span>
                            {clientWhs.length > 0 && geofencedWhsCount === clientWhs.length && (
                              <span title="All warehouses geofenced">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 ml-0.5" />
                              </span>
                            )}
                          </button>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditClient(client)}
                              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                              title="Edit Client Master"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClient(client)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                              title="Delete Client Master"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ALL FACILITIES / WAREHOUSES TABLE */
        <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-card)] text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="py-3 px-4">Warehouse Facility</th>
                  <th className="py-3 px-3">Client / Consignee</th>
                  <th className="py-3 px-3">Industrial Zone</th>
                  <th className="py-3 px-3 text-center">Loading Ramps</th>
                  <th className="py-3 px-3 text-right">Trip Amount</th>
                  <th className="py-3 px-3 text-right">Driver Allowance</th>
                  <th className="py-3 px-3 text-center">Geofence Configured</th>
                  <th className="py-3 px-3 text-center">Plot on Map</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                {filteredWarehouses.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-[var(--text-muted)]">
                      <Warehouse className="w-8 h-8 mx-auto mb-2 opacity-40 text-blue-400" />
                      <p className="font-medium">No warehouse facilities found matching filter.</p>
                      <button
                        type="button"
                        onClick={() => openAddWarehouse()}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 text-xs font-semibold transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add First Facility</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredWarehouses.map((wh) => (
                    <tr key={wh.id} className="transition-colors hover:bg-[var(--bg-card)]/60">
                      {/* Warehouse Name */}
                      <td className="py-3.5 px-4 font-medium text-[var(--text-main)]">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                            <Warehouse className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-sm text-[var(--text-main)] flex items-center gap-2">
                              <span>{wh.name}</span>
                              {wh.code && (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-blue-400">
                                  {wh.code}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] truncate max-w-xs">
                              {wh.address || wh.zone}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Customer / Client */}
                      <td className="py-3.5 px-3 text-[var(--text-main)] font-medium">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-blue-400" />
                          <span>{wh.customerName}</span>
                        </div>
                      </td>

                      {/* Industrial Zone */}
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-500/10 border border-slate-500/20 text-[var(--text-main)] font-medium text-[11px]">
                          <MapPin className="w-3 h-3 text-blue-400" />
                          <span>{wh.zone}</span>
                        </span>
                      </td>

                      {/* Loading Ramps */}
                      <td className="py-3.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold font-mono text-[11px]">
                          {wh.rampsCount || 6} Ramps
                        </span>
                      </td>

                      {/* Trip Amount */}
                      <td className="py-3.5 px-3 text-right font-mono font-semibold text-emerald-400">
                        AED {(wh.tripAmountAed || 1550).toLocaleString()}
                      </td>

                      {/* Driver Allowance */}
                      <td className="py-3.5 px-3 text-right font-mono font-semibold text-amber-400">
                        AED {(wh.driverAllowanceAed || 150).toLocaleString()}
                      </td>

                      {/* Geofence Configured: Yes / No */}
                      <td className="py-3.5 px-3 text-center">
                        {wh.geofenceConfigured ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-semibold text-[11px]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Yes ({wh.geofenceRadiusMeters || 800}m)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-semibold text-[11px]">
                            <AlertTriangle className="w-3 h-3" />
                            <span>No</span>
                          </span>
                        )}
                      </td>

                      {/* Plot on Map */}
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => openPlotModal(wh)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-semibold text-xs transition-all shadow-sm"
                          title="Open interactive Google Maps to view or adjust geofence perimeter"
                        >
                          <Compass className="w-3.5 h-3.5 text-blue-400" />
                          <span>📍 Plot on Map</span>
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditWarehouse(wh)}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                            title="Edit Warehouse"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteWarehouse(wh)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                            title="Delete Warehouse"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DEDICATED WAREHOUSE MANAGEMENT DRAWER / MODAL (FOR SELECTED CLIENT) */}
      {selectedClientForWarehouses && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                  {selectedClientForWarehouses.code}
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                    <span>{selectedClientForWarehouses.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-semibold border border-blue-500/30">
                      Warehouse Network
                    </span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Default Rates: AED {selectedClientForWarehouses.defaultTripAmountAed} Trip / AED {selectedClientForWarehouses.defaultDriverAllowanceAed} Allowance • Contact: {selectedClientForWarehouses.contactPerson || 'N/A'} ({selectedClientForWarehouses.contactNo || 'N/A'})
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openAddWarehouse(selectedClientForWarehouses)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Warehouse for {selectedClientForWarehouses.code}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedClientForWarehouses(null)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Warehouses List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {(() => {
                const clientWhs = warehouses.filter(
                  (w) => w.customerId === selectedClientForWarehouses.id || (w.customerName && w.customerName.toLowerCase() === selectedClientForWarehouses.name.toLowerCase())
                );

                if (clientWhs.length === 0) {
                  return (
                    <div className="py-12 text-center text-[var(--text-muted)] rounded-2xl bg-[var(--bg-card)]/50 border border-dashed border-[var(--border-subtle)] p-6">
                      <Warehouse className="w-10 h-10 mx-auto mb-2 opacity-30 text-blue-400" />
                      <h4 className="text-sm font-semibold text-[var(--text-main)]">No warehouses configured yet</h4>
                      <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md mx-auto">
                        Add destination distribution centers, container yards, and cold storage facilities for {selectedClientForWarehouses.name}.
                      </p>
                      <button
                        type="button"
                        onClick={() => openAddWarehouse(selectedClientForWarehouses)}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow-md hover:bg-blue-500 transition-all"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add First Warehouse</span>
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {clientWhs.map((wh) => (
                      <div
                        key={wh.id}
                        className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col justify-between hover:border-blue-500/40 transition-all shadow-sm"
                      >
                        <div>
                          {/* Warehouse Title & Ramps */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-sm text-[var(--text-main)]">{wh.name}</h4>
                                {wh.code && (
                                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                                    {wh.code}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5">
                                <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
                                <span>{wh.zone}</span>
                              </p>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 font-bold font-mono text-[11px] shrink-0">
                              {wh.rampsCount || 6} Ramps
                            </span>
                          </div>

                          {/* Address & Contact */}
                          {wh.address && (
                            <p className="text-xs text-[var(--text-muted)] mt-2 bg-[var(--bg-surface)] p-2 rounded-lg border border-[var(--border-subtle)]">
                              {wh.address}
                            </p>
                          )}

                          {/* Rates & Geofence Status */}
                          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                                Trip Amount
                              </div>
                              <div className="font-mono font-bold text-emerald-400 text-sm">
                                AED {(wh.tripAmountAed || selectedClientForWarehouses.defaultTripAmountAed).toLocaleString()}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                                Driver Allowance
                              </div>
                              <div className="font-mono font-bold text-amber-400 text-sm">
                                AED {(wh.driverAllowanceAed || selectedClientForWarehouses.defaultDriverAllowanceAed).toLocaleString()}
                              </div>
                            </div>
                          </div>

                          {/* Geofence Configured Status */}
                          <div className="mt-3 flex items-center justify-between">
                            <div className="text-xs flex items-center gap-1.5">
                              <span className="text-[var(--text-muted)] font-medium">Geofence Configured:</span>
                              {wh.geofenceConfigured ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px]">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Yes ({wh.geofenceRadiusMeters || 800}m)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold text-[11px]">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>No</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions & Plot on Map button */}
                        <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[var(--border-subtle)]">
                          <button
                            type="button"
                            onClick={() => openPlotModal(wh)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-semibold text-xs transition-all shadow-sm"
                          >
                            <Compass className="w-3.5 h-3.5 text-blue-400" />
                            <span>📍 Plot on Map</span>
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditWarehouse(wh)}
                              className="px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-card)] text-[var(--text-main)] border border-[var(--border-subtle)] text-xs font-semibold transition-all flex items-center gap-1"
                            >
                              <Edit2 className="w-3 h-3 text-blue-400" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteWarehouse(wh)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                              title="Delete Warehouse"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Drawer Footer */}
            <div className="flex items-center justify-end px-6 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <button
                type="button"
                onClick={() => setSelectedClientForWarehouses(null)}
                className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-card)] transition-all"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT CLIENT MODAL */}
      {showClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-[var(--text-main)]">
                  {editingClient ? `Edit Client: ${editingClient.name}` : 'Add New Client Master'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowClientModal(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClient} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">
                    Client / Consignee Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={clientForm.name}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                    placeholder="e.g. Al-Futtaim Logistics LLC"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">
                    Client Code <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={clientForm.code}
                    onChange={(e) => setClientForm({ ...clientForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. ALF-LOG"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] font-mono uppercase focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">Contact Person</label>
                  <input
                    type="text"
                    value={clientForm.contactPerson}
                    onChange={(e) => setClientForm({ ...clientForm, contactPerson: e.target.value })}
                    placeholder="e.g. Tariq Al-Mansoori"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">Contact No. / Mobile</label>
                  <input
                    type="text"
                    value={clientForm.contactNo}
                    onChange={(e) => setClientForm({ ...clientForm, contactNo: e.target.value })}
                    placeholder="+971 50 482 9910"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">Street Address</label>
                  <input
                    type="text"
                    value={clientForm.streetAddress}
                    onChange={(e) => setClientForm({ ...clientForm, streetAddress: e.target.value })}
                    placeholder="e.g. Plot S-204, Road 4, JAFZA South"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">City / Emirate</label>
                  <input
                    type="text"
                    value={clientForm.city}
                    onChange={(e) => setClientForm({ ...clientForm, city: e.target.value })}
                    placeholder="Dubai"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">TRN (Tax Registration Number)</label>
                  <input
                    type="text"
                    value={clientForm.trn}
                    onChange={(e) => setClientForm({ ...clientForm, trn: e.target.value })}
                    placeholder="100294820100003"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">Trade License No.</label>
                  <input
                    type="text"
                    value={clientForm.tradeLicense}
                    onChange={(e) => setClientForm({ ...clientForm, tradeLicense: e.target.value })}
                    placeholder="CN-1029481"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Contractual Trip Amount (AED)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={clientForm.defaultTripAmountAed}
                    onChange={(e) => setClientForm({ ...clientForm, defaultTripAmountAed: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-emerald-500/30 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">Default rate billed per laden FCL trip.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Driver Allowance (AED)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={clientForm.defaultDriverAllowanceAed}
                    onChange={(e) => setClientForm({ ...clientForm, defaultDriverAllowanceAed: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-amber-500/30 text-xs text-amber-400 font-mono font-bold focus:outline-none focus:border-amber-500"
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">Default trip allowance paid to the assigned driver.</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--text-main)]">Operational Notes</label>
                <textarea
                  rows={2}
                  value={clientForm.notes}
                  onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })}
                  placeholder="e.g. Priority FCL client. Unloading at Gate 5 bay only."
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowClientModal(false)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
                >
                  {editingClient ? 'Save Changes' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT WAREHOUSE MODAL */}
      {showWarehouseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex items-center gap-2.5">
                <Warehouse className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-[var(--text-main)]">
                  {editingWarehouse ? `Edit Facility: ${editingWarehouse.name}` : 'Add Warehouse Facility'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowWarehouseModal(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveWarehouse} className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Linked Client */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--text-main)]">
                  Linked Client / Consignee <span className="text-rose-400">*</span>
                </label>
                <select
                  required
                  value={warehouseForm.customerId}
                  onChange={(e) => {
                    const cid = e.target.value;
                    const c = clients.find(cl => cl.id === cid);
                    setWarehouseForm({
                      ...warehouseForm,
                      customerId: cid,
                      customerName: c?.name || '',
                      tripAmountAed: c?.defaultTripAmountAed || warehouseForm.tripAmountAed,
                      driverAllowanceAed: c?.defaultDriverAllowanceAed || warehouseForm.driverAllowanceAed,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select Client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Warehouse Name & Code */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">
                    Warehouse Facility Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={warehouseForm.name}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                    placeholder="e.g. JAFZA South Fulfillment Hub (Gate 5)"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">Warehouse Code</label>
                  <input
                    type="text"
                    value={warehouseForm.code}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. WH-JAF-01"
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] font-mono uppercase focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Industrial Zone & Loading Ramps */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">
                    Industrial Area / Zone <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={warehouseForm.zone}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, zone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                  >
                    {INDUSTRIAL_ZONES.map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text-main)]">
                    Loading Ramps Count
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={warehouseForm.rampsCount}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, rampsCount: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-cyan-400 font-mono font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Street Address */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--text-main)]">Street Address</label>
                <input
                  type="text"
                  value={warehouseForm.address}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, address: e.target.value })}
                  placeholder="Plot S-204, Jebel Ali Free Zone South, Dubai"
                  className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Rates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Trip Amount (AED)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={warehouseForm.tripAmountAed}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, tripAmountAed: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-emerald-500/30 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Driver Allowance (AED)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={warehouseForm.driverAllowanceAed}
                    onChange={(e) => setWarehouseForm({ ...warehouseForm, driverAllowanceAed: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-amber-500/30 text-xs text-amber-400 font-mono font-bold focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Geofence Configuration Section */}
              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-[var(--text-main)]">Geofence Configured</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={warehouseForm.geofenceConfigured}
                      onChange={(e) => setWarehouseForm({ ...warehouseForm, geofenceConfigured: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {warehouseForm.geofenceConfigured && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]">Perimeter Type</label>
                      <select
                        value={warehouseForm.geofenceType}
                        onChange={(e) => setWarehouseForm({ ...warehouseForm, geofenceType: e.target.value as any })}
                        className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none"
                      >
                        <option value="CIRCLE">Circular Perimeter (Radius)</option>
                        <option value="POLYGON">Polygon Custom Boundary</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]">Geofence Radius (meters)</label>
                      <input
                        type="number"
                        min="100"
                        max="5000"
                        step="100"
                        value={warehouseForm.geofenceRadiusMeters}
                        onChange={(e) => setWarehouseForm({ ...warehouseForm, geofenceRadiusMeters: Number(e.target.value) })}
                        className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] font-mono focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowWarehouseModal(false)}
                  className="px-4 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
                >
                  {editingWarehouse ? 'Save Warehouse' : 'Create Warehouse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INTERACTIVE PLOT ON GOOGLE MAP MODAL */}
      {showPlotModal && plottingWarehouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-4xl h-[85vh] rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                    <span>Plot on Map: {plottingWarehouse.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30">
                      Google Maps Radar
                    </span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Drag the center marker or click anywhere on the map to set the warehouse gate location and perimeter.
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

            {/* Interactive Google Map Canvas */}
            <div className="flex-1 relative bg-slate-900 overflow-hidden">
              <div ref={mapContainerRef} className="w-full h-full" />

              {/* Top Floating Controls: Map Type Switcher & Geofence Stretching Controls */}
              <div className="absolute top-4 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[var(--bg-surface)]/95 backdrop-blur-md border border-[var(--border-subtle)] shadow-xl text-xs">
                {/* Left: Interactive Radius Slider & Coords */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="font-semibold text-[var(--text-main)] flex items-center gap-1.5">
                    <Move className="w-3.5 h-3.5 text-blue-400" />
                    <span>Vertex & Perimeter Stretching</span>
                  </div>

                  <div className="flex items-center gap-2">
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
                        if (circleRef.current) circleRef.current.setRadius(r);
                      }}
                      className="w-28 accent-blue-500 cursor-pointer"
                    />
                    <span className="font-mono font-bold text-blue-400">{plotRadius}m</span>
                  </div>

                  <div className="text-[11px] text-[var(--text-muted)] font-mono hidden sm:inline">
                    ({plotCoordinates.lat.toFixed(5)}, {plotCoordinates.lng.toFixed(5)})
                  </div>
                </div>

                {/* Right: Map Type Switcher (Default, Satellite, Hybrid, Terrain) */}
                <div className="flex items-center gap-1 bg-[var(--bg-card)] p-0.5 rounded-lg border border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => {
                      setPlotMapTypeId('roadmap');
                      mapInstanceRef.current?.setMapTypeId?.('roadmap');
                    }}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all ${
                      plotMapTypeId === 'roadmap'
                        ? 'bg-blue-600 text-white shadow-sm'
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
                        ? 'bg-blue-600 text-white shadow-sm'
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
                        ? 'bg-blue-600 text-white shadow-sm'
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
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    <Mountain className="w-3 h-3" />
                    <span>Terrain</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="text-xs text-[var(--text-muted)] flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Geofence events trigger auto-arrival detection when prime movers cross this boundary.</span>
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
                  onClick={handleSavePlotOnMap}
                  disabled={savingPlot}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50"
                >
                  {savingPlot ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>Save Geofence & Location</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
