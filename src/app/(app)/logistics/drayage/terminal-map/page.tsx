'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  MapPin,
  Anchor,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Compass,
  X,
  Clock,
  Warehouse,
  Building2,
  Navigation,
} from 'lucide-react';
import type { PlotContext } from '@/components/logistics/drayage/DrayageGeofenceMap';
import { ConsigneeDestinationModal } from '@/components/logistics/drayage/ConsigneeDestinationModal';
import { PageHeader, KpiCard, Panel } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

const DrayageGeofenceMap = dynamic(
  () => import('@/components/logistics/drayage/DrayageGeofenceMap'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[450px] rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col items-center justify-center gap-2 text-xs text-[var(--text-muted)] animate-pulse">
        <Compass className="w-6 h-6 text-blue-400 animate-spin" />
        <span>Loading Live Google Maps Drayage Radar...</span>
      </div>
    ),
  }
);

interface DrayageTerminal {
  id: string;
  name: string;
  code: string;
  portName: string;
  emirate: string;
  lat: number;
  lng: number;
  geofenceRadiusMeters: number;
  freeDaysDry: number;
  freeDaysReefer: number;
  operatingHours: string;
  status: string;
}

interface DrayageClient {
  id: string;
  tenantId?: string;
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
  notes?: string | null;
}

interface DrayageWarehouse {
  id: string;
  customerId: string | null;
  customerName: string;
  name: string;
  zone: string;
  address?: string;
  lat?: number;
  lng?: number;
  rampsCount?: number;
  contactPerson?: string;
  contactPhone?: string;
}

interface CustomerOption {
  id: string;
  name: string;
}

interface DrayageGeofence {
  id: string;
  terminalId: string | null;
  terminalName: string;
  name: string;
  type: 'CIRCLE' | 'POLYGON';
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  coordinatesJson: string;
  createdAt: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class GeofenceMapErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('GeofenceMapErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-[320px] rounded-2xl bg-[var(--bg-surface)] border border-amber-500/30 p-6 flex flex-col items-center justify-center text-center gap-3">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <div className="text-sm font-bold text-[var(--text-main)]">
            Interactive Geofence Map Recovered
          </div>
          <p className="text-xs text-[var(--text-muted)] max-w-md">
            WebGL or map styling encountered an issue in this browser session. You can still manage all ports, geofences, and warehouse destinations below without interruption.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
          >
            Retry Map Load
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DrayageTerminalMapPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.terminals);
  const [terminals, setTerminals] = useState<DrayageTerminal[]>(cached?.terminals || []);
  const [geofences, setGeofences] = useState<DrayageGeofence[]>(cached?.geofences || []);
  const [warehouses, setWarehouses] = useState<DrayageWarehouse[]>(cached?.warehouses || []);
  const [clients, setClients] = useState<DrayageClient[]>(cached?.clients || []);
  const [, setCustomers] = useState<CustomerOption[]>(cached?.customers || []);
  const [selectedTerminal, setSelectedTerminal] = useState<DrayageTerminal | null>(cached?.terminals?.[0] || null);

  // Map Navigation & Interactive Plot Mode State
  const [focusMapLocation, setFocusMapLocation] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    title?: string;
  } | null>(null);

  const [plotContext, setPlotContext] = useState<PlotContext | null>(null);

  // Terminal Modal State (Add / Edit)
  const [showTerminalModal, setShowTerminalModal] = useState(false);
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [termName, setTermName] = useState('');
  const [termCode, setTermCode] = useState('');
  const [termPortName, setTermPortName] = useState('Jebel Ali Port');
  const [termEmirate, setTermEmirate] = useState('Dubai');
  const [termLat, setTermLat] = useState(25.0112);
  const [termLng, setTermLng] = useState(55.0612);
  const [termRadius, setTermRadius] = useState(1500);
  const [termFreeDry, setTermFreeDry] = useState(5);
  const [termFreeReefer, setTermFreeReefer] = useState(3);
  const [termOperatingHours, setTermOperatingHours] = useState('24/7 Gate Operations');
  const [submittingTerm, setSubmittingTerm] = useState(false);

  // Warehouse Modal State (Add / Edit)
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);

  // Geofence Modal State
  const [showGeofenceModal, setShowGeofenceModal] = useState(false);
  const [geofenceName, setGeofenceName] = useState('');
  const [geofenceType, setGeofenceType] = useState<'CIRCLE' | 'POLYGON'>('CIRCLE');
  const [geofenceRadius, setGeofenceRadius] = useState(1500);
  const [geofenceLat, setGeofenceLat] = useState(25.0112);
  const [geofenceLng, setGeofenceLng] = useState(55.0612);
  const [targetTerminalId, setTargetTerminalId] = useState('');
  const [editingGeofenceId, setEditingGeofenceId] = useState<string | null>(null);
  const [mapEditGeofenceId, setMapEditGeofenceId] = useState<string | null>(null);
  const [submittingGf, setSubmittingGf] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const scrollToMap = () => {
    if (typeof window !== 'undefined') {
      const mapEl = document.getElementById('geofence-map-view');
      if (mapEl) {
        mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const loadData = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.terminals) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      const terms: DrayageTerminal[] = data?.terminals || [];
      setTerminals(terms);
      setGeofences(data?.geofences || []);
      setWarehouses(data?.warehouses || []);
      setClients(data?.clients || []);
      setCustomers(data?.customers || []);
      if (terms.length > 0 && !selectedTerminal) {
        setSelectedTerminal(terms[0]);
      }
    } catch (err) {
      if (!getCachedDrayageData()?.terminals) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch terminal map');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedTerminal]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Terminal Handlers
  const handleOpenAddTerminal = () => {
    setEditingTerminalId(null);
    setTermName('');
    setTermCode('');
    setTermPortName('Jebel Ali Port');
    setTermEmirate('Dubai');
    setTermLat(25.0112);
    setTermLng(55.0612);
    setTermRadius(1500);
    setTermFreeDry(5);
    setTermFreeReefer(3);
    setTermOperatingHours('24/7 Gate Operations');
    setShowTerminalModal(true);
    setFocusMapLocation({ lat: 25.0112, lng: 55.0612, zoom: 14, title: 'New Terminal' });
  };

  const handleOpenEditTerminal = (t: DrayageTerminal) => {
    setEditingTerminalId(t.id);
    setTermName(t.name);
    setTermCode(t.code);
    setTermPortName(t.portName);
    setTermEmirate(t.emirate);
    setTermLat(t.lat);
    setTermLng(t.lng);
    setTermRadius(t.geofenceRadiusMeters);
    setTermFreeDry(t.freeDaysDry);
    setTermFreeReefer(t.freeDaysReefer);
    setTermOperatingHours(t.operatingHours);
    setShowTerminalModal(true);

    // Map automatically points to that particular geofence / terminal location
    const matchingGf = geofences.find((g) => g.terminalId === t.id) || geofences.find((g) => g.terminalName === t.name);
    const targetLat = matchingGf ? matchingGf.centerLat : t.lat;
    const targetLng = matchingGf ? matchingGf.centerLng : t.lng;
    setFocusMapLocation({ lat: targetLat, lng: targetLng, zoom: 14.5, title: t.name });
    scrollToMap();
  };

  const handleSaveTerminal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termName.trim()) {
      showToast('error', 'Terminal name is required');
      return;
    }
    if (!termCode.trim()) {
      showToast('error', 'Terminal code (e.g. DPW-JA-T1) is required');
      return;
    }

    try {
      setSubmittingTerm(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_terminal',
          id: editingTerminalId || undefined,
          name: termName.trim(),
          code: termCode.trim().toUpperCase(),
          portName: termPortName.trim() || 'Jebel Ali Port',
          emirate: termEmirate.trim() || 'Dubai',
          lat: Number(termLat),
          lng: Number(termLng),
          geofenceRadiusMeters: Number(termRadius),
          freeDaysDry: Number(termFreeDry),
          freeDaysReefer: Number(termFreeReefer),
          operatingHours: termOperatingHours.trim() || '24/7 Gate Operations',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save terminal');

      setShowTerminalModal(false);
      setPlotContext(null);
      invalidateDrayageClientCache();
      await loadData(true);
      showToast('success', editingTerminalId ? `Terminal "${termName}" updated successfully` : `Terminal "${termName}" created`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error saving terminal');
    } finally {
      setSubmittingTerm(false);
    }
  };

  const handleDeleteTerminal = async (t: DrayageTerminal) => {
    if (!confirm(`Are you sure you want to delete port terminal "${t.name}" (${t.code})?`)) return;
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_terminal', id: t.id }),
      });
      if (!res.ok) throw new Error('Failed to delete terminal');
      showToast('success', `Terminal "${t.name}" removed`);
      if (selectedTerminal?.id === t.id) {
        setSelectedTerminal(null);
      }
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error deleting terminal');
    }
  };

  const handleStartPlotTerminal = () => {
    setShowTerminalModal(false);
    setPlotContext({
      type: 'TERMINAL',
      title: termName || 'Terminal Location',
      lat: termLat,
      lng: termLng,
      radiusMeters: termRadius || 1500,
      geofenceType: 'CIRCLE',
      onApply: (res: { lat: number; lng: number; radiusMeters: number; geofenceType: 'CIRCLE' | 'POLYGON' }) => {
        setTermLat(Number(res.lat.toFixed(6)));
        setTermLng(Number(res.lng.toFixed(6)));
        setTermRadius(res.radiusMeters || 1500);
        setPlotContext(null);
        setShowTerminalModal(true);
        showToast('success', `Geofence coordinates applied: ${res.lat.toFixed(5)}, ${res.lng.toFixed(5)} (${res.radiusMeters}m)`);
      },
      onCancel: () => {
        setPlotContext(null);
        setShowTerminalModal(true);
      },
    });
    setFocusMapLocation({ lat: termLat, lng: termLng, zoom: 15, title: termName || 'Terminal' });
    scrollToMap();
  };

  // Warehouse Handlers
  const [selectedWarehouseForEdit, setSelectedWarehouseForEdit] = useState<DrayageWarehouse | null>(null);

  const handleOpenAddWarehouse = () => {
    setSelectedWarehouseForEdit(null);
    setShowWarehouseModal(true);
  };

  const handleOpenEditWarehouse = (w: DrayageWarehouse) => {
    setSelectedWarehouseForEdit(w);
    setShowWarehouseModal(true);
  };

  const handleDeleteWarehouse = async (w: DrayageWarehouse) => {
    if (!confirm(`Are you sure you want to delete consignee warehouse "${w.name}"?`)) return;
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_warehouse', id: w.id }),
      });
      if (!res.ok) throw new Error('Failed to delete warehouse');
      showToast('success', `Warehouse "${w.name}" deleted`);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error deleting warehouse');
    }
  };

  // Geofence Handlers
  const handleOpenAddGeofence = () => {
    setEditingGeofenceId(null);
    const term = selectedTerminal || terminals[0];
    setTargetTerminalId(term?.id || '');
    setGeofenceName(term ? `${term.name} OCR Gate Perimeter` : 'New Port Geofence');
    setGeofenceType('CIRCLE');
    setGeofenceRadius(term?.geofenceRadiusMeters || 1500);
    setGeofenceLat(term?.lat || 25.0112);
    setGeofenceLng(term?.lng || 55.0612);
    setShowGeofenceModal(true);
    setFocusMapLocation({ lat: term?.lat || 25.0112, lng: term?.lng || 55.0612, zoom: 14, title: term?.name });
  };

  // Renamed button action from "+ Add Geofence" to "Edit Geofence" in Selected Terminal Card:
  // Points directly to that terminal's geofence on the map!
  const handleEditSelectedTerminalGeofence = () => {
    if (!selectedTerminal) return;
    const matchingGf = geofences.find((g) => g.terminalId === selectedTerminal.id) ||
                       geofences.find((g) => g.terminalName === selectedTerminal.name);
    if (matchingGf) {
      setMapEditGeofenceId(matchingGf.id);
      setFocusMapLocation({
        lat: matchingGf.centerLat,
        lng: matchingGf.centerLng,
        zoom: 14.5,
        title: matchingGf.name,
      });
      scrollToMap();
      showToast('success', `Editing geofence for ${selectedTerminal.name} on map`);
    } else {
      // If no geofence exists yet for this terminal, open the modal pre-filled
      handleOpenAddGeofence();
    }
  };

  const handleOpenEditGeofence = (gf: DrayageGeofence) => {
    setEditingGeofenceId(gf.id);
    setTargetTerminalId(gf.terminalId || '');
    setGeofenceName(gf.name);
    setGeofenceType(gf.type);
    setGeofenceRadius(gf.radiusMeters || 1500);
    setGeofenceLat(gf.centerLat || 25.0112);
    setGeofenceLng(gf.centerLng || 55.0612);
    setShowGeofenceModal(true);

    // Map automatically points to that geofence
    setFocusMapLocation({ lat: gf.centerLat, lng: gf.centerLng, zoom: 14.5, title: gf.name });
    scrollToMap();
  };

  const handleSaveGeofenceFromMap = async (gf: {
    id?: string;
    terminalId: string | null;
    terminalName: string;
    name: string;
    type: 'CIRCLE' | 'POLYGON';
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    coordinates?: Array<{ lat: number; lng: number }>;
  }) => {
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_geofence',
          id: gf.id,
          terminalId: gf.terminalId,
          terminalName: gf.terminalName,
          name: gf.name,
          type: gf.type,
          centerLat: gf.centerLat,
          centerLng: gf.centerLng,
          radiusMeters: gf.radiusMeters,
          coordinates: gf.coordinates && gf.coordinates.length > 0 ? gf.coordinates : [{ lat: gf.centerLat, lng: gf.centerLng }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save geofence');
      showToast(
        'success',
        gf.id
          ? `Geofence "${gf.name}" updated successfully via map!`
          : `Geofence "${gf.name}" created successfully via map!`
      );
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error saving geofence');
      throw err;
    }
  };

  const handleSaveGeofence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!geofenceName.trim()) {
      showToast('error', 'Geofence name is required');
      return;
    }
    const term = terminals.find((t) => t.id === targetTerminalId);
    try {
      setSubmittingGf(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_geofence',
          id: editingGeofenceId || undefined,
          terminalId: targetTerminalId || null,
          terminalName: term?.name || 'Port Terminal',
          name: geofenceName.trim(),
          type: geofenceType,
          centerLat: Number(geofenceLat),
          centerLng: Number(geofenceLng),
          radiusMeters: Number(geofenceRadius),
          coordinates: [{ lat: Number(geofenceLat), lng: Number(geofenceLng) }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save geofence');
      showToast(
        'success',
        editingGeofenceId
          ? `Geofence "${geofenceName}" updated successfully!`
          : `Geofence "${geofenceName}" saved successfully!`
      );
      setShowGeofenceModal(false);
      setEditingGeofenceId(null);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error saving geofence');
    } finally {
      setSubmittingGf(false);
    }
  };

  const handleDeleteGeofence = async (id: string, name: string) => {
    if (!confirm(`Delete geofence "${name}"?`)) return;
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_geofence', id }),
      });
      if (!res.ok) throw new Error('Failed to delete geofence');
      showToast('success', `Geofence "${name}" deleted`);
      invalidateDrayageClientCache();
      await loadData(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error deleting geofence');
    }
  };

  return (
    <div className="space-y-6">

      

      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Port Terminals & Geofence Management"
        subtitle="Configure GPS geofence triggers for automated OCR gate-in, demurrage clock starts, and ramp arrival notifications"
        icon={MapPin}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleOpenAddTerminal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-blue-500/40 text-blue-400 hover:bg-blue-600/10 text-xs font-semibold transition-colors shadow-sm"
            >
              <Anchor className="w-3.5 h-3.5" />
              + Add Terminal
            </button>
            <button
              onClick={handleOpenAddGeofence}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Geofence
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Mapped Port Terminals"
          value={terminals.length}
          icon={Anchor}
          accent="blue"
          sub="Dubai & Abu Dhabi"
        />
        <KpiCard
          label="Active Geofence Zones"
          value={geofences.length}
          icon={Compass}
          accent="emerald"
          sub="Automated OCR triggers"
        />
        <KpiCard
          label="Standard Dry Free Days"
          value="5 Days"
          icon={Clock}
          accent="amber"
          sub="DP World / AD Ports standard"
        />
        <KpiCard
          label="Reefer Free Days"
          value="3 Days"
          icon={ShieldCheck}
          accent="rose"
          sub="Refrigerated cargo standard"
        />
      </div>

      {/* Live Interactive Drayage Geofence Map */}
      <div id="geofence-map-view">
        <GeofenceMapErrorBoundary>
          <DrayageGeofenceMap
            terminals={terminals}
            geofences={geofences}
            warehouses={warehouses}
            selectedTerminalId={selectedTerminal?.id}
            onSelectTerminal={(t) => {
              const matched = terminals.find((item) => item.id === t.id);
              if (matched) setSelectedTerminal(matched);
            }}
            onSelectWarehouse={(wh) => {
              setFocusMapLocation({
                lat: wh.lat || 24.9642,
                lng: wh.lng || 55.0915,
                zoom: 14.5,
                title: wh.name,
              });
            }}
            onSaveGeofence={handleSaveGeofenceFromMap}
            onDeleteGeofence={handleDeleteGeofence}
            activeEditGeofenceId={mapEditGeofenceId}
            onCloseEditMode={() => setMapEditGeofenceId(null)}
            focusLocation={focusMapLocation}
            plotContext={plotContext}
          />
        </GeofenceMapErrorBoundary>
      </div>

      {/* Split Map View: Left Terminal Cards / Right Geofence Radar Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Terminals list (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-main)] flex items-center gap-1.5">
              <Anchor className="w-3.5 h-3.5 text-blue-400" />
              Major UAE Ports & Terminals
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-muted)]">{terminals.length} Ports</span>
              <button
                type="button"
                onClick={handleOpenAddTerminal}
                className="px-2 py-1 rounded bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add Terminal
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {terminals.map((t) => {
              const selected = selectedTerminal?.id === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    setSelectedTerminal(t);
                    setFocusMapLocation({ lat: t.lat, lng: t.lng, zoom: 14, title: t.name });
                  }}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selected
                      ? 'bg-blue-600/10 border-blue-500 text-[var(--text-main)] shadow-sm'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-start justify-between mb-1.5 gap-2">
                    <span className="font-bold text-xs text-[var(--text-main)] leading-snug">{t.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-blue-400 font-bold">
                        {t.code}
                      </span>
                      <button
                        type="button"
                        title="Plot / Point on Map"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusMapLocation({ lat: t.lat, lng: t.lng, zoom: 14.5, title: t.name });
                          scrollToMap();
                        }}
                        className="p-1 rounded hover:bg-blue-600/20 text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                      >
                        <Compass className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Edit Terminal & Code"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEditTerminal(t);
                        }}
                        className="p-1 rounded hover:bg-blue-600/20 text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete Terminal"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTerminal(t);
                        }}
                        className="p-1 rounded hover:bg-rose-600/20 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span>
                      {t.portName} · {t.emirate}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-[var(--border-subtle)] text-[10px]">
                    <div>
                      <span className="text-[var(--text-muted)] block">Radius</span>
                      <strong className="font-mono text-[var(--text-main)]">{t.geofenceRadiusMeters}m</strong>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)] block">Dry Free</span>
                      <strong className="font-mono text-emerald-400">{t.freeDaysDry} Days</strong>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)] block">Reefer Free</span>
                      <strong className="font-mono text-amber-400">{t.freeDaysReefer} Days</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Terminal & Geofence Table (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {selectedTerminal && (
            <div className="p-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                      <Anchor className="w-4 h-4 text-blue-400" />
                      {selectedTerminal.name}
                    </h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 font-bold">
                      {selectedTerminal.code}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Operating Hours: {selectedTerminal.operatingHours} · Emirate: {selectedTerminal.emirate}
                  </p>
                </div>
                {/* RENAMED BUTTON: "+ Add Geofence" -> "Edit Geofence" with Edit2 icon */}
                <button
                  type="button"
                  onClick={handleEditSelectedTerminalGeofence}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-xs font-semibold transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Geofence
                </button>
              </div>

              {/* Coordinates & Technical Specs */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">GPS Coordinates</span>
                  <strong className="font-mono text-[var(--text-main)]">
                    {selectedTerminal.lat.toFixed(4)}, {selectedTerminal.lng.toFixed(4)}
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Geofence Radius</span>
                  <strong className="font-mono text-blue-400">
                    {selectedTerminal.geofenceRadiusMeters.toLocaleString()} Meters
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Gate Status</span>
                  <strong className="text-emerald-400 flex items-center gap-1 mt-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 24/7 OCR ACTIVE
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Configured Geofences for this port / corridor */}
          <Panel
            title={`Configured Port Geofences (${geofences.length} Total)`}
            icon={Compass}
            accent="blue"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Geofence Zone Name</th>
                    <th className="py-2.5 px-3 font-semibold">Terminal Link</th>
                    <th className="py-2.5 px-3 font-semibold">Geometry</th>
                    <th className="py-2.5 px-3 font-semibold">Radius</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                  {geofences.map((gf) => (
                    <tr key={gf.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-[var(--text-main)]">{gf.name}</div>
                        <div className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">
                          {gf.centerLat.toFixed(4)}, {gf.centerLng.toFixed(4)}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-[var(--text-muted)]">{gf.terminalName}</td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          gf.type === 'POLYGON'
                            ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400'
                            : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                        }`}>
                          {gf.type === 'POLYGON' ? '⬡ Polygon' : '⚪ Circular'}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono font-medium">
                        {gf.type === 'POLYGON' ? 'Custom Bounds' : `${gf.radiusMeters}m`}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Point on Map"
                            onClick={() => {
                              setFocusMapLocation({ lat: gf.centerLat, lng: gf.centerLng, zoom: 14.5, title: gf.name });
                              scrollToMap();
                            }}
                            className="p-1 rounded hover:bg-blue-600/20 text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                          >
                            <Compass className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Edit Geofence"
                            onClick={() => handleOpenEditGeofence(gf)}
                            className="p-1 rounded hover:bg-blue-600/20 text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Delete Geofence"
                            onClick={() => handleDeleteGeofence(gf.id, gf.name)}
                            className="p-1 rounded hover:bg-rose-600/20 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      {/* Add / Edit Terminal Modal */}
      {showTerminalModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Anchor className="w-4 h-4 text-blue-400" />
                {editingTerminalId ? 'Edit Port Terminal & Code' : 'Add Port Terminal'}
              </h3>
              <button
                type="button"
                onClick={() => setShowTerminalModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTerminal} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Terminal Name *</label>
                  <input
                    type="text"
                    required
                    value={termName}
                    onChange={(e) => setTermName(e.target.value)}
                    placeholder="e.g. Jebel Ali Port - Terminal 1 (DP World)"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-[var(--text-muted)]">Terminal Code *</label>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">Format: [OPERATOR]-[PORT]-[BERTH]</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={termCode}
                    onChange={(e) => setTermCode(e.target.value.toUpperCase())}
                    placeholder="e.g. DPW-JA-T1, ADP-KP-T1, DPW-PR-T1"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold outline-none focus:border-blue-500 uppercase placeholder:text-slate-500/60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Port Authority / Facility</label>
                  <input
                    type="text"
                    value={termPortName}
                    onChange={(e) => setTermPortName(e.target.value)}
                    placeholder="e.g. Jebel Ali Port, Khalifa Port"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Emirate</label>
                  <select
                    value={termEmirate}
                    onChange={(e) => setTermEmirate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="Dubai">Dubai</option>
                    <option value="Abu Dhabi">Abu Dhabi</option>
                    <option value="Sharjah">Sharjah</option>
                    <option value="Fujairah">Fujairah</option>
                    <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                  </select>
                </div>
              </div>

              {/* Coordinates with Plot on Map button */}
              <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text-muted)] text-[11px] flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-blue-400" />
                    GPS Coordinates
                  </span>
                  <button
                    type="button"
                    onClick={handleStartPlotTerminal}
                    className="px-2.5 py-1 rounded bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors flex items-center gap-1"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    📍 Plot on Map
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--text-muted)]">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={termLat}
                      onChange={(e) => setTermLat(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-[var(--text-muted)]">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={termLng}
                      onChange={(e) => setTermLng(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Geofence Radius (m)</label>
                  <input
                    type="number"
                    value={termRadius}
                    onChange={(e) => setTermRadius(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Dry Free Days</label>
                  <input
                    type="number"
                    value={termFreeDry}
                    onChange={(e) => setTermFreeDry(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Reefer Free Days</label>
                  <input
                    type="number"
                    value={termFreeReefer}
                    onChange={(e) => setTermFreeReefer(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Operating Hours</label>
                <input
                  type="text"
                  value={termOperatingHours}
                  onChange={(e) => setTermOperatingHours(e.target.value)}
                  placeholder="e.g. 24/7 Gate Operations"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowTerminalModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingTerm}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50 shadow-sm"
                >
                  {submittingTerm ? 'Saving...' : editingTerminalId ? 'Update Terminal' : 'Save Terminal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Geofence Modal */}
      {showGeofenceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Compass className="w-4 h-4 text-blue-400" />
                {editingGeofenceId ? 'Edit Port / Warehouse Geofence Zone' : 'Configure New Port / Warehouse Geofence'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGeofenceModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGeofence} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Terminal / Facility Link</label>
                <select
                  value={targetTerminalId}
                  onChange={(e) => {
                    setTargetTerminalId(e.target.value);
                    const matched = terminals.find((t) => t.id === e.target.value);
                    if (matched) {
                      setGeofenceLat(matched.lat);
                      setGeofenceLng(matched.lng);
                      setFocusMapLocation({ lat: matched.lat, lng: matched.lng, zoom: 14 });
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Geofence Name *</label>
                <input
                  type="text"
                  value={geofenceName}
                  onChange={(e) => setGeofenceName(e.target.value)}
                  placeholder="e.g. Jebel Ali T1 Gate 3 Inbound Perimeter"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Geometry Type</label>
                  <select
                    value={geofenceType}
                    onChange={(e) => setGeofenceType(e.target.value as Parameters<typeof setGeofenceType>[0])}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="CIRCLE">Circular Perimeter</option>
                    <option value="POLYGON">Polygon Ramp Zone</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Radius (Meters)</label>
                  <input
                    type="number"
                    value={geofenceRadius}
                    onChange={(e) => setGeofenceRadius(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Center Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={geofenceLat}
                    onChange={(e) => setGeofenceLat(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Center Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={geofenceLng}
                    onChange={(e) => setGeofenceLng(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowGeofenceModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingGf}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submittingGf ? (editingGeofenceId ? 'Updating...' : 'Saving...') : (editingGeofenceId ? 'Update Geofence' : 'Save Geofence')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Client Destination Warehouses & Consignee Hubs Section */}
      <Panel
        title="Consignee Destinations & Client Warehouses"
        subtitle="Manage receiving client facilities, distribution centers, and private ramps linked to Consignor Customers"
        icon={Warehouse}
        accent="emerald"
        actions={
          <button
            type="button"
            onClick={handleOpenAddWarehouse}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Consignee Destination
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-main)]/50">
                <th className="py-2.5 px-3 font-semibold">Consignee Facility (Client)</th>
                <th className="py-2.5 px-3 font-semibold">Consignor (Customer)</th>
                <th className="py-2.5 px-3 font-semibold">Industrial Zone</th>
                <th className="py-2.5 px-3 font-semibold">Address</th>
                <th className="py-2.5 px-3 font-semibold text-center">Unloading Ramps</th>
                <th className="py-2.5 px-3 font-semibold">Receiving Contact (Consignee Rep)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {warehouses.map((w) => (
                <tr key={w.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="py-3 px-3">
                    <div className="font-bold text-[var(--text-main)] flex items-center gap-1.5">
                      <Warehouse className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      {w.name}
                    </div>
                    {w.lat && w.lng && (
                      <div className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">
                        {w.lat.toFixed(4)}, {w.lng.toFixed(4)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                      <Building2 className="w-3 h-3 text-blue-400" />
                      {w.customerName || 'All Customers'}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[10px] font-medium text-emerald-400">
                      {w.zone}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-[var(--text-muted)] max-w-[200px] truncate">
                    {w.address || '—'}
                  </td>
                  <td className="py-3 px-3 text-center font-mono font-semibold">
                    {w.rampsCount ?? 4}
                  </td>
                  <td className="py-3 px-3">
                    {w.contactPerson || w.contactPhone ? (
                      <div className="space-y-0.5">
                        {w.contactPerson && <div className="font-medium text-[var(--text-main)]">{w.contactPerson}</div>}
                        {w.contactPhone && <div className="text-[10px] font-mono text-[var(--text-muted)]">{w.contactPhone}</div>}
                      </div>
                    ) : (
                      <span className="text-[var(--text-faint)]">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title="Plot / Point on Map"
                        onClick={() => {
                          setFocusMapLocation({
                            lat: w.lat || 24.9642,
                            lng: w.lng || 55.0915,
                            zoom: 14.5,
                            title: w.name,
                          });
                          scrollToMap();
                        }}
                        className="p-1 rounded hover:bg-emerald-600/20 text-[var(--text-muted)] hover:text-emerald-400 transition-colors"
                      >
                        <Compass className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Edit Consignee"
                        onClick={() => handleOpenEditWarehouse(w)}
                        className="p-1 rounded hover:bg-blue-600/20 text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete Consignee"
                        onClick={() => handleDeleteWarehouse(w)}
                        className="p-1 rounded hover:bg-rose-600/20 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Unified Consignee Destination / Facility / Warehouse Modal */}
      <ConsigneeDestinationModal
        isOpen={showWarehouseModal}
        onClose={() => {
          setShowWarehouseModal(false);
          setSelectedWarehouseForEdit(null);
        }}
        initialData={selectedWarehouseForEdit}
        clients={clients}
        onClientCreated={(newCli) => {
          setClients((prev) => [newCli as (typeof prev)[number], ...prev]);
        }}
        onSaved={async () => {
          invalidateDrayageClientCache();
          await loadData(true);
          showToast('success', selectedWarehouseForEdit ? 'Consignee destination updated successfully' : 'Consignee destination created successfully');
        }}
      />

    </div>
  );
}
