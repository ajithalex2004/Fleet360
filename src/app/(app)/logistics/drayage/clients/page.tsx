'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  Building2,
  Warehouse,
  MapPin,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Search,
  RefreshCw,
  X,
  ShieldCheck,
  DollarSign,
  Phone,
  User,
  Compass,
  Check,
} from 'lucide-react';
import { PageHeader, KpiCard } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';
import {
  ConsigneeDestinationModal,
} from '@/components/logistics/drayage/ConsigneeDestinationModal';

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
  defaultTripAmountAed?: number;
  defaultDriverAllowanceAed?: number;
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
  'KIZAD / KEZAD, Abu Dhabi',
  'Hamriyah Free Zone, Sharjah',
];

export default function DrayageClientMasterPage() {
  const cached = getCachedDrayageData();
  const [clients, setClients] = useState<DrayageClient[]>(cached?.clients || []);
  const [warehouses, setWarehouses] = useState<DrayageWarehouse[]>(cached?.warehouses || []);
  const [loading, setLoading] = useState(!cached);

  // Filters & View State
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [geofenceFilter, setGeofenceFilter] = useState<'ALL' | 'GEOFENCED' | 'NOT_GEOFENCED'>('ALL');
  const [viewMode, setViewMode] = useState<'CLIENTS' | 'WAREHOUSES'>('CLIENTS');

  // Client Modal State (Add / Edit)
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
    notes: '',
  });

  // Selected Client for Dedicated Facility/Warehouse Management Drawer
  const [selectedClientForWarehouses, setSelectedClientForWarehouses] = useState<DrayageClient | null>(null);

  // Unified Consignee Destination Modal State
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<DrayageWarehouse | null>(null);
  const [defaultClientForNewWh, setDefaultClientForNewWh] = useState<string | null>(null);

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

  // Compute KPI Summary Metrics
  const totalWarehouses = warehouses.length;
  const geofencedCount = warehouses.filter((w) => Boolean(w.geofenceConfigured)).length;
  const avgTripAmount = useMemo(() => {
    if (warehouses.length === 0) return 1550;
    const sum = warehouses.reduce((acc, w) => acc + (w.tripAmountAed || 1550), 0);
    return Math.round(sum / warehouses.length);
  }, [warehouses]);
  const avgDriverAllowance = useMemo(() => {
    if (warehouses.length === 0) return 150;
    const sum = warehouses.reduce((acc, w) => acc + (w.driverAllowanceAed || 150), 0);
    return Math.round(sum / warehouses.length);
  }, [warehouses]);

  // Filtered Clients (for Client Master table view)
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
          (w) => w.customerId === c.id || (w.customerName && w.customerName.toLowerCase() === c.name.toLowerCase())
        );
        const hasZone = clientWhs.some((w) => w.zone.toLowerCase().includes(zoneFilter.toLowerCase()));
        if (!hasZone) return false;
      }

      // If geofence filter is active
      if (geofenceFilter !== 'ALL') {
        const clientWhs = warehouses.filter(
          (w) => w.customerId === c.id || (w.customerName && w.customerName.toLowerCase() === c.name.toLowerCase())
        );
        if (geofenceFilter === 'GEOFENCED' && !clientWhs.some((w) => Boolean(w.geofenceConfigured))) return false;
        if (geofenceFilter === 'NOT_GEOFENCED' && clientWhs.every((w) => Boolean(w.geofenceConfigured))) return false;
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
        (w.address && w.address.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (zoneFilter !== 'ALL' && !w.zone.toLowerCase().includes(zoneFilter.toLowerCase())) {
        return false;
      }

      if (geofenceFilter === 'GEOFENCED' && !w.geofenceConfigured) return false;
      if (geofenceFilter === 'NOT_GEOFENCED' && w.geofenceConfigured) return false;

      return true;
    });
  }, [warehouses, search, zoneFilter, geofenceFilter]);

  // Client Modal Handlers
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

  // Facility / Warehouse Modal Openers (Opens Unified ConsigneeDestinationModal)
  const openAddWarehouse = (defaultClient?: DrayageClient) => {
    setEditingWarehouse(null);
    setDefaultClientForNewWh(defaultClient?.id || selectedClientForWarehouses?.id || null);
    setShowWarehouseModal(true);
  };

  const openEditWarehouse = (warehouse: DrayageWarehouse) => {
    setEditingWarehouse(warehouse);
    setShowWarehouseModal(true);
  };

  const handleDeleteWarehouse = async (warehouse: DrayageWarehouse) => {
    if (!confirm(`Are you sure you want to delete facility/warehouse "${warehouse.name}"?`)) {
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
      showToast('success', `Facility/Warehouse "${warehouse.name}" removed.`);
    } catch (err: unknown) {
      console.error('Error deleting warehouse:', err);
      showToast('error', 'Error deleting facility/warehouse.');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold backdrop-blur-md border animate-in slide-in-from-bottom-3 duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
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
              <span>Add Client Facility/Warehouse</span>
            </button>
            <button
              type="button"
              onClick={openAddClient}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add Client</span>
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
          label="Total Facilities"
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
          label="Avg Driver Allowance"
          value={`AED ${avgDriverAllowance.toLocaleString()}`}
          icon={DollarSign}
          sub="Per standard roundtrip"
          accent="amber"
        />
        <KpiCard
          label="Avg Trip Rate"
          value={`AED ${avgTripAmount.toLocaleString()}`}
          icon={DollarSign}
          sub="FCL container corridor"
          accent="violet"
        />
      </div>

      {/* View Switcher, Search, and Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        {/* Left: View Switcher */}
        <div className="flex items-center bg-[var(--bg-card)] p-1 rounded-xl border border-[var(--border-subtle)] shadow-sm">
          <button
            type="button"
            onClick={() => setViewMode('CLIENTS')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'CLIENTS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Client Master ({clients.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('WAREHOUSES')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === 'WAREHOUSES'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <Warehouse className="w-3.5 h-3.5" />
            <span>All Facilities / Warehouses ({warehouses.length})</span>
          </button>
        </div>

        {/* Right: Search & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={viewMode === 'CLIENTS' ? 'Search client name, code, contact...' : 'Search facility name, code, zone...'}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500 shadow-sm"
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
            onChange={(e) => setGeofenceFilter(e.target.value as Parameters<typeof setGeofenceFilter>[0])}
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
                  <th className="py-3 px-3">Emirate / City</th>
                  <th className="py-3 px-3 text-center">Facility / Warehouse Network</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                {filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-[var(--text-muted)]">
                      <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40 text-blue-400" />
                      <p className="font-medium">No clients found matching current filter.</p>
                      <button
                        type="button"
                        onClick={openAddClient}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 text-xs font-semibold transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add First Client</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((client) => {
                    const clientWhs = warehouses.filter(
                      (w) => w.customerId === client.id || (w.customerName && w.customerName.toLowerCase() === client.name.toLowerCase())
                    );
                    const geofencedWhsCount = clientWhs.filter((w) => Boolean(w.geofenceConfigured)).length;
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

                        {/* Emirate / City */}
                        <td className="py-3.5 px-3 text-[var(--text-muted)] font-medium">
                          <span className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                            {client.city || 'Dubai'}
                          </span>
                        </td>

                        {/* Facility / Warehouse Network Manage Option */}
                        <td className="py-3.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedClientForWarehouses(client)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 font-semibold text-xs transition-all shadow-sm group"
                            title="Manage facilities/warehouses under this client"
                          >
                            <Warehouse className="w-3.5 h-3.5 text-blue-400 group-hover:scale-110 transition-transform" />
                            <span>
                              Manage ({clientWhs.length})
                            </span>
                            {clientWhs.length > 0 && geofencedWhsCount === clientWhs.length && (
                              <span title="All facilities/warehouses geofenced">
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
                              title="Edit Client"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClient(client)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                              title="Delete Client"
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
                  <th className="py-3 px-4">Facility / Warehouse</th>
                  <th className="py-3 px-3">Client / Consignee</th>
                  <th className="py-3 px-3">Industrial Zone</th>
                  <th className="py-3 px-3 text-center">Loading Ramps</th>
                  <th className="py-3 px-3 text-right">Driver Allowance</th>
                  <th className="py-3 px-3 text-right">Trip Amount</th>
                  <th className="py-3 px-3 text-center">Geofence Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                {filteredWarehouses.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-[var(--text-muted)]">
                      <Warehouse className="w-8 h-8 mx-auto mb-2 opacity-40 text-blue-400" />
                      <p className="font-medium">No facilities found matching filter.</p>
                      <button
                        type="button"
                        onClick={() => openAddWarehouse()}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 text-xs font-semibold transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add First Facility/Warehouse</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredWarehouses.map((wh) => (
                    <tr key={wh.id} className="transition-colors hover:bg-[var(--bg-card)]/60">
                      {/* Facility Name */}
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

                      {/* Driver Allowance */}
                      <td className="py-3.5 px-3 text-right font-mono font-semibold text-amber-400">
                        AED {(wh.driverAllowanceAed || 150).toLocaleString()}
                      </td>

                      {/* Trip Amount */}
                      <td className="py-3.5 px-3 text-right font-mono font-semibold text-emerald-400">
                        AED {(wh.tripAmountAed || 1550).toLocaleString()}
                      </td>

                      {/* Geofence Status */}
                      <td className="py-3.5 px-3 text-center">
                        {wh.geofenceConfigured ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold text-[11px]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Configured ({wh.geofenceRadiusMeters || 800}m)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium text-[11px]">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Pending</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditWarehouse(wh)}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                            title="Edit Facility/Warehouse"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteWarehouse(wh)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-[var(--text-muted)] hover:text-rose-400 transition-colors"
                            title="Delete Facility/Warehouse"
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

      {/* DEDICATED FACILITY/WAREHOUSE MANAGEMENT DRAWER (FOR SELECTED CLIENT) */}
      {selectedClientForWarehouses && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden">
            {/* Drawer Header (Properly Aligned & Formatted) */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold font-mono text-sm shrink-0">
                  {selectedClientForWarehouses.code}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-[var(--text-main)]">
                      {selectedClientForWarehouses.name}
                    </h3>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-semibold border border-blue-500/30">
                      Facility/Warehouse Network
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-2">
                    <span>Contact: {selectedClientForWarehouses.contactPerson || 'N/A'} ({selectedClientForWarehouses.contactNo || 'N/A'})</span>
                    <span>•</span>
                    <span>{selectedClientForWarehouses.city || 'Dubai'}</span>
                    <span>•</span>
                    <span className="text-cyan-400 font-semibold">
                      {warehouses.filter(w => w.customerId === selectedClientForWarehouses.id || (w.customerName && w.customerName.toLowerCase() === selectedClientForWarehouses.name.toLowerCase())).length} Facilities/Warehouses
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openAddWarehouse(selectedClientForWarehouses)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Facility/Warehouse for {selectedClientForWarehouses.code}</span>
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

            {/* Facilities/Warehouses List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {(() => {
                const clientWhs = warehouses.filter(
                  (w) => w.customerId === selectedClientForWarehouses.id || (w.customerName && w.customerName.toLowerCase() === selectedClientForWarehouses.name.toLowerCase())
                );

                if (clientWhs.length === 0) {
                  return (
                    <div className="py-12 text-center text-[var(--text-muted)] rounded-2xl bg-[var(--bg-card)]/50 border border-dashed border-[var(--border-subtle)] p-6">
                      <Warehouse className="w-10 h-10 mx-auto mb-2 opacity-30 text-blue-400" />
                      <h4 className="text-sm font-semibold text-[var(--text-main)]">No facilities/warehouses configured yet</h4>
                      <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md mx-auto">
                        Add destination distribution centers, container yards, and cold storage facilities for {selectedClientForWarehouses.name}.
                      </p>
                      <button
                        type="button"
                        onClick={() => openAddWarehouse(selectedClientForWarehouses)}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow-md hover:bg-blue-500 transition-all"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add First Facility/Warehouse</span>
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

                          {/* Rates against each warehouse: Driver Allowance & Trip Amount */}
                          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                                Driver Allowance
                              </div>
                              <div className="font-mono font-bold text-amber-400 text-sm">
                                AED {(wh.driverAllowanceAed || 150).toLocaleString()}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                                Trip Amount
                              </div>
                              <div className="font-mono font-bold text-emerald-400 text-sm">
                                AED {(wh.tripAmountAed || 1550).toLocaleString()}
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

                        {/* Actions */}
                        <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[var(--border-subtle)]">
                          <button
                            type="button"
                            onClick={() => openEditWarehouse(wh)}
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
                              title="Delete Facility/Warehouse"
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
                Close Facility/Warehouse Network
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT CLIENT MODAL (Rates removed: swapped to Warehouse) */}
      {showClientModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-[var(--text-main)]">
                  {editingClient ? `Edit Client: ${editingClient.name}` : 'Add New Client'}
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
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingClient ? 'Update Client' : 'Create Client'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* UNIFIED CONSIGNEE DESTINATION (CLIENT FACILITY / WAREHOUSE) MODAL */}
      <ConsigneeDestinationModal
        isOpen={showWarehouseModal}
        onClose={() => {
          setShowWarehouseModal(false);
          setEditingWarehouse(null);
        }}
        initialData={editingWarehouse}
        clients={clients}
        defaultClientId={defaultClientForNewWh || selectedClientForWarehouses?.id || null}
        onClientCreated={(newCli) => {
          setClients((prev) => [newCli as (typeof prev)[number], ...prev]);
        }}
        onSaved={async () => {
          invalidateDrayageClientCache();
          await loadData(true);
          showToast('success', editingWarehouse ? 'Facility/Warehouse updated successfully.' : 'Facility/Warehouse created successfully.');
        }}
      />
    </div>
  );
}
