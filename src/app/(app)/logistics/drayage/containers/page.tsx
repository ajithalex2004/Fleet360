'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Layers,
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Download,
  UploadCloud,
  Search,
  X,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
  invalidateDrayageClientCache,
} from '@/lib/logistics/drayage-client-cache';

interface DrayageContainer {
  id: string;
  containerNumber: string;
  size: string;
  containerType: string;
  shipmentType: string;
  status: string;
  customerName: string;
  terminalName: string;
  warehouseName: string;
  doExpiryDate: string | null;
  dischargeDate: string;
  emptyReturnDate: string | null;
  sealNumber: string | null;
  weightKg: number;
  customsInspection: boolean;
  municipalityInspection: boolean;
  cpipInspection: boolean;
  mercInspection: boolean;
  boxcareInspection: boolean;
  linkedTrailerPlate: string | null;
  demurrage: {
    status: 'SAFE' | 'WARNING' | 'CRITICAL_OVERDUE' | 'RETURNED';
    freeDaysAllowed: number;
    daysInPort: number;
    freeDaysRemaining: number;
    overdueDays: number;
    tierLabel: string;
    dailyRateAed: number;
    accruedPenaltyAed: number;
  };
}

export default function DrayageContainersPage() {
  const cached = getCachedDrayageData();
  const [, setLoading] = useState(!cached?.containers);
  const [containers, setContainers] = useState<DrayageContainer[]>(cached?.containers || []);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  // Create Container Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [containerNumber, setContainerNumber] = useState('');
  const [size, setSize] = useState('40HC');
  const [containerType, setContainerType] = useState('DRY');
  const [customerName] = useState('Al-Futtaim Logistics LLC');
  const [terminalName] = useState('Jebel Ali Port - Terminal 1 (DP World)');
  const [warehouseName] = useState('JAFZA South Bonded Fulfillment Hub (Gate 5)');
  const [doExpiryDate, setDoExpiryDate] = useState(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
  const [dischargeDate, setDischargeDate] = useState(new Date().toISOString().slice(0, 10));
  const [sealNumber] = useState('');
  const [weightKg, setWeightKg] = useState(22400);
  const [customsInspection] = useState(true);
  const [municipalityInspection] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Bulk Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvRawText, setCsvRawText] = useState('');

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadContainers = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.containers) {
        setLoading(true);
      }
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      setContainers(data?.containers || []);
    } catch (err) {
      if (!getCachedDrayageData()?.containers) {
        showToast('error', err instanceof Error ? err.message : 'Failed to fetch containers');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
  }, [loadContainers]);

  const handleCreateContainer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!containerNumber.trim()) {
      showToast('error', 'Container number is required');
      return;
    }

    try {
      setSubmittingCreate(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_container',
          containerNumber: containerNumber.trim().toUpperCase(),
          size,
          containerType,
          customerName,
          terminalName,
          warehouseName,
          doExpiryDate,
          dischargeDate,
          sealNumber: sealNumber || `SL-${Math.floor(100000 + Math.random() * 900000)}`,
          weightKg: Number(weightKg),
          customsInspection,
          municipalityInspection,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create container');
      showToast('success', `Container ${containerNumber.toUpperCase()} added to inventory!`);
      setShowCreateModal(false);
      setContainerNumber('');
      invalidateDrayageClientCache();
      await loadContainers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error creating container');
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleDownloadCsvTemplate = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,ContainerNumber,Size,Type,CustomerName,TerminalName,WarehouseName,DOExpiryDate,DischargeDate,SealNumber,WeightKg\n' +
      'MSCU8492014,40HC,DRY,Al-Futtaim Logistics,Jebel Ali T1,JAFZA South Hub,2026-11-05,2026-10-25,SL-884120,22400\n' +
      'MAEU5910283,40HC,DRY,Landmark Retail,Jebel Ali T2,NIP Mega DC,2026-11-02,2026-10-24,SL-391044,26200\n';
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', 'containers_upload_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleParseCsvUpload = async () => {
    const lines = csvRawText
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('ContainerNumber'));

    if (lines.length === 0) {
      showToast('error', 'No valid rows found in CSV data');
      return;
    }

    const parsedItems = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      return {
        containerNumber: parts[0] || 'MSCU' + Math.floor(1000000 + Math.random() * 9000000),
        size: parts[1] || '40HC',
        containerType: parts[2] || 'DRY',
        customerName: parts[3] || 'Al-Futtaim Logistics LLC',
        terminalName: parts[4] || 'Jebel Ali Port - Terminal 1 (DP World)',
        warehouseName: parts[5] || 'JAFZA South Bonded Fulfillment Hub',
        doExpiryDate: parts[6] || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        dischargeDate: parts[7] || new Date().toISOString().slice(0, 10),
        sealNumber: parts[8] || `SL-${Math.floor(100000 + Math.random() * 900000)}`,
        weightKg: Number(parts[9] || 22000),
      };
    });

    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_container',
          containers: parsedItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to bulk import containers');
      showToast('success', `Imported ${data.createdCount} container(s) successfully!`);
      setShowUploadModal(false);
      setCsvRawText('');
      invalidateDrayageClientCache();
      await loadContainers(true);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error bulk importing');
    }
  };

  // Filtered list
  const filteredContainers = useMemo(() => {
    return containers.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && c.containerType !== typeFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          c.containerNumber.toLowerCase().includes(q) ||
          c.customerName.toLowerCase().includes(q) ||
          c.terminalName.toLowerCase().includes(q) ||
          (c.linkedTrailerPlate && c.linkedTrailerPlate.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [containers, search, statusFilter, typeFilter]);

  const overdueCount = containers.filter((c) => c.demurrage.status === 'CRITICAL_OVERDUE').length;
  const warningCount = containers.filter((c) => c.demurrage.status === 'WARNING').length;
  const totalDemurrageAed = containers.reduce((sum, c) => sum + c.demurrage.accruedPenaltyAed, 0);

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
        title="Container Inventory & Port Demurrage"
        subtitle="Live tracking of container discharge dates, ocean free-time countdowns, linked skeletal trailers, and delivery orders"
        icon={Layers}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadCsvTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Template
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
              Bulk CSV
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Container
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Tracked Containers"
          value={containers.length}
          icon={Layers}
          accent="blue"
          sub="Dry, Reefer & Special"
        />
        <KpiCard
          label="Approaching Free-Days (<48h)"
          value={warningCount}
          icon={Clock}
          accent="amber"
          sub="Expiring within 2 days"
        />
        <KpiCard
          label="In Ocean Demurrage"
          value={overdueCount}
          icon={AlertTriangle}
          accent="rose"
          sub="Accruing port penalty"
        />
        <KpiCard
          label="Total Accrued Penalty"
          value={`AED ${totalDemurrageAed.toLocaleString()}`}
          icon={AlertTriangle}
          accent="rose"
          sub="Estimated fine liability"
        />
      </div>

      {/* Filter and Inventory Table */}
      <Panel
        title={`Container Inventory (${filteredContainers.length} Units)`}
        icon={Package}
        accent="blue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="AT_PORT_DISCHARGED">At Port Discharged</option>
              <option value="IN_TRANSIT">In Transit</option>
              <option value="PLACED_AT_RAMP">Placed at Ramp</option>
              <option value="CONTAINER_DETACHED">Chassis Detached</option>
              <option value="EMPTY_DEPOSITED">Empty Deposited</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500"
            >
              <option value="ALL">All Types</option>
              <option value="DRY">DRY</option>
              <option value="REEFER">REEFER</option>
              <option value="OPEN_TOP">OPEN TOP</option>
              <option value="FLAT_RACK">FLAT RACK</option>
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search container, customer, trailer..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 w-48 md:w-64"
              />
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Container Number</th>
                <th className="py-2.5 px-3 font-semibold">Type & Weight</th>
                <th className="py-2.5 px-3 font-semibold">Terminal & Warehouse</th>
                <th className="py-2.5 px-3 font-semibold">Demurrage Clock</th>
                <th className="py-2.5 px-3 font-semibold">Penalty Fine</th>
                <th className="py-2.5 px-3 font-semibold">Chassis Link</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
              {filteredContainers.map((c) => {
                const isOverdue = c.demurrage.status === 'CRITICAL_OVERDUE';
                return (
                  <tr key={c.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-mono font-bold text-sm text-[var(--text-main)]">{c.containerNumber}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[150px]">{c.customerName}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold">{c.size} · {c.containerType}</div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">
                        {c.weightKg.toLocaleString()} kg · Seal: {c.sealNumber || 'N/A'}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium truncate max-w-[170px]">{c.terminalName}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[170px]">
                        Dest: {c.warehouseName}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {isOverdue ? (
                        <div className="text-rose-400 font-bold">
                          {c.demurrage.overdueDays}d Overdue
                          <div className="text-[10px] text-[var(--text-muted)] font-normal">{c.demurrage.tierLabel}</div>
                        </div>
                      ) : (
                        <div className="text-emerald-400 font-semibold">
                          {c.demurrage.freeDaysRemaining}d Remaining
                          <div className="text-[10px] text-[var(--text-muted)] font-normal">
                            Discharged: {new Date(c.dischargeDate).toLocaleDateString()}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold">
                      {c.demurrage.accruedPenaltyAed > 0 ? (
                        <span className="text-rose-400">AED {c.demurrage.accruedPenaltyAed.toLocaleString()}</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">AED 0</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {c.linkedTrailerPlate ? (
                        <span className="px-2 py-1 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] font-mono font-medium">
                          {c.linkedTrailerPlate}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)] italic text-[11px]">Unlinked</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <StatusPill status={c.status.toLowerCase()} label={c.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Create Container Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-400" />
                Add New Container to Inventory
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateContainer} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Container Number *</label>
                  <input
                    type="text"
                    value={containerNumber}
                    onChange={(e) => setContainerNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. MSCU9912041"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono font-bold uppercase outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Size</label>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="40HC">40HC (High Cube)</option>
                    <option value="40FT">40FT (Standard)</option>
                    <option value="20FT">20FT (Dry Box)</option>
                    <option value="45HC">45HC (High Cube)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Type</label>
                  <select
                    value={containerType}
                    onChange={(e) => setContainerType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  >
                    <option value="DRY">DRY (General Merchandise)</option>
                    <option value="REEFER">REEFER (3-Day Free Limit)</option>
                    <option value="OPEN_TOP">OPEN TOP</option>
                    <option value="FLAT_RACK">FLAT RACK</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Gross Weight (kg)</label>
                  <input
                    type="number"
                    value={weightKg}
                    onChange={(e) => setWeightKg(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Discharge Date</label>
                  <input
                    type="date"
                    value={dischargeDate}
                    onChange={(e) => setDischargeDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">DO Expiry Date</label>
                  <input
                    type="date"
                    value={doExpiryDate}
                    onChange={(e) => setDoExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submittingCreate ? 'Saving...' : 'Add Container'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV Paste Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-blue-400" />
                Bulk CSV Container Upload
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Paste CSV contents below matching columns: <code>ContainerNumber,Size,Type,CustomerName,TerminalName,WarehouseName,DOExpiryDate,DischargeDate,SealNumber,WeightKg</code>
            </p>
            <textarea
              rows={6}
              value={csvRawText}
              onChange={(e) => setCsvRawText(e.target.value)}
              placeholder="Paste raw CSV lines here..."
              className="w-full text-xs font-mono p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleParseCsvUpload}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors"
              >
                Upload & Create Containers
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
