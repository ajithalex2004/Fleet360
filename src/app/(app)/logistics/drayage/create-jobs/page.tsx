'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PlusCircle, Package, Trash2, Plus, CheckCircle2, AlertTriangle, RefreshCw,
  Building2, MapPin, ShieldCheck, DollarSign, ArrowRight, FileText, UploadCloud,
  Warehouse, X, User, Phone, Mail,
} from 'lucide-react';
import { PageHeader, Panel, KpiCard } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

interface CustomerOption {
  id: string;
  name: string;
}

interface TerminalOption {
  id: string;
  name: string;
  portName: string;
}

interface WarehouseOption {
  id: string;
  customerId: string | null;
  customerName: string;
  name: string;
  zone: string;
}

interface ContainerItem {
  id: string;
  containerNumber: string;
  size: '20FT' | '40FT' | '40HC' | '45HC';
  containerType: 'DRY' | 'REEFER' | 'OPEN_TOP' | 'FLAT_RACK';
  dischargeDate: string;
  deliveryDate?: string;
  deliveryTime?: string;
  doExpiryDate: string;
  doExpiryTime?: string;
  sealNumber: string;
  weightKg: number;
  customsInspection: boolean;
  municipalityInspection: boolean;
  cpipInspection: boolean;
  mercInspection: boolean;
  boxcareInspection: boolean;
}

export default function DrayageCreateJobsPage() {
  const router = useRouter();
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.customers?.length);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form State
  const [customers, setCustomers] = useState<CustomerOption[]>(cached?.customers || []);
  const [terminals, setTerminals] = useState<TerminalOption[]>(cached?.terminals || []);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>(cached?.warehouses || []);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(cached?.customers?.[0]?.id || '');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(cached?.warehouses?.[0]?.id || '');
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(cached?.terminals?.[0]?.id || '');
  const [shipmentType, setShipmentType] = useState<'IMPORT' | 'EXPORT'>('IMPORT');
  const [priority, setPriority] = useState<'STANDARD' | 'HIGH' | 'URGENT'>('STANDARD');
  const [rateAmountAed, setRateAmountAed] = useState<number>(1550);
  const [driverAllowanceAed, setDriverAllowanceAed] = useState<number>(150);
  const [notes, setNotes] = useState<string>('');

  // Quick Customer Creation Modal State
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerType, setNewCustomerType] = useState('CORPORATE');
  const [newCustomerContact, setNewCustomerContact] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerTrn, setNewCustomerTrn] = useState('');
  const [newCustomerLicense, setNewCustomerLicense] = useState('');
  const [newCustomerCity, setNewCustomerCity] = useState('Dubai');
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Quick Warehouse / Destination Creation Modal State
  const [showWarehouseModal, setShowWarehouseModal] = useState(false);
  const [newWarehouseCustomerId, setNewWarehouseCustomerId] = useState('');
  const [newWarehouseName, setNewWarehouseName] = useState('');
  const [newWarehouseZone, setNewWarehouseZone] = useState('JAFZA South');
  const [newWarehouseAddress, setNewWarehouseAddress] = useState('');
  const [newWarehouseContact, setNewWarehouseContact] = useState('');
  const [newWarehousePhone, setNewWarehousePhone] = useState('');
  const [newWarehouseRamps, setNewWarehouseRamps] = useState(4);
  const [savingWarehouse, setSavingWarehouse] = useState(false);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) {
      showToast('error', 'Please enter customer company name');
      return;
    }
    try {
      setSavingCustomer(true);
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nameEn: newCustomerName.trim(),
          customerType: newCustomerType || 'CORPORATE',
          contactPerson: newCustomerContact.trim() || undefined,
          mobileNumber: newCustomerPhone.trim() || undefined,
          email: newCustomerEmail.trim() || undefined,
          city: newCustomerCity.trim() || 'Dubai',
          taxRegistrationNumber: newCustomerTrn.trim() || undefined,
          tradeLicense: newCustomerLicense.trim() || undefined,
          country: 'UAE',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create customer');

      const createdCustomer: CustomerOption = {
        id: data.id,
        name: data.name_en || data.nameEn || newCustomerName.trim(),
      };
      setCustomers((prev) => [createdCustomer, ...prev]);
      setSelectedCustomerId(createdCustomer.id);
      setShowCustomerModal(false);
      setNewCustomerName('');
      setNewCustomerContact('');
      setNewCustomerPhone('');
      setNewCustomerEmail('');
      setNewCustomerTrn('');
      setNewCustomerLicense('');
      invalidateDrayageClientCache();
      showToast('success', `Customer "${createdCustomer.name}" created and selected!`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating customer');
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWarehouseName.trim()) {
      showToast('error', 'Please enter destination warehouse name');
      return;
    }
    const targetCustomerId = newWarehouseCustomerId || selectedCustomerId || null;
    const currentCustomer = customers.find((c) => c.id === targetCustomerId);
    try {
      setSavingWarehouse(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_warehouse',
          customerId: targetCustomerId,
          customerName: currentCustomer?.name || (targetCustomerId ? 'Enterprise Client' : 'General / Shared Hub'),
          name: newWarehouseName.trim(),
          zone: newWarehouseZone.trim() || 'JAFZA South',
          address: newWarehouseAddress.trim() || 'Dubai, UAE',
          contactPerson: newWarehouseContact.trim() || undefined,
          contactPhone: newWarehousePhone.trim() || undefined,
          rampsCount: Number(newWarehouseRamps) || 4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create warehouse destination');

      const createdWh: WarehouseOption = {
        id: data.id,
        customerId: targetCustomerId,
        customerName: currentCustomer?.name || (targetCustomerId ? 'Enterprise Client' : 'General / Shared Hub'),
        name: newWarehouseName.trim(),
        zone: newWarehouseZone.trim() || 'JAFZA South',
      };
      setWarehouses((prev) => [createdWh, ...prev]);
      setSelectedWarehouseId(createdWh.id);
      setShowWarehouseModal(false);
      setNewWarehouseName('');
      setNewWarehouseZone('JAFZA South');
      setNewWarehouseAddress('');
      setNewWarehouseContact('');
      setNewWarehousePhone('');
      setNewWarehouseRamps(4);
      invalidateDrayageClientCache();
      showToast('success', `Destination "${createdWh.name}" added and mapped!`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating warehouse');
    } finally {
      setSavingWarehouse(false);
    }
  };

  // Bulk Paste State
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkText, setBulkText] = useState('');

  // Container rows
  const [containers, setContainers] = useState<ContainerItem[]>([
    {
      id: 'c-init-1',
      containerNumber: 'MSCU' + Math.floor(1000000 + Math.random() * 9000000),
      size: '40HC',
      containerType: 'DRY',
      dischargeDate: new Date().toISOString().slice(0, 10),
      deliveryDate: new Date().toISOString().slice(0, 10),
      deliveryTime: '09:00',
      doExpiryDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      doExpiryTime: '18:00',
      sealNumber: 'SL-' + Math.floor(100000 + Math.random() * 900000),
      weightKg: 22400,
      customsInspection: true,
      municipalityInspection: false,
      cpipInspection: true,
      mercInspection: false,
      boxcareInspection: true,
    },
  ]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadMasters = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.customers?.length) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      const custs = data?.customers || [];
      const terms = data?.terminals || [];
      const whs = data?.warehouses || [];

      setCustomers(custs);
      setTerminals(terms);
      setWarehouses(whs);

      setSelectedCustomerId((prev) => prev || (custs[0]?.id ?? ''));
      setSelectedTerminalId((prev) => prev || (terms[0]?.id ?? ''));
      setSelectedWarehouseId((prev) => prev || (whs[0]?.id ?? ''));
    } catch (err) {
      if (!getCachedDrayageData()?.customers?.length) {
        showToast('error', err instanceof Error ? err.message : 'Failed to load master data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  const handleAddContainerRow = () => {
    const isReefer = containers[containers.length - 1]?.containerType === 'REEFER';
    setContainers((prev) => [
      ...prev,
      {
        id: `c-${Date.now()}-${Math.random()}`,
        containerNumber: '',
        size: '40HC',
        containerType: isReefer ? 'REEFER' : 'DRY',
        dischargeDate: new Date().toISOString().slice(0, 10),
        doExpiryDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        sealNumber: 'SL-' + Math.floor(100000 + Math.random() * 900000),
        weightKg: 22000,
        customsInspection: true,
        municipalityInspection: false,
        cpipInspection: false,
        mercInspection: false,
        boxcareInspection: false,
      },
    ]);
  };

  const handleRemoveContainerRow = (id: string) => {
    if (containers.length <= 1) {
      showToast('error', 'Manifest must have at least one container');
      return;
    }
    setContainers((prev) => prev.filter((c) => c.id !== id));
  };

  const updateContainer = (id: string, updates: Partial<ContainerItem>) => {
    setContainers((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const handleApplyBulkPaste = () => {
    const lines = bulkText
      .split(/[\r\n,]+/)
      .map((l) => l.trim().toUpperCase())
      .filter((l) => l.length >= 4);

    if (lines.length === 0) {
      showToast('error', 'No valid container numbers detected in paste text');
      return;
    }

    const newRows: ContainerItem[] = lines.map((num, idx) => ({
      id: `c-bulk-${Date.now()}-${idx}`,
      containerNumber: num,
      size: '40HC',
      containerType: 'DRY',
      dischargeDate: new Date().toISOString().slice(0, 10),
      deliveryDate: new Date().toISOString().slice(0, 10),
      deliveryTime: '09:00',
      doExpiryDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      doExpiryTime: '18:00',
      sealNumber: 'SL-' + Math.floor(100000 + Math.random() * 900000),
      weightKg: 22000,
      customsInspection: true,
      municipalityInspection: false,
      cpipInspection: false,
      mercInspection: false,
      boxcareInspection: false,
    }));

    setContainers((prev) => (prev[0]?.containerNumber ? [...prev, ...newRows] : newRows));
    setBulkText('');
    setShowBulkPaste(false);
    showToast('success', `Imported ${newRows.length} containers into manifest!`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const invalidContainers = containers.filter((c) => !c.containerNumber.trim());
    if (invalidContainers.length > 0) {
      showToast('error', 'Please fill in all container numbers before submitting');
      return;
    }

    const custObj = customers.find((c) => c.id === selectedCustomerId);
    const termObj = terminals.find((t) => t.id === selectedTerminalId);
    const whObj = warehouses.find((w) => w.id === selectedWarehouseId);

    try {
      setSubmitting(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_jobs',
          shipmentType,
          priority,
          customerId: selectedCustomerId || null,
          customerName: custObj?.name || 'Enterprise Client',
          terminalId: selectedTerminalId || null,
          terminalName: termObj?.name || 'Jebel Ali Port - Terminal 1',
          warehouseId: selectedWarehouseId || null,
          warehouseName: whObj?.name || 'Distribution Center',
          rateAmountAed: Number(rateAmountAed),
          driverAllowanceAed: Number(driverAllowanceAed),
          notes,
          containers: containers.map((c) => ({
            containerNumber: c.containerNumber.trim().toUpperCase(),
            size: c.size,
            containerType: c.containerType,
            dischargeDate: c.deliveryDate || c.dischargeDate,
            deliveryDate: c.deliveryDate || c.dischargeDate,
            deliveryTime: c.deliveryTime || '09:00',
            doExpiryDate: c.doExpiryDate,
            doExpiryTime: c.doExpiryTime || '18:00',
            sealNumber: c.sealNumber,
            weightKg: Number(c.weightKg),
            customsInspection: c.customsInspection,
            municipalityInspection: c.municipalityInspection,
            cpipInspection: c.cpipInspection,
            mercInspection: c.mercInspection,
            boxcareInspection: c.boxcareInspection,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create drayage jobs');

      showToast('success', `Created ${data.createdCount} drayage job(s) successfully!`);
      invalidateDrayageClientCache();
      setTimeout(() => {
        router.push('/logistics/drayage/assignment');
      }, 1500);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating jobs');
    } finally {
      setSubmitting(false);
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
        title="Create Container Drayage Jobs"
        subtitle="Provision FCL haulage jobs mapped to Customer, Port Terminal, and Warehouse destinations"
        icon={PlusCircle}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBulkPaste(!showBulkPaste)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              Bulk Paste
            </button>
            <button
              type="button"
              onClick={handleAddContainerRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-xs font-semibold text-blue-400 hover:bg-blue-600/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Container Row
            </button>
          </div>
        }
      />

      {/* Bulk Paste Modal */}
      {showBulkPaste && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-blue-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-[var(--text-main)] flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-blue-400" />
              Paste Multiple Container Numbers (Comma or Newline separated)
            </h4>
            <button
              type="button"
              onClick={() => setShowBulkPaste(false)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
            >
              Cancel
            </button>
          </div>
          <textarea
            rows={3}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="e.g. MSCU8492014, MAEU5910283, CMAU3019482, HLXU9041128"
            className="w-full text-xs font-mono p-2.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleApplyBulkPaste}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors"
            >
              Parse & Add to Manifest
            </button>
          </div>
        </div>
      )}

      {/* Main Creation Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Shipment Details Panel */}
        <Panel title="Shipment & Commercial Parameters" icon={FileText} accent="blue">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* Customer */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-[var(--text-muted)]">Consignor (Customer / Shipper)</label>
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(true)}
                  className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold inline-flex items-center gap-1 transition-colors hover:underline"
                >
                  <Plus className="w-3 h-3" /> New Consignor
                </button>
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => {
                  const newCustId = e.target.value;
                  setSelectedCustomerId(newCustId);
                  const firstMapped = warehouses.find((w) => w.customerId === newCustId);
                  if (firstMapped) {
                    setSelectedWarehouseId(firstMapped.id);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Port Terminal */}
            <div className="space-y-1.5">
              <label className="font-semibold text-[var(--text-muted)]">Port Terminal of Origin/Return</label>
              <select
                value={selectedTerminalId}
                onChange={(e) => setSelectedTerminalId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
              >
                {terminals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.portName})
                  </option>
                ))}
              </select>
            </div>

            {/* Client Warehouse Destination */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-[var(--text-muted)]">Consignee (Client Destination Warehouse / Ramp)</label>
                <button
                  type="button"
                  onClick={() => {
                    setNewWarehouseCustomerId(selectedCustomerId);
                    setShowWarehouseModal(true);
                  }}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 transition-colors hover:underline"
                >
                  <Plus className="w-3 h-3" /> New Consignee Destination
                </button>
              </div>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
              >
                {(() => {
                  const mapped = warehouses.filter((w) => Boolean(w.customerId && w.customerId === selectedCustomerId));
                  const others = warehouses.filter((w) => !w.customerId || w.customerId !== selectedCustomerId);
                  const selCustName = customers.find((c) => c.id === selectedCustomerId)?.name || 'Selected Customer';
                  return (
                    <>
                      {mapped.length > 0 && (
                        <optgroup label={`Mapped Consignee Hubs for ${selCustName}`}>
                          {mapped.map((w) => (
                            <option key={w.id} value={w.id}>
                              📍 {w.name} ({w.zone})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label={mapped.length > 0 ? 'Other Consignee Facilities & Shared Hubs' : 'All Consignee Facilities & Hubs'}>
                        {others.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.zone}){w.customerName && w.customerName !== 'Enterprise Shipper' && w.customerName !== 'General / Shared Hub' ? ` [${w.customerName}]` : ''}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  );
                })()}
              </select>
            </div>

            {/* Shipment Type */}
            <div className="space-y-1.5">
              <label className="font-semibold text-[var(--text-muted)]">Shipment Type & Priority</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={shipmentType}
                  onChange={(e) => setShipmentType(e.target.value as 'IMPORT' | 'EXPORT')}
                  className="px-2 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  <option value="IMPORT">IMPORT (FCL)</option>
                  <option value="EXPORT">EXPORT</option>
                </select>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'STANDARD' | 'HIGH' | 'URGENT')}
                  className="px-2 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  <option value="STANDARD">Standard</option>
                  <option value="HIGH">High Priority</option>
                  <option value="URGENT">Urgent (DO/Demurrage)</option>
                </select>
              </div>
            </div>

            {/* Rates & Driver Allowance */}
            <div className="space-y-1.5">
              <label className="font-semibold text-[var(--text-muted)]">Trip Contract Rate (AED per container)</label>
              <input
                type="number"
                value={rateAmountAed}
                onChange={(e) => setRateAmountAed(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-[var(--text-muted)]">Driver Trip Allowance (AED)</label>
              <input
                type="number"
                value={driverAllowanceAed}
                onChange={(e) => setDriverAllowanceAed(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-mono"
              />
            </div>

            {/* Notes */}
            <div className="md:col-span-2 space-y-1.5">
              <label className="font-semibold text-[var(--text-muted)]">Special Instructions / Port Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Gate pass required at DPW Gate 3; weighbridge ticket required upon discharge"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </Panel>

        {/* Multi-Container Manifest Builder */}
        <Panel
          title={`Container Manifest (${containers.length} Units)`}
          subtitle="Configure container specifications, discharge timestamps, DO expiry dates, and regulatory inspection requirements"
          icon={Package}
          accent="blue"
        >
          <div className="space-y-4">
            {containers.map((c, index) => (
              <div
                key={c.id}
                className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-3"
              >
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
                  <span className="text-xs font-bold text-[var(--text-main)] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-blue-600/15 text-blue-400 flex items-center justify-center text-[10px]">
                      {index + 1}
                    </span>
                    Container #{index + 1}
                  </span>
                  {containers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveContainerRow(c.id)}
                      className="text-xs text-rose-400 hover:text-rose-300 inline-flex items-center gap-1 font-medium"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
                  {/* Container Number */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Container Number *</label>
                    <input
                      type="text"
                      value={c.containerNumber}
                      onChange={(e) => updateContainer(c.id, { containerNumber: e.target.value.toUpperCase() })}
                      placeholder="e.g. MSCU8492014"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Size */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Size</label>
                    <select
                      value={c.size}
                      onChange={(e) => updateContainer(c.id, { size: e.target.value as ContainerItem['size'] })}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                    >
                      <option value="40HC">40HC (High Cube)</option>
                      <option value="40FT">40FT (Standard)</option>
                      <option value="20FT">20FT (Dry Box)</option>
                      <option value="45HC">45HC (High Cube)</option>
                    </select>
                  </div>

                  {/* Type */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Type</label>
                    <select
                      value={c.containerType}
                      onChange={(e) => updateContainer(c.id, { containerType: e.target.value as ContainerItem['containerType'] })}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                    >
                      <option value="DRY">DRY</option>
                      <option value="REEFER">REEFER (Refrigerated)</option>
                      <option value="OPEN_TOP">OPEN TOP</option>
                      <option value="FLAT_RACK">FLAT RACK</option>
                    </select>
                  </div>

                  {/* Seal Number */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Seal Number</label>
                    <input
                      type="text"
                      value={c.sealNumber}
                      onChange={(e) => updateContainer(c.id, { sealNumber: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Delivery Date & Time */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">Delivery Date & Time</label>
                    <div className="flex gap-1">
                      <input
                        type="date"
                        value={c.deliveryDate || c.dischargeDate}
                        onChange={(e) => updateContainer(c.id, { deliveryDate: e.target.value, dischargeDate: e.target.value })}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs"
                      />
                      <input
                        type="time"
                        value={c.deliveryTime || '09:00'}
                        onChange={(e) => updateContainer(c.id, { deliveryTime: e.target.value })}
                        className="w-20 px-1.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs"
                      />
                    </div>
                  </div>

                  {/* DO Expiry Date & Time */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-[var(--text-muted)]">DO Expiry Date & Time</label>
                    <div className="flex gap-1">
                      <input
                        type="date"
                        value={c.doExpiryDate}
                        onChange={(e) => updateContainer(c.id, { doExpiryDate: e.target.value })}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs"
                      />
                      <input
                        type="time"
                        value={c.doExpiryTime || '18:00'}
                        onChange={(e) => updateContainer(c.id, { doExpiryTime: e.target.value })}
                        className="w-20 px-1.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 5 Regulatory Inspection Flags */}
                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">
                    Regulatory Inspection Clearance Flags:
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.customsInspection}
                        onChange={(e) => updateContainer(c.id, { customsInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                      />
                      <span>Dubai Customs</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.municipalityInspection}
                        onChange={(e) => updateContainer(c.id, { municipalityInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                      />
                      <span>Municipality (DM)</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.cpipInspection}
                        onChange={(e) => updateContainer(c.id, { cpipInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                      />
                      <span>CPIP Inspection</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.mercInspection}
                        onChange={(e) => updateContainer(c.id, { mercInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                      />
                      <span>Merc / Fumigation</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.boxcareInspection}
                        onChange={(e) => updateContainer(c.id, { boxcareInspection: e.target.checked })}
                        className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                      />
                      <span>Boxcare Seal Audit</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <button
              type="button"
              onClick={handleAddContainerRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Another Container
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
            >
              <PlusCircle className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
              {submitting ? 'Creating Drayage Jobs...' : `Submit & Create ${containers.length} Job(s)`}
            </button>
          </div>
        </Panel>
      </form>

      {/* Quick Create Customer Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                Create Consignor Customer (Shipper / Bill-To Party)
              </h3>
              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Consignor Company Name (Customer / Shipper) *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="e.g. Al-Futtaim Logistics LLC, DHL Global Forwarding"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Consignor Type</label>
                  <select
                    value={newCustomerType}
                    onChange={(e) => setNewCustomerType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="CORPORATE">Corporate Shipper</option>
                    <option value="INTERNAL">Internal Division</option>
                    <option value="VIP">VIP Key Account</option>
                    <option value="INDIVIDUAL">Individual Consignor / Merchant</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Emirate / City</label>
                  <select
                    value={newCustomerCity}
                    onChange={(e) => setNewCustomerCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="Dubai">Dubai</option>
                    <option value="Abu Dhabi">Abu Dhabi</option>
                    <option value="Sharjah">Sharjah</option>
                    <option value="Ajman">Ajman</option>
                    <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                    <option value="Fujairah">Fujairah</option>
                    <option value="Umm Al Quwain">Umm Al Quwain</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Contact Person</label>
                  <input
                    type="text"
                    value={newCustomerContact}
                    onChange={(e) => setNewCustomerContact(e.target.value)}
                    placeholder="e.g. Ahmed Al-Mansoor"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Phone / Mobile</label>
                  <input
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="+971 50 123 4567"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Email Address</label>
                <input
                  type="email"
                  value={newCustomerEmail}
                  onChange={(e) => setNewCustomerEmail(e.target.value)}
                  placeholder="logistics@customer.ae"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">UAE TRN (Tax No.)</label>
                  <input
                    type="text"
                    value={newCustomerTrn}
                    onChange={(e) => setNewCustomerTrn(e.target.value)}
                    placeholder="100XXXXXXXXX003"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Trade License</label>
                  <input
                    type="text"
                    value={newCustomerLicense}
                    onChange={(e) => setNewCustomerLicense(e.target.value)}
                    placeholder="CN-1234567"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCustomer}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50"
                >
                  {savingCustomer ? 'Creating Customer...' : 'Save & Select Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Create Client Destination Warehouse Modal */}
      {showWarehouseModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-blue-400" />
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

            <form onSubmit={handleCreateWarehouse} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Linked Consignor (Customer / Shipper)
                </label>
                <select
                  value={newWarehouseCustomerId}
                  onChange={(e) => setNewWarehouseCustomerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                >
                  <option value="">General / Shared Facility (All Consignors)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[var(--text-muted)]">
                  Mapping this facility to a specific client pins it automatically when booking containers for them.
                </p>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">
                  Consignee Facility / Warehouse Name (Client) *
                </label>
                <input
                  type="text"
                  required
                  value={newWarehouseName}
                  onChange={(e) => setNewWarehouseName(e.target.value)}
                  placeholder="e.g. JAFZA North Automated DC, DIC Central Hub"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Industrial Zone / Area</label>
                  <input
                    type="text"
                    value={newWarehouseZone}
                    onChange={(e) => setNewWarehouseZone(e.target.value)}
                    placeholder="e.g. JAFZA South, DIC, KEZAD, DIP"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Loading Ramps / Bays</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={newWarehouseRamps}
                    onChange={(e) => setNewWarehouseRamps(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Physical Street Address</label>
                <input
                  type="text"
                  value={newWarehouseAddress}
                  onChange={(e) => setNewWarehouseAddress(e.target.value)}
                  placeholder="Plot S-204, Road 4, Dubai, UAE"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Receiving Contact Person (Consignee Rep)</label>
                  <input
                    type="text"
                    value={newWarehouseContact}
                    onChange={(e) => setNewWarehouseContact(e.target.value)}
                    placeholder="e.g. Warehouse Supervisor"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Receiving Phone</label>
                  <input
                    type="tel"
                    value={newWarehousePhone}
                    onChange={(e) => setNewWarehousePhone(e.target.value)}
                    placeholder="+971 4 888 1234"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
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
                  disabled={savingWarehouse}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50"
                >
                  {savingWarehouse ? 'Adding Destination...' : 'Save & Select Destination'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
