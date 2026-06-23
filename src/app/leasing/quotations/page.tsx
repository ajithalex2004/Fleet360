'use client';

import React, { useState, useEffect, useCallback, Suspense, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { addMonths, addDays, inquiryToQuotation } from '@/lib/autoFill';
import { getModelsForMakeAndVehicleType, getAllMakes } from '@/lib/vehicleMaster';
import { useSearchParams } from 'next/navigation';
import { Plus, Eye, Check, Send, FileText, X, ArrowRight, Mail, CalendarDays, Search, RefreshCw, Users, ListFilter } from 'lucide-react';
import { getQuotationAction, getQuotationStatusStyles } from '@/services/leasingWorkflow';
import DataTableToolbar from '@/components/ui/DataTableToolbar';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';
import ActionDialog from '@/components/ui/ActionDialog';
import { useDataTableColumns, type DataTableColumn } from '@/hooks/useDataTableColumns';
import { downloadXLSX } from '@/lib/exportUtils';
import { downloadTablePdf } from '@/lib/exportTablePdf';

interface Vehicle {
  vehicleType: string;
  make: string;
  model: string;
  year: number;
  quantity: number;
  monthlyRate: number;
  // Per-vehicle bundled services
  insuranceIncluded?: boolean;
  insuranceCostPerUnit?: number;
  maintenanceIncluded?: boolean;
  maintenanceCostPerUnit?: number;
  driverIncluded?: boolean;
  driverCostPerUnit?: number;
}

type QuotationLineItemType = 'ACCESSORY' | 'SERVICE' | 'OTHER';

interface QuotationLineItem {
  itemType: QuotationLineItemType;
  description: string;
  quantity: number;
  unitRate: number;
  notes?: string;
}

interface QuotationCatalogItem {
  id: string;
  code: string;
  itemType: QuotationLineItemType;
  name: string;
  description?: string | null;
  unitRate: number;
  currency?: string | null;
}

const createQuotationLineItem = (itemType: QuotationLineItemType = 'ACCESSORY'): QuotationLineItem => ({
  itemType,
  description: '',
  quantity: 1,
  unitRate: 0,
  notes: '',
});

interface LeaseQuotation {
  id: string;
  quotationNumber: string;
  lesseeId: string;
  lesseeName: string;
  leaseType: 'LONG_TERM' | 'SHORT_TERM' | 'DAILY' | 'MONTHLY';
  duration?: number;
  durationMonths?: number;
  startDate: string;
  endDate: string;
  currency: 'AED' | 'USD' | 'EUR' | 'SAR';
  status:
    | 'NEW'
    | 'PENDING_APPROVAL'
    | 'DRAFT_APPROVED'
    | 'SENT_TO_CUSTOMER'
    | 'CUSTOMER_APPROVED'
    | 'PENDING_CREDIT_APPROVAL'
    | 'CREDIT_APPROVED'
    | 'PO_PREPARATION'
    | 'PO_PREPARED'
    | 'DELIVERY_IN_PROGRESS'
    | 'DELIVERED'
    | 'REJECTED'
    | 'CANCELLED';
  validUntil: string;
  vehicles: Vehicle[];
  lessee?: { name: string };
  totalMonthlyRate?: number;
  totalValue?: number;
  totalContractValue?: number;
  vehicleType?: string;
  vehicleCount?: number;
  inquiryId?: string;
  notes: string;
  createdAt: string;
  securityDeposit?: number;
  mileageCap?: number;
  insuranceIncluded?: boolean;
  maintenanceIncluded?: boolean;
  driverIncluded?: boolean;
  lineItems?: Array<{
    itemType?: string | null;
    description?: string | null;
    quantity?: number | null;
    unitRate?: number | null;
    monthlyAmount?: number | null;
    totalAmount?: number | null;
    currency?: string | null;
    notes?: string | null;
  }>;
}

type SessionIdentity = {
  role?: string;
  isSuperAdmin?: boolean;
};

type ApprovalStepSummary = {
  entityId?: string;
  status?: string;
  approverRole?: string | null;
  stepOrder?: number;
};

type CachedInquiryPayload = {
  id?: string;
  inquiryNumber?: string;
  customerName?: string;
  companyName?: string;
  customerEmail?: string;
  customerPhone?: string;
  vehicleType?: string;
  vehicleCount?: number;
  leaseType?: string;
  durationMonths?: number;
  startDate?: string;
  requiresDriver?: boolean;
  requiresInsurance?: boolean;
  requiresMaintenance?: boolean;
  notes?: string;
};

type LesseeOption = {
  id: string;
  name: string;
  deletedAt?: string | null;
};

type LeaseType = LeaseQuotation['leaseType'];

const normalizeLeaseType = (value: unknown): LeaseType =>
  value === 'SHORT_TERM' || value === 'DAILY' || value === 'MONTHLY' ? value : 'LONG_TERM';

function readCachedInquiryPayload(inquiryId: string): CachedInquiryPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('xl_convert_inquiry_payload');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedInquiryPayload;
    if (!parsed || parsed.id !== inquiryId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearCachedInquiryPayload() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem('xl_convert_inquiry_payload');
  } catch {}
}

type QuotationColumnKey =
  | 'quotationNumber'
  | 'lesseeName'
  | 'leaseType'
  | 'duration'
  | 'vehicleCount'
  | 'totalMonthly'
  | 'totalValue'
  | 'status'
  | 'validUntil';

const DEFAULT_QUOTATION_COLUMNS: DataTableColumn<QuotationColumnKey>[] = [
  { key: 'quotationNumber', label: 'Quotation #', visible: true },
  { key: 'lesseeName', label: 'Lessee / Customer', visible: true },
  { key: 'leaseType', label: 'Lease Type', visible: true },
  { key: 'duration', label: 'Duration', visible: true },
  { key: 'vehicleCount', label: 'Vehicle Count', visible: true },
  { key: 'totalMonthly', label: 'Total Monthly', visible: true },
  { key: 'totalValue', label: 'Total Value', visible: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'validUntil', label: 'Valid Until', visible: true },
];

const STATUS_PIPELINE = [
  'NEW',
  'PENDING_APPROVAL',
  'DRAFT_APPROVED',
  'SENT_TO_CUSTOMER',
  'CUSTOMER_APPROVED',
  'PENDING_CREDIT_APPROVAL',
  'CREDIT_APPROVED',
  'PO_PREPARATION',
  'PO_PREPARED',
  'DELIVERY_IN_PROGRESS',
  'DELIVERED',
] as const;

// SearchParamsReader lives inside <Suspense> so it can safely call useSearchParams()
function SearchParamsReader({
  onFromInquiry,
}: {
  onFromInquiry: (id: string) => void;
}) {
  const searchParams = useSearchParams();
  const processed = typeof window !== 'undefined'
    ? window.sessionStorage.getItem('xl_last_inquiry_id')
    : null;

  useEffect(() => {
    const fromInquiry = searchParams.get('fromInquiry');
    if (fromInquiry && fromInquiry !== processed) {
      window.sessionStorage.setItem('xl_last_inquiry_id', fromInquiry);
      window.history.replaceState(null, '', '/leasing/quotations');
      onFromInquiry(fromInquiry);
    }
  }, [searchParams, onFromInquiry, processed]);
  return null;
}

export default function LeaseQuotationsPage() {
  const router       = useRouter();
  const [quotations, setQuotations] = useState<LeaseQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [sortKey, setSortKey] = useState<QuotationColumnKey>('quotationNumber');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [lesseeFilter, setLesseeFilter] = useState('ALL');
  const [quotationYearFilter, setQuotationYearFilter] = useState(String(new Date().getFullYear()));
  const [quotationSequenceFilter, setQuotationSequenceFilter] = useState('');
  const fromDateInputRef = useRef<HTMLInputElement | null>(null);
  const toDateInputRef = useRef<HTMLInputElement | null>(null);
  const [prefilling, setPrefilling]     = useState(false);
  const [viewQuotation, setViewQuotation] = useState<LeaseQuotation | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [submitMode, setSubmitMode]     = useState<'draft'|'submit'>('draft');
  const [submitResult, setSubmitResult] = useState<{success:boolean;message:string}|null>(null);
  const [wfToast, setWfToast] = useState<{type:'success'|'warn'|'error'; msg:string}|null>(null);
  const [conversionCandidate, setConversionCandidate] = useState<LeaseQuotation | null>(null);
  const [conversionNotice, setConversionNotice] = useState<{
    tone: 'success' | 'warn' | 'error';
    title: string;
    message: string;
    meta?: string;
  } | null>(null);
  const [lessees, setLessees]           = useState<any[]>([]);
  const [sessionIdentity, setSessionIdentity] = useState<SessionIdentity | null>(null);
  const [pendingCreditApproverRoles, setPendingCreditApproverRoles] = useState<Record<string, string | null>>({});
  const [serviceCatalog, setServiceCatalog] = useState<QuotationCatalogItem[]>([]);
  const [serviceCatalogLoading, setServiceCatalogLoading] = useState(false);
  const vehicleMakesList                = getAllMakes();
  const {
    columns: quotationColumns,
    visibleColumns: visibleQuotationColumns,
    toggleColumn: toggleQuotationColumn,
    moveColumn: moveQuotationColumn,
    resizeColumn: resizeQuotationColumn,
  } = useDataTableColumns<QuotationColumnKey>('leasing-quotations-columns', DEFAULT_QUOTATION_COLUMNS);

  const getQuotationColumnStyle = useCallback(
    (key: QuotationColumnKey) => {
      const column = visibleQuotationColumns.find((item) => item.key === key);
      return column?.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : undefined;
    },
    [visibleQuotationColumns],
  );

  const [formData, setFormData] = useState({
    lesseeId: '',
    lesseeName: '',
    leaseType: 'LONG_TERM' as LeaseType,
    duration: 24,
    startDate: '',
    currency: 'AED' as const,
    endDate: '',
    validUntil: '',
    vehicles: [
      {
        vehicleType: 'SEDAN',
        make: '',
        model: '',
        year: new Date().getFullYear(),
        quantity: 1,
        monthlyRate: 0,
        insuranceIncluded: false,
        insuranceCostPerUnit: 0,
        maintenanceIncluded: false,
        maintenanceCostPerUnit: 0,
        driverIncluded: false,
        driverCostPerUnit: 0,
      },
    ],
    baseMonthlyRate: 0,
    interestRate: 0,
    markupRate: 0,
    lineItems: [] as QuotationLineItem[],
    accessoriesCost: 0,
    servicesCost: 0,
    insuranceCost: 0,
    maintenanceCost: 0,
    driverCost: 0,
    mileageCap: 0,
    securityDeposit: 0,
    insuranceIncluded: false,
    maintenanceIncluded: false,
    driverIncluded: false,
    notes: '',
    inquiryId: '',
  });

  // Mock data
  const mockQuotations: LeaseQuotation[] = [
    {
      id: '1',
      quotationNumber: 'QT-001',
      lesseeId: 'LESS-001',
      lesseeName: 'Al Mansouri Trading',
      leaseType: 'LONG_TERM',
      duration: 36,
      startDate: '2024-05-01',
      endDate: '2027-05-01',
      currency: 'AED',
      status: 'NEW',
      validUntil: '2024-05-15',
      vehicles: [
        {
          vehicleType: 'SUV',
          make: 'Toyota',
          model: 'Land Cruiser',
          year: 2024,
          quantity: 5,
          monthlyRate: 4500,
        },
      ],
      totalMonthlyRate: 22500,
      totalValue: 810000,
      notes: 'VIP client',
      createdAt: '2024-04-12',
    },
    {
      id: '2',
      quotationNumber: 'QT-002',
      lesseeId: 'LESS-002',
      lesseeName: 'Tech Solutions LLC',
      leaseType: 'LONG_TERM',
      duration: 24,
      startDate: '2024-05-15',
      endDate: '2026-05-15',
      currency: 'AED',
      status: 'PENDING_APPROVAL',
      validUntil: '2024-05-25',
      vehicles: [
        {
          vehicleType: 'SEDAN',
          make: 'BMW',
          model: '3 Series',
          year: 2024,
          quantity: 10,
          monthlyRate: 2800,
        },
      ],
      totalMonthlyRate: 28000,
      totalValue: 672000,
      notes: 'Corporate fleet',
      createdAt: '2024-04-10',
    },
    {
      id: '3',
      quotationNumber: 'QT-003',
      lesseeId: 'LESS-003',
      lesseeName: 'Construction Co',
      leaseType: 'SHORT_TERM',
      duration: 6,
      startDate: '2024-05-20',
      endDate: '2024-11-20',
      currency: 'AED',
      status: 'SENT_TO_CUSTOMER',
      validUntil: '2024-05-30',
      vehicles: [
        {
          vehicleType: 'TRUCK',
          make: 'Volvo',
          model: 'FM',
          year: 2024,
          quantity: 3,
          monthlyRate: 6500,
        },
      ],
      totalMonthlyRate: 19500,
      totalValue: 117000,
      notes: 'Project lease',
      createdAt: '2024-04-08',
    },
    {
      id: '4',
      quotationNumber: 'QT-004',
      lesseeId: 'LESS-004',
      lesseeName: 'Hospitality Group',
      leaseType: 'LONG_TERM',
      duration: 48,
      startDate: '2024-04-01',
      endDate: '2028-04-01',
      currency: 'AED',
      status: 'CUSTOMER_APPROVED',
      validUntil: '2024-04-20',
      vehicles: [
        {
          vehicleType: 'SEDAN',
          make: 'Mercedes-Benz',
          model: 'E-Class',
          year: 2024,
          quantity: 15,
          monthlyRate: 3500,
        },
      ],
      totalMonthlyRate: 52500,
      totalValue: 2520000,
      notes: 'Corporate accounts',
      createdAt: '2024-03-20',
    },
  ];

  // Auto-open modal and pre-fill from inquiry when ?fromInquiry= param is set
  const prefillFromInquiry = useCallback(async (inquiryId: string) => {
    setPrefilling(true);
    try {
      const cachedInquiry = readCachedInquiryPayload(inquiryId);
      let inq = cachedInquiry;
      if (!inq) {
        const res = await fetch(`/api/leasing/inquiries/${inquiryId}`);
        if (!res.ok) { console.error('Inquiry not found:', inquiryId); return; }
        inq = await res.json();
      }
      if (!inq) { console.error('Inquiry not found:', inquiryId); return; }
      const filled = inquiryToQuotation(inq);
      const filledVehicles = (filled.vehicles ?? []).map((vehicle) => ({
        ...vehicle,
        insuranceIncluded: inq.requiresInsurance ?? false,
        insuranceCostPerUnit: 0,
        maintenanceIncluded: inq.requiresMaintenance ?? false,
        maintenanceCostPerUnit: 0,
        driverIncluded: inq.requiresDriver ?? false,
        driverCostPerUnit: 0,
      }));
      const searchName = (inq.companyName ?? inq.customerName ?? '').toLowerCase().trim();

      let matchedLesseeId = '';
      let matchedLesseeName = filled.lesseeName;
      if (lessees.length > 0) {
        const match = (lessees as LesseeOption[]).find((l) =>
          l.name.toLowerCase().includes(searchName) ||
          searchName.includes(l.name.toLowerCase())
        );
        if (match) {
          matchedLesseeId = match.id;
          matchedLesseeName = match.name;
        }
      }

      setFormData(prev => ({
        ...prev,
        ...filled,
        leaseType: normalizeLeaseType(filled.leaseType),
        vehicles: filledVehicles,
        inquiryId, // Link to the inquiry
        lesseeId:            matchedLesseeId,
        lesseeName:          matchedLesseeName,
      }));

      setShowNewModal(true);
      setActiveStep(1);
      clearCachedInquiryPayload();
      setPrefilling(false);

      if (lessees.length === 0) {
        fetch('/api/leasing/lessees')
          .then(r => r.ok ? r.json() : [])
          .then((lData: LesseeOption[]) => {
            if (!Array.isArray(lData)) return;
            setLessees(lData);
            const match = lData.find((l) =>
              l.name.toLowerCase().includes(searchName) ||
              searchName.includes(l.name.toLowerCase())
            );
            if (match) {
              setFormData(prev => ({
                ...prev,
                lesseeId: match.id,
                lesseeName: match.name,
              }));
            }
          })
          .catch(() => {});
      }

    } catch (e) {
      console.error('Failed to load inquiry:', e);
      alert('Failed to load inquiry data. Please try again.');
    } finally {
      setPrefilling(false);
    }
  }, [lessees]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((me: SessionIdentity) => {
        setSessionIdentity(me);
      })
      .catch(() => setSessionIdentity(null));

    fetch('/api/leasing/lessees')
      .then(r => r.ok ? r.json() : [])
      .then((lesseesData: LesseeOption[]) => {
        setLessees(Array.isArray(lesseesData) ? lesseesData.filter((l) => !l.deletedAt) : []);
      })
      .catch(() => {});

    fetch('/api/leasing/quotations')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((quotationsData) => {
        setQuotations(quotationsData);
      })
      .catch(() => setQuotations(mockQuotations))
      .finally(() => setLoading(false));

    fetch('/api/leasing/approval-steps?entityType=QUOTATION')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((steps: ApprovalStepSummary[]) => {
        const next: Record<string, string | null> = {};
        for (const step of Array.isArray(steps) ? steps : []) {
          if (step?.status !== 'PENDING' || !step?.entityId) continue;
          if (!(step.entityId in next)) next[step.entityId] = step.approverRole ?? null;
        }
        setPendingCreditApproverRoles(next);
      })
      .catch(() => setPendingCreditApproverRoles({}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setServiceCatalogLoading(true);
    fetch('/api/data-masters/leasing-service-catalog?serviceTypeKey=LEASING_QUOTATIONS&activeOnly=true', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { items?: QuotationCatalogItem[] }) => {
        if (!cancelled) setServiceCatalog(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setServiceCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setServiceCatalogLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const availableYears = Array.from(
    new Set(
      quotations
        .map((quotation) => {
          const createdYear = quotation.createdAt ? new Date(quotation.createdAt).getFullYear() : null;
          return createdYear ? String(createdYear) : null;
        })
        .filter(Boolean) as string[],
    ),
  ).sort((a, b) => Number(b) - Number(a));

  const filteredQuotations = quotations.filter((quotation) => {
    if (statusFilter !== 'ALL' && quotation.status !== statusFilter) return false;

    const lesseeName = quotation.lessee?.name || quotation.lesseeName || '';
    if (lesseeFilter !== 'ALL' && quotation.lesseeId !== lesseeFilter) return false;

    const createdAt = quotation.createdAt ? new Date(quotation.createdAt) : null;
    if (fromDateFilter && createdAt) {
      const fromDate = new Date(fromDateFilter);
      fromDate.setHours(0, 0, 0, 0);
      if (createdAt < fromDate) return false;
    }
    if (toDateFilter && createdAt) {
      const toDate = new Date(toDateFilter);
      toDate.setHours(23, 59, 59, 999);
      if (createdAt > toDate) return false;
    }

    const yearCode = quotationYearFilter.slice(-2);
    if (quotationYearFilter && !quotation.quotationNumber?.includes(`-${yearCode}`) && !(createdAt && String(createdAt.getFullYear()) === quotationYearFilter)) {
      return false;
    }

    if (quotationSequenceFilter) {
      const normalizedSeq = quotationSequenceFilter.replace(/\D/g, '');
      if (normalizedSeq && !quotation.quotationNumber?.endsWith(normalizedSeq.padStart(4, '0')) && !quotation.quotationNumber?.includes(normalizedSeq)) {
        return false;
      }
    }

    if (searchQuery.trim()) {
      const needle = searchQuery.toLowerCase().trim();
      const haystack = [
        quotation.quotationNumber,
        lesseeName,
        quotation.leaseType,
        quotation.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });

  const sortedQuotations = useMemo(() => {
    const next = [...filteredQuotations];
    next.sort((left, right) => {
      const leftVehicleCount = (left.vehicles ?? []).reduce((sum, vehicle) => sum + (vehicle.quantity || 0), 0) || left.vehicleCount || 0;
      const rightVehicleCount = (right.vehicles ?? []).reduce((sum, vehicle) => sum + (vehicle.quantity || 0), 0) || right.vehicleCount || 0;
      const leftValue: Record<QuotationColumnKey, string | number> = {
        quotationNumber: left.quotationNumber,
        lesseeName: left.lessee?.name || left.lesseeName || '',
        leaseType: left.leaseType,
        duration: left.durationMonths ?? left.duration ?? 0,
        vehicleCount: leftVehicleCount,
        totalMonthly: left.totalMonthlyRate ?? 0,
        totalValue: left.totalValue ?? left.totalContractValue ?? 0,
        status: left.status,
        validUntil: left.validUntil ?? '',
      };
      const rightValue: Record<QuotationColumnKey, string | number> = {
        quotationNumber: right.quotationNumber,
        lesseeName: right.lessee?.name || right.lesseeName || '',
        leaseType: right.leaseType,
        duration: right.durationMonths ?? right.duration ?? 0,
        vehicleCount: rightVehicleCount,
        totalMonthly: right.totalMonthlyRate ?? 0,
        totalValue: right.totalValue ?? right.totalContractValue ?? 0,
        status: right.status,
        validUntil: right.validUntil ?? '',
      };
      const a = leftValue[sortKey];
      const b = rightValue[sortKey];
      const comparison =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return next;
  }, [filteredQuotations, sortDirection, sortKey]);

  const toggleSort = (key: QuotationColumnKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const getStatusCounts = () => {
    const counts: Record<string, number> = {};
    STATUS_PIPELINE.forEach((status) => {
      counts[status] = quotations.filter((q) => q.status === status).length;
    });
    return counts;
  };

  const statusCounts = getStatusCounts();

  const getQuotationColumnValue = (quotation: LeaseQuotation, key: QuotationColumnKey) => {
    const veh = quotation.vehicles ?? [];
    const totalVehicleCount = veh.reduce((sum, v) => sum + (v.quantity || 0), 0);
    const lesseeName = quotation.lessee?.name || quotation.lesseeName || '-';

    switch (key) {
      case 'quotationNumber':
        return quotation.quotationNumber;
      case 'lesseeName':
        return lesseeName;
      case 'leaseType':
        return quotation.leaseType.replace(/_/g, ' ');
      case 'duration':
        return `${quotation.durationMonths ?? quotation.duration ?? 0} months`;
      case 'vehicleCount':
        return `${totalVehicleCount || quotation.vehicleCount || 0} units`;
      case 'totalMonthly':
        return `${Number(quotation.totalMonthlyRate ?? 0).toLocaleString('en-AE')} ${quotation.currency}`;
      case 'totalValue':
        return `${Number(quotation.totalValue ?? quotation.totalContractValue ?? 0).toLocaleString('en-AE')} ${quotation.currency}`;
      case 'status':
        return quotation.status.replace(/_/g, ' ');
      case 'validUntil':
        return quotation.validUntil;
      default:
        return '';
    }
  };

  const quotationExportColumns = visibleQuotationColumns.map((column) => column.label);
  const quotationExportRows = filteredQuotations.map((quotation) =>
    visibleQuotationColumns.reduce<Record<string, string | number>>((row, column) => {
      row[column.label] = getQuotationColumnValue(quotation, column.key);
      return row;
    }, {}),
  );

  const resetFilters = () => {
    setSearchQuery('');
    setFromDateFilter('');
    setToDateFilter('');
    setLesseeFilter('ALL');
    setStatusFilter('ALL');
    setQuotationYearFilter(String(new Date().getFullYear()));
    setQuotationSequenceFilter('');
  };

  const renderQuotationCell = (quotation: LeaseQuotation, key: QuotationColumnKey) => {
    const veh = quotation.vehicles ?? [];
    const totalVehicleCount = veh.reduce((sum, v) => sum + (v.quantity || 0), 0);
    const lesseeName = quotation.lessee?.name || quotation.lesseeName || '-';
    const valueCellClass = 'smart-data-grid-cell px-3 py-3 align-top';
    const style = getQuotationColumnStyle(key);

    switch (key) {
      case 'quotationNumber':
        return <td className={valueCellClass} style={style}>{quotation.quotationNumber}</td>;
      case 'lesseeName':
        return <td className={valueCellClass} style={style}>{lesseeName}</td>;
      case 'leaseType':
        return <td className={valueCellClass} style={style}>{quotation.leaseType.replace(/_/g, ' ')}</td>;
      case 'duration':
        return <td className={valueCellClass} style={style}>{quotation.durationMonths ?? quotation.duration} months</td>;
      case 'vehicleCount':
        return <td className={valueCellClass} style={style}>{totalVehicleCount || quotation.vehicleCount || '0'} units</td>;
      case 'totalMonthly':
        return (
          <td className={valueCellClass} style={style}>
            {Number(quotation.totalMonthlyRate ?? 0).toLocaleString('en-AE')} {quotation.currency}
          </td>
        );
      case 'totalValue':
        return (
          <td className={valueCellClass} style={style}>
            {Number(quotation.totalValue ?? quotation.totalContractValue ?? 0).toLocaleString('en-AE')} {quotation.currency}
          </td>
        );
      case 'status':
        return (
          <td className="smart-data-grid-cell px-3 py-3 whitespace-nowrap" style={style}>
            <select
              value={quotation.status}
              onChange={async (e) => {
                const newStatus = e.target.value;
                try {
                  const res = await fetch(`/api/leasing/quotations/${quotation.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus }),
                  });
                  if (res.ok) {
                    const updated = await res.json();
                    setQuotations(prev => prev.map(q => q.id === quotation.id ? { ...q, ...updated } : q));
                    if (viewQuotation?.id === quotation.id) {
                      setViewQuotation((prev) => (prev?.id === quotation.id ? { ...prev, ...updated } : prev));
                    }
                    await triggerWorkflowIfNeeded(quotation.id, newStatus, quotation.quotationNumber ?? quotation.id);
                  }
                } catch {}
              }}
              onClick={(e) => e.stopPropagation()}
              className={`text-xs px-2 py-1.5 rounded-lg border font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 ${getStatusColor(quotation.status)} bg-slate-800`}
            >
              {STATUS_PIPELINE.map(s => (
                <option key={s} value={s} className="bg-slate-800 text-white">{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </td>
        );
      case 'validUntil':
        return <td className={valueCellClass} style={style}>{quotation.validUntil}</td>;
      default:
        return null;
    }
  };

  const openDatePicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    input.focus();
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
    input.click();
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      NEW: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      INTERNAL_APPROVAL: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
      SENT_TO_CUSTOMER: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      CUSTOMER_APPROVED: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      CREDIT_APPROVAL: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      PO_PREPARED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      DELIVERY_IN_PROGRESS: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      DELIVERED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
      CANCELLED: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };
    return colors[status] || colors.NEW;
  };

  const addVehicleRow = () => {
    setFormData({
      ...formData,
      vehicles: [
        ...formData.vehicles,
        {
          vehicleType: 'SEDAN',
          make: '',
          model: '',
          year: new Date().getFullYear(),
          quantity: 1,
          monthlyRate: 0,
          insuranceIncluded: false,
          insuranceCostPerUnit: 0,
          maintenanceIncluded: false,
          maintenanceCostPerUnit: 0,
          driverIncluded: false,
          driverCostPerUnit: 0,
        },
      ],
    });
  };

  const removeVehicleRow = (index: number) => {
    setFormData({
      ...formData,
      vehicles: (formData.vehicles ?? []).filter((_, i) => i !== index),
    });
  };

  const addCatalogLineItem = (itemType: QuotationLineItemType = 'ACCESSORY', preset?: QuotationLineItem) => {
    setFormData(prev => ({
      ...prev,
      lineItems: [
        ...(prev.lineItems ?? []),
        preset ? { ...preset } : createQuotationLineItem(itemType),
      ],
    }));
  };

  const addServiceCatalogPreset = (preset: QuotationCatalogItem) => {
    addCatalogLineItem(preset.itemType, {
      itemType: preset.itemType,
      description: preset.name,
      quantity: 1,
      unitRate: Number(preset.unitRate) || 0,
      notes: preset.description ?? '',
    });
  };

  const updateCatalogLineItem = (index: number, patch: Partial<QuotationLineItem>) => {
    setFormData(prev => ({
      ...prev,
      lineItems: (prev.lineItems ?? []).map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    }));
  };

  const removeCatalogLineItem = (index: number) => {
    setFormData(prev => ({
      ...prev,
      lineItems: (prev.lineItems ?? []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const calculateTotals = () => {
    const vehicles = Array.isArray(formData.vehicles) ? formData.vehicles : [];

    // Per-vehicle line calculations
    const vehicleLines = vehicles.map(v => {
      const qty          = Number(v.quantity) || 1;
      const unitBase     = Number(v.monthlyRate) || 0;
      const unitIns      = v.insuranceIncluded    ? (Number(v.insuranceCostPerUnit)    || 0) : 0;
      const unitMaint    = v.maintenanceIncluded   ? (Number(v.maintenanceCostPerUnit)  || 0) : 0;
      const unitDriver   = v.driverIncluded        ? (Number(v.driverCostPerUnit)       || 0) : 0;
      const unitTotal    = unitBase + unitIns + unitMaint + unitDriver;
      return {
        vehicleType:    v.vehicleType,
        make:           v.make,
        model:          v.model,
        quantity:       qty,
        unitBase,
        unitIns,
        unitMaint,
        unitDriver,
        unitTotal,
        lineBase:       unitBase   * qty,
        lineIns:        unitIns    * qty,
        lineMaint:      unitMaint  * qty,
        lineDriver:     unitDriver * qty,
        lineTotal:      unitTotal  * qty,
      };
    });

    const baseMonthly       = vehicleLines.reduce((s, l) => s + l.lineBase, 0);
    const totalInsurance    = vehicleLines.reduce((s, l) => s + l.lineIns, 0);
    const totalMaintenance  = vehicleLines.reduce((s, l) => s + l.lineMaint, 0);
    const totalDriver       = vehicleLines.reduce((s, l) => s + l.lineDriver, 0);
    const vehicleServicesTotal = totalInsurance + totalMaintenance + totalDriver;

    const durationMonths = Number(formData.duration) || 0;
    const lineItems = (formData.lineItems ?? [])
      .map(item => {
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const unitRate = Math.max(0, Number(item.unitRate) || 0);
        const monthlyAmount = Number((quantity * unitRate).toFixed(2));
        const totalAmount = Number((monthlyAmount * durationMonths).toFixed(2));
        return {
          itemType: item.itemType || 'OTHER',
          description: String(item.description || '').trim(),
          quantity,
          unitRate,
          monthlyAmount,
          totalAmount,
          notes: item.notes || '',
        };
      })
      .filter(item => item.description || item.monthlyAmount > 0);

    const accessoriesCost = lineItems
      .filter(item => item.itemType === 'ACCESSORY')
      .reduce((sum, item) => sum + item.monthlyAmount, 0);
    const servicesCost = lineItems
      .filter(item => item.itemType === 'SERVICE')
      .reduce((sum, item) => sum + item.monthlyAmount, 0);
    const otherLineCost = lineItems
      .filter(item => item.itemType === 'OTHER')
      .reduce((sum, item) => sum + item.monthlyAmount, 0);

    const interestAmount = (baseMonthly * (Number(formData.interestRate) || 0)) / 100;
    const markupAmount   = (baseMonthly * (Number(formData.markupRate)   || 0)) / 100;
    const extraCosts     = accessoriesCost + servicesCost + otherLineCost;

    const totalMonthly = baseMonthly + vehicleServicesTotal + interestAmount + markupAmount + extraCosts;

    return {
      vehicleLines,
      baseMonthly:        Number(baseMonthly.toFixed(2)),
      totalInsurance:     Number(totalInsurance.toFixed(2)),
      totalMaintenance:   Number(totalMaintenance.toFixed(2)),
      totalDriver:        Number(totalDriver.toFixed(2)),
      vehicleServicesTotal: Number(vehicleServicesTotal.toFixed(2)),
      interestAmount:     Number(interestAmount.toFixed(2)),
      markupAmount:       Number(markupAmount.toFixed(2)),
      accessoriesCost:     Number(accessoriesCost.toFixed(2)),
      servicesCost:        Number(servicesCost.toFixed(2)),
      otherLineCost:       Number(otherLineCost.toFixed(2)),
      lineItems,
      extraCosts:         Number(extraCosts.toFixed(2)),
      totalMonthly:       Number(totalMonthly.toFixed(2)),
      totalValue:         Number((totalMonthly * durationMonths).toFixed(2)),
    };
  };

  const totals = calculateTotals();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSubmitResult(null);
    try {
      const vehicles = (formData.vehicles ?? []).map(v => ({
        vehicleType: v.vehicleType,
        make:        v.make        || null,
        model:       v.model       || null,
        year:        v.year,
        quantity:    v.quantity,
        monthlyRate: v.monthlyRate,
        insuranceIncluded:    v.insuranceIncluded    ?? false,
        insuranceCostPerUnit: v.insuranceCostPerUnit ?? 0,
        maintenanceIncluded:    v.maintenanceIncluded    ?? false,
        maintenanceCostPerUnit: v.maintenanceCostPerUnit ?? 0,
        driverIncluded:    v.driverIncluded    ?? false,
        driverCostPerUnit: v.driverCostPerUnit ?? 0,
      }));
      const lineItems = totals.lineItems.map(item => ({
        itemType: item.itemType,
        description: item.description || `${item.itemType} line item`,
        quantity: item.quantity,
        unitRate: item.unitRate,
        monthlyAmount: item.monthlyAmount,
        totalAmount: item.totalAmount,
        currency: formData.currency,
        notes: item.notes || null,
      }));

      const payload = {
        lesseeId:            formData.lesseeId        || null,
        leaseType:           formData.leaseType,
        durationMonths:      formData.duration,
        startDate:           formData.startDate ? new Date(formData.startDate).toISOString() : null,
        endDate:             formData.endDate   ? new Date(formData.endDate).toISOString()   : null,
        currency:            formData.currency,
        validUntil:          formData.validUntil ? new Date(formData.validUntil).toISOString() : null,
        vehicleType:         vehicles[0]?.vehicleType ?? null,
        vehicleCount:        vehicles.reduce((s, v) => s + (v.quantity||0), 0),
        baseMonthlyRate:     totals.baseMonthly      || null,
        interestRate:        formData.interestRate    || null,
        markupPct:           formData.markupRate      || null,
        accessoriesCost:     totals.accessoriesCost   || null,
        servicesCost:        (totals.servicesCost + totals.otherLineCost) || null,
        insuranceCost:       totals.totalInsurance    || null,
        maintenanceCost:     totals.totalMaintenance  || null,
        driverCost:          totals.totalDriver       || null,
        totalMonthlyRate:    totals.totalMonthly,
        totalContractValue:  totals.totalValue,
        securityDeposit:     formData.securityDeposit || null,
        insuranceIncluded:   totals.totalInsurance    > 0,
        maintenanceIncluded: totals.totalMaintenance  > 0,
        driverIncluded:      totals.totalDriver       > 0,
        notes:               formData.notes || null,
        status:              'NEW',
        inquiryId:           (formData as any).inquiryId || null,
        vehicles,
        lineItems,
      };

      // Step A: Create quotation
      const res = await fetch('/api/leasing/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to save quotation');
      }
      const saved = await res.json();
      setQuotations(prev => [{ ...saved, vehicles: saved.vehicles ?? [] }, ...prev]);

      // Step B: If Submit mode, trigger email
      if (submitMode === 'submit') {
        const submitRes = await fetch(`/api/leasing/quotations/${saved.id}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientEmail: recipientEmail || null }),
        });
        const submitData = await submitRes.json().catch(() => ({}));
        setSubmitResult({
          success: submitData.email?.sent ?? false,
          message: submitData.email?.message ?? (submitRes.ok ? 'Quotation submitted.' : 'Submit failed.'),
        });
        // Update the quotation in local state to SENT_TO_CUSTOMER
        if (submitRes.ok) {
          setQuotations(prev => prev.map(q => q.id === saved.id ? { ...q, status: 'SENT_TO_CUSTOMER' } : q));
        }
      }

      setShowNewModal(false);
      setActiveStep(1);
      setSubmitResult(null);
    } catch (err: any) {
      console.error('Failed to save quotation:', err);
      setSubmitResult({ success: false, message: err.message ?? 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleApproveAction = async (quotationId: string, action: 'APPROVE' | 'REJECT' = 'APPROVE') => {
    try {
      const res = await fetch(`/api/leasing/quotations/${quotationId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          approverName: 'System Admin', 
          comments: `Quotation ${action.toLowerCase()}d via dashboard`
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setQuotations(prev => prev.map(q => q.id === quotationId ? updated : q));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to update status');
      }
    } catch (e) {
      console.error(e);
      alert('Network error while updating status');
    }
  };

  const handleApproveInternally = (quotationId: string) => handleApproveAction(quotationId, 'APPROVE');
  const handleSendToCustomer    = (quotationId: string) => handleApproveAction(quotationId, 'APPROVE');
  const handleGenericApprove    = (quotationId: string) => handleApproveAction(quotationId, 'APPROVE');

  const openConvertToContractDialog = (quotation: LeaseQuotation) => {
    setConversionNotice(null);
    setConversionCandidate(quotation);
  };

  const handleConvertToContract = async () => {
    const quotation = conversionCandidate;
    if (!quotation) return;

    const quotationId = quotation.id;
    setProcessingActionId(quotationId);
    try {
      const res = await fetch(`/api/leasing/quotations/${quotationId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreementType: 'INDIVIDUAL', // Default
          startDate: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Update local status so UI reflects 'DELIVERED' or 'CONVERTED'
        setQuotations(prev => prev.map(q => q.id === quotationId ? { ...q, status: 'DELIVERED' } : q));
        setConversionCandidate(null);
        setConversionNotice({
          tone: 'success',
          title: 'Contract created',
          message: `${quotation.quotationNumber ?? 'Quotation'} was converted into contract ${data.contract?.contractNumber ?? data.contract?.id ?? ''}.`,
        });
        // Redirect to the newly created contract
        router.push(`/leasing/contracts-v2?contractId=${data.contract.id}`);
      } else {
        const err = await res.json().catch(() => ({}));
        const runtimeAction = err?.runtimeAction;
        const firstPendingStep = runtimeAction?.pendingSteps?.[0];
        const assignedTo =
          firstPendingStep?.approverRole ??
          firstPendingStep?.assignedToEmail ??
          'the configured approver';
        const message =
          res.status === 428 || err?.code === 'LEASING_RUNTIME_APPROVAL_REQUIRED'
            ? `Approval is required before this Leasing action can execute. It is waiting for ${assignedTo}. Approve it in Leasing Workflow, then retry the Contract action.`
            : (err.error || 'Unknown error');
        setConversionCandidate(null);
        setConversionNotice({
          tone: res.status === 428 || err?.code === 'LEASING_RUNTIME_APPROVAL_REQUIRED' ? 'warn' : 'error',
          title: res.status === 428 || err?.code === 'LEASING_RUNTIME_APPROVAL_REQUIRED' ? 'Approval required' : 'Conversion failed',
          message,
          meta: runtimeAction?.id ? `Runtime action ${runtimeAction.id}` : undefined,
        });
        showWfToast(res.status === 428 || err?.code === 'LEASING_RUNTIME_APPROVAL_REQUIRED' ? 'warn' : 'error', message);
      }
    } catch (err) {
      console.error(err);
      setConversionNotice({
        tone: 'error',
        title: 'Network error',
        message: 'Could not complete contract conversion. Please retry after checking the connection.',
      });
      showWfToast('error', 'Network error during contract conversion.');
    } finally {
      setProcessingActionId(null);
    }
  };

  const [processingActionId, setProcessingActionId] = useState<string | null>(null);
  const [quotationHistory, setQuotationHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentAction, setCommentAction] = useState<{ id: string, label: string, targetStatus?: string } | null>(null);
  const [workflowComment, setWorkflowComment] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');

  // Fetch detailed history when viewing
  useEffect(() => {
    if (viewQuotation?.id) {
      const fetchHistory = async () => {
        setLoadingHistory(true);
        try {
          const res = await fetch(`/api/leasing/quotations/${viewQuotation.id}`);
          if (res.ok) {
            const data = await res.json();
            setQuotationHistory(data.history || []);
          }
        } catch (err) {
          console.error('Failed to fetch history:', err);
        } finally {
          setLoadingHistory(false);
        }
      };
      fetchHistory();
    } else {
      setQuotationHistory([]);
    }
  }, [viewQuotation?.id]);

  //  Workflow Engine Integration 
  // Maps status transitions to workflow procedures
  const WORKFLOW_TRIGGER_MAP: Record<string, { procedure: string; label: string }> = {
    PENDING_APPROVAL:        { procedure: 'QUOTATION_APPROVAL',  label: 'Internal Approval' },
    PENDING_CREDIT_APPROVAL: { procedure: 'CREDIT_APPROVAL',     label: 'Credit Approval' },
    PO_PREPARATION:          { procedure: 'PO_REQUEST',          label: 'PO Request' },
  };

  const showWfToast = (type: 'success'|'warn'|'error', msg: string) => {
    setWfToast({ type, msg });
    setTimeout(() => setWfToast(null), 5000);
  };

  const canApproveCreditForQuotation = useCallback((quotation: LeaseQuotation) => {
    if (quotation.status !== 'PENDING_CREDIT_APPROVAL') return true;
    if (sessionIdentity?.isSuperAdmin) return true;
    const requiredRole = pendingCreditApproverRoles[quotation.id];
    if (!requiredRole) return false;
    return sessionIdentity?.role === requiredRole;
  }, [pendingCreditApproverRoles, sessionIdentity]);

  const triggerWorkflowIfNeeded = async (quotationId: string, newStatus: string, quotationNumber: string) => {
    const trigger = WORKFLOW_TRIGGER_MAP[newStatus];
    if (!trigger) return;
    try {
      const res = await fetch('/api/workflow/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'LEASING',
          procedure: trigger.procedure,
          referenceType: 'LEASE_QUOTATION',
          referenceId: quotationId,
          referenceNumber: quotationNumber,
          initiatedByEmail: 'admin@xlai.com',
          initiatedByName: 'System User',
        }),
      });
      const wf = await res.json();
      if (res.ok) {
        if (wf.reused) {
          showWfToast('warn', `Workflow already in progress for ${quotationNumber}. Check Approvals Inbox.`);
        } else {
          showWfToast('success', `Workflow started: "${wf.workflowName}"  sent to Approvals Inbox.`);
        }
      } else {
        const errMsg = wf?.error ?? 'Workflow trigger failed';
        showWfToast('warn', errMsg);
        console.warn('[Workflow]', errMsg);
      }
    } catch (e) {
      showWfToast('error', 'Could not trigger workflow  check console for details.');
      console.warn('Workflow trigger failed:', e);
    }
  };

  const handleWorkflowAction = async (quotationId: string, actionLabel: string, targetStatus?: string, comment?: string, email?: string) => {
    const currentQuotation =
      quotations.find((quotation) => quotation.id === quotationId)
      ?? (viewQuotation?.id === quotationId ? viewQuotation : null);
    if (currentQuotation && !canApproveCreditForQuotation(currentQuotation)) {
      showWfToast('warn', `Credit approval is assigned to ${pendingCreditApproverRoles[quotationId] ?? 'another approver role'}.`);
      return;
    }
    setProcessingActionId(quotationId);
    try {
      const res = await fetch(`/api/leasing/quotations/${quotationId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE',
          approverName: 'System User',
          comments: comment || `Action: ${actionLabel}`,
          targetStatus: targetStatus,
          recipientEmail: email
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setQuotations(prev => prev.map(q => q.id === quotationId ? updated : q));
        setPendingCreditApproverRoles((prev) => {
          if (!(quotationId in prev)) return prev;
          const next = { ...prev };
          delete next[quotationId];
          return next;
        });
        if (viewQuotation?.id === quotationId) {
          setViewQuotation(updated);
          void (async () => {
            const hRes = await fetch(`/api/leasing/quotations/${quotationId}`);
            if (hRes.ok) {
              const hData = await hRes.json();
              setQuotationHistory(hData.history || []);
            }
          })();
        }
        setShowCommentModal(false);
        setWorkflowComment('');
        setRecipientEmail('');
        // Trigger workflow engine for approval-gated transitions in the background
        void triggerWorkflowIfNeeded(quotationId, updated.status, updated.quotationNumber ?? quotationId);
      } else {
        const errorBody = await res.json().catch(() => ({}));
        const errorCode = String(errorBody?.code ?? '');
        const errorMessage = String(errorBody?.error ?? 'Failed to process workflow action');
        if (res.status === 409 && errorCode.startsWith('CREDIT_')) {
          showWfToast('warn', `Credit approval blocked: ${errorMessage}`);
        } else {
          showWfToast('error', errorMessage);
        }
      }
    } catch (err) {
      console.error(err);
      showWfToast('error', 'Network error while processing workflow action.');
    } finally {
      setProcessingActionId(null);
    }
  };

  /**
   * Status Stepper Helper
   */
  const StatusStepper = ({ currentStatus }: { currentStatus: string }) => {
    const stages = [
      { key: 'NEW', label: 'Draft' },
      { key: 'PENDING_APPROVAL', label: 'Internal' },
      { key: 'DRAFT_APPROVED', label: 'Approved' },
      { key: 'SENT_TO_CUSTOMER', label: 'Customer' },
      { key: 'CUSTOMER_APPROVED', label: 'Accepted' },
      { key: 'CREDIT_APPROVED', label: 'Credit' },
      { key: 'PO_PREPARED', label: 'PO' },
      { key: 'DELIVERY_IN_PROGRESS', label: 'Delivery' },
      { key: 'DELIVERED', label: 'Done' }
    ];

    const currentIdx = stages.findIndex(s => s.key === currentStatus || (currentStatus === 'PENDING_CREDIT_APPROVAL' && s.key === 'CUSTOMER_APPROVED'));
    
    return (
      <div className="w-full py-4 overflow-x-auto no-scrollbar">
        <div className="flex items-center min-w-[600px] px-2">
          {stages.map((stage, idx) => {
            const isCompleted = idx < currentIdx;
            const isCurrent = idx === currentIdx;
            return (
              <React.Fragment key={stage.key}>
                <div className="flex flex-col items-center relative group min-w-[60px]">
                  <div 
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold z-10 transition-all
                      ${isCompleted ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 
                        isCurrent ? 'bg-blue-600 text-white ring-4 ring-blue-600/20' : 
                        'bg-slate-700 text-slate-500 border border-white/10'}`}
                  >
                    {isCompleted ? <Check className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span className={`text-[10px] mt-2 font-medium whitespace-nowrap ${isCurrent ? 'text-blue-400' : isCompleted ? 'text-emerald-500' : 'text-slate-500'}`}>
                    {stage.label}
                  </span>
                </div>
                {idx < stages.length - 1 && (
                  <div className={`flex-1 h-[2px] mx-1 mb-4 ${idx < currentIdx ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0c1a3e] p-8">
      <Suspense fallback={null}>
        <SearchParamsReader onFromInquiry={prefillFromInquiry} />
      </Suspense>

      {/* Workflow Toast Notification */}
      {wfToast && (
        <div className={`fixed bottom-6 right-6 z-[9999] flex items-start gap-3 px-5 py-4 rounded-2xl shadow-2xl border max-w-sm transition-all ${
          wfToast.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/40 text-emerald-300' :
          wfToast.type === 'warn'    ? 'bg-amber-900/90 border-amber-500/40 text-amber-300' :
                                       'bg-rose-900/90 border-rose-500/40 text-rose-300'
        }`}>
          <span className="text-lg flex-shrink-0">
            {wfToast.type === 'success' ? '' : wfToast.type === 'warn' ? '' : ''}
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider mb-0.5 opacity-70">Workflow</p>
            <p className="text-sm font-medium leading-snug">{wfToast.msg}</p>
            {wfToast.type !== 'success' && (
              <a href="/leasing/workflow" className="text-xs underline opacity-70 hover:opacity-100 mt-1 block">
                Open Leasing approvals
              </a>
            )}
          </div>
          <button onClick={() => setWfToast(null)} className="ml-2 opacity-50 hover:opacity-100 text-lg leading-none flex-shrink-0">
            
          </button>
        </div>
      )}

      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between">
          <h1 className="text-4xl font-bold text-white">Lease Quotations</h1>
          {prefilling && (
            <span className="text-sm text-blue-400 animate-pulse mr-3">
              Loading inquiry data...
            </span>
          )}
          <button
            onClick={() => setShowNewModal(true)}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            New Quotation
          </button>
        </div>

        {/* Status Pipeline */}
        <div className="mb-8 bg-slate-800/50 border border-white/10 rounded-2xl p-4">
          <p className="text-sm font-medium text-slate-300 mb-4">
            Quotation Pipeline
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {STATUS_PIPELINE.map((status) => (
              <button
                key={status}
                onClick={() =>
                  setStatusFilter(statusFilter === status ? 'ALL' : status)
                }
                className={`px-3 py-2 rounded-lg whitespace-nowrap text-xs font-medium transition-colors ${
                  statusFilter === status
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {status.replace(/_/g, ' ')} ({statusCounts[status] || 0})
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 flex justify-end">
          <DataTableToolbar
            filtersOpen={showTableFilters}
            onToggleFilters={() => setShowTableFilters((current) => !current)}
            onExportExcel={() => downloadXLSX('lease-quotations-export', quotationExportRows, quotationExportColumns)}
            onExportPdf={() => downloadTablePdf({
              filename: 'lease-quotations-export.pdf',
              title: 'Lease Quotations',
              columns: quotationExportColumns,
              rows: quotationExportRows,
            })}
            columns={quotationColumns}
            onToggleColumn={toggleQuotationColumn}
            onMoveColumn={moveQuotationColumn}
            onResizeColumn={(key, direction) => resizeQuotationColumn(key, direction === 'wider' ? 24 : -24)}
            leftSlot={(
              <div className="data-grid-count-badge">
                {filteredQuotations.length} quotation{filteredQuotations.length === 1 ? '' : 's'}
              </div>
            )}
          />
        </div>

        {conversionNotice && (
          <div className={`mb-4 rounded-2xl border px-4 py-3 shadow-sm ${
            conversionNotice.tone === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : conversionNotice.tone === 'warn'
              ? 'border-amber-300 bg-amber-50 text-amber-950'
              : 'border-rose-300 bg-rose-50 text-rose-950'
          }`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-bold">{conversionNotice.title}</p>
                <p className="mt-1 text-sm font-medium">{conversionNotice.message}</p>
                {conversionNotice.meta && (
                  <p className="mt-1 text-xs font-semibold opacity-70">{conversionNotice.meta}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {conversionNotice.tone === 'warn' && (
                  <a
                    href="/leasing/workflow"
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-amber-100"
                  >
                    Open Leasing approvals
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setConversionNotice(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-slate-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {showTableFilters && (
        <div className="mb-8 rounded-2xl border border-white/10 bg-slate-800/50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => openDatePicker(fromDateInputRef.current)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openDatePicker(fromDateInputRef.current);
                }
              }}
              className="flex min-w-[190px] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-left"
            >
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <input
                ref={fromDateInputRef}
                type="date"
                value={fromDateFilter}
                onChange={(e) => setFromDateFilter(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full cursor-pointer bg-transparent text-sm text-white focus:outline-none"
              />
              {fromDateFilter && (
                <button onClick={() => setFromDateFilter('')} className="text-slate-500 hover:text-white">×</button>
              )}
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => openDatePicker(toDateInputRef.current)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openDatePicker(toDateInputRef.current);
                }
              }}
              className="flex min-w-[190px] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-left"
            >
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <input
                ref={toDateInputRef}
                type="date"
                value={toDateFilter}
                onChange={(e) => setToDateFilter(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full cursor-pointer bg-transparent text-sm text-white focus:outline-none"
              />
              {toDateFilter && (
                <button onClick={() => setToDateFilter('')} className="text-slate-500 hover:text-white">×</button>
              )}
            </div>

            <div className="flex min-w-[170px] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
              <ListFilter className="h-4 w-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-transparent text-sm text-white focus:outline-none"
              >
                <option value="ALL">Status</option>
                {STATUS_PIPELINE.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              {statusFilter !== 'ALL' && (
                <span className="rounded-md bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {filteredQuotations.length}
                </span>
              )}
            </div>

            <div className="flex min-w-[210px] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
              <Users className="h-4 w-4 text-slate-400" />
              <select
                value={lesseeFilter}
                onChange={(e) => setLesseeFilter(e.target.value)}
                className="w-full bg-transparent text-sm text-white focus:outline-none"
              >
                <option value="ALL">Lessee</option>
                {lessees.map((lessee) => (
                  <option key={lessee.id} value={lessee.id}>
                    {lessee.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-slate-900/70">
              <span className="border-r border-white/10 px-3 py-2 text-sm font-semibold text-slate-300">QUO-</span>
              <select
                value={quotationYearFilter}
                onChange={(e) => setQuotationYearFilter(e.target.value)}
                className="bg-transparent px-3 py-2 text-sm text-white focus:outline-none"
              >
                {(availableYears.length ? availableYears : [String(new Date().getFullYear())]).map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <span className="border-l border-r border-white/10 px-3 py-2 text-sm text-slate-400">-</span>
              <input
                type="text"
                inputMode="numeric"
                value={quotationSequenceFilter}
                onChange={(e) => setQuotationSequenceFilter(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="0001"
                className="w-24 bg-transparent px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="flex min-w-[220px] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search quotation or lessee"
                className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
              />
            </div>

            <button
              onClick={resetFilters}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-slate-900/70 text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Reset filters"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
        )}

        {/* Table */}
        <div className="smart-data-grid-surface">
          <table className="w-full min-w-[760px]">
            <SmartDataGridHeader
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={(key) => toggleSort(key as QuotationColumnKey)}
              columns={visibleQuotationColumns.map((column) => {
                const commonInputClass = 'w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm font-medium text-[color:var(--text-primary)] placeholder:text-xs placeholder:font-medium placeholder:text-[color:var(--text-tertiary)] focus:border-blue-500 focus:outline-none';
                if (!showTableFilters) return { key: column.key, label: column.label, sortable: true, width: column.width };
                switch (column.key) {
                  case 'quotationNumber':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <input value={quotationSequenceFilter} onChange={(e) => setQuotationSequenceFilter(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="0001" className={commonInputClass} /> };
                  case 'lesseeName':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <select value={lesseeFilter} onChange={(e) => setLesseeFilter(e.target.value)} className={commonInputClass}><option value="ALL">All</option>{lessees.map((lessee) => <option key={lessee.id} value={lessee.id}>{lessee.name}</option>)}</select> };
                  case 'leaseType':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Lease type..." className={commonInputClass} /> };
                  case 'duration':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="e.g. 36" className={commonInputClass} /> };
                  case 'vehicleCount':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Units..." className={commonInputClass} /> };
                  case 'totalMonthly':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Amount..." className={commonInputClass} /> };
                  case 'totalValue':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Amount..." className={commonInputClass} /> };
                  case 'status':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={commonInputClass}><option value="ALL">All</option>{STATUS_PIPELINE.map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select> };
                  case 'validUntil':
                    return { key: column.key, label: column.label, sortable: true, width: column.width, filter: <input value={toDateFilter} onChange={(e) => setToDateFilter(e.target.value)} placeholder="YYYY-MM-DD" className={commonInputClass} /> };
                  default:
                    return { key: column.key, label: column.label, sortable: true, width: column.width };
                }
              })}
              actionHeader="Actions"
            />
            <tbody>
              {sortedQuotations.map((quotation) => {
                return (
                  <tr
                    key={quotation.id}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    {visibleQuotationColumns.map((column) => (
                      <React.Fragment key={column.key}>
                        {renderQuotationCell(quotation, column.key)}
                      </React.Fragment>
                    ))}
                    <td className="smart-data-grid-cell px-3 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setViewQuotation(quotation)}
                          className="px-2.5 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs hover:bg-blue-500/30 flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </button>
                        {getQuotationAction(quotation.status) && (
                          <button
                            disabled={processingActionId === quotation.id || !canApproveCreditForQuotation(quotation)}
                            onClick={() => handleWorkflowAction(quotation.id, getQuotationAction(quotation.status)!.label)}
                            title={!canApproveCreditForQuotation(quotation) ? `Assigned to ${pendingCreditApproverRoles[quotation.id] ?? 'another approver role'}` : undefined}
                            className={`px-2.5 py-1 rounded text-xs transition-all flex items-center gap-1 border ${
                              getQuotationAction(quotation.status)!.color === 'emerald'
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                                : getQuotationAction(quotation.status)!.color === 'indigo'
                                ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/30'
                                : 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30'
                            } ${!canApproveCreditForQuotation(quotation) ? 'opacity-50 cursor-not-allowed hover:bg-inherit' : ''}`}
                          >
                            {processingActionId === quotation.id ? (
                               <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                               getQuotationAction(quotation.status)!.label === 'Submit Quotation' ? <Mail className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />
                            )}
                            {getQuotationAction(quotation.status)!.label}
                          </button>
                        )}
                        {['CUSTOMER_APPROVED', 'PENDING_CREDIT_APPROVAL', 'CREDIT_APPROVED', 'PO_PREPARATION', 'PO_PREPARED', 'DELIVERY_IN_PROGRESS', 'DELIVERED'].includes(quotation.status) && (
                          <button
                            onClick={() => openConvertToContractDialog(quotation)}
                            className="px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs hover:bg-indigo-500/30 flex items-center gap-1"
                          >
                            <FileText className="h-3 w-3" />
                            Contract
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ActionDialog
        open={!!conversionCandidate}
        title="Convert quotation to contract"
        description="This will try to activate a live Leasing contract from the selected quotation. If the contract activation policy requires approval, the action will be queued in Leasing Workflow."
        confirmLabel="Convert"
        cancelLabel="Cancel"
        tone="info"
        busy={processingActionId === conversionCandidate?.id}
        onClose={() => {
          if (processingActionId !== conversionCandidate?.id) {
            setConversionCandidate(null);
          }
        }}
        onConfirm={handleConvertToContract}
        details={[
          `Quotation: ${conversionCandidate?.quotationNumber ?? '-'}`,
          `Lessee: ${conversionCandidate?.lesseeName ?? conversionCandidate?.lessee?.name ?? '-'}`,
          `Value: ${(conversionCandidate?.totalContractValue ?? conversionCandidate?.totalValue ?? 0).toLocaleString()} ${conversionCandidate?.currency ?? 'AED'}`,
        ]}
      />

      {/*  New Quotation Modal  */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-5xl max-h-[95vh] flex flex-col">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-white/10 flex-shrink-0">
              <div>
                <h2 className="text-2xl font-bold text-white">New Lease Quotation</h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  {prefilling ? 'Loading inquiry data...' : 'Complete all steps to generate a quotation'}
                </p>
              </div>
              <button onClick={() => { setShowNewModal(false); setActiveStep(1); }}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Step Indicator */}
            <div className="px-8 py-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-0">
                {[
                  { n:1, label:'Lessee & Terms' },
                  { n:2, label:'Vehicles' },
                  { n:3, label:'Pricing & Services' },
                  { n:4, label:'Review & Submit' },
                ].map(({ n, label }, idx) => (
                  <div key={n} className="flex items-center flex-1">
                    <button
                      type="button"
                      onClick={() => setActiveStep(n)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all w-full ${ 
                        activeStep === n
                          ? 'bg-blue-600 text-white'
                          : activeStep > n
                          ? 'bg-emerald-600/20 text-emerald-400'
                          : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                      }`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        activeStep > n ? 'bg-emerald-500 text-white' : activeStep === n ? 'bg-white text-blue-600' : 'bg-slate-600 text-slate-300'
                      }`}>{activeStep > n ? '' : n}</span>
                      <span className="hidden md:inline">{label}</span>
                    </button>
                    {idx < 3 && <div className="w-4 h-0.5 bg-slate-700 flex-shrink-0 mx-1" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Body - scrollable */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-8 py-6">

                {/*  STEP 1: LESSEE & CONTRACT TERMS  */}
                {activeStep === 1 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-blue-600 text-white text-xs flex items-center justify-center">1</span>
                        Lessee Information
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          {formData.notes && formData.notes.startsWith('Ref: Inquiry') && (
                            <div className="mb-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2">
                              <span className="text-emerald-400 text-sm font-semibold flex-shrink-0">Auto-filled</span>
                              <span className="text-slate-300 text-sm">
                                This quotation was pre-populated from the inquiry.
                                {!formData.lesseeId && ' No matching lessee found - please select one below.'}
                                {formData.lesseeId && ' Lessee auto-matched from inquiry.'}
                              </span>
                            </div>
                          )}
                          <label className="block text-sm font-medium text-slate-300 mb-2">Select Lessee *</label>
                          <select
                            required
                            value={formData.lesseeId}
                            onChange={e => {
                              const lessee = lessees.find(l => l.id === e.target.value);
                              setFormData({ ...formData, lesseeId: e.target.value, lesseeName: lessee?.name ?? '' });
                            }}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500">
                            <option value="">-- Select Lessee --</option>
                            {lessees.map(l => (
                              <option key={l.id} value={l.id}>
                                {l.name} {l.type === 'corporate' ? `(${l.tradeLicense ?? l.licenseNo ?? 'Corporate'})` : '(Individual)'}
                              </option>
                            ))}
                          </select>
                          {formData.lesseeId && (
                            <p className="text-xs text-emerald-400 mt-1">Selected: {formData.lesseeName}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Lease Type *</label>
                          <select value={formData.leaseType}
                            onChange={e => setFormData({ ...formData, leaseType: e.target.value as any })}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500">
                            <option value="LONG_TERM">Long Term (12+ months)</option>
                            <option value="SHORT_TERM">Short Term (3-12 months)</option>
                            <option value="MONTHLY">Monthly Rolling</option>
                            <option value="DAILY">Daily</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Duration (months) *</label>
                          <input type="number" min="1" max="120" required value={formData.duration}
                            onChange={e => {
                              const d = parseInt(e.target.value) || 0;
                              setFormData({ ...formData, duration: d,
                                endDate: formData.startDate && d ? addMonths(formData.startDate, d) : formData.endDate });
                            }}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Start Date *</label>
                          <input type="date" required value={formData.startDate}
                            onChange={e => {
                              const s = e.target.value;
                              setFormData({ ...formData, startDate: s,
                                endDate: s && formData.duration ? addMonths(s, formData.duration) : formData.endDate,
                                validUntil: formData.validUntil || addDays(s, 30) });
                            }}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">
                            End Date <span className="text-xs text-emerald-400">(auto-calculated)</span>
                          </label>
                          <input type="date" value={formData.endDate} readOnly
                            className="w-full bg-slate-600/30 border border-white/5 rounded-xl px-3 py-2.5 text-emerald-400 cursor-default" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Quotation Valid Until *</label>
                          <input type="date" required value={formData.validUntil}
                            onChange={e => setFormData({ ...formData, validUntil: e.target.value })}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Currency</label>
                          <select value={formData.currency}
                            onChange={e => setFormData({ ...formData, currency: e.target.value as any })}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-blue-500">
                            <option value="AED">AED - UAE Dirham</option>
                            <option value="USD">USD - US Dollar</option>
                            <option value="EUR">EUR - Euro</option>
                            <option value="SAR">SAR - Saudi Riyal</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-blue-600 text-white text-xs flex items-center justify-center">2</span>
                        Contract Terms
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Mileage Cap (km/month)</label>
                          <input type="number" min="0" value={formData.mileageCap ?? ''} placeholder="e.g. 3000"
                            onChange={e => setFormData({ ...formData, mileageCap: parseInt(e.target.value) || 0 })}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                          <p className="text-xs text-slate-500 mt-1">Leave 0 for unlimited mileage</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-2">Security Deposit ({formData.currency})</label>
                          <input type="number" min="0" value={formData.securityDeposit || ''} placeholder="e.g. 5000"
                            onChange={e => setFormData({ ...formData, securityDeposit: parseFloat(e.target.value) || 0 })}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium text-slate-300 mb-2">Notes / Special Conditions</label>
                          <textarea value={formData.notes} rows={3} placeholder="Any special terms, conditions, or notes for this quotation..."
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                            className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/*  STEP 2: VEHICLE CONFIGURATION  */}
                {activeStep === 2 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-semibold text-white flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-blue-600 text-white text-xs flex items-center justify-center">2</span>
                        Vehicle Configuration
                      </h3>
                      <button type="button" onClick={addVehicleRow}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 text-sm hover:bg-blue-500/30 transition-all">
                        <Plus className="h-4 w-4" /> Add Vehicle Type
                      </button>
                    </div>

                    {(formData.vehicles ?? []).map((vehicle, index) => (
                      <div key={index} className="bg-slate-700/30 border border-white/10 rounded-2xl p-5">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-sm font-semibold text-white">
                            Vehicle Line {index + 1}
                            {vehicle.make && vehicle.model && (
                              <span className="ml-2 text-slate-400 font-normal">{vehicle.make} {vehicle.model}</span>
                            )}
                          </span>
                          {(formData.vehicles ?? []).length > 1 && (
                            <button type="button" onClick={() => removeVehicleRow(index)}
                              className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-all">
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Vehicle Type *</label>
                            <select value={vehicle.vehicleType}
                              onChange={e => {
                                const v = [...formData.vehicles];
                                const nextVehicleType = e.target.value as any;
                                const validModels = v[index].make ? getModelsForMakeAndVehicleType(v[index].make, nextVehicleType) : [];
                                const currentModelStillValid = !v[index].model || validModels.some(model => model.model === v[index].model);
                                v[index] = {
                                  ...v[index],
                                  vehicleType: nextVehicleType,
                                  model: currentModelStillValid ? v[index].model : '',
                                };
                                setFormData({ ...formData, vehicles: v });
                              }}
                              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                              {['SEDAN','HATCHBACK','SUV','CROSSOVER','MINIVAN','VAN','BUS','MINIBUS','PICKUP','TRUCK','LUXURY','EXECUTIVE_SEDAN','LIMOUSINE','AMBULANCE','OTHER'].map(t => (
                                <option key={t} value={t}>{t.replace('_',' ')}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Make</label>
                            <select value={vehicle.make}
                              onChange={e => {
                                const v = [...formData.vehicles];
                                v[index] = { ...v[index], make: e.target.value, model: '' };
                                setFormData({ ...formData, vehicles: v });
                              }}
                              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                              <option value="">Any Make</option>
                              {vehicleMakesList.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Model</label>
                            <select value={vehicle.model}
                              onChange={e => {
                                const v = [...formData.vehicles];
                                v[index] = { ...v[index], model: e.target.value };
                                setFormData({ ...formData, vehicles: v });
                              }}
                              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                              <option value="">Any Model</option>
                              {vehicle.make && getModelsForMakeAndVehicleType(vehicle.make, vehicle.vehicleType).map(m => (
                                <option key={m.model} value={m.model}>{m.model}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Year</label>
                            <select value={vehicle.year}
                              onChange={e => {
                                const v = [...formData.vehicles];
                                v[index] = { ...v[index], year: parseInt(e.target.value) };
                                setFormData({ ...formData, vehicles: v });
                              }}
                              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i).map(y => (
                                <option key={y} value={y}>{y}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Quantity *</label>
                            <input type="number" min="1" value={vehicle.quantity}
                              onChange={e => {
                                const v = [...formData.vehicles];
                                v[index] = { ...v[index], quantity: parseInt(e.target.value) || 1 };
                                setFormData({ ...formData, vehicles: v });
                              }}
                              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Monthly Rate per Unit ({formData.currency}) *</label>
                            <input type="number" min="0" step="0.01" value={vehicle.monthlyRate || ''}
                              placeholder="e.g. 3500"
                              onChange={e => {
                                const v = [...formData.vehicles];
                                v[index] = { ...v[index], monthlyRate: parseFloat(e.target.value) || 0 };
                                setFormData({ ...formData, vehicles: v });
                              }}
                              className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500" />
                          </div>
                        </div>

                        {/* Per-vehicle bundled services */}
                        <div className="mt-4 pt-4 border-t border-white/10">
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Bundled Services for this Vehicle Type</p>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { flag: 'insuranceIncluded', costKey: 'insuranceCostPerUnit', label: 'Insurance', color: 'blue' },
                              { flag: 'maintenanceIncluded', costKey: 'maintenanceCostPerUnit', label: 'Maintenance', color: 'emerald' },
                              { flag: 'driverIncluded', costKey: 'driverCostPerUnit', label: 'Driver', color: 'amber' },
                            ].map(({ flag, costKey, label, color }) => {
                              const isOn = !!(vehicle as any)[flag];
                              return (
                                <div key={flag} className={`rounded-xl border p-3 transition-all ${isOn ? `border-${color}-500/40 bg-${color}-500/10` : 'border-white/10 bg-slate-800/50'}`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-medium text-white">{label}</span>
                                    <button type="button"
                                      onClick={() => {
                                        const v = [...formData.vehicles];
                                        v[index] = { ...v[index], [flag]: !isOn };
                                        setFormData({ ...formData, vehicles: v });
                                      }}
                                      className={`relative inline-flex h-5 w-9 rounded-full transition-colors flex-shrink-0 ${isOn ? 'bg-blue-600' : 'bg-slate-600'}`}>
                                      <span className={`inline-block h-3 w-3 mt-1 rounded-full bg-white transition-transform ${isOn ? 'translate-x-5' : 'translate-x-1'}`} />
                                    </button>
                                  </div>
                                  {isOn && (
                                    <div>
                                      <label className="block text-xs text-slate-400 mb-1">Cost per Unit / month ({formData.currency})</label>
                                      <input type="number" min="0" step="0.01"
                                        value={(vehicle as any)[costKey] || ''}
                                        placeholder="0.00"
                                        onChange={e => {
                                          const v = [...formData.vehicles];
                                          v[index] = { ...v[index], [costKey]: parseFloat(e.target.value) || 0 };
                                          setFormData({ ...formData, vehicles: v });
                                        }}
                                        className="w-full bg-slate-700 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500" />
                                      {(vehicle as any)[costKey] > 0 && (
                                        <p className="text-xs text-slate-500 mt-1">
                                          Total: {formData.currency} {((Number((vehicle as any)[costKey]) || 0) * (Number(vehicle.quantity) || 0)).toLocaleString('en-AE')} / month
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Per-vehicle subtotal */}
                        <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                          <span className="text-xs text-slate-400">Line Subtotal (incl. services):</span>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-emerald-400">
                              {formData.currency} {(
                                ((Number(vehicle.monthlyRate) || 0) +
                                (vehicle.insuranceIncluded ? (Number(vehicle.insuranceCostPerUnit) || 0) : 0) +
                                (vehicle.maintenanceIncluded ? (Number(vehicle.maintenanceCostPerUnit) || 0) : 0) +
                                (vehicle.driverIncluded ? (Number(vehicle.driverCostPerUnit) || 0) : 0)) *
                                (Number(vehicle.quantity) || 0)
                              ).toLocaleString('en-AE')} / month
                            </div>
                            {formData.duration > 0 && (
                              <div className="text-xs text-slate-400">
                                {formData.currency} {(
                                  ((Number(vehicle.monthlyRate) || 0) +
                                  (vehicle.insuranceIncluded ? (Number(vehicle.insuranceCostPerUnit) || 0) : 0) +
                                  (vehicle.maintenanceIncluded ? (Number(vehicle.maintenanceCostPerUnit) || 0) : 0) +
                                  (vehicle.driverIncluded ? (Number(vehicle.driverCostPerUnit) || 0) : 0)) *
                                  (Number(vehicle.quantity) || 0) * formData.duration
                                ).toLocaleString('en-AE')} over {formData.duration} months
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Fleet summary */}
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-5 py-3 flex items-center justify-between">
                      <span className="text-sm text-slate-300">
                        Total Fleet: <strong className="text-white">{formData.vehicles.reduce((s, v) => s + (Number(v.quantity)||0), 0)} vehicles</strong>
                        {' '}across <strong className="text-white">{formData.vehicles.length} line(s)</strong>
                      </span>
                      <span className="text-sm font-bold text-emerald-400">
                        Base: {formData.currency} {formData.vehicles.reduce((s,v) => s+(Number(v.monthlyRate)||0)*(Number(v.quantity)||0), 0).toLocaleString('en-AE')} / month
                      </span>
                    </div>
                  </div>
                )}

                {/*  STEP 3: PRICING & SERVICES  */}
                {activeStep === 3 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-blue-600 text-white text-xs flex items-center justify-center">3</span>
                        Pricing Adjustments
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          { label:'Interest Rate (%)', key:'interestRate', help:'Annual interest rate applied to base monthly rate' },
                          { label:'Markup (%)', key:'markupRate', help:'Profit markup percentage on base monthly rate' },
                        ].map(({ label, key, help }) => (
                          <div key={key}>
                            <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
                            <input type="number" min="0" step="0.01"
                              value={(formData as any)[key] || ''}
                              placeholder="0"
                              onChange={e => setFormData({ ...formData, [key]: parseFloat(e.target.value) || 0 })}
                              className="w-full bg-slate-700/50 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500" />
                            {help && <p className="text-xs text-slate-500 mt-1">{help}</p>}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div>
                          <h3 className="text-base font-semibold text-white flex items-center gap-2">
                            <span className="w-6 h-6 rounded bg-cyan-600 text-white text-xs flex items-center justify-center">+</span>
                            Itemized Accessories & Service Catalog
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">
                            Add optional vehicle accessories and recurring service elements as separate quote lines.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => addCatalogLineItem('ACCESSORY')}
                            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-cyan-100 hover:bg-cyan-500/20 transition-all"
                          >
                            <Plus className="h-4 w-4" /> Add accessory
                          </button>
                          <button
                            type="button"
                            onClick={() => addCatalogLineItem('SERVICE')}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-emerald-100 hover:bg-emerald-500/20 transition-all"
                          >
                            <Plus className="h-4 w-4" /> Add service
                          </button>
                        </div>
                      </div>

                      <div className="mb-3 flex flex-wrap gap-2">
                        {serviceCatalogLoading && (
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-400">
                            Loading tenant catalog...
                          </span>
                        )}
                        {!serviceCatalogLoading && serviceCatalog.length === 0 && (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
                            No active catalog presets. Configure them in Admin &gt; Service Configuration &gt; Vehicle Leasing &gt; Quotations &gt; Catalog.
                          </span>
                        )}
                        {serviceCatalog.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => addServiceCatalogPreset(preset)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-blue-400/50 hover:bg-blue-500/10 transition-all"
                            title={preset.description ?? undefined}
                          >
                            + {preset.name}
                          </button>
                        ))}
                      </div>

                      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-700/20">
                        <div className="grid grid-cols-[140px_1fr_110px_140px_150px_44px] gap-2 border-b border-white/10 bg-slate-800/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                          <span>Type</span>
                          <span>Description</span>
                          <span>Qty</span>
                          <span>Rate / Month</span>
                          <span className="text-right">Monthly Total</span>
                          <span />
                        </div>
                        {(formData.lineItems ?? []).length === 0 ? (
                          <div className="px-4 py-6 text-center text-sm text-slate-500">
                            No catalog items added yet. Add accessories or services to make the quotation fully itemized.
                          </div>
                        ) : (
                          <div className="divide-y divide-white/5">
                            {(formData.lineItems ?? []).map((item, index) => {
                              const quantity = Math.max(1, Number(item.quantity) || 1);
                              const unitRate = Math.max(0, Number(item.unitRate) || 0);
                              const monthlyAmount = quantity * unitRate;
                              return (
                                <div key={index} className="grid grid-cols-[140px_1fr_110px_140px_150px_44px] gap-2 px-4 py-3 items-start">
                                  <select
                                    value={item.itemType}
                                    onChange={e => updateCatalogLineItem(index, { itemType: e.target.value as QuotationLineItemType })}
                                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-2 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                                  >
                                    <option value="ACCESSORY">Accessory</option>
                                    <option value="SERVICE">Service</option>
                                    <option value="OTHER">Other</option>
                                  </select>
                                  <input
                                    type="text"
                                    value={item.description}
                                    onChange={e => updateCatalogLineItem(index, { description: e.target.value })}
                                    placeholder="e.g. Roadside assistance"
                                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                                  />
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.quantity || ''}
                                    onChange={e => updateCatalogLineItem(index, { quantity: parseInt(e.target.value, 10) || 1 })}
                                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                                  />
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.unitRate || ''}
                                    onChange={e => updateCatalogLineItem(index, { unitRate: parseFloat(e.target.value) || 0 })}
                                    className="w-full rounded-lg border border-white/10 bg-slate-700 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                                  />
                                  <div className="rounded-lg bg-slate-800/70 px-3 py-2 text-right text-sm font-semibold text-emerald-300">
                                    {formData.currency} {monthlyAmount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                                    <div className="text-[11px] font-medium text-slate-500">
                                      {formData.duration} mo: {formData.currency} {(monthlyAmount * (Number(formData.duration) || 0)).toLocaleString('en-AE')}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeCatalogLineItem(index)}
                                    className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all"
                                    aria-label="Remove catalog item"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-3 border-t border-white/10 bg-slate-800/40 px-4 py-3 text-sm">
                          <div className="rounded-xl bg-cyan-500/10 px-3 py-2">
                            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Accessories</div>
                            <div className="font-bold text-white">{formData.currency} {totals.accessoriesCost.toLocaleString('en-AE')}</div>
                          </div>
                          <div className="rounded-xl bg-emerald-500/10 px-3 py-2">
                            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Services</div>
                            <div className="font-bold text-white">{formData.currency} {totals.servicesCost.toLocaleString('en-AE')}</div>
                          </div>
                          <div className="rounded-xl bg-violet-500/10 px-3 py-2">
                            <div className="text-xs font-semibold uppercase tracking-wider text-violet-300">Other</div>
                            <div className="font-bold text-white">{formData.currency} {totals.otherLineCost.toLocaleString('en-AE')}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-violet-600 text-white text-xs flex items-center justify-center">+</span>
                        Bundled Services Breakdown by Vehicle Type
                      </h3>
                      <div className="bg-slate-700/20 border border-white/10 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/10 bg-slate-800/50">
                              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400">Vehicle Type / Make</th>
                              <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-400">Units</th>
                              <th className="px-4 py-2.5 text-center text-xs font-semibold text-blue-400">Insurance</th>
                              <th className="px-4 py-2.5 text-center text-xs font-semibold text-emerald-400">Maintenance</th>
                              <th className="px-4 py-2.5 text-center text-xs font-semibold text-amber-400">Driver</th>
                              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400">Services Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {totals.vehicleLines.map((line, i) => (
                              <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                                <td className="px-4 py-3">
                                  <div className="font-medium text-white">{line.vehicleType.replace('_',' ')}</div>
                                  {(line.make || line.model) && <div className="text-xs text-slate-400">{line.make} {line.model}</div>}
                                </td>
                                <td className="px-4 py-3 text-center text-white font-medium">{line.quantity}</td>
                                <td className="px-4 py-3 text-center">
                                  {line.lineIns > 0
                                    ? <div><div className="text-blue-400 font-medium">{formData.currency} {line.lineIns.toLocaleString('en-AE')}</div><div className="text-xs text-slate-500">{formData.currency} {Number(line.unitIns).toLocaleString('en-AE')}/unit</div></div>
                                    : <span className="text-slate-600 text-xs">-</span>}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {line.lineMaint > 0
                                    ? <div><div className="text-emerald-400 font-medium">{formData.currency} {line.lineMaint.toLocaleString('en-AE')}</div><div className="text-xs text-slate-500">{formData.currency} {Number(line.unitMaint).toLocaleString('en-AE')}/unit</div></div>
                                    : <span className="text-slate-600 text-xs">-</span>}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {line.lineDriver > 0
                                    ? <div><div className="text-amber-400 font-medium">{formData.currency} {line.lineDriver.toLocaleString('en-AE')}</div><div className="text-xs text-slate-500">{formData.currency} {Number(line.unitDriver).toLocaleString('en-AE')}/unit</div></div>
                                    : <span className="text-slate-600 text-xs">-</span>}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="font-semibold text-white">{formData.currency} {(line.lineIns + line.lineMaint + line.lineDriver).toLocaleString('en-AE')}</div>
                                  <div className="text-xs text-slate-400">+ base {formData.currency} {line.lineBase.toLocaleString('en-AE')}</div>
                                </td>
                              </tr>
                            ))}
                            {totals.vehicleServicesTotal > 0 && (
                              <tr className="bg-slate-800/50 border-t border-white/10">
                                <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Totals</td>
                                <td className="px-4 py-2.5 text-center text-blue-400 font-semibold text-sm">{formData.currency} {totals.totalInsurance.toLocaleString('en-AE')}</td>
                                <td className="px-4 py-2.5 text-center text-emerald-400 font-semibold text-sm">{formData.currency} {totals.totalMaintenance.toLocaleString('en-AE')}</td>
                                <td className="px-4 py-2.5 text-center text-amber-400 font-semibold text-sm">{formData.currency} {totals.totalDriver.toLocaleString('en-AE')}</td>
                                <td className="px-4 py-2.5 text-right text-white font-bold">{formData.currency} {totals.vehicleServicesTotal.toLocaleString('en-AE')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {totals.vehicleServicesTotal === 0 && (
                          <div className="px-4 py-4 text-center text-slate-500 text-sm">
                            No bundled services configured. Go back to Step 2 to enable Insurance, Maintenance, or Driver services per vehicle type.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Live Pricing Summary */}
                    <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-white/10 rounded-2xl p-5">
                      <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Live Pricing Summary</h4>
                      <div className="space-y-2">
                        {/* Vehicle Base */}
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-400">Vehicle Base ({formData.vehicles.reduce((s,v)=>s+(Number(v.quantity)||0),0)} units)</span>
                          <span className="text-white">{formData.currency} {Number(totals.baseMonthly ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
                        </div>
                        {/* Per-vehicle service breakdown */}
                        {totals.vehicleLines.map((line, i) => (
                          (line.lineIns > 0 || line.lineMaint > 0 || line.lineDriver > 0) && (
                            <div key={i} className="ml-3 border-l-2 border-slate-600 pl-3 space-y-1">
                              <div className="text-xs text-slate-500 font-medium">{line.vehicleType.replace('_',' ')} x{line.quantity}</div>
                              {line.lineIns > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500">Insurance ({formData.currency}{Number(line.unitIns).toLocaleString('en-AE')}/unit)</span>
                                  <span className="font-medium text-sky-700 dark:text-sky-300">{formData.currency} {line.lineIns.toLocaleString('en-AE')}</span>
                                </div>
                              )}
                              {line.lineMaint > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500">Maintenance ({formData.currency}{Number(line.unitMaint).toLocaleString('en-AE')}/unit)</span>
                                  <span className="font-medium text-emerald-700 dark:text-emerald-300">{formData.currency} {line.lineMaint.toLocaleString('en-AE')}</span>
                                </div>
                              )}
                              {line.lineDriver > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500">Driver ({formData.currency}{Number(line.unitDriver).toLocaleString('en-AE')}/unit)</span>
                                  <span className="font-medium text-amber-700 dark:text-amber-300">{formData.currency} {line.lineDriver.toLocaleString('en-AE')}</span>
                                </div>
                              )}
                            </div>
                          )
                        ))}
                        {/* Adjustments */}
                        {(Number(totals.interestAmount) > 0) && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400">Interest ({formData.interestRate}%)</span>
                            <span className="text-white">{formData.currency} {Number(totals.interestAmount ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        {(Number(totals.markupAmount) > 0) && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400">Markup ({formData.markupRate}%)</span>
                            <span className="text-white">{formData.currency} {Number(totals.markupAmount ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        {(Number(totals.accessoriesCost) > 0) && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400">Accessories</span>
                            <span className="text-white">{formData.currency} {Number(totals.accessoriesCost).toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        {(Number(totals.servicesCost) > 0) && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400">Additional Services</span>
                            <span className="text-white">{formData.currency} {Number(totals.servicesCost).toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        {(Number(totals.otherLineCost) > 0) && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400">Other Quote Items</span>
                            <span className="text-white">{formData.currency} {Number(totals.otherLineCost).toLocaleString('en-AE', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        <div className="border-t border-white/10 pt-3 mt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-base font-semibold text-white">Total Monthly Rate</span>
                            <span className="text-xl font-bold text-emerald-800 dark:text-emerald-300">
                              {formData.currency} {Number(totals.totalMonthly ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          {formData.duration > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-slate-400">Total Contract Value ({formData.duration} months)</span>
                              <span className="text-lg font-bold text-sky-800 dark:text-sky-300">
                                {formData.currency} {Number(totals.totalValue ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          )}
                          {Number(formData.securityDeposit) > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-slate-400">Security Deposit</span>
                              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                                {formData.currency} {Number(formData.securityDeposit).toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/*  STEP 4: REVIEW & SUBMIT  */}
                {activeStep === 4 && (
                  <div className="space-y-5">
                    <h3 className="text-base font-semibold text-white flex items-center gap-2">
                      <span className="w-6 h-6 rounded bg-emerald-600 text-white text-xs flex items-center justify-center">4</span>
                      Review Before Submission
                    </h3>

                    {/* Summary Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Lessee & Terms */}
                      <div className="bg-slate-700/30 border border-white/10 rounded-xl p-4">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Lessee & Terms</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between"><span className="text-slate-400">Lessee</span><span className="text-white font-medium">{formData.lesseeName || ''}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Lease Type</span><span className="text-white">{formData.leaseType}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Duration</span><span className="text-white">{formData.duration} months</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Start Date</span><span className="text-white">{formData.startDate || ''}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">End Date</span><span className="text-emerald-400">{formData.endDate || ''}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Valid Until</span><span className="text-white">{formData.validUntil || ''}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Mileage Cap</span><span className="text-white">{formData.mileageCap ? `${formData.mileageCap.toLocaleString()} km/mo` : 'Unlimited'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Security Deposit</span><span className="text-amber-400">{formData.currency} {Number(formData.securityDeposit || 0).toLocaleString('en-AE')}</span></div>
                        </div>
                      </div>

                      {/* Pricing Summary */}
                      <div className="bg-slate-700/30 border border-white/10 rounded-xl p-4">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Pricing</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between"><span className="text-slate-400">Vehicle Base</span><span className="text-white">{formData.currency} {Number(totals.baseMonthly??0).toLocaleString('en-AE')}</span></div>
                          {Number(totals.totalInsurance) > 0 && <div className="flex justify-between"><span className="text-slate-400">Insurance (all vehicles)</span><span className="font-medium text-sky-700 dark:text-sky-300">{formData.currency} {totals.totalInsurance.toLocaleString('en-AE')}</span></div>}
                          {Number(totals.totalMaintenance) > 0 && <div className="flex justify-between"><span className="text-slate-400">Maintenance (all vehicles)</span><span className="font-medium text-emerald-700 dark:text-emerald-300">{formData.currency} {totals.totalMaintenance.toLocaleString('en-AE')}</span></div>}
                          {Number(totals.totalDriver) > 0 && <div className="flex justify-between"><span className="text-slate-400">Driver (all vehicles)</span><span className="font-medium text-amber-700 dark:text-amber-300">{formData.currency} {totals.totalDriver.toLocaleString('en-AE')}</span></div>}
                          {Number(totals.accessoriesCost) > 0 && <div className="flex justify-between"><span className="text-slate-400">Accessories</span><span className="font-medium text-cyan-700 dark:text-cyan-300">{formData.currency} {totals.accessoriesCost.toLocaleString('en-AE')}</span></div>}
                          {Number(totals.servicesCost + totals.otherLineCost) > 0 && <div className="flex justify-between"><span className="text-slate-400">Services / Other</span><span className="font-medium text-emerald-700 dark:text-emerald-300">{formData.currency} {(totals.servicesCost + totals.otherLineCost).toLocaleString('en-AE')}</span></div>}
                          {(Number(totals.interestAmount) > 0 || Number(totals.markupAmount) > 0) && (
                            <div className="flex justify-between"><span className="text-slate-400">Interest + Markup</span><span className="text-white">{formData.currency} {(Number(totals.interestAmount??0)+Number(totals.markupAmount??0)).toLocaleString('en-AE')}</span></div>
                          )}
                          <div className="border-t border-white/10 pt-2 space-y-1">
                            <div className="flex justify-between text-base font-bold">
                              <span className="text-white">Monthly Total</span>
                              <span className="text-emerald-800 dark:text-emerald-300">{formData.currency} {Number(totals.totalMonthly??0).toLocaleString('en-AE')}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400 text-sm">Contract Total</span>
                              <span className="text-blue-400 font-semibold">{formData.currency} {Number(totals.totalValue??0).toLocaleString('en-AE')}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {totals.lineItems.length > 0 && (
                      <div className="bg-slate-700/30 border border-white/10 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/10">
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Accessories & Service Catalog</h4>
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/5">
                              <th className="px-4 py-2 text-left text-xs text-slate-400">Type</th>
                              <th className="px-4 py-2 text-left text-xs text-slate-400">Description</th>
                              <th className="px-4 py-2 text-center text-xs text-slate-400">Qty</th>
                              <th className="px-4 py-2 text-right text-xs text-slate-400">Monthly</th>
                              <th className="px-4 py-2 text-right text-xs text-slate-400">Contract Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {totals.lineItems.map((item, index) => (
                              <tr key={`${item.description}-${index}`} className="border-b border-white/5">
                                <td className="px-4 py-2.5 text-slate-300">{item.itemType}</td>
                                <td className="px-4 py-2.5 text-white">{item.description || '-'}</td>
                                <td className="px-4 py-2.5 text-center text-slate-300">{item.quantity}</td>
                                <td className="px-4 py-2.5 text-right text-emerald-300">{formData.currency} {item.monthlyAmount.toLocaleString('en-AE')}</td>
                                <td className="px-4 py-2.5 text-right text-blue-300">{formData.currency} {item.totalAmount.toLocaleString('en-AE')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Vehicles Table */}
                    <div className="bg-slate-700/30 border border-white/10 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-white/10">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vehicle Lines ({formData.vehicles.reduce((s,v)=>s+(Number(v.quantity)||0),0)} total units)</h4>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5">
                            <th className="px-4 py-2 text-left text-xs text-slate-400">Vehicle Type</th>
                            <th className="px-4 py-2 text-center text-xs text-slate-400">Qty</th>
                            <th className="px-4 py-2 text-right text-xs text-slate-400">Base/Unit</th>
                            <th className="px-4 py-2 text-right text-xs text-slate-400">Services/Unit</th>
                            <th className="px-4 py-2 text-right text-xs text-slate-400">Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.vehicles.map((v, i) => (
                            <tr key={i} className="border-b border-white/5">
                              <td className="px-4 py-2.5 text-white">{v.vehicleType.replace('_',' ')}</td>
                              <td className="px-4 py-2.5 text-slate-300">{v.make || ''} {v.model || ''}</td>
                              <td className="px-4 py-2.5 text-slate-300">{v.year}</td>
                              <td className="px-4 py-2.5 text-center text-white font-medium">{v.quantity}</td>
                              <td className="px-4 py-2.5 text-right text-slate-300">{Number(v.monthlyRate||0).toLocaleString('en-AE')}</td>
                              <td className="px-4 py-2.5 text-right text-emerald-400 font-medium">{((Number(v.monthlyRate)||0)*(Number(v.quantity)||0)).toLocaleString('en-AE')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {formData.notes && (
                      <div className="bg-slate-700/20 border border-white/10 rounded-xl p-4">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</h4>
                        <p className="text-sm text-slate-300 whitespace-pre-line">{formData.notes}</p>
                      </div>
                    )}

                    {/* Email recipient for Submit mode */}
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                        <span className="w-5 h-5 rounded bg-blue-600 text-white text-xs flex items-center justify-center">@</span>
                        Email Submission
                      </h3>
                      <p className="text-xs text-slate-500">
                        &quot;Save &amp; Submit&quot; will update the status to <strong className="text-blue-400">SENT_TO_CUSTOMER</strong> and send
                        this quotation by email. Configure SMTP in Admin &rarr; Notifications to enable email delivery.
                      </p>
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">
                          Recipient Email <span className="text-slate-600">(leave blank to use lessee&apos;s email)</span>
                        </label>
                        <input
                          type="email"
                          value={recipientEmail}
                          onChange={e => setRecipientEmail(e.target.value)}
                          placeholder="customer@company.com"
                          className="w-full px-3 py-2 rounded-xl bg-slate-700/50 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Submit result message */}
                    {submitResult && (
                      <div className={`px-4 py-3 rounded-xl border text-sm flex items-start gap-2 ${submitResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
                        <span className="font-bold flex-shrink-0">{submitResult.success ? '' : '!'}</span>
                        {submitResult.message}
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Modal Footer - Navigation */}
              <div className="px-8 py-4 border-t border-white/10 flex items-center justify-between flex-shrink-0">
                <button type="button"
                  onClick={() => activeStep > 1 && setActiveStep(activeStep - 1)}
                  disabled={activeStep === 1}
                  className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm font-medium">
                  &larr; Back
                </button>

                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={() => { setShowNewModal(false); setActiveStep(1); }}
                    className="px-5 py-2.5 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-all text-sm">
                    Cancel
                  </button>

                  {activeStep < 4 ? (
                    <button type="button"
                      onClick={() => {
                        if (activeStep === 1 && !formData.lesseeId) {
                          const confirm = window.confirm(
                            'No lessee selected. You can proceed and assign a lessee later, or click Cancel to select one now.'
                          );
                          if (!confirm) return;
                        }
                        if (activeStep === 1 && !formData.startDate) {
                          alert('Please enter a Start Date before proceeding');
                          return;
                        }
                        if (activeStep === 1 && !formData.duration) {
                          alert('Please enter a Duration (months) before proceeding');
                          return;
                        }
                        if (activeStep === 2 && (formData.vehicles ?? []).some(v => !v.monthlyRate)) {
                          alert('Please enter a Monthly Rate for each vehicle line before proceeding');
                          return;
                        }
                        setActiveStep(activeStep + 1);
                      }}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium hover:opacity-90 transition-all text-sm">
                      Next Step &rarr;
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={saving}
                        onClick={() => setSubmitMode('draft')}
                        className="px-5 py-2.5 rounded-xl bg-slate-600 border border-white/20 text-white font-medium hover:bg-slate-500 disabled:opacity-50 transition-all text-sm flex items-center gap-2">
                        {saving && submitMode === 'draft'
                          ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <FileText className="h-4 w-4" />
                        }
                        Save Quote
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        onClick={() => setSubmitMode('submit')}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold hover:opacity-90 disabled:opacity-50 transition-all text-sm flex items-center gap-2">
                        {saving && submitMode === 'submit'
                          ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <Send className="h-4 w-4" />
                        }
                        Save &amp; Submit
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/*  View Quotation Modal  */}
      {viewQuotation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white">{viewQuotation.quotationNumber}</h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  {viewQuotation.lesseeName || '-'} &bull; {viewQuotation.leaseType} &bull; {viewQuotation.currency}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${getQuotationStatusStyles(viewQuotation.status)}`}>
                  {viewQuotation.status.replace(/_/g,' ')}
                </span>
                <button onClick={() => setViewQuotation(null)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Visual Workflow Stepper */}
              <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Workflow Progress</h3>
                  <span className="text-[10px] text-blue-400 font-mono">Stage {viewQuotation.status}</span>
                </div>
                <StatusStepper currentStatus={viewQuotation.status} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label:'Lease Type',    value: viewQuotation.leaseType },
                  { label:'Duration',      value: `${viewQuotation.durationMonths ?? viewQuotation.duration ?? '-'} months` },
                  { label:'Start Date',    value: viewQuotation.startDate ? new Date(viewQuotation.startDate).toLocaleDateString() : '-' },
                  { label:'End Date',      value: viewQuotation.endDate   ? new Date(viewQuotation.endDate).toLocaleDateString()   : '-' },
                  { label:'Valid Until',   value: viewQuotation.validUntil ? new Date(viewQuotation.validUntil).toLocaleDateString() : '-' },
                  { label:'Security Dep.', value: viewQuotation.securityDeposit ? `${viewQuotation.currency} ${Number(viewQuotation.securityDeposit).toLocaleString('en-AE')}` : '-' },
                  { label:'Mileage Cap',   value: viewQuotation.mileageCap ? `${Number(viewQuotation.mileageCap).toLocaleString()} km/mo` : 'Unlimited' },
                  { label:'Currency',      value: viewQuotation.currency },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-700/30 border border-white/10 rounded-xl p-3">
                    <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                    <div className="text-sm font-medium text-white">{value}</div>
                  </div>
                ))}
              </div>
              {(viewQuotation.insuranceIncluded || viewQuotation.maintenanceIncluded || viewQuotation.driverIncluded) && (
                <div className="flex gap-2 flex-wrap">
                  {viewQuotation.insuranceIncluded && <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Insurance Included</span>}
                  {viewQuotation.maintenanceIncluded && <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">Maintenance Included</span>}
                  {viewQuotation.driverIncluded && <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-500/20 text-violet-400 border border-violet-500/30">Driver Included</span>}
                </div>
              )}

              {(viewQuotation.vehicles ?? []).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Vehicles</h4>
                  <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/5 bg-slate-900/40">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-300">Type</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-300">Make / Model</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-300">Year</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-300">Qty</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-300">Monthly Rate</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-300">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(viewQuotation.vehicles ?? []).map((v, idx) => (
                          <tr key={idx} className="border-b border-white/5">
                            <td className="px-4 py-2.5 text-white">{v.vehicleType}</td>
                            <td className="px-4 py-2.5 text-white">{v.make} {v.model}</td>
                            <td className="px-4 py-2.5 text-slate-300">{v.year}</td>
                            <td className="px-4 py-2.5 text-white font-semibold">{v.quantity}</td>
                            <td className="px-4 py-2.5 text-white">{Number(v.monthlyRate).toLocaleString()} AED</td>
                            <td className="px-4 py-2.5 text-emerald-400 font-bold">{(Number(v.monthlyRate) * Number(v.quantity)).toLocaleString()} AED</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Financial Summary</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Monthly Rate</span>
                    <span className="text-white font-semibold">{Number(viewQuotation.totalMonthlyRate ?? 0).toLocaleString()} {viewQuotation.currency}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-white/5 pt-2">
                    <span className="text-slate-400">Total Contract Value</span>
                    <span className="text-emerald-400 font-bold text-base">{Number(viewQuotation.totalValue ?? viewQuotation.totalContractValue ?? 0).toLocaleString()} {viewQuotation.currency}</span>
                  </div>
                </div>
              </div>

              {getQuotationAction(viewQuotation.status) && (
                <div className="bg-slate-900/40 border border-violet-500/20 rounded-2xl p-4">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Next Action</h4>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-white font-semibold text-sm">{getQuotationAction(viewQuotation.status)!.label}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{getQuotationAction(viewQuotation.status)!.description}</p>
                    </div>
                    <button
                      disabled={processingActionId === viewQuotation.id || !canApproveCreditForQuotation(viewQuotation)}
                      onClick={() => handleWorkflowAction(viewQuotation.id, getQuotationAction(viewQuotation.status)!.label)}
                      title={!canApproveCreditForQuotation(viewQuotation) ? `Assigned to ${pendingCreditApproverRoles[viewQuotation.id] ?? 'another approver role'}` : undefined}
                      className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0"
                    >
                      {processingActionId === viewQuotation.id
                        ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <ArrowRight className="h-4 w-4" />}
                      {getQuotationAction(viewQuotation.status)!.label}
                    </button>
                  </div>
                </div>
              )}

              {viewQuotation.notes && (
                <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-4">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</h4>
                  <p className="text-sm text-slate-300">{viewQuotation.notes}</p>
                </div>
              )}

              {loadingHistory ? (
                <div className="text-slate-500 text-sm animate-pulse py-2">Loading history...</div>
              ) : quotationHistory.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Approval History</h4>
                  <div className="space-y-2">
                    {quotationHistory.map((h: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-slate-700/30 border border-white/5 rounded-xl">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${h.action === 'APPROVE' ? 'bg-emerald-400' : h.action === 'REJECT' ? 'bg-rose-400' : 'bg-blue-400'}`} />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-white">{h.action ?? h.event ?? '-'}</p>
                            <span className="text-xs text-slate-500">{h.createdAt ? new Date(h.createdAt).toLocaleDateString() : '-'}</span>
                          </div>
                          {h.comments && <p className="text-xs text-slate-400 mt-0.5 italic">"{h.comments}"</p>}
                          {h.approverName && <p className="text-xs text-slate-500 mt-0.5">By: {h.approverName}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/10 flex-shrink-0 flex justify-end">
              <button
                onClick={() => setViewQuotation(null)}
                className="px-6 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-medium transition-all text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
