'use client';

import React, { useState, useEffect } from 'react';
import {
  Pencil,
  X,
  Package,
  MapPin,
  ShieldCheck,
  Calendar,
  FileText,
  Loader2,
} from 'lucide-react';

export interface EditableDrayageJob {
  id: string;
  jobCode: string;
  jobPhase?: 'L1' | 'L2' | string;
  shipmentType: string;
  status: string;
  priority: string;
  customerId?: string | null;
  customerName: string;
  terminalId?: string | null;
  terminalName: string;
  warehouseId?: string | null;
  warehouseName: string;
  containerNumber: string;
  containerSize: string;
  containerType: string;
  sealNumber?: string | null;
  cargoWeightKg?: number;
  doExpiryDate?: string | null;
  dischargeDate?: string | null;
  tokenNumber?: string | null;
  rateAmountAed: number;
  driverAllowanceAed: number;
  customsInspection?: boolean;
  municipalityInspection?: boolean;
  cpipInspection?: boolean;
  mercInspection?: boolean;
  boxcareInspection?: boolean;
  notes?: string | null;
  createdAt?: string;
}

export interface EditJobMasterOption {
  id: string;
  name: string;
  tripAmountAed?: number;
  driverAllowanceAed?: number;
}

interface DrayageEditJobModalProps {
  open: boolean;
  job: EditableDrayageJob | null;
  customers?: EditJobMasterOption[];
  terminals?: EditJobMasterOption[];
  warehouses?: EditJobMasterOption[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
  onError?: (message: string) => void;
}

function toDateInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function DrayageEditJobModal({
  open,
  job,
  customers = [],
  terminals = [],
  warehouses = [],
  onClose,
  onSaved,
  onError,
}: DrayageEditJobModalProps) {
  const [saving, setSaving] = useState(false);

  const [containerNumber, setContainerNumber] = useState('');
  const [containerSize, setContainerSize] = useState('40HC');
  const [containerType, setContainerType] = useState('DRY');
  const [sealNumber, setSealNumber] = useState('');
  const [weightKg, setWeightKg] = useState<number>(22000);

  const [shipmentType, setShipmentType] = useState<'IMPORT' | 'EXPORT'>('IMPORT');
  const [priority, setPriority] = useState<'STANDARD' | 'HIGH' | 'URGENT'>('STANDARD');

  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [terminalId, setTerminalId] = useState<string>('');
  const [terminalName, setTerminalName] = useState<string>('');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [warehouseName, setWarehouseName] = useState<string>('');

  const [doExpiryDate, setDoExpiryDate] = useState<string>('');
  const [dischargeDate, setDischargeDate] = useState<string>('');
  const [tokenNumber, setTokenNumber] = useState<string>('');

  const [rateAmountAed, setRateAmountAed] = useState<number>(1550);
  const [driverAllowanceAed, setDriverAllowanceAed] = useState<number>(150);

  const [customsInspection, setCustomsInspection] = useState(false);
  const [municipalityInspection, setMunicipalityInspection] = useState(false);
  const [cpipInspection, setCpipInspection] = useState(false);
  const [mercInspection, setMercInspection] = useState(false);
  const [boxcareInspection, setBoxcareInspection] = useState(false);

  const [notes, setNotes] = useState<string>('');
  const [jobStatus, setJobStatus] = useState<string>('PENDING');
  const [placementLocation, setPlacementLocation] = useState<'RAMP' | 'YARD' | ''>('');
  const [etcHours, setEtcHours] = useState<number>(3);

  useEffect(() => {
    if (!open || !job) return;
    setContainerNumber(job.containerNumber || '');
    setContainerSize(job.containerSize || '40HC');
    setContainerType(job.containerType || 'DRY');
    setSealNumber(job.sealNumber || '');
    setWeightKg(Number(job.cargoWeightKg) > 0 ? Number(job.cargoWeightKg) : 22000);
    setShipmentType(job.shipmentType === 'EXPORT' ? 'EXPORT' : 'IMPORT');
    setPriority(
      ['STANDARD', 'HIGH', 'URGENT'].includes((job.priority || '').toUpperCase())
        ? ((job.priority || 'STANDARD').toUpperCase() as 'STANDARD' | 'HIGH' | 'URGENT')
        : 'STANDARD',
    );

    const matchedCust = customers.find(
      (c) =>
        (job.customerId && c.id === job.customerId) ||
        c.name.trim().toLowerCase() === (job.customerName || '').trim().toLowerCase(),
    );
    setCustomerId(matchedCust?.id || job.customerId || '');
    setCustomerName(matchedCust?.name || job.customerName || '');

    const matchedTerm = terminals.find(
      (t) =>
        (job.terminalId && t.id === job.terminalId) ||
        t.name.trim().toLowerCase() === (job.terminalName || '').trim().toLowerCase(),
    );
    setTerminalId(matchedTerm?.id || job.terminalId || '');
    setTerminalName(matchedTerm?.name || job.terminalName || '');

    const matchedWh = warehouses.find(
      (w) =>
        (job.warehouseId && w.id === job.warehouseId) ||
        w.name.trim().toLowerCase() === (job.warehouseName || '').trim().toLowerCase(),
    );
    setWarehouseId(matchedWh?.id || job.warehouseId || '');
    setWarehouseName(matchedWh?.name || job.warehouseName || '');

    setDoExpiryDate(toDateInputValue(job.doExpiryDate));
    setDischargeDate(toDateInputValue(job.dischargeDate || job.createdAt));
    setTokenNumber(job.tokenNumber || '');
    setRateAmountAed(Number.isFinite(Number(job.rateAmountAed)) ? Number(job.rateAmountAed) : 1550);
    setDriverAllowanceAed(
      Number.isFinite(Number(job.driverAllowanceAed)) ? Number(job.driverAllowanceAed) : 150,
    );
    setCustomsInspection(Boolean(job.customsInspection));
    setMunicipalityInspection(Boolean(job.municipalityInspection));
    setCpipInspection(Boolean(job.cpipInspection));
    setMercInspection(Boolean(job.mercInspection));
    setBoxcareInspection(Boolean(job.boxcareInspection));
    setNotes(job.notes || '');
    setJobStatus(job.status || 'PENDING');
    setPlacementLocation(
      (job.status || '').toUpperCase().includes('YARD')
        ? 'YARD'
        : (job.status || '').toUpperCase().includes('RAMP')
        ? 'RAMP'
        : '',
    );
    setEtcHours(3);
  }, [open, job, customers, terminals, warehouses]);

  if (!open || !job) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!containerNumber.trim()) {
      onError?.('Container Number is required');
      return;
    }
    if (!customerName.trim() || !terminalName.trim() || !warehouseName.trim()) {
      onError?.('Customer, Port Terminal, and Consignee Warehouse are required');
      return;
    }

    try {
      setSaving(true);
      const statusChanged = jobStatus && jobStatus.trim() !== '' && jobStatus.trim() !== job.status;
      const isRampStatus = jobStatus.toUpperCase().includes('RAMP') || placementLocation === 'RAMP';
      const computedEtcIso =
        statusChanged && isRampStatus
          ? new Date(Date.now() + Number(etcHours || 3) * 3600000).toISOString()
          : undefined;
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_job',
          jobId: job.id,
          containerNumber: containerNumber.trim().toUpperCase(),
          containerSize,
          containerType,
          sealNumber: sealNumber.trim() || null,
          weightKg: Number(weightKg) > 0 ? Number(weightKg) : 22000,
          shipmentType,
          priority,
          customerId: customerId || null,
          customerName: customerName.trim(),
          terminalId: terminalId || null,
          terminalName: terminalName.trim(),
          warehouseId: warehouseId || null,
          warehouseName: warehouseName.trim(),
          doExpiryDate: doExpiryDate || null,
          dischargeDate: dischargeDate || null,
          tokenNumber: tokenNumber.trim().toUpperCase() || null,
          rateAmountAed: Number(rateAmountAed) >= 0 ? Number(rateAmountAed) : 0,
          driverAllowanceAed: Number(driverAllowanceAed) >= 0 ? Number(driverAllowanceAed) : 0,
          customsInspection,
          municipalityInspection,
          cpipInspection,
          mercInspection,
          boxcareInspection,
          notes: notes.trim() || null,
          status: statusChanged ? jobStatus.trim() : undefined,
          placementLocation: statusChanged
            ? placementLocation || (jobStatus.toUpperCase().includes('YARD') ? 'YARD' : jobStatus.toUpperCase().includes('RAMP') ? 'RAMP' : undefined)
            : undefined,
          etcTime: computedEtcIso,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update job details');
      }
      await onSaved(
        statusChanged
          ? `Updated ${job.jobCode} & synced status → ${jobStatus} with Driver App!`
          : `Updated ${job.jobCode} (${containerNumber.trim().toUpperCase()}) successfully!`,
      );
      onClose();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Error updating job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden my-8">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-main)]/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Pencil className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[var(--text-main)]">
                  Edit Drayage Job — {job.jobCode}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30 font-mono">
                  {job.status}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Modify container specifications, route stakeholders, DO expiry, gate token, inspection flags, and commercial rates
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-main)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs max-h-[80vh] overflow-y-auto">
          {/* Section 1: Container & Cargo Specifications */}
          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-main)]">
              <Package className="w-3.5 h-3.5 text-blue-400" />
              <span>1. Container &amp; Cargo Specifications</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Container Number *
                </label>
                <input
                  type="text"
                  required
                  value={containerNumber}
                  onChange={(e) => setContainerNumber(e.target.value.toUpperCase())}
                  placeholder="MSCU4829104"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Container Size
                </label>
                <select
                  value={containerSize}
                  onChange={(e) => setContainerSize(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                >
                  <option value="40HC">40HC (40ft High Cube)</option>
                  <option value="40FT">40FT (Standard Dry)</option>
                  <option value="20FT">20FT (Dry Box)</option>
                  <option value="45HC">45HC (High Cube)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Equipment Type
                </label>
                <select
                  value={containerType}
                  onChange={(e) => setContainerType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                >
                  <option value="DRY">DRY (General)</option>
                  <option value="REEFER">REEFER (Chilled)</option>
                  <option value="OPEN_TOP">OPEN TOP</option>
                  <option value="FLAT_RACK">FLAT RACK</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Seal Number
                </label>
                <input
                  type="text"
                  value={sealNumber}
                  onChange={(e) => setSealNumber(e.target.value)}
                  placeholder="SL-849201"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Gross Weight (KG)
                </label>
                <input
                  type="number"
                  min={0}
                  value={weightKg || ''}
                  onChange={(e) => setWeightKg(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Stakeholders & Route */}
          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-main)]">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              <span>2. Haulage Stakeholders &amp; Port Route</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Customer */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Customer (Consignor / Shipper) *
                </label>
                {customers.length > 0 ? (
                  <select
                    value={customerId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setCustomerId(id);
                      const found = customers.find((c) => c.id === id);
                      if (found) setCustomerName(found.name);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                  >
                    {!customers.some((c) => c.id === customerId) && customerName && (
                      <option value={customerId}>{customerName}</option>
                    )}
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                )}
              </div>

              {/* Port Terminal */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Port Terminal *
                </label>
                {terminals.length > 0 ? (
                  <select
                    value={terminalId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setTerminalId(id);
                      const found = terminals.find((t) => t.id === id);
                      if (found) setTerminalName(found.name);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                  >
                    {!terminals.some((t) => t.id === terminalId) && terminalName && (
                      <option value={terminalId}>{terminalName}</option>
                    )}
                    {terminals.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={terminalName}
                    onChange={(e) => setTerminalName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                )}
              </div>

              {/* Consignee Warehouse */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Consignee / Warehouse *
                </label>
                {warehouses.length > 0 ? (
                  <select
                    value={warehouseId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setWarehouseId(id);
                      const found = warehouses.find((w) => w.id === id);
                      if (found) {
                        setWarehouseName(found.name);
                        if (Number(found.tripAmountAed) > 0) {
                          setRateAmountAed(Number(found.tripAmountAed));
                        }
                        if (Number(found.driverAllowanceAed) > 0) {
                          setDriverAllowanceAed(Number(found.driverAllowanceAed));
                        }
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                  >
                    {!warehouses.some((w) => w.id === warehouseId) && warehouseName && (
                      <option value={warehouseId}>{warehouseName}</option>
                    )}
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={warehouseName}
                    onChange={(e) => setWarehouseName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Commercial Terms, Dates & Gate Token */}
          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-main)]">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>3. Commercial Rates, Schedule &amp; Gate Token</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Shipment Direction
                </label>
                <select
                  value={shipmentType}
                  onChange={(e) => setShipmentType(e.target.value as 'IMPORT' | 'EXPORT')}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                >
                  <option value="IMPORT">IMPORT (Discharge → Delivery)</option>
                  <option value="EXPORT">EXPORT (Stuffing → Gate-In)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Dispatch Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'STANDARD' | 'HIGH' | 'URGENT')}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500 font-medium"
                >
                  <option value="STANDARD">Standard Haulage</option>
                  <option value="HIGH">High Priority</option>
                  <option value="URGENT">Urgent (Demurrage Risk)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Contract Rate (AED)
                </label>
                <input
                  type="number"
                  min={0}
                  value={rateAmountAed}
                  onChange={(e) => setRateAmountAed(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Driver Allowance (AED)
                </label>
                <input
                  type="number"
                  min={0}
                  value={driverAllowanceAed}
                  onChange={(e) => setDriverAllowanceAed(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Port Gate Token (PCS)
                </label>
                <input
                  type="text"
                  value={tokenNumber}
                  onChange={(e) => setTokenNumber(e.target.value.toUpperCase())}
                  placeholder="DPW-TKN-4821"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono uppercase outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Discharge / Target Date
                </label>
                <input
                  type="date"
                  value={dischargeDate}
                  onChange={(e) => setDischargeDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                  DO Expiry Date
                </label>
                <input
                  type="date"
                  value={doExpiryDate}
                  onChange={(e) => setDoExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Section 4: Regulatory Inspections & Notes */}
          <div className="p-4 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-main)]">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span>4. Regulatory Inspection Flags &amp; Operational Notes</span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={customsInspection}
                  onChange={(e) => setCustomsInspection(e.target.checked)}
                  className="rounded border-[var(--border-subtle)] text-blue-600"
                />
                <span className="font-medium text-[var(--text-main)]">Dubai Customs</span>
              </label>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={municipalityInspection}
                  onChange={(e) => setMunicipalityInspection(e.target.checked)}
                  className="rounded border-[var(--border-subtle)] text-blue-600"
                />
                <span className="font-medium text-[var(--text-main)]">Municipality (DM)</span>
              </label>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={cpipInspection}
                  onChange={(e) => setCpipInspection(e.target.checked)}
                  className="rounded border-[var(--border-subtle)] text-blue-600"
                />
                <span className="font-medium text-[var(--text-main)]">CPIP Inspection</span>
              </label>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={mercInspection}
                  onChange={(e) => setMercInspection(e.target.checked)}
                  className="rounded border-[var(--border-subtle)] text-blue-600"
                />
                <span className="font-medium text-[var(--text-main)]">Merc / Fumigation</span>
              </label>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={boxcareInspection}
                  onChange={(e) => setBoxcareInspection(e.target.checked)}
                  className="rounded border-[var(--border-subtle)] text-blue-600"
                />
                <span className="font-medium text-[var(--text-main)]">Boxcare Seal Audit</span>
              </label>
            </div>

            <div className="space-y-1 pt-1">
              <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-blue-400" />
                <span>Operational Notes / Special Instructions</span>
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter gate pass instructions, weighbridge notes, or DO reference..."
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
              />
            </div>

            {/* Section 5: Operations Team Status Override (Syncs automatically to Driver App) */}
            <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                  5. Operations Status Override (Auto-Syncs with Driver App)
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  Current: <strong className="font-mono text-[var(--text-main)]">{job.status}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                    Job Execution Status
                  </label>
                  <select
                    value={jobStatus}
                    onChange={(e) => setJobStatus(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-emerald-500/40 text-[var(--text-main)] font-semibold outline-none focus:border-emerald-500"
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="ASSIGNED">ASSIGNED</option>
                    <option value="ACCEPTED">ACCEPTED (Driver Accepted)</option>
                    <option value="CONTAINER_PICKED">CONTAINER_PICKED (Picked at Port/WH)</option>
                    <option value="UNDER_INSPECTION">UNDER_INSPECTION (Port/Customs Check)</option>
                    <option value="EN_ROUTE_WAREHOUSE">EN_ROUTE_WAREHOUSE (In Transit to WH)</option>
                    <option value="EN_ROUTE_TERMINAL">EN_ROUTE_TERMINAL (L2 In Transit to Port)</option>
                    <option value="ARRIVED_AT_PORT">ARRIVED_AT_PORT (L2 Arrived at Port)</option>
                    <option value="PLACED_AT_RAMP">PLACED_AT_RAMP (Placed @ Ramp)</option>
                    <option value="PLACED_AT_YARD">PLACED_AT_YARD (Placed @ Yard)</option>
                    <option value="TRAILER_DETACHED">TRAILER_DETACHED (Trailer Uncoupled)</option>
                    <option value="MT_Reassign to Yard">MT_Reassign to Yard</option>
                    <option value="FCL_Reassign to Yard">FCL_Reassign to Yard</option>
                    <option value="FCL_Reassign to Ramp">FCL_Reassign to Ramp</option>
                    <option value="MT_Reassign to Ramp">MT_Reassign to Ramp</option>
                    <option value="RE-ASSIGNED">RE-ASSIGNED</option>
                    <option value="TRAILER_ATTACHED">TRAILER_ATTACHED (Reassign Coupled)</option>
                    <option value="REASSIGN_PLACED_AT_RAMP">REASSIGN_PLACED_AT_RAMP</option>
                    <option value="REASSIGN_PLACED_AT_YARD">REASSIGN_PLACED_AT_YARD</option>
                    <option value="READY_FOR_PICKUP">READY_FOR_PICKUP (Ready for L2)</option>
                    <option value="CONTAINER_DROPPED">CONTAINER_DROPPED (L2 Empty Dropped)</option>
                    <option value="COMPLETED">COMPLETED</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                    Placement Location (If at WH)
                  </label>
                  <select
                    value={placementLocation}
                    onChange={(e) => setPlacementLocation(e.target.value as 'RAMP' | 'YARD' | '')}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="">Auto / Default</option>
                    <option value="RAMP">RAMP (Offloading Dock)</option>
                    <option value="YARD">YARD (Container Yard)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)]">
                    Ramp Offload ETC Timer
                  </label>
                  <select
                    value={etcHours}
                    onChange={(e) => setEtcHours(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value={1}>1 Hour ETC</option>
                    <option value={2}>2 Hours ETC</option>
                    <option value={3}>3 Hours ETC (Standard)</option>
                    <option value={4}>4 Hours ETC</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Save Job Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
