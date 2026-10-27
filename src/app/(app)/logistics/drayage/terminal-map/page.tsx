'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  MapPin, Anchor, Plus, Trash2, CheckCircle2, AlertTriangle, RefreshCw,
  Search, ShieldCheck, Compass, Layers, ExternalLink, X, Map, Clock,
  Warehouse, Building2, User, Phone,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

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

export default function DrayageTerminalMapPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.terminals);
  const [terminals, setTerminals] = useState<DrayageTerminal[]>(cached?.terminals || []);
  const [geofences, setGeofences] = useState<DrayageGeofence[]>(cached?.geofences || []);
  const [warehouses, setWarehouses] = useState<DrayageWarehouse[]>(cached?.warehouses || []);
  const [customers, setCustomers] = useState<CustomerOption[]>(cached?.customers || []);
  const [selectedTerminal, setSelectedTerminal] = useState<DrayageTerminal | null>(cached?.terminals?.[0] || null);

  // Warehouse Modal State
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [newWhName, setNewWhName] = useState('');
  const [newWhZone, setNewWhZone] = useState('JAFZA South');
  const [newWhAddress, setNewWhAddress] = useState('');
  const [newWhContact, setNewWhContact] = useState('');
  const [newWhPhone, setNewWhPhone] = useState('');
  const [newWhRamps, setNewWhRamps] = useState(4);
  const [newWhCustomerId, setNewWhCustomerId] = useState('');
  const [submittingWh, setSubmittingWh] = useState(false);

  // Geofence Modal
  const [showGeofenceModal, setShowGeofenceModal] = useState(false);
  const [geofenceName, setGeofenceName] = useState('');
  const [geofenceType, setGeofenceType] = useState<'CIRCLE' | 'POLYGON'>('CIRCLE');
  const [geofenceRadius, setGeofenceRadius] = useState(1500);
  const [geofenceLat, setGeofenceLat] = useState(25.0112);
  const [geofenceLng, setGeofenceLng] = useState(55.0612);
  const [targetTerminalId, setTargetTerminalId] = useState('');
  const [submittingGf, setSubmittingGf] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
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

  const handleSaveWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhName.trim()) {
      showToast('error', 'Please enter warehouse / facility name');
      return;
    }
    const cust = customers.find((c) => c.id === newWhCustomerId);
    try {
      setSubmittingWh(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_warehouse',
          customerId: newWhCustomerId || null,
          customerName: cust?.name || 'Enterprise Client',
          name: newWhName.trim(),
          zone: newWhZone.trim() || 'JAFZA South',
          address: newWhAddress.trim() || 'Dubai, UAE',
          contactPerson: newWhContact.trim() || undefined,
          contactPhone: newWhPhone.trim() || undefined,
          rampsCount: Number(newWhRamps) || 4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create warehouse');

      setShowWarehouseModal(false);
      setNewWhName('');
      setNewWhZone('JAFZA South');
      setNewWhAddress('');
      setNewWhContact('');
      setNewWhPhone('');
      setNewWhRamps(4);
      invalidateDrayageClientCache();
      await loadData(true);
      showToast('success', 'Client destination warehouse created successfully');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating warehouse');
    } finally {
      setSubmittingWh(false);
    }
  };

  const handleOpenAddGeofence = () => {
    const term = selectedTerminal || terminals[0];
    setTargetTerminalId(term?.id || '');
    setGeofenceName(term ? `${term.name} OCR Gate Perimeter` : 'New Port Geofence');
    setGeofenceType('CIRCLE');
    setGeofenceRadius(term?.geofenceRadiusMeters || 1500);
    setGeofenceLat(term?.lat || 25.0112);
    setGeofenceLng(term?.lng || 55.0612);
    setShowGeofenceModal(true);
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
      showToast('success', `Geofence "${geofenceName}" saved successfully!`);
      setShowGeofenceModal(false);
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

      {/* Split Map View: Left Terminal Cards / Right Geofence Radar Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Terminals list (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--text-main)]">Major UAE Ports & Terminals</span>
            <span className="text-[11px] text-[var(--text-muted)]">{terminals.length} Ports</span>
          </div>

          <div className="space-y-3">
            {terminals.map((t) => {
              const selected = selectedTerminal?.id === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTerminal(t)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selected
                      ? 'bg-blue-600/10 border-blue-500 text-[var(--text-main)] shadow-sm'
                      : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-xs text-[var(--text-main)]">{t.name}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-blue-400">
                      {t.code}
                    </span>
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
                  <h3 className="text-base font-bold text-[var(--text-main)] flex items-center gap-2">
                    <Anchor className="w-4 h-4 text-blue-400" />
                    {selectedTerminal.name}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Operating Hours: {selectedTerminal.operatingHours} · Emirate: {selectedTerminal.emirate}
                  </p>
                </div>
                <button
                  onClick={handleOpenAddGeofence}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Zone
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
                        <div className="text-[10px] text-[var(--text-muted)] font-mono">
                          Center: {gf.centerLat.toFixed(4)}, {gf.centerLng.toFixed(4)}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="truncate block max-w-[150px]">{gf.terminalName}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[10px] font-mono">
                          {gf.type}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold">{gf.radiusMeters}m</td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleDeleteGeofence(gf.id, gf.name)}
                          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Delete geofence"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      {/* Add Geofence Modal */}
      {showGeofenceModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Compass className="w-4 h-4 text-blue-400" />
                Configure New Port / Warehouse Geofence
              </h3>
              <button
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
                  onChange={(e) => setTargetTerminalId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  {terminals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
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
                    onChange={(e) => setGeofenceType(e.target.value as any)}
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
                  {submittingGf ? 'Saving Zone...' : 'Save Geofence'}
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
            onClick={() => setShowWarehouseModal(true)}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Add Client Destination Warehouse Modal */}
      {showWarehouseModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-emerald-400" />
                Add Consignee Destination (Client Facility / Ramp)
              </h3>
              <button
                type="button"
                onClick={() => setShowWarehouseModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWarehouse} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Consignee Facility / Warehouse Name (Client) *
                </label>
                <input
                  type="text"
                  required
                  value={newWhName}
                  onChange={(e) => setNewWhName(e.target.value)}
                  placeholder="e.g. Landmark Distribution Center NIP, Chalhoub DWC Hub"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Linked Consignor (Customer / Shipper)</label>
                <SearchableSelect
                  value={newWhCustomerId}
                  onChange={(val) => setNewWhCustomerId(val)}
                  options={[
                    { value: '', label: 'General / Shared Facility (All Consignors)' },
                    ...customers.map((c) => ({ value: c.id, label: c.name, sublabel: 'Consignor Customer' })),
                  ]}
                  placeholder="Search or select linked consignor..."
                  searchPlaceholder="Type customer name..."
                  accent="emerald"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Industrial Zone / Area</label>
                  <input
                    type="text"
                    value={newWhZone}
                    onChange={(e) => setNewWhZone(e.target.value)}
                    placeholder="e.g. JAFZA South, DIC, KEZAD, DIP"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Loading Ramps / Bays</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={newWhRamps}
                    onChange={(e) => setNewWhRamps(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Physical Street Address</label>
                <input
                  type="text"
                  value={newWhAddress}
                  onChange={(e) => setNewWhAddress(e.target.value)}
                  placeholder="e.g. Plot S-204, Road 4, Dubai, UAE"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Receiving Contact Person</label>
                  <input
                    type="text"
                    value={newWhContact}
                    onChange={(e) => setNewWhContact(e.target.value)}
                    placeholder="e.g. Warehouse Supervisor"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Receiving Contact Phone</label>
                  <input
                    type="tel"
                    value={newWhPhone}
                    onChange={(e) => setNewWhPhone(e.target.value)}
                    placeholder="+971 4 888 1234"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowWarehouseModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWh}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  {submittingWh ? 'Saving...' : 'Save Warehouse Destination'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
