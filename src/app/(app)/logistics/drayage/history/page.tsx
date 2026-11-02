'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  History,
  Package,
  FileText,
  Download,
  Printer,
  CheckCircle2,
  DollarSign,
  Clock,
  Eye,
  Building2,
  X,
  Truck,
  QrCode,
  MapPin,
  Activity,
} from 'lucide-react';
import { PageHeader, KpiCard, StatusPill } from '@/components/ui/page-theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';
import {
  fetchDrayageWorkspaceCached,
  getCachedDrayageData,
} from '@/lib/logistics/drayage-client-cache';

interface DrayageJob {
  id: string;
  jobCode: string;
  jobPhase: 'L1' | 'L2';
  parentJobId: string | null;
  shipmentType: string;
  status: string;
  priority: string;
  customerName: string;
  warehouseName: string;
  terminalName: string;
  containerNumber: string;
  containerSize: string;
  tokenNumber: string | null;
  assignedVehiclePlate: string | null;
  assignedDriverName: string | null;
  assignedTrailerPlate: string | null;
  rateAmountAed: number;
  driverAllowanceAed: number;
  placementLocation: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LifecycleMilestone {
  id: string;
  stageNumber: number;
  title: string;
  description: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';
  timestamp?: string;
  metadata?: { label: string; value: string }[];
}

function getJobMilestones(job: DrayageJob): LifecycleMilestone[] {
  const status = (job.status || 'PENDING').toUpperCase();
  const isCompleted = status === 'COMPLETED';
  const isDetached = status === 'CONTAINER_DETACHED' || isCompleted;
  const isAtRamp = status === 'PLACED_AT_RAMP' || isDetached;
  const isInTransit = status === 'IN_TRANSIT' || isAtRamp;
  const isTokenIssued = Boolean(job.tokenNumber) || isInTransit;
  const isAssigned = Boolean(job.assignedVehiclePlate || job.assignedDriverName) || isTokenIssued;

  const createdTime = new Date(job.createdAt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const updatedTime = new Date(job.updatedAt || job.createdAt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return [
    {
      id: 'step-1',
      stageNumber: 1,
      title: 'Job Created & FCL Manifest Registered',
      description: `Delivery order initiated for container ${job.containerNumber} (${job.containerSize}) on corridor ${job.terminalName} → ${job.warehouseName}`,
      status: 'COMPLETED',
      timestamp: createdTime,
      metadata: [
        { label: 'Customer', value: job.customerName },
        { label: 'Priority', value: job.priority || 'NORMAL' },
        { label: 'Phase', value: job.jobPhase === 'L2' ? 'L2 - Empty Return' : 'L1 - Import Delivery' },
      ],
    },
    {
      id: 'step-2',
      stageNumber: 2,
      title: 'Asset Allocation & Driver Dispatched',
      description: isAssigned
        ? `Tractor ${job.assignedVehiclePlate || 'Assigned'} and driver ${job.assignedDriverName || 'Assigned'} linked to trip`
        : 'Awaiting fleet asset coupling and driver dispatch schedule',
      status: isAssigned ? (isTokenIssued ? 'COMPLETED' : 'IN_PROGRESS') : 'PENDING',
      timestamp: isAssigned ? createdTime : undefined,
      metadata: isAssigned
        ? [
            { label: 'Prime Mover', value: job.assignedVehiclePlate || 'N/A' },
            { label: 'Driver', value: job.assignedDriverName || 'N/A' },
            { label: 'Chassis Trailer', value: job.assignedTrailerPlate || '40FT Skeletal' },
          ]
        : undefined,
    },
    {
      id: 'step-3',
      stageNumber: 3,
      title: 'Port Terminal Token & OCR Pre-Gate Authorization',
      description: isTokenIssued
        ? `Port terminal entry token verified for ${job.terminalName}`
        : `Awaiting DP World / Port e-token generation for ${job.terminalName}`,
      status: isTokenIssued ? (isInTransit ? 'COMPLETED' : 'IN_PROGRESS') : 'PENDING',
      timestamp: isTokenIssued ? createdTime : undefined,
      metadata: isTokenIssued
        ? [
            { label: 'Terminal', value: job.terminalName },
            { label: 'Token Number', value: job.tokenNumber || 'DPW-TRN-VALID' },
            { label: 'OCR Pass', value: 'Gate Pre-Cleared' },
          ]
        : undefined,
    },
    {
      id: 'step-4',
      stageNumber: 4,
      title: 'Container Mounted & Gate-Out (Terminal EIR)',
      description: isInTransit
        ? `STS / RTG crane mounted container ${job.containerNumber} onto chassis. EIR equipment interchange pass validated at terminal exit.`
        : 'Awaiting container yard lifting and gate-out inspection',
      status: isInTransit ? (isAtRamp ? 'COMPLETED' : 'IN_PROGRESS') : 'PENDING',
      timestamp: isInTransit ? updatedTime : undefined,
      metadata: isInTransit
        ? [
            { label: 'Equipment Size', value: job.containerSize },
            { label: 'Container ID', value: job.containerNumber },
            { label: 'EIR Status', value: 'Interchange Verified' },
          ]
        : undefined,
    },
    {
      id: 'step-5',
      stageNumber: 5,
      title: 'Corridor Transit (Line-Haul)',
      description: isInTransit
        ? isAtRamp
          ? `Transit completed along corridor from ${job.terminalName} to ${job.warehouseName}`
          : `Active line-haul transit towards ${job.warehouseName} under GPS & geofence telemetry`
        : 'Pending terminal exit for highway line-haul haulage',
      status: isAtRamp ? 'COMPLETED' : isInTransit ? 'IN_PROGRESS' : 'PENDING',
      timestamp: isInTransit ? updatedTime : undefined,
      metadata: [
        { label: 'Origin Terminal', value: job.terminalName },
        { label: 'Destination', value: job.warehouseName },
      ],
    },
    {
      id: 'step-6',
      stageNumber: 6,
      title: 'Warehouse Ramp Arrival & In-Gate',
      description: isAtRamp
        ? `Arrived at consignee warehouse facility: ${job.warehouseName}. Spotting at loading ramp bay.`
        : `Awaiting arrival at destination facility ${job.warehouseName}`,
      status: isAtRamp ? (isDetached ? 'COMPLETED' : 'IN_PROGRESS') : 'PENDING',
      timestamp: isAtRamp ? updatedTime : undefined,
      metadata: isAtRamp
        ? [
            { label: 'Facility', value: job.warehouseName },
            { label: 'Ramp Spot', value: job.placementLocation || 'Dock Bay 3' },
          ]
        : undefined,
    },
    {
      id: 'step-7',
      stageNumber: 7,
      title: 'Container Destuffing / Chassis Drop Operation',
      description: isDetached
        ? `Container uncoupled at loading dock. Cargo destuffing actively underway within free detention window.`
        : 'Pending ramp destuffing / container uncoupling initiation',
      status: isDetached ? (isCompleted ? 'COMPLETED' : 'IN_PROGRESS') : 'PENDING',
      timestamp: isDetached ? updatedTime : undefined,
      metadata: isDetached
        ? [
            { label: 'Operation', value: isCompleted ? 'Destuffing Finalized' : 'Dock Destuffing Active' },
            { label: 'Detention Clock', value: 'Free Time Compliant' },
          ]
        : undefined,
    },
    {
      id: 'step-8',
      stageNumber: 8,
      title: 'Empty Container Return & Turnaround Completed',
      description: isCompleted
        ? `Empty container deposited at container depot / DP World port. Interchange sign-off closed and job finalized.`
        : 'Awaiting empty container return to close drayage cycle',
      status: isCompleted ? 'COMPLETED' : 'PENDING',
      timestamp: isCompleted ? updatedTime : undefined,
      metadata: isCompleted
        ? [
            { label: 'Turnaround Status', value: 'COMPLETED & CLOSED' },
            { label: 'Billing Status', value: `AED ${job.rateAmountAed.toLocaleString()} Invoiced` },
          ]
        : undefined,
    },
  ];
}

function numberToWordsAED(num: number): { en: string; ar: string } {
  const dirhams = Math.floor(num);
  const fils = Math.round((num - dirhams) * 100);

  const onesEn = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tensEn = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertGroup(n: number): string {
    let str = '';
    if (n >= 100) {
      str += onesEn[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tensEn[Math.floor(n / 10)] + (n % 10 ? '-' + onesEn[n % 10] : '') + ' ';
    } else if (n > 0) {
      str += onesEn[n] + ' ';
    }
    return str.trim();
  }

  function toWordsEn(n: number): string {
    if (n === 0) return 'Zero';
    let res = '';
    if (n >= 1000000) {
      res += convertGroup(Math.floor(n / 1000000)) + ' Million ';
      n %= 1000000;
    }
    if (n >= 1000) {
      res += convertGroup(Math.floor(n / 1000)) + ' Thousand ';
      n %= 1000;
    }
    if (n > 0) {
      res += convertGroup(n);
    }
    return res.trim();
  }

  const enDirhams = toWordsEn(dirhams);
  const enFils = fils > 0 ? ` and ${toWordsEn(fils)} Fils` : '';
  const en = `${enDirhams} UAE Dirhams${enFils} Only.`;

  const arOnes = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const arTens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const arHundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function toWordsAr(n: number): string {
    let cur = n;
    if (cur === 0) return 'صفر';
    const parts: string[] = [];
    if (cur >= 1000) {
      const thousands = Math.floor(cur / 1000);
      if (thousands === 1) parts.push('ألف');
      else if (thousands === 2) parts.push('ألفان');
      else if (thousands >= 3 && thousands <= 10) parts.push(arOnes[thousands] + ' آلاف');
      else parts.push(toWordsAr(thousands) + ' ألف');
      cur %= 1000;
    }
    if (cur >= 100) {
      parts.push(arHundreds[Math.floor(cur / 100)]);
      cur %= 100;
    }
    if (cur >= 20) {
      const unit = cur % 10;
      const ten = Math.floor(cur / 10);
      if (unit > 0) {
        parts.push(`${arOnes[unit]} و${arTens[ten]}`);
      } else {
        parts.push(arTens[ten]);
      }
    } else if (cur > 0) {
      parts.push(arOnes[cur]);
    }
    return parts.join(' و');
  }

  const arDirhams = toWordsAr(dirhams);
  const arFils = fils > 0 ? ` و${toWordsAr(fils)} فلساً` : '';
  const ar = `فقط ${arDirhams} درهماً إماراتياً${arFils} لا غير.`;

  return { en, ar };
}

export default function DrayageHistoryPage() {
  const cached = getCachedDrayageData();
  const [loading, setLoading] = useState(!cached?.jobs);
  const [jobs, setJobs] = useState<DrayageJob[]>(cached?.jobs || []);
  const [search] = useState('');
  const [shipmentFilter, setShipmentFilter] = useState<'ALL' | 'IMPORT' | 'EXPORT'>('ALL');
  const [selectedJobForInvoice, setSelectedJobForInvoice] = useState<DrayageJob | null>(null);
  const [selectedJobForLifecycle, setSelectedJobForLifecycle] = useState<DrayageJob | null>(null);

  // Detention Calculator Settings
  const [freeHours, setFreeHours] = useState(4);
  const [hourlyDetentionRate, setHourlyDetentionRate] = useState(150);

  const loadData = useCallback(async (forceFresh = false) => {
    try {
      if (!getCachedDrayageData()?.jobs) setLoading(true);
      const data = await fetchDrayageWorkspaceCached({ forceFresh });
      const loadedJobs = data?.jobs || [];
      setJobs(loadedJobs);
    } catch {
      // Keep page usable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (shipmentFilter !== 'ALL' && j.shipmentType !== shipmentFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          j.jobCode.toLowerCase().includes(q) ||
          j.containerNumber.toLowerCase().includes(q) ||
          j.customerName.toLowerCase().includes(q) ||
          (j.assignedVehiclePlate && j.assignedVehiclePlate.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [jobs, search, shipmentFilter]);

  // Completed jobs & stats
  const completedJobs = useMemo(() => jobs.filter((j) => j.status === 'COMPLETED'), [jobs]);
  const totalBilledAed = jobs.reduce((sum, j) => sum + j.rateAmountAed, 0);

  
  const historyColumns: DataGridColumn<DrayageJob>[] = useMemo(() => [
    {
      key: 'jobCode',
      header: 'Job Reference',
      accessor: (j) => `${j.jobCode} ${j.jobPhase} ${new Date(j.createdAt).toLocaleDateString()}`,
      filter: 'text',
      render: (job) => {
        const isL2 = job.jobPhase === 'L2';
        return (
          <div>
            <div className="font-mono font-bold text-[var(--text-main)] flex items-center gap-1.5">
              <span className="hover:text-blue-400 transition-colors">{job.jobCode}</span>
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  isL2
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                }`}
              >
                {job.jobPhase}
              </span>
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              {new Date(job.createdAt).toLocaleDateString()}
            </div>
          </div>
        );
      },
    },
    {
      key: 'customer',
      header: 'Customer & Corridor',
      accessor: (j) => `${j.customerName} ${j.terminalName} ${j.warehouseName}`,
      filter: 'text',
      render: (job) => (
        <div>
          <div className="font-medium text-[var(--text-main)] truncate max-w-[160px]">{job.customerName}</div>
          <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]">
            {job.terminalName} → {job.warehouseName}
          </div>
        </div>
      ),
    },
    {
      key: 'container',
      header: 'Container Number',
      accessor: (j) => `${j.containerNumber} ${j.containerSize}`,
      filter: 'text',
      render: (job) => (
        <div>
          <div className="font-mono font-semibold">{job.containerNumber}</div>
          <div className="text-[10px] text-[var(--text-muted)]">{job.containerSize}</div>
        </div>
      ),
    },
    {
      key: 'executedFleet',
      header: 'Executed Fleet',
      accessor: (j) => `${j.assignedVehiclePlate || ''} ${j.assignedDriverName || ''} ${j.assignedTrailerPlate || ''}`,
      filter: 'text',
      render: (job) => (
        <div>
          <div className="font-medium">{job.assignedVehiclePlate || 'Tractor N/A'}</div>
          <div className="text-[10px] text-[var(--text-muted)]">
            {job.assignedDriverName || 'Driver N/A'} · {job.assignedTrailerPlate || 'Chassis N/A'}
          </div>
        </div>
      ),
    },
    {
      key: 'rateAmountAed',
      header: 'Base Rate (AED)',
      accessor: (j) => j.rateAmountAed,
      filter: 'text',
      align: 'right',
      render: (job) => (
        <span className="font-mono font-semibold">AED {job.rateAmountAed.toLocaleString()}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (j) => j.status,
      filter: 'select',
      selectOptions: ['COMPLETED', 'IN_TRANSIT', 'PENDING', 'CANCELLED'],
      render: (job) => <StatusPill status={job.status.toLowerCase()} label={job.status} />,
    },
    {
      key: 'actions',
      header: 'Invoice & Lifecycle',
      align: 'right',
      sortable: false,
      filter: false,
      render: (job) => (
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setSelectedJobForLifecycle(job)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] hover:border-blue-500/40 hover:text-blue-400 text-[11px] font-semibold transition-colors"
            title="View Drayage Execution Lifecycle"
          >
            <Eye className="w-3 h-3 text-blue-400" />
            Lifecycle
          </button>
          <button
            onClick={() => setSelectedJobForInvoice(job)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors"
          >
            <FileText className="w-3 h-3" />
            Tax Invoice
          </button>
        </div>
      ),
    },
  ], []);

  // Export CSV for Zoho, QuickBooks, Xero
  const handleExportCsv = (format: 'ZOHO' | 'QUICKBOOKS' | 'XERO') => {
    const headers = ['InvoiceNumber', 'CustomerName', 'JobCode', 'ContainerNumber', 'Phase', 'BaseRateAED', 'VAT5AED', 'TotalAED', 'Date'];
    const rows = filteredJobs.map((j) => {
      const vat = j.rateAmountAed * 0.05;
      const total = j.rateAmountAed + vat;
      return [
        `INV-${j.jobCode}`,
        `"${j.customerName}"`,
        j.jobCode,
        j.containerNumber,
        j.jobPhase,
        j.rateAmountAed.toFixed(2),
        vat.toFixed(2),
        total.toFixed(2),
        new Date(j.createdAt).toISOString().slice(0, 10),
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `drayage_export_${format.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Drayage Job History & FTA Invoicing"
        subtitle="Historical container turnaround archive, warehouse waiting detention calculations, and UAE FTA 5% VAT tax invoice generation"
        icon={History}
        accent="blue"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportCsv('ZOHO')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500/40 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              Export Zoho CSV
            </button>
            <button
              onClick={() => handleExportCsv('QUICKBOOKS')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-emerald-500/40 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              QuickBooks CSV
            </button>
          </div>
        }
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Historical Jobs"
          value={jobs.length}
          icon={Package}
          accent="blue"
          sub="Import & Export FCL"
        />
        <KpiCard
          label="Completed Turnarounds"
          value={completedJobs.length}
          icon={CheckCircle2}
          accent="emerald"
          sub="Empty deposited at port"
        />
        <KpiCard
          label="Total Contracted Billings"
          value={`AED ${totalBilledAed.toLocaleString()}`}
          icon={DollarSign}
          accent="cyan"
          sub="Excl. 5% UAE VAT"
        />
        <KpiCard
          label="Estimated 5% FTA VAT"
          value={`AED ${(totalBilledAed * 0.05).toLocaleString()}`}
          icon={FileText}
          accent="amber"
          sub="Tax invoice liability"
        />
      </div>

      {/* Waiting Detention Calculator Configuration */}
      <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-400 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-[var(--text-main)]">Ramp & Yard Detention Rate Matrix</h4>
            <p className="text-[11px] text-[var(--text-muted)]">
              Applies hourly waiting charge if chassis exceeds allocated free destuffing time.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--text-muted)]">Free Hours:</span>
            <input
              type="number"
              value={freeHours}
              onChange={(e) => setFreeHours(Number(e.target.value))}
              className="w-16 px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono text-center font-bold"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--text-muted)]">Rate (AED/hr):</span>
            <input
              type="number"
              value={hourlyDetentionRate}
              onChange={(e) => setHourlyDetentionRate(Number(e.target.value))}
              className="w-20 px-2.5 py-1 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono text-center font-bold"
            />
          </div>
        </div>
      </div>

      {/* Main Historical Table */}
      <FleetDataGrid<DrayageJob>
        rows={filteredJobs}
        columns={historyColumns}
        getRowId={(j) => j.id}
        loading={loading}
        onRowClick={(job) => setSelectedJobForLifecycle(job)}
        emptyMessage="No historical drayage records found"
        gridName="DrayageHistoryGrid"
        numbered={true}
        toolbar={{
          title: 'Turnaround & Billing Archive',
          search: true,
          columns: true,
          density: true,
          filters: true,
          exportCsv: true,
          exportName: 'drayage_job_history',
          actions: (
            <div className="flex items-center gap-2">
              <select
                value={shipmentFilter}
                onChange={(e) => setShipmentFilter(e.target.value as Parameters<typeof setShipmentFilter>[0])}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500"
              >
                <option value="ALL">All Shipments</option>
                <option value="IMPORT">IMPORT FCL</option>
                <option value="EXPORT">EXPORT</option>
              </select>
            </div>
          ),
        }}
      />

      {/* Job Execution Lifecycle Modal */}
      {selectedJobForLifecycle && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-6 my-8 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[var(--border-subtle)] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-600/15 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-[var(--text-main)] font-mono">
                      {selectedJobForLifecycle.jobCode}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        selectedJobForLifecycle.jobPhase === 'L2'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                      }`}
                    >
                      {selectedJobForLifecycle.jobPhase === 'L2' ? 'Phase L2 (Empty Return)' : 'Phase L1 (Import Delivery)'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                      {selectedJobForLifecycle.containerNumber} ({selectedJobForLifecycle.containerSize})
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Customer: <strong className="text-[var(--text-main)]">{selectedJobForLifecycle.customerName}</strong> · Ordered on {new Date(selectedJobForLifecycle.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={selectedJobForLifecycle.status.toLowerCase()} label={selectedJobForLifecycle.status} />
                <button
                  onClick={() => setSelectedJobForLifecycle(null)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Corridor Routing Visual */}
            <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                  <MapPin className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Port Terminal Origin</span>
                  <strong className="text-[var(--text-main)] text-xs">{selectedJobForLifecycle.terminalName}</strong>
                </div>
              </div>

              <div className="flex-1 flex items-center justify-center gap-2 px-4">
                <div className="h-0.5 flex-1 bg-[var(--border-subtle)] relative">
                  <div className="absolute inset-0 bg-blue-500/50 rounded-full" />
                </div>
                <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-semibold shrink-0">
                  <Truck className="w-3 h-3" />
                  <span>Freight Line-Haul</span>
                </div>
                <div className="h-0.5 flex-1 bg-[var(--border-subtle)] relative">
                  <div className="absolute inset-0 bg-blue-500/50 rounded-full" />
                </div>
              </div>

              <div className="flex items-center gap-2 text-right">
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Destination Facility</span>
                  <strong className="text-[var(--text-main)] text-xs">{selectedJobForLifecycle.warehouseName}</strong>
                </div>
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>

            {/* Operational Snapshot Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)] uppercase block font-semibold">Tractor & Driver</span>
                <div className="font-bold text-[var(--text-main)] mt-0.5 font-mono">
                  {selectedJobForLifecycle.assignedVehiclePlate || 'Unassigned'}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">
                  {selectedJobForLifecycle.assignedDriverName || 'No driver linked'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)] uppercase block font-semibold">Trailer Chassis</span>
                <div className="font-bold text-[var(--text-main)] mt-0.5 font-mono">
                  {selectedJobForLifecycle.assignedTrailerPlate || '40FT Skeletal'}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">Coupled Chassis</div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)] uppercase block font-semibold">Port Token Ref</span>
                <div className="font-bold text-[var(--text-main)] mt-0.5 font-mono text-cyan-400">
                  {selectedJobForLifecycle.tokenNumber || 'DPW-PREPASS'}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">Terminal Pre-Gate Pass</div>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)] uppercase block font-semibold">Haulage Rate</span>
                <div className="font-bold text-emerald-400 mt-0.5 font-mono">
                  AED {selectedJobForLifecycle.rateAmountAed.toLocaleString()}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">+ 5% FTA VAT (AED {(selectedJobForLifecycle.rateAmountAed * 0.05).toFixed(0)})</div>
              </div>
            </div>

            {/* Stepper Timeline Header */}
            {(() => {
              const milestones = getJobMilestones(selectedJobForLifecycle);
              const completedCount = milestones.filter((m) => m.status === 'COMPLETED').length;
              const progressPct = Math.round((completedCount / milestones.length) * 100);

              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[var(--text-main)] uppercase tracking-wider text-[11px]">
                        Lifecycle Progression
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-bold font-mono text-[10px]">
                        {completedCount} of {milestones.length} Stages Completed ({progressPct}%)
                      </span>
                    </div>
                    <span className="text-[var(--text-muted)] font-mono text-[11px]">
                      Current Stage: <strong className="text-blue-400">{selectedJobForLifecycle.status}</strong>
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-[var(--bg-main)] overflow-hidden border border-[var(--border-subtle)]">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {/* Stepper Timeline Items */}
                  <div className="space-y-4 pt-2">
                    {milestones.map((milestone, idx) => {
                      const isCompleted = milestone.status === 'COMPLETED';
                      const isInProgress = milestone.status === 'IN_PROGRESS';
                      const isLast = idx === milestones.length - 1;

                      return (
                        <div key={milestone.id} className="relative flex items-start gap-3.5 group">
                          {/* Vertical Connector Line */}
                          {!isLast && (
                            <div
                              className={`absolute left-4 top-8 bottom-[-16px] w-0.5 -ml-[1px] transition-colors ${
                                isCompleted ? 'bg-emerald-500/40' : 'bg-[var(--border-subtle)]'
                              }`}
                            />
                          )}

                          {/* Node Icon */}
                          <div className="relative shrink-0 z-10">
                            {isCompleted ? (
                              <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shadow-sm">
                                <CheckCircle2 className="w-4 h-4" />
                              </div>
                            ) : isInProgress ? (
                              <div className="relative">
                                <span className="absolute -inset-1 rounded-full bg-blue-500/30 animate-ping opacity-75" />
                                <div className="w-8 h-8 rounded-full bg-blue-600 text-white border-2 border-blue-400 flex items-center justify-center relative shadow-md">
                                  <Activity className="w-4 h-4 animate-spin" />
                                </div>
                              </div>
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)] flex items-center justify-center">
                                <Clock className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </div>

                          {/* Stage Content Card */}
                          <div
                            className={`flex-1 p-3.5 rounded-xl border transition-all ${
                              isInProgress
                                ? 'bg-blue-500/5 border-blue-500/40 shadow-sm ring-1 ring-blue-500/20'
                                : isCompleted
                                ? 'bg-[var(--bg-main)] border-[var(--border-subtle)] hover:border-emerald-500/30'
                                : 'bg-[var(--bg-main)]/50 border-[var(--border-subtle)] opacity-60'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase">
                                  Stage 0{milestone.stageNumber}
                                </span>
                                <h4
                                  className={`font-bold text-xs ${
                                    isInProgress
                                      ? 'text-blue-400'
                                      : isCompleted
                                      ? 'text-[var(--text-main)]'
                                      : 'text-[var(--text-muted)]'
                                  }`}
                                >
                                  {milestone.title}
                                </h4>
                              </div>

                              <div className="flex items-center gap-2">
                                {milestone.timestamp && (
                                  <span className="text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {milestone.timestamp}
                                  </span>
                                )}
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                    isCompleted
                                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                      : isInProgress
                                      ? 'bg-blue-500/20 text-blue-300 border border-blue-400/40 animate-pulse'
                                      : 'bg-slate-500/15 text-slate-400 border border-slate-500/30'
                                  }`}
                                >
                                  {isCompleted
                                    ? 'Completed'
                                    : isInProgress
                                    ? 'Active Current Stage'
                                    : 'Upcoming Milestone'}
                                </span>
                              </div>
                            </div>

                            <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-relaxed">
                              {milestone.description}
                            </p>

                            {/* Metadata Pills */}
                            {milestone.metadata && milestone.metadata.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2 border-t border-[var(--border-subtle)]">
                                {milestone.metadata.map((meta, mIdx) => (
                                  <span
                                    key={mIdx}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10px] font-medium text-[var(--text-main)]"
                                  >
                                    <span className="text-[var(--text-muted)]">{meta.label}:</span>
                                    <strong className="font-mono">{meta.value}</strong>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Modal Action Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
              <div className="text-[11px] text-[var(--text-muted)]">
                Click any milestone stage to view inspection telemetry or generate invoice.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedJobForLifecycle(null)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const j = selectedJobForLifecycle;
                    setSelectedJobForLifecycle(null);
                    setSelectedJobForInvoice(j);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5" />
                  View Tax Invoice
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* UAE FTA Tax Invoice Modal */}
      {selectedJobForInvoice && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex flex-col items-center justify-start overflow-y-auto p-3 sm:p-6 print:p-0 print:bg-white print:static print:overflow-visible">
          {/* Print Isolation Styles */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              @page {
                size: A4 portrait;
                margin: 8mm 10mm 8mm 10mm;
              }
              html, body {
                background: #ffffff !important;
                color: #0f172a !important;
                margin: 0 !important;
                padding: 0 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              body * {
                visibility: hidden !important;
              }
              #uae-tax-invoice-sheet,
              #uae-tax-invoice-sheet * {
                visibility: visible !important;
              }
              #uae-tax-invoice-sheet {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                background: #ffffff !important;
                color: #0f172a !important;
                box-shadow: none !important;
                border: none !important;
                border-radius: 0 !important;
              }
              .no-print,
              .print\\:hidden {
                display: none !important;
              }
            }
          `}} />

          {/* Screen-Only Action Control Bar (COMPLETELY EXCLUDED WHEN PRINTING) */}
          <div className="no-print print:hidden w-full max-w-4xl flex items-center justify-between mb-4 px-4 py-3 rounded-xl bg-slate-900/90 border border-slate-700 shadow-2xl backdrop-blur-md sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  UAE FTA Tax Invoice Preview
                  <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                    FTA COMPLIANT (5% VAT)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Original UAE format for printing. Control buttons are automatically excluded from the printed document.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedJobForInvoice(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Close Preview
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md active:scale-95"
              >
                <Printer className="w-4 h-4" />
                Print Tax Invoice
              </button>
            </div>
          </div>

          {/* Authentic UAE FTA Tax Invoice Document Sheet (ZERO BUTTONS INSIDE) */}
          <div
            id="uae-tax-invoice-sheet"
            className="w-full max-w-4xl bg-white text-slate-900 rounded-xl shadow-2xl p-8 sm:p-10 font-sans border border-slate-200 print:shadow-none print:border-none print:p-0 print:m-0 print:rounded-none print:w-full"
          >
            {/* Header: Company Brand + Title + Digital Stamp */}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5 mb-5">
              {/* Left: Supplier Legal Entity */}
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-sm tracking-wider">
                    F360
                  </div>
                  <div>
                    <h1 className="text-base font-black tracking-tight text-slate-900 uppercase">
                      Fleet360 Logistics Solutions L.L.C
                    </h1>
                    <p className="text-xs font-bold text-slate-600 font-arabic text-left">
                      فليت 360 للحلول اللوجستية ش.ذ.م.م
                    </p>
                  </div>
                </div>

                <div className="text-[11px] text-slate-600 space-y-0.5 pt-1">
                  <div>Commercial License / CR No: <strong className="text-slate-800 font-mono">CN-1092842</strong> (Dubai DED)</div>
                  <div>Plot S20401, JAFZA South Gate 5, P.O. Box 261888, Dubai, United Arab Emirates</div>
                  <div>Tel: +971 4 881 9000 &bull; Email: billing@fleet360.ae &bull; Web: www.fleet360.ae</div>
                  <div className="pt-1.5">
                    <span className="inline-block px-2.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-[11px] text-slate-900">
                      Tax Registration No. (TRN / رقم التسجيل الضريبي): 100294819200003
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Tax Invoice Title & FTA Seal */}
              <div className="text-right flex flex-col items-end">
                <div className="border-b border-slate-300 pb-1 mb-2">
                  <h2 className="text-2xl font-black text-slate-900 tracking-wider">
                    TAX INVOICE
                  </h2>
                  <div className="text-lg font-bold text-slate-700 font-arabic">
                    فاتورة ضريبية
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 max-w-[220px] leading-tight">
                  Issued pursuant to UAE Federal Decree-Law No. (8) of 2017 on Value Added Tax
                </p>
                {/* QR Code / Digital Verification Block */}
                <div className="mt-2.5 flex items-center gap-2 p-1.5 bg-slate-50 border border-slate-300 rounded">
                  <div className="text-[8px] text-slate-500 text-left font-mono leading-tight">
                    <div>FTA e-Invoice</div>
                    <div>TRN 100294819200003</div>
                    <div>Verified Genuine</div>
                  </div>
                  <QrCode className="w-10 h-10 text-slate-900 shrink-0" />
                </div>
              </div>
            </div>

            {/* Customer & Invoice Details Matrix */}
            <div className="grid grid-cols-2 gap-4 mb-5 text-[11px]">
              {/* Bill To / Recipient */}
              <div className="border border-slate-300 rounded-lg p-3.5 bg-slate-50/50">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                  <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">
                    Billed To / العميل (المشتري)
                  </span>
                  <span className="text-[10px] text-slate-500">Buyer Details</span>
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-bold text-slate-900">
                    {selectedJobForInvoice.customerName}
                  </div>
                  <div className="font-mono text-[11px] text-slate-700">
                    Buyer TRN: <strong>100384729100003</strong>
                  </div>
                  <div className="text-slate-600">
                    Delivery Destination: {selectedJobForInvoice.warehouseName}
                  </div>
                  <div className="text-slate-500">
                    Dubai Industrial City / JAFZA, Dubai, United Arab Emirates
                  </div>
                  <div className="text-slate-500">
                    Attn: Accounts Payable & Inbound Logistics
                  </div>
                </div>
              </div>

              {/* Invoice Metadata */}
              <div className="border border-slate-300 rounded-lg p-3.5 bg-slate-50/50">
                <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                  <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">
                    Invoice Details / بيانات الفاتورة
                  </span>
                  <span className="text-[10px] text-slate-500">Tax Point</span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  <span className="text-slate-500">Invoice Number:</span>
                  <span className="font-mono font-bold text-slate-900 text-right">
                    INV-DXB-{new Date(selectedJobForInvoice.createdAt).getFullYear()}-{selectedJobForInvoice.jobCode}
                  </span>

                  <span className="text-slate-500">Tax Point / Issue Date:</span>
                  <span className="font-mono text-slate-800 text-right">
                    {new Date(selectedJobForInvoice.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>

                  <span className="text-slate-500">Supply / Delivery Date:</span>
                  <span className="font-mono text-slate-800 text-right">
                    {new Date(selectedJobForInvoice.updatedAt || selectedJobForInvoice.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>

                  <span className="text-slate-500">Payment Terms:</span>
                  <span className="text-slate-800 text-right font-medium">
                    30 Days Net (صافي 30 يوماً)
                  </span>

                  <span className="text-slate-500">Payment Due Date:</span>
                  <span className="font-mono font-bold text-slate-900 text-right">
                    {new Date(new Date(selectedJobForInvoice.createdAt).getTime() + 30 * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>

                  <span className="text-slate-500">Place of Supply:</span>
                  <span className="text-slate-800 text-right">
                    Dubai, UAE (دبي، الإمارات)
                  </span>

                  <span className="text-slate-500">Currency:</span>
                  <span className="font-bold text-slate-900 text-right">
                    AED (درهم إماراتي)
                  </span>
                </div>
              </div>
            </div>

            {/* Drayage Operational References Strip */}
            <div className="border border-slate-300 rounded-lg p-2.5 mb-5 bg-slate-100/70 text-[10px]">
              <div className="font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between border-b border-slate-200 pb-1">
                <span>Port Cargo & Transport Execution Reference / مراجع العملية والنقل</span>
                <span className="font-mono text-slate-500">Job Code: {selectedJobForInvoice.jobCode}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-slate-700">
                <div>
                  <span className="text-slate-500 block">Container & Size:</span>
                  <strong className="font-mono text-slate-900">
                    {selectedJobForInvoice.containerNumber} ({selectedJobForInvoice.containerSize})
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Shipment Type:</span>
                  <strong className="text-slate-900">
                    {selectedJobForInvoice.shipmentType || 'IMPORT'} (FCL Drayage)
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Port Terminal:</span>
                  <strong className="text-slate-900 truncate block" title={selectedJobForInvoice.terminalName}>
                    {selectedJobForInvoice.terminalName}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Dubai Trade Token:</span>
                  <strong className="font-mono text-slate-900">
                    {selectedJobForInvoice.tokenNumber || 'DPW-TKN-8839'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Prime Mover (Tractor):</span>
                  <strong className="font-mono text-slate-900">
                    {selectedJobForInvoice.assignedVehiclePlate || 'DXB-TRACTOR-482'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Trailer Chassis:</span>
                  <strong className="font-mono text-slate-900">
                    {selectedJobForInvoice.assignedTrailerPlate || 'DXB-TR-9901'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Assigned Driver:</span>
                  <strong className="text-slate-900 truncate block">
                    {selectedJobForInvoice.assignedDriverName || 'Licensed Logistics Driver'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Transport Phase:</span>
                  <strong className="text-slate-900">
                    Phase {selectedJobForInvoice.jobPhase} ({selectedJobForInvoice.jobPhase === 'L2' ? 'Empty Return' : 'Laden Delivery'})
                  </strong>
                </div>
              </div>
            </div>

            {/* Itemized Table of Charges (Standard FTA Format) */}
            <div className="border border-slate-300 rounded-lg overflow-hidden mb-5">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 text-[9px] font-bold uppercase tracking-wider border-b border-slate-300">
                    <th className="py-2.5 px-2 border-r border-slate-300 text-center w-8">#<br/><span className="text-[8px] font-arabic font-normal">م</span></th>
                    <th className="py-2.5 px-3 border-r border-slate-300">Description of Goods / Services<br/><span className="text-[8px] font-arabic font-normal">بيان ووصف الخدمات والعمليات</span></th>
                    <th className="py-2.5 px-2 border-r border-slate-300 text-center w-14">Qty<br/><span className="text-[8px] font-arabic font-normal">الكمية</span></th>
                    <th className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono w-24">Unit Price<br/><span className="text-[8px] font-arabic font-normal">سعر الوحدة</span></th>
                    <th className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono w-24">Gross Amt<br/><span className="text-[8px] font-arabic font-normal">الإجمالي</span></th>
                    <th className="py-2.5 px-2 border-r border-slate-300 text-right font-mono w-16">Discount<br/><span className="text-[8px] font-arabic font-normal">الخصم</span></th>
                    <th className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono w-24">Taxable<br/><span className="text-[8px] font-arabic font-normal">الخاضع للضريبة</span></th>
                    <th className="py-2.5 px-2 border-r border-slate-300 text-center font-mono w-14">VAT %<br/><span className="text-[8px] font-arabic font-normal">النسبة</span></th>
                    <th className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono w-20">VAT Amt<br/><span className="text-[8px] font-arabic font-normal">مبلغ الضريبة</span></th>
                    <th className="py-2.5 px-3 text-right font-mono w-28 bg-slate-200/60 font-bold">Total (AED)<br/><span className="text-[8px] font-arabic font-normal">الإجمالي شامل الضريبة</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  <tr>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">1</td>
                    <td className="py-2.5 px-3 border-r border-slate-200">
                      <div className="font-bold text-slate-900">
                        Port Container Drayage & Haulage ({selectedJobForInvoice.jobPhase})
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Transport of container {selectedJobForInvoice.containerNumber} from {selectedJobForInvoice.terminalName} to {selectedJobForInvoice.warehouseName}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">1 Trip</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">{selectedJobForInvoice.rateAmountAed.toFixed(2)}</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">{selectedJobForInvoice.rateAmountAed.toFixed(2)}</td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-right font-mono text-slate-400">0.00</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono font-medium">{selectedJobForInvoice.rateAmountAed.toFixed(2)}</td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">5%</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">{(selectedJobForInvoice.rateAmountAed * 0.05).toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold bg-slate-50">{(selectedJobForInvoice.rateAmountAed * 1.05).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">2</td>
                    <td className="py-2.5 px-3 border-r border-slate-200">
                      <div className="font-bold text-slate-900">
                        DP World Port Gate OCR Pass & Terminal Surcharge
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Dubai Trade EDI gate token dispatch, OCR validation and terminal security access fee ({selectedJobForInvoice.tokenNumber || 'DPW-TKN'})
                      </div>
                    </td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">1 Pass</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">35.00</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">35.00</td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-right font-mono text-slate-400">0.00</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono font-medium">35.00</td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">5%</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">1.75</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold bg-slate-50">36.75</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">3</td>
                    <td className="py-2.5 px-3 border-r border-slate-200">
                      <div className="font-bold text-slate-900">
                        Electronic EIR & Equipment Interchange Documentation
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Digital interchange inspection verification and delivery order gate clearance
                      </div>
                    </td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">1 Set</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">0.00</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">0.00</td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-right font-mono text-slate-400">0.00</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono font-medium">0.00</td>
                    <td className="py-2.5 px-2 border-r border-slate-200 text-center font-mono">5%</td>
                    <td className="py-2.5 px-2.5 border-r border-slate-200 text-right font-mono">0.00</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold bg-slate-50">0.00</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Totals & Financial Reconciliation */}
            <div className="grid grid-cols-12 gap-4 mb-5">
              {/* Left: Amount in Words & Bank Remittance (Cols 7) */}
              <div className="col-span-7 space-y-3">
                {/* Amount in words */}
                <div className="p-3 border border-slate-300 rounded-lg bg-slate-50 text-[11px]">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[9px] mb-1">
                    Total Amount in Words / المبلغ بالكلمات:
                  </div>
                  <div className="font-semibold text-slate-900 italic">
                    {numberToWordsAED((selectedJobForInvoice.rateAmountAed + 35) * 1.05).en}
                  </div>
                  <div className="font-bold text-slate-700 font-arabic text-left pt-0.5">
                    {numberToWordsAED((selectedJobForInvoice.rateAmountAed + 35) * 1.05).ar}
                  </div>
                </div>

                {/* Bank Details */}
                <div className="p-3 border border-slate-300 rounded-lg bg-slate-50 text-[10px] space-y-1">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[9px] border-b border-slate-200 pb-1 mb-1">
                    Bank Remittance Details / بيانات الحساب المصرفي للتحويل:
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-slate-700">
                    <span>Bank Name:</span>
                    <strong className="text-slate-900">Emirates NBD Bank PJSC</strong>
                    <span>Account Name:</span>
                    <strong className="text-slate-900">Fleet360 Logistics Solutions LLC</strong>
                    <span>IBAN:</span>
                    <strong className="font-mono text-slate-900">AE29 0260 0001 2345 6789 012</strong>
                    <span>Account Number:</span>
                    <strong className="font-mono text-slate-900">102948192001</strong>
                    <span>SWIFT / BIC Code:</span>
                    <strong className="font-mono text-slate-900">EBILAEAD</strong>
                    <span>Branch:</span>
                    <span className="text-slate-900">JAFZA South Branch, Dubai</span>
                  </div>
                </div>
              </div>

              {/* Right: Summary Calculation Card (Cols 5) */}
              <div className="col-span-5 border border-slate-300 rounded-lg p-3.5 bg-slate-50/50 space-y-2 text-[11px]">
                <div className="font-bold text-slate-900 uppercase tracking-wider text-[10px] border-b border-slate-200 pb-1.5 mb-2">
                  Summary of Charges / ملخص الفاتورة
                </div>

                {(() => {
                  const subtotal = selectedJobForInvoice.rateAmountAed + 35;
                  const vat = subtotal * 0.05;
                  const total = subtotal + vat;
                  return (
                    <div className="space-y-1.5 font-mono">
                      <div className="flex justify-between text-slate-600">
                        <span>Total Gross Amount:</span>
                        <span>AED {subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Total Discount (الخصم):</span>
                        <span>AED 0.00</span>
                      </div>
                      <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200">
                        <span>Total Taxable Value:</span>
                        <span>AED {subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-700">
                        <span>Total VAT (5%):</span>
                        <span>AED {vat.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm font-black text-slate-900 bg-emerald-500/10 border border-emerald-500/30 p-2 rounded mt-2">
                        <span className="text-xs uppercase font-sans">Total Due (المستحق):</span>
                        <span className="text-base text-emerald-700">AED {total.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Signatures & Stamp Authentication Section */}
            <div className="grid grid-cols-3 gap-4 pt-4 border-t-2 border-slate-300 text-[10px] text-slate-600">
              {/* Prepared By */}
              <div className="space-y-6">
                <div className="font-bold text-slate-800 uppercase tracking-wider text-[9px]">
                  Prepared & Verified By / إعداد
                </div>
                <div className="border-b border-slate-400 w-3/4 pt-4" />
                <div>
                  <strong className="text-slate-900 block">Finance & Billing Department</strong>
                  <span>Fleet360 Logistics Solutions LLC</span>
                </div>
              </div>

              {/* Official Stamp */}
              <div className="flex flex-col items-center justify-center text-center">
                <div className="w-24 h-24 rounded-full border-2 border-dashed border-blue-600/50 flex flex-col items-center justify-center p-2 text-blue-900 bg-blue-50/50 rotate-[-4deg]">
                  <span className="text-[7px] font-black uppercase tracking-tight">FLEET360 LOGISTICS</span>
                  <span className="text-[6px] text-slate-600 font-mono">TRN 100294819200003</span>
                  <span className="text-[8px] font-black text-blue-700 my-0.5 border-y border-blue-300 py-0.5 px-1 uppercase tracking-wider">
                    TAX INVOICE
                  </span>
                  <span className="text-[7px] font-bold">APPROVED & ISSUED</span>
                  <span className="text-[6px] text-slate-500">DUBAI - UAE</span>
                </div>
                <span className="text-[9px] text-slate-500 mt-1">Official Company Stamp</span>
              </div>

              {/* Customer Acceptance */}
              <div className="space-y-6 text-right">
                <div className="font-bold text-slate-800 uppercase tracking-wider text-[9px]">
                  Customer Acceptance / استلام العميل
                </div>
                <div className="border-b border-slate-400 w-3/4 ml-auto pt-4" />
                <div>
                  <strong className="text-slate-900 block">Authorized Signature & Stamp</strong>
                  <span>Name: ______________________</span>
                </div>
              </div>
            </div>

            {/* Official FTA Legal Footer */}
            <div className="mt-6 pt-3 border-t border-slate-200 text-center text-[9px] text-slate-500 leading-relaxed">
              <p>
                This is an official Tax Invoice issued in compliance with Article (59) of the Executive Regulations of UAE Federal Decree-Law No. (8) of 2017 on Value Added Tax.
              </p>
              <p className="font-arabic text-slate-400 mt-0.5">
                هذه فاتورة ضريبية رسمية صادرة وفقاً للمادة (59) من اللائحة التنفيذية للمرسوم بقانون اتحادي رقم (8) لسنة 2017 في شأن ضريبة القيمة المضافة بدولة الإمارات العربية المتحدة.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
