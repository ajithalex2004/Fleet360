'use client';

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CreditCard, FileText, Plus, Receipt, ShieldAlert, X } from 'lucide-react';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Invoice {
  id: string;
  invoiceNo: string;
  agreementId: string;
  customerId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  agreementNo: string;
  parentInvoiceId?: string;
  parentInvoiceNo?: string;
  invoiceType: string;
  invoiceDate: string;
  dueDate: string;
  periodFrom?: string;
  periodTo?: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: string;
  notes?: string;
  createdAt: string;
}

interface LineItem {
  id: string;
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitLabel: string;
  taxable: boolean;
  amount: number;
}

interface Payment {
  id: string;
  receiptNo: string;
  paymentDate: string;
  amount: number;
  paymentMethod: string;
  referenceNo?: string;
  notes?: string;
}

interface CreditNoteSummary {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  notes?: string;
}

interface PreAuthHold {
  id: string;
  authCode: string;
  customerId: string;
  customerName: string;
  bookingId?: string;
  bookingRef?: string;
  agreementId?: string;
  agreementNo?: string;
  cardBrand: string;
  cardLast4: string;
  cardholderName: string;
  currency: string;
  amount: number;
  capturedAmount: number;
  status: string;
  expiresAt?: string;
  createdAt: string;
  notes?: string;
}

interface CustomerOption {
  id: string;
  label: string;
}

interface AgreementOption {
  id: string;
  agreementNo: string;
  customerId: string;
  customerName: string;
  bookingId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const fmt = (n: unknown, c = 'AED') => {
  const val = toNum(n, 0);
  const curr = c && typeof c === 'string' && c.trim().length === 3 ? c.trim().toUpperCase() : 'AED';
  try {
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  } catch {
    return `${curr} ${val.toFixed(2)}`;
  }
};

const dateStr = (d?: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
};

const isPastDue = (dueDate?: string, status?: string, invoiceType?: string) => {
  if (
    !dueDate ||
    invoiceType === 'CREDIT_NOTE' ||
    ['PAID', 'VOID', 'CANCELLED', 'CREDITED'].includes(status ?? '')
  ) {
    return false;
  }
  const dt = new Date(dueDate);
  return !Number.isNaN(dt.getTime()) && dt < new Date();
};

function normalizeInvoice(raw: Record<string, unknown>): Invoice {
  const agreementObj = (raw.agreement as Record<string, unknown> | undefined) ?? undefined;
  const bookingObj = (agreementObj?.booking as Record<string, unknown> | undefined) ?? undefined;
  const customerObj =
    (raw.customer as Record<string, unknown> | undefined) ??
    (bookingObj?.customer as Record<string, unknown> | undefined);

  const invoiceType = String(raw.invoiceType ?? raw.invoice_type ?? 'STANDARD').toUpperCase();
  const subtotal = toNum(raw.subtotal ?? raw.sub_total, 0);
  const discountAmount = toNum(raw.discountAmount ?? raw.discount_amount, 0);
  const taxRate = toNum(raw.taxRate ?? raw.tax_rate, 5);
  const taxAmount = toNum(
    raw.taxAmount ?? raw.tax_amount ?? raw.vatAmount ?? raw.vat_amount,
    0
  );
  const totalAmount = toNum(
    raw.totalAmount ?? raw.total_amount ?? raw.amount,
    +(subtotal - discountAmount + taxAmount).toFixed(2)
  );
  const paidAmount = toNum(
    raw.paidAmount ?? raw.paid_amount ?? raw.amountPaid ?? raw.amount_paid,
    0
  );
  const balanceFallback =
    invoiceType === 'CREDIT_NOTE' ? 0 : Math.max(0, +(totalAmount - paidAmount).toFixed(2));
  const balanceDue =
    invoiceType === 'CREDIT_NOTE'
      ? 0
      : toNum(raw.balanceDue ?? raw.balance_due, balanceFallback);

  const resolvedCustomerName =
    raw.customerName ??
    raw.customer_name ??
    customerObj?.companyName ??
    customerObj?.company_name ??
    customerObj?.fullName ??
    customerObj?.full_name ??
    customerObj?.name;

  const customerEmailRaw = raw.customerEmail ?? raw.customer_email ?? customerObj?.email;
  const customerPhoneRaw = raw.customerPhone ?? raw.customer_phone ?? customerObj?.phone;
  const parentIdRaw = raw.parentInvoiceId ?? raw.parent_invoice_id;
  const parentNoRaw = raw.parentInvoiceNo ?? raw.parent_invoice_no;

  return {
    id: String(raw.id ?? ''),
    invoiceNo: String(
      raw.invoiceNumber ??
        raw.invoiceNo ??
        raw.invoice_number ??
        raw.invoice_no ??
        `INV-${String(raw.id ?? '').slice(0, 6).toUpperCase()}`
    ),
    agreementId: String(raw.agreementId ?? raw.agreement_id ?? agreementObj?.id ?? ''),
    customerId: String(raw.customerId ?? raw.customer_id ?? customerObj?.id ?? ''),
    customerName:
      resolvedCustomerName && String(resolvedCustomerName).trim()
        ? String(resolvedCustomerName).trim()
        : '—',
    customerEmail:
      customerEmailRaw && String(customerEmailRaw).trim()
        ? String(customerEmailRaw).trim()
        : undefined,
    customerPhone:
      customerPhoneRaw && String(customerPhoneRaw).trim()
        ? String(customerPhoneRaw).trim()
        : undefined,
    agreementNo: String(
      raw.agreementNo ??
        raw.agreement_no ??
        agreementObj?.agreementNo ??
        agreementObj?.agreement_no ??
        '—'
    ),
    parentInvoiceId:
      parentIdRaw && String(parentIdRaw).trim() ? String(parentIdRaw).trim() : undefined,
    parentInvoiceNo:
      parentNoRaw && String(parentNoRaw).trim() ? String(parentNoRaw).trim() : undefined,
    invoiceType,
    invoiceDate: String(
      raw.invoiceDate ??
        raw.invoice_date ??
        raw.issueDate ??
        raw.issue_date ??
        raw.createdAt ??
        raw.created_at ??
        ''
    ),
    dueDate: String(raw.dueDate ?? raw.due_date ?? ''),
    periodFrom: raw.periodFrom
      ? String(raw.periodFrom)
      : raw.period_from
        ? String(raw.period_from)
        : undefined,
    periodTo: raw.periodTo
      ? String(raw.periodTo)
      : raw.period_to
        ? String(raw.period_to)
        : undefined,
    currency: String(raw.currency ?? 'AED') || 'AED',
    subtotal,
    discountAmount,
    taxableAmount: toNum(raw.taxableAmount ?? raw.taxable_amount, subtotal - discountAmount),
    taxRate,
    taxAmount,
    totalAmount,
    paidAmount,
    balanceDue,
    status: String(raw.status ?? 'DRAFT').toUpperCase(),
    notes: raw.notes ? String(raw.notes) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
  };
}

function normalizeLineItem(raw: Record<string, unknown>, idx: number): LineItem {
  const quantity = toNum(raw.quantity ?? raw.qty, 1);
  const unitPrice = toNum(raw.unitPrice ?? raw.unit_price ?? raw.rate, 0);
  const amount = toNum(
    raw.amount ?? raw.lineTotal ?? raw.line_total ?? raw.total,
    +(quantity * unitPrice).toFixed(2)
  );
  return {
    id: String(raw.id ?? `li-${idx}`),
    lineType: String(raw.lineType ?? raw.line_type ?? 'CHARGE'),
    description: String(raw.description ?? raw.label ?? 'Rental Charge'),
    quantity,
    unitPrice,
    unitLabel: String(raw.unitLabel ?? raw.unit_label ?? 'unit'),
    taxable: raw.taxable !== false,
    amount,
  };
}

function normalizePayment(raw: Record<string, unknown>, idx: number): Payment {
  return {
    id: String(raw.id ?? `pay-${idx}`),
    receiptNo: String(
      raw.receiptNo ??
        raw.receipt_no ??
        `RCP-${String(raw.id ?? idx).slice(0, 6).toUpperCase()}`
    ),
    paymentDate: String(
      raw.paidAt ??
        raw.paid_at ??
        raw.paymentDate ??
        raw.payment_date ??
        raw.createdAt ??
        raw.created_at ??
        ''
    ),
    amount: toNum(raw.amount, 0),
    paymentMethod: String(raw.paymentMethod ?? raw.payment_method ?? 'CASH'),
    referenceNo: raw.referenceNo
      ? String(raw.referenceNo)
      : raw.reference_no
        ? String(raw.reference_no)
        : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
  };
}

function normalizeCreditNote(raw: Record<string, unknown>, idx: number): CreditNoteSummary {
  return {
    id: String(raw.id ?? `cn-${idx}`),
    invoiceNo: String(
      raw.invoiceNo ??
        raw.invoice_no ??
        raw.invoiceNumber ??
        `RCN-${String(raw.id ?? idx).slice(0, 6).toUpperCase()}`
    ),
    invoiceDate: String(raw.invoiceDate ?? raw.invoice_date ?? raw.createdAt ?? raw.created_at ?? ''),
    subtotal: toNum(raw.subtotal, 0),
    taxAmount: toNum(raw.taxAmount ?? raw.tax_amount, 0),
    totalAmount: toNum(raw.totalAmount ?? raw.total_amount, 0),
    status: String(raw.status ?? 'ISSUED').toUpperCase(),
    notes: raw.notes ? String(raw.notes) : undefined,
  };
}

function normalizePreAuthHold(raw: Record<string, unknown>, idx: number): PreAuthHold {
  const customerObj = (raw.customer as Record<string, unknown> | undefined) ?? undefined;
  const bookingObj = (raw.booking as Record<string, unknown> | undefined) ?? undefined;
  const agreementObj = (raw.agreement as Record<string, unknown> | undefined) ?? undefined;

  const custName =
    raw.customerName ??
    raw.customer_name ??
    customerObj?.companyName ??
    customerObj?.company_name ??
    customerObj?.fullName ??
    customerObj?.full_name ??
    raw.cardholderName ??
    raw.cardholder_name;

  return {
    id: String(raw.id ?? `pa-${idx}`),
    authCode: String(
      raw.authCode ??
        raw.auth_code ??
        raw.referenceNo ??
        raw.reference_no ??
        `AUTH-${String(raw.id ?? idx).slice(0, 6).toUpperCase()}`
    ),
    customerId: String(raw.customerId ?? raw.customer_id ?? customerObj?.id ?? ''),
    customerName: custName && String(custName).trim() ? String(custName).trim() : '—',
    bookingId:
      raw.bookingId ?? raw.booking_id ?? bookingObj?.id
        ? String(raw.bookingId ?? raw.booking_id ?? bookingObj?.id)
        : undefined,
    bookingRef:
      raw.bookingRef ?? raw.booking_ref ?? bookingObj?.bookingRef ?? bookingObj?.booking_ref
        ? String(
            raw.bookingRef ?? raw.booking_ref ?? bookingObj?.bookingRef ?? bookingObj?.booking_ref
          )
        : undefined,
    agreementId:
      raw.agreementId ?? raw.agreement_id ?? agreementObj?.id
        ? String(raw.agreementId ?? raw.agreement_id ?? agreementObj?.id)
        : undefined,
    agreementNo:
      raw.agreementNo ?? raw.agreement_no ?? agreementObj?.agreementNo ?? agreementObj?.agreement_no
        ? String(
            raw.agreementNo ??
              raw.agreement_no ??
              agreementObj?.agreementNo ??
              agreementObj?.agreement_no
          )
        : undefined,
    cardBrand: String(raw.cardBrand ?? raw.card_brand ?? 'CARD').toUpperCase(),
    cardLast4: String(raw.cardLast4 ?? raw.card_last4 ?? raw.last4 ?? '0000'),
    cardholderName: String(raw.cardholderName ?? raw.cardholder_name ?? custName ?? '—'),
    currency: String(raw.currency ?? 'AED') || 'AED',
    amount: toNum(raw.amount ?? raw.holdAmount ?? raw.hold_amount, 0),
    capturedAmount: toNum(raw.capturedAmount ?? raw.captured_amount, 0),
    status: String(raw.status ?? 'AUTHORIZED').toUpperCase(),
    expiresAt:
      raw.expiresAt ?? raw.expires_at ? String(raw.expiresAt ?? raw.expires_at) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    notes: raw.notes ? String(raw.notes) : undefined,
  };
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT:               'bg-[var(--bg-surface-hover)]/50 text-[var(--text-muted)]',
  ISSUED:              'bg-blue-500/20 text-blue-300',
  SENT:                'bg-blue-500/20 text-blue-300',
  UNPAID:              'bg-blue-500/20 text-blue-300',
  PARTIALLY_PAID:      'bg-amber-500/20 text-amber-300',
  PAID:                'bg-emerald-500/20 text-emerald-300',
  OVERDUE:             'bg-red-500/20 text-red-300',
  PARTIALLY_CREDITED:  'bg-purple-500/20 text-purple-300',
  CREDITED:            'bg-purple-500/20 text-purple-300',
  VOID:                'bg-[var(--bg-surface-hover)]/50 text-[var(--text-faint)]',
  CANCELLED:           'bg-[var(--bg-surface-hover)]/50 text-[var(--text-faint)]',
};

const PREAUTH_STATUS_COLORS: Record<string, string> = {
  AUTHORIZED:          'bg-cyan-500/20 text-cyan-300',
  ACTIVE:              'bg-cyan-500/20 text-cyan-300',
  HELD:                'bg-cyan-500/20 text-cyan-300',
  PARTIALLY_CAPTURED:  'bg-amber-500/20 text-amber-300',
  CAPTURED:            'bg-emerald-500/20 text-emerald-300',
  RELEASED:            'bg-slate-500/20 text-slate-300',
  EXPIRED:             'bg-rose-500/20 text-rose-300',
  CANCELLED:           'bg-[var(--bg-surface-hover)]/50 text-[var(--text-faint)]',
};

const TYPE_COLORS: Record<string, string> = {
  STANDARD:     'bg-blue-500/15 text-blue-300',
  RETURN:       'bg-teal-500/15 text-teal-300',
  EXTENSION:    'bg-cyan-500/15 text-cyan-300',
  PRE_BILLING:  'bg-purple-500/15 text-purple-300',
  MONTHLY:      'bg-teal-500/15 text-teal-300',
  COMBINATION:  'bg-indigo-500/15 text-indigo-300',
  CREDIT_NOTE:  'bg-amber-500/15 text-amber-300',
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function RentalInvoicesInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const agreementIdFilter = searchParams.get('agreementId') ?? '';
  const invoiceNoFilter = searchParams.get('invoiceNo') ?? '';
  const invoiceIdParam = searchParams.get('id') ?? '';
  const tabParam = searchParams.get('tab') ?? '';

  const [activeTab, setActiveTab] = useState<'invoices' | 'preauth'>(
    tabParam === 'preauth' ? 'preauth' : 'invoices'
  );

  useEffect(() => {
    if (tabParam === 'preauth') {
      setActiveTab('preauth');
    }
  }, [tabParam]);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [rbacBanner, setRbacBanner] = useState('');

  // Detail drawer
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [detail, setDetail] = useState<{
    lineItems: LineItem[];
    payments: Payment[];
    creditNotes: CreditNoteSummary[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const autoOpenedKeyRef = useRef('');

  // Payment modal
  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: '',
    paymentMethod: 'CASH',
    referenceNo: '',
    notes: '',
  });
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');

  // Void / Credit Note modal
  const [voidModal, setVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidError, setVoidError] = useState('');

  // Pre-Auth Holds state
  const [preauths, setPreauths] = useState<PreAuthHold[]>([]);
  const [preauthLoading, setPreauthLoading] = useState(false);
  const [preauthStatusFilter, setPreauthStatusFilter] = useState('');
  const [newPreauthModal, setNewPreauthModal] = useState(false);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [agreementOptions, setAgreementOptions] = useState<AgreementOption[]>([]);
  const [newPreauthForm, setNewPreauthForm] = useState({
    customerId: '',
    agreementId: '',
    bookingId: '',
    amount: '1500',
    cardBrand: 'VISA',
    cardLast4: '',
    cardholderName: '',
    notes: '',
  });
  const [newPreauthSaving, setNewPreauthSaving] = useState(false);
  const [newPreauthError, setNewPreauthError] = useState('');

  // Capture / Release modal
  const [actionHold, setActionHold] = useState<PreAuthHold | null>(null);
  const [holdActionType, setHoldActionType] = useState<'CAPTURE' | 'RELEASE'>('CAPTURE');
  const [captureAmount, setCaptureAmount] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [holdActionLoading, setHoldActionLoading] = useState(false);
  const [holdActionError, setHoldActionError] = useState('');

  const limit = 20;

  // ── Fetch detail ─────────────────────────────────────────────────────────
  const openDetail = useCallback(async (inv: Invoice) => {
    setSelected(inv);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch('/api/rental/invoices/' + encodeURIComponent(inv.id), {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      const invObj = (json?.invoice ?? json) as Record<string, unknown>;
      const rawLineItems = Array.isArray(json?.lineItems)
        ? json.lineItems
        : Array.isArray(invObj?.lineItems)
          ? invObj.lineItems
          : Array.isArray(invObj?.line_items)
            ? invObj.line_items
            : [];
      const rawPayments = Array.isArray(json?.payments)
        ? json.payments
        : Array.isArray(invObj?.payments)
          ? invObj.payments
          : [];
      const rawCreditNotes = Array.isArray(json?.creditNotes)
        ? json.creditNotes
        : Array.isArray(invObj?.creditNotes)
          ? invObj.creditNotes
          : Array.isArray(invObj?.credit_notes)
            ? invObj.credit_notes
            : [];

      setDetail({
        lineItems: (rawLineItems as Record<string, unknown>[]).map(normalizeLineItem),
        payments: (rawPayments as Record<string, unknown>[]).map(normalizePayment),
        creditNotes: (rawCreditNotes as Record<string, unknown>[]).map(normalizeCreditNote),
      });
      if (invObj?.id) {
        setSelected(normalizeInvoice(invObj));
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetailById = useCallback(
    async (id: string) => {
      const existingMatch = invoices.find(i => i.id === id);
      if (existingMatch) {
        openDetail(existingMatch);
        return;
      }
      setDetailLoading(true);
      try {
        const res = await fetch('/api/rental/invoices/' + encodeURIComponent(id), {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        const invObj = (json?.invoice ?? json) as Record<string, unknown>;
        if (!invObj?.id) return;
        const normalized = normalizeInvoice(invObj);
        setSelected(normalized);
        const rawLineItems = Array.isArray(json?.lineItems)
          ? json.lineItems
          : Array.isArray(invObj?.lineItems)
            ? invObj.lineItems
            : [];
        const rawPayments = Array.isArray(json?.payments)
          ? json.payments
          : Array.isArray(invObj?.payments)
            ? invObj.payments
            : [];
        const rawCreditNotes = Array.isArray(json?.creditNotes)
          ? json.creditNotes
          : Array.isArray(invObj?.creditNotes)
            ? invObj.creditNotes
            : [];
        setDetail({
          lineItems: (rawLineItems as Record<string, unknown>[]).map(normalizeLineItem),
          payments: (rawPayments as Record<string, unknown>[]).map(normalizePayment),
          creditNotes: (rawCreditNotes as Record<string, unknown>[]).map(normalizeCreditNote),
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [invoices, openDetail]
  );

  // ── Fetch invoices list ──────────────────────────────────────────────────
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterStatus) sp.set('status', filterStatus);
      if (filterType) sp.set('invoiceType', filterType);
      if (overdue) sp.set('overdue', 'true');
      if (agreementIdFilter) sp.set('agreementId', agreementIdFilter);
      if (invoiceNoFilter) {
        sp.set('invoiceNo', invoiceNoFilter);
        sp.set('search', invoiceNoFilter);
      }

      const res = await fetch('/api/rental/invoices?' + sp.toString(), { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      const rawRows = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.invoices)
            ? json.invoices
            : [];
      let mapped = (rawRows as Record<string, unknown>[]).map(normalizeInvoice);
      if (invoiceNoFilter) {
        const exact = mapped.filter(
          inv => inv.invoiceNo.toLowerCase().includes(invoiceNoFilter.toLowerCase())
        );
        if (exact.length > 0) {
          mapped = exact;
        }
      }
      setInvoices(mapped);
      setTotal(toNum(json?.total ?? json?.pagination?.total, mapped.length));
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterType, overdue, agreementIdFilter, invoiceNoFilter]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Auto-open invoice drawer when deep-linked via ?id=, ?invoiceNo=, or single ?agreementId= match
  useEffect(() => {
    const deepKey = `${invoiceIdParam}|${invoiceNoFilter}|${agreementIdFilter}`;
    if (!invoiceIdParam && !invoiceNoFilter && !agreementIdFilter) return;
    if (autoOpenedKeyRef.current === deepKey) return;

    if (invoiceIdParam) {
      autoOpenedKeyRef.current = deepKey;
      openDetailById(invoiceIdParam);
      return;
    }

    if (invoices.length === 0) return;

    if (invoiceNoFilter) {
      const match = invoices.find(
        i => i.invoiceNo.toLowerCase() === invoiceNoFilter.toLowerCase()
      ) ?? invoices[0];
      if (match) {
        autoOpenedKeyRef.current = deepKey;
        openDetail(match);
      }
      return;
    }

    if (agreementIdFilter && invoices.length === 1) {
      autoOpenedKeyRef.current = deepKey;
      openDetail(invoices[0]);
    }
  }, [invoiceIdParam, invoiceNoFilter, agreementIdFilter, invoices, openDetail, openDetailById]);

  // ── Fetch Pre-Auth Holds ─────────────────────────────────────────────────
  const fetchPreauths = useCallback(async () => {
    setPreauthLoading(true);
    try {
      const sp = new URLSearchParams({ limit: '100' });
      if (preauthStatusFilter) sp.set('status', preauthStatusFilter);
      if (agreementIdFilter) sp.set('agreementId', agreementIdFilter);
      const res = await fetch('/api/rental/preauth?' + sp.toString(), { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setRbacBanner(String(json?.error ?? 'Insufficient permissions to view card pre-auth holds.'));
        return;
      }
      const rawRows = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.preauths)
            ? json.preauths
            : Array.isArray(json?.holds)
              ? json.holds
              : [];
      const mapped = (rawRows as Record<string, unknown>[]).map(normalizePreAuthHold);
      setPreauths(
        preauthStatusFilter
          ? mapped.filter(h => h.status === preauthStatusFilter)
          : mapped
      );
    } finally {
      setPreauthLoading(false);
    }
  }, [preauthStatusFilter, agreementIdFilter]);

  useEffect(() => {
    fetchPreauths();
  }, [fetchPreauths]);

  const openNewPreauthModal = async () => {
    setNewPreauthError('');
    setNewPreauthModal(true);
    try {
      const [cRes, aRes] = await Promise.all([
        fetch('/api/rental/customers?limit=100', { cache: 'no-store' }),
        fetch('/api/rental/agreements?status=ACTIVE&limit=100', { cache: 'no-store' }),
      ]);
      if (cRes.ok) {
        const cJson = await cRes.json().catch(() => ({}));
        const cList = Array.isArray(cJson) ? cJson : Array.isArray(cJson?.data) ? cJson.data : [];
        setCustomerOptions(
          (cList as Record<string, unknown>[]).map(c => ({
            id: String(c.id ?? ''),
            label: String(c.companyName ?? c.fullName ?? c.name ?? c.id ?? ''),
          }))
        );
      }
      if (aRes.ok) {
        const aJson = await aRes.json().catch(() => ({}));
        const aList = Array.isArray(aJson) ? aJson : Array.isArray(aJson?.data) ? aJson.data : [];
        setAgreementOptions(
          (aList as Record<string, unknown>[]).map(a => {
            const booking = (a.booking as Record<string, unknown> | undefined) ?? undefined;
            const cust = (booking?.customer as Record<string, unknown> | undefined) ?? undefined;
            return {
              id: String(a.id ?? ''),
              agreementNo: String(a.agreementNo ?? a.agreement_no ?? a.id ?? ''),
              customerId: String(a.customerId ?? a.customer_id ?? cust?.id ?? ''),
              customerName: String(
                a.customerName ?? a.customer_name ?? cust?.companyName ?? cust?.fullName ?? ''
              ),
              bookingId: a.bookingId ? String(a.bookingId) : undefined,
            };
          })
        );
      }
    } catch {
      /* ignore lookup failure */
    }
  };

  const createPreauthHold = async () => {
    const amt = Number(newPreauthForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setNewPreauthError('Enter a valid positive hold amount');
      return;
    }
    const last4 = newPreauthForm.cardLast4.trim();
    if (!/^\d{4}$/.test(last4)) {
      setNewPreauthError('Enter the 4-digit card ending (e.g. 4242)');
      return;
    }
    if (!newPreauthForm.customerId.trim() && !newPreauthForm.agreementId.trim()) {
      setNewPreauthError('Select a customer or active agreement');
      return;
    }
    setNewPreauthSaving(true);
    setNewPreauthError('');
    setRbacBanner('');
    try {
      const res = await fetch('/api/rental/preauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: newPreauthForm.customerId || undefined,
          agreementId: newPreauthForm.agreementId || undefined,
          bookingId: newPreauthForm.bookingId || undefined,
          amount: amt,
          cardBrand: newPreauthForm.cardBrand,
          cardLast4: last4,
          cardholderName: newPreauthForm.cardholderName.trim() || undefined,
          notes: newPreauthForm.notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = String(json?.error ?? 'Requires counter operator or manager permission.');
        setNewPreauthError(`Requires permission (403): ${msg}`);
        setRbacBanner(msg);
        return;
      }
      if (!res.ok) {
        setNewPreauthError(String(json?.error ?? 'Failed to authorize pre-auth hold'));
        return;
      }
      setNewPreauthModal(false);
      setNewPreauthForm({
        customerId: '',
        agreementId: '',
        bookingId: '',
        amount: '1500',
        cardBrand: 'VISA',
        cardLast4: '',
        cardholderName: '',
        notes: '',
      });
      fetchPreauths();
    } finally {
      setNewPreauthSaving(false);
    }
  };

  const submitHoldAction = async () => {
    if (!actionHold) return;
    if (holdActionType === 'CAPTURE') {
      const amt = Number(captureAmount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setHoldActionError('Enter a valid capture amount greater than 0');
        return;
      }
    }
    setHoldActionLoading(true);
    setHoldActionError('');
    setRbacBanner('');
    try {
      const payload =
        holdActionType === 'CAPTURE'
          ? { action: 'CAPTURE', amount: Number(captureAmount) }
          : {
              action: 'RELEASE',
              reason: releaseReason.trim() || 'Deposit released upon vehicle return',
            };
      const res = await fetch('/api/rental/preauth/' + encodeURIComponent(actionHold.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = String(
          json?.error ?? 'Requires RAC Manager or counter settlement permission.'
        );
        setHoldActionError(`Requires permission (403): ${msg}`);
        setRbacBanner(msg);
        return;
      }
      if (!res.ok) {
        setHoldActionError(String(json?.error ?? `Failed to ${holdActionType.toLowerCase()} hold`));
        return;
      }
      setActionHold(null);
      setCaptureAmount('');
      setReleaseReason('');
      fetchPreauths();
    } finally {
      setHoldActionLoading(false);
    }
  };

  // ── Record payment ───────────────────────────────────────────────────────
  const recordPayment = async () => {
    if (!selected) return;
    if (!payForm.amount || Number(payForm.amount) <= 0) {
      setPayError('Enter a valid payment amount greater than 0');
      return;
    }
    setPayLoading(true);
    setPayError('');
    setRbacBanner('');
    try {
      const res = await fetch('/api/rental/invoices/' + selected.id + '/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(payForm.amount),
          paymentMethod: payForm.paymentMethod,
          referenceNo: payForm.referenceNo,
          notes: payForm.notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = String(
          json?.error ?? 'Requires RAC Manager or authorized billing permission to record payments.'
        );
        setPayError(`Requires RAC Manager permission (403): ${msg}`);
        setRbacBanner(msg);
        return;
      }
      if (!res.ok) {
        setPayError(String(json?.error ?? 'Payment failed'));
        return;
      }
      setPayModal(false);
      setPayForm({ amount: '', paymentMethod: 'CASH', referenceNo: '', notes: '' });
      const nextInv = json?.invoice
        ? normalizeInvoice(json.invoice as Record<string, unknown>)
        : selected;
      openDetail(nextInv);
      fetchInvoices();
    } finally {
      setPayLoading(false);
    }
  };

  // ── Issue Credit Note / Void invoice ─────────────────────────────────────
  const voidInvoice = async () => {
    if (!selected || !voidReason.trim()) return;
    const trimmedCredit = creditAmount.trim();
    if (trimmedCredit) {
      const parsed = Number(trimmedCredit);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setVoidError('Credit amount must be greater than 0 (or leave blank for full reversal)');
        return;
      }
    }
    setVoidLoading(true);
    setVoidError('');
    setRbacBanner('');
    try {
      const bodyPayload: Record<string, unknown> = { reason: voidReason.trim() };
      if (trimmedCredit && Number(trimmedCredit) > 0) {
        bodyPayload.creditAmount = Number(trimmedCredit);
      }
      const res = await fetch('/api/rental/invoices/' + selected.id + '/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) {
        const msg = String(
          json?.error ??
            'Requires RAC Manager permission — Operators cannot void or credit customer invoices.'
        );
        setVoidError(`Requires RAC Manager permission (403): ${msg}`);
        setRbacBanner(msg);
        return;
      }
      if (!res.ok) {
        setVoidError(String(json?.error ?? 'Failed to issue credit note / void invoice'));
        return;
      }
      setVoidModal(false);
      setVoidReason('');
      setCreditAmount('');
      setVoidError('');
      const nextInv = json?.invoice
        ? normalizeInvoice(json.invoice as Record<string, unknown>)
        : selected;
      openDetail(nextInv);
      fetchInvoices();
    } finally {
      setVoidLoading(false);
    }
  };

  // ── Send invoice ─────────────────────────────────────────────────────────
  const sendInvoice = async () => {
    if (!selected) return;
    setRbacBanner('');
    const res = await fetch('/api/rental/invoices/' + selected.id + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'EMAIL' }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 403) {
      setRbacBanner(String(json?.error ?? 'Requires RAC Manager permission to dispatch invoices.'));
      return;
    }
    if (res.ok) {
      const nextInv = json?.invoice
        ? normalizeInvoice(json.invoice as Record<string, unknown>)
        : selected;
      openDetail(nextInv);
      fetchInvoices();
    }
  };

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = {
    draft: invoices.filter(i => i.status === 'DRAFT').length,
    sent: invoices.filter(i => ['SENT', 'ISSUED', 'UNPAID'].includes(i.status)).length,
    overdue: invoices.filter(
      i => i.status === 'OVERDUE' || isPastDue(i.dueDate, i.status, i.invoiceType)
    ).length,
    totalDue: invoices.reduce((s, i) => s + toNum(i.balanceDue, 0), 0),
  };

  const preauthStats = {
    authorizedCount: preauths.filter(h => ['AUTHORIZED', 'ACTIVE', 'HELD'].includes(h.status)).length,
    heldTotal: preauths
      .filter(h => ['AUTHORIZED', 'ACTIVE', 'HELD'].includes(h.status))
      .reduce((s, h) => s + h.amount, 0),
    capturedTotal: preauths
      .filter(h => ['CAPTURED', 'PARTIALLY_CAPTURED'].includes(h.status))
      .reduce((s, h) => s + (h.capturedAmount || h.amount), 0),
    releasedCount: preauths.filter(h => h.status === 'RELEASED').length,
  };

  const hasDeepFilter = Boolean(agreementIdFilter || invoiceNoFilter || invoiceIdParam);
  const selectedIsCreditNote = selected?.invoiceType === 'CREDIT_NOTE';
  const selectedIsTerminal =
    selected != null &&
    (['VOID', 'CANCELLED', 'CREDITED'].includes(selected.status) || selectedIsCreditNote);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col xl:flex-row h-full gap-6">
      {/* LEFT: Main List */}
      <div
        className={`flex flex-col space-y-5 transition-all ${
          activeTab === 'invoices' && selected ? 'xl:w-3/5' : 'w-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-main)]">
              Rental Invoices &amp; Pre-Auths
            </h1>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">
              Customer tax invoices, UAE FTA credit notes (RCN-), payment receipts &amp; card pre-authorization holds
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {hasDeepFilter && (
              <button
                onClick={() => {
                  autoOpenedKeyRef.current = '';
                  router.push('/rental/invoices');
                }}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 transition-colors"
              >
                <span>
                  {invoiceNoFilter
                    ? `Invoice: ${invoiceNoFilter}`
                    : agreementIdFilter
                      ? 'Filtered by Agreement'
                      : 'Filtered by Invoice'}
                </span>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* View Tabs: Invoices vs Card Pre-Auth Holds */}
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('invoices')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              activeTab === 'invoices'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-[var(--bg-surface)]/60 text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-main)]'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Tax Invoices &amp; Credit Notes ({total})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preauth')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              activeTab === 'preauth'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-[var(--bg-surface)]/60 text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-main)]'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Card Pre-Auth Holds ({preauths.length})</span>
          </button>
        </div>

        {/* 403 RBAC Banner */}
        {rbacBanner && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3.5 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-300">
                  Requires RAC Manager Permission (403)
                </p>
                <p className="text-xs text-amber-200/80 mt-0.5">{rbacBanner}</p>
              </div>
            </div>
            <button
              onClick={() => setRbacBanner('')}
              className="text-amber-300/70 hover:text-amber-200 text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {activeTab === 'invoices' ? (
          <>
            {/* Stats */}
            <StatGrid cols={4}>
              <KpiCard label="Draft" value={stats.draft} accent="slate" />
              <KpiCard label="Issued / Sent" value={stats.sent} accent="cyan" />
              <KpiCard label="Overdue" value={stats.overdue} accent="rose" />
              <KpiCard label="Total Balance Due" value={fmt(stats.totalDue)} accent="emerald" />
            </StatGrid>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap items-center">
              <select
                value={filterStatus}
                onChange={e => {
                  setFilterStatus(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              >
                <option value="">All Statuses</option>
                {[
                  'DRAFT',
                  'ISSUED',
                  'SENT',
                  'UNPAID',
                  'PARTIALLY_PAID',
                  'PAID',
                  'OVERDUE',
                  'PARTIALLY_CREDITED',
                  'CREDITED',
                  'VOID',
                  'CANCELLED',
                ].map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={filterType}
                onChange={e => {
                  setFilterType(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
              >
                <option value="">All Types</option>
                {[
                  'STANDARD',
                  'RETURN',
                  'EXTENSION',
                  'PRE_BILLING',
                  'MONTHLY',
                  'COMBINATION',
                  'CREDIT_NOTE',
                ].map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={overdue}
                  onChange={e => {
                    setOverdue(e.target.checked);
                    setPage(1);
                  }}
                  className="accent-red-500"
                />
                Overdue only
              </label>
              <span className="ml-auto text-[var(--text-muted)] text-sm self-center">
                {total} invoice{total !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Table */}
            <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl overflow-x-auto flex-1">
              {loading ? (
                <div className="p-12 text-center text-[var(--text-muted)]">Loading…</div>
              ) : invoices.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-[var(--text-muted)] text-lg">No invoices found</p>
                </div>
              ) : (
                <table className="w-full text-sm min-w-[780px]">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                      <th className="px-4 py-3 text-left">Invoice #</th>
                      <th className="px-4 py-3 text-left">Customer</th>
                      <th className="px-4 py-3 text-left">Agreement</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Due</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Paid</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(inv => (
                      <tr
                        key={inv.id}
                        onClick={() => openDetail(inv)}
                        className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] cursor-pointer transition ${
                          selected?.id === inv.id ? 'bg-blue-500/10' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-blue-300 font-medium text-xs whitespace-nowrap">
                          {inv.invoiceNo}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-main)] text-xs font-medium">
                          {inv.customerName || '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-[var(--text-muted)] text-xs whitespace-nowrap">
                          {inv.agreementNo || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              TYPE_COLORS[inv.invoiceType] ??
                              'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
                            }`}
                          >
                            {inv.invoiceType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-muted)] text-xs whitespace-nowrap">
                          {dateStr(inv.invoiceDate)}
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          <span
                            className={
                              isPastDue(inv.dueDate, inv.status, inv.invoiceType)
                                ? 'text-red-400 font-medium'
                                : 'text-[var(--text-muted)]'
                            }
                          >
                            {dateStr(inv.dueDate)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--text-main)] text-xs whitespace-nowrap">
                          {fmt(inv.totalAmount, inv.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-400 text-xs whitespace-nowrap">
                          {fmt(inv.paidAmount, inv.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                          <span className={inv.balanceDue > 0 ? 'text-amber-300' : 'text-emerald-400'}>
                            {fmt(inv.balanceDue, inv.currency)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              STATUS_COLORS[inv.status] ??
                              'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 text-sm"
                >
                  ← Prev
                </button>
                <span className="text-[var(--text-muted)] text-sm">
                  Page {page} of {Math.ceil(total / limit)}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * limit >= total}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 text-sm"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        ) : (
          /* ═══════════════════════════════════════════════════════════════════
             CARD PRE-AUTH HOLDS TAB
             ═══════════════════════════════════════════════════════════════════ */
          <>
            <StatGrid cols={4}>
              <KpiCard label="Active Holds" value={preauthStats.authorizedCount} accent="cyan" />
              <KpiCard label="Total Deposit Held" value={fmt(preauthStats.heldTotal)} accent="violet" />
              <KpiCard label="Captured Total" value={fmt(preauthStats.capturedTotal)} accent="emerald" />
              <KpiCard label="Released Holds" value={preauthStats.releasedCount} accent="slate" />
            </StatGrid>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <select
                  value={preauthStatusFilter}
                  onChange={e => setPreauthStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                >
                  <option value="">All Hold Statuses</option>
                  {['AUTHORIZED', 'PARTIALLY_CAPTURED', 'CAPTURED', 'RELEASED', 'EXPIRED'].map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={openNewPreauthModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>New Pre-Auth Hold</span>
              </button>
            </div>

            <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl overflow-x-auto flex-1">
              {preauthLoading ? (
                <div className="p-12 text-center text-[var(--text-muted)]">Loading pre-auth holds…</div>
              ) : preauths.length === 0 ? (
                <div className="p-12 text-center space-y-2">
                  <p className="text-[var(--text-muted)] text-base">
                    No card pre-authorization holds found
                  </p>
                  <p className="text-xs text-[var(--text-faint)]">
                    Authorize security deposit holds here or directly at the Counter Pick-Up Desk.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm min-w-[780px]">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                      <th className="px-4 py-3 text-left">Auth Code</th>
                      <th className="px-4 py-3 text-left">Customer</th>
                      <th className="px-4 py-3 text-left">Ref</th>
                      <th className="px-4 py-3 text-left">Card</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-right">Hold Amount</th>
                      <th className="px-4 py-3 text-right">Captured</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preauths.map(hold => {
                      const canSettle = ['AUTHORIZED', 'ACTIVE', 'HELD', 'PARTIALLY_CAPTURED'].includes(
                        hold.status
                      );
                      const remainingHold = Math.max(0, +(hold.amount - hold.capturedAmount).toFixed(2));
                      return (
                        <tr
                          key={hold.id}
                          className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition"
                        >
                          <td className="px-4 py-3 font-mono text-cyan-300 font-medium text-xs whitespace-nowrap">
                            {hold.authCode}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-main)] text-xs font-medium">
                            {hold.customerName}
                          </td>
                          <td className="px-4 py-3 font-mono text-[var(--text-muted)] text-xs whitespace-nowrap">
                            {hold.agreementNo ?? hold.bookingRef ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--text-muted)] font-mono whitespace-nowrap">
                            {hold.cardBrand} •••• {hold.cardLast4}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">
                            {dateStr(hold.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--text-main)] text-xs whitespace-nowrap">
                            {fmt(hold.amount, hold.currency)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-400 text-xs whitespace-nowrap">
                            {fmt(hold.capturedAmount, hold.currency)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                PREAUTH_STATUS_COLORS[hold.status] ??
                                'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
                              }`}
                            >
                              {hold.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {canSettle ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionHold(hold);
                                    setHoldActionType('CAPTURE');
                                    setCaptureAmount(String(remainingHold || hold.amount));
                                    setHoldActionError('');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-medium"
                                >
                                  Capture
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionHold(hold);
                                    setHoldActionType('RELEASE');
                                    setReleaseReason('');
                                    setHoldActionError('');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-500/20 text-slate-300 hover:bg-slate-500/30 border border-slate-500/30 text-xs font-medium"
                                >
                                  Release
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--text-faint)]">Settled</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* RIGHT: Invoice Detail Drawer */}
      {activeTab === 'invoices' && selected && (
        <div className="xl:w-2/5 flex flex-col space-y-4 bg-[var(--bg-surface)]/80 border border-[var(--border-subtle)] rounded-2xl p-5 overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-[var(--text-muted)]">
                {selectedIsCreditNote ? 'UAE FTA Tax Credit Note' : 'Tax Invoice'}
              </p>
              <p className="text-lg font-bold text-[var(--text-main)] font-mono">
                {selected.invoiceNo}
              </p>
              {selected.customerName && selected.customerName !== '—' && (
                <p className="text-xs text-[var(--text-main)] font-medium mt-0.5">
                  Customer: {selected.customerName}
                </p>
              )}
              {(selected.customerEmail || selected.customerPhone) && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {[selected.customerEmail, selected.customerPhone].filter(Boolean).join(' · ')}
                </p>
              )}
              {selected.agreementNo && selected.agreementNo !== '—' && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">
                  Agreement: {selected.agreementNo}
                </p>
              )}
              {selected.parentInvoiceNo && (
                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (selected.parentInvoiceId) {
                        openDetailById(selected.parentInvoiceId);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono hover:bg-amber-500/25"
                  >
                    <FileText className="w-3 h-3" />
                    <span>Reverses Invoice: {selected.parentInvoiceNo}</span>
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Status + type chips */}
          <div className="flex gap-2 flex-wrap">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                STATUS_COLORS[selected.status] ??
                'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
              }`}
            >
              {selected.status}
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                TYPE_COLORS[selected.invoiceType] ??
                'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'
              }`}
            >
              {selected.invoiceType}
            </span>
          </div>

          {/* Key dates */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Invoice Date</p>
              <p className="text-[var(--text-main)]">{dateStr(selected.invoiceDate)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Due Date</p>
              <p
                className={
                  isPastDue(selected.dueDate, selected.status, selected.invoiceType)
                    ? 'text-red-400 font-semibold'
                    : 'text-[var(--text-main)]'
                }
              >
                {dateStr(selected.dueDate)}
              </p>
            </div>
            {selected.periodFrom && (
              <>
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Period From</p>
                  <p className="text-[var(--text-main)]">{dateStr(selected.periodFrom)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Period To</p>
                  <p className="text-[var(--text-main)]">{dateStr(selected.periodTo)}</p>
                </div>
              </>
            )}
          </div>

          {/* Financial summary */}
          <div className="bg-[var(--bg-surface-hover)]/40 rounded-xl p-4 space-y-2 text-sm">
            {[
              { label: 'Subtotal', value: fmt(selected.subtotal, selected.currency) },
              {
                label: 'Discount',
                value:
                  selected.discountAmount > 0
                    ? '-' + fmt(selected.discountAmount, selected.currency)
                    : null,
              },
              {
                label: `VAT (${toNum(selected.taxRate, 5)}%)`,
                value: fmt(selected.taxAmount, selected.currency),
              },
            ]
              .filter(r => r.value)
              .map(r => (
                <div key={r.label} className="flex justify-between text-[var(--text-muted)]">
                  <span>{r.label}</span>
                  <span className="font-mono">{r.value}</span>
                </div>
              ))}
            <div className="flex justify-between font-bold text-[var(--text-main)] border-t border-[var(--border-subtle)] pt-2 mt-2">
              <span>Total</span>
              <span className="font-mono">{fmt(selected.totalAmount, selected.currency)}</span>
            </div>
            {!selectedIsCreditNote && (
              <>
                <div className="flex justify-between text-emerald-300">
                  <span>Paid</span>
                  <span className="font-mono">{fmt(selected.paidAmount, selected.currency)}</span>
                </div>
                <div
                  className={`flex justify-between font-bold ${
                    selected.balanceDue > 0 ? 'text-amber-300' : 'text-emerald-400'
                  }`}
                >
                  <span>Balance Due</span>
                  <span className="font-mono">{fmt(selected.balanceDue, selected.currency)}</span>
                </div>
              </>
            )}
          </div>

          {/* PDF Actions */}
          <div className="flex gap-2 flex-wrap mb-1">
            <a
              href={`/api/rental/invoices/${selected.id}/pdf?lang=en&download=1`}
              className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-medium"
              title="Download bilingual tax document (EN layout)"
            >
              PDF·EN
            </a>
            <a
              href={`/api/rental/invoices/${selected.id}/pdf?lang=ar&download=1`}
              className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-medium"
              title="Download bilingual tax document (AR layout)"
            >
              PDF·AR
            </a>
          </div>

          {/* Settlement & Credit Note / Void Actions */}
          {!selectedIsTerminal && (
            <div className="flex gap-2 flex-wrap">
              {selected.status !== 'PAID' && selected.balanceDue > 0 && (
                <button
                  onClick={() => {
                    setPayForm(p => ({
                      ...p,
                      amount: String(selected.balanceDue),
                    }));
                    setPayError('');
                    setPayModal(true);
                  }}
                  className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-semibold transition-colors"
                >
                  💳 Record Payment
                </button>
              )}
              {selected.status === 'DRAFT' && (
                <button
                  onClick={sendInvoice}
                  className="flex-1 px-3 py-2 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30 text-xs font-medium"
                >
                  📧 Send Invoice
                </button>
              )}
              <button
                onClick={() => {
                  setVoidReason('');
                  setCreditAmount('');
                  setVoidError('');
                  setVoidModal(true);
                }}
                className="px-3 py-2 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 text-xs font-medium"
              >
                {selected.status === 'DRAFT' ? 'Void Draft' : '🧾 Issue Credit Note / Void'}
              </button>
            </div>
          )}

          {/* Line Items, Payments & Linked Credit Notes */}
          {detailLoading ? (
            <div className="text-[var(--text-muted)] text-sm text-center py-4">
              Loading details…
            </div>
          ) : (
            detail && (
              <>
                {detail.lineItems.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Line Items
                    </h3>
                    <div className="space-y-1">
                      {detail.lineItems.map((li, i) => (
                        <div
                          key={li.id ?? i}
                          className="flex justify-between items-start text-xs py-1.5 border-b border-[var(--border-subtle)]"
                        >
                          <div className="flex-1 pr-4">
                            <p className="text-[var(--text-main)]">{li.description}</p>
                            <p className="text-[var(--text-faint)]">
                              {li.quantity} × {fmt(li.unitPrice, selected.currency)} / {li.unitLabel}
                            </p>
                          </div>
                          <span
                            className={`font-mono font-medium ${
                              li.amount < 0 ? 'text-amber-300' : 'text-[var(--text-main)]'
                            }`}
                          >
                            {fmt(li.amount, selected.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Linked Tax Credit Notes */}
                {detail.creditNotes.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Linked Tax Credit Notes (RCN-)
                    </h3>
                    <div className="space-y-2">
                      {detail.creditNotes.map((cn, idx) => (
                        <div
                          key={cn.id ?? idx}
                          className="flex justify-between items-center gap-2 text-xs bg-purple-500/10 border border-purple-500/25 rounded-lg px-3 py-2"
                        >
                          <div>
                            <button
                              type="button"
                              onClick={() => openDetailById(cn.id)}
                              className="text-purple-300 font-mono font-semibold hover:underline text-left"
                            >
                              {cn.invoiceNo}
                            </button>
                            <p className="text-[var(--text-muted)]">
                              {dateStr(cn.invoiceDate)} · {cn.status}
                            </p>
                            {cn.notes && (
                              <p className="text-[var(--text-faint)] line-clamp-1">{cn.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-purple-300 font-bold font-mono">
                              {fmt(cn.totalAmount, selected.currency)}
                            </span>
                            <a
                              href={`/api/rental/invoices/${cn.id}/pdf?lang=en&download=1`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 rounded bg-purple-500/20 text-purple-200 hover:bg-purple-500/30 border border-purple-500/30 text-[11px] font-medium"
                              title="Download Tax Credit Note PDF"
                            >
                              PDF
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payments */}
                {detail.payments.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Payment History
                    </h3>
                    <div className="space-y-2">
                      {detail.payments.map((p, i) => (
                        <div
                          key={p.id ?? i}
                          className="flex justify-between items-center gap-2 text-xs bg-emerald-500/10 rounded-lg px-3 py-2"
                        >
                          <div>
                            <p className="text-emerald-300 font-medium font-mono">{p.receiptNo}</p>
                            <p className="text-[var(--text-muted)]">
                              {dateStr(p.paymentDate)} · {p.paymentMethod}
                            </p>
                            {p.referenceNo && (
                              <p className="text-[var(--text-faint)]">Ref: {p.referenceNo}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-300 font-bold font-mono">
                              {fmt(p.amount, selected.currency)}
                            </span>
                            <a
                              href={`/api/rental/invoices/${selected.id}/payments/${p.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 border border-emerald-500/30 text-[11px] font-medium whitespace-nowrap"
                              title="Download Official Payment Receipt PDF"
                            >
                              Receipt PDF
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          )}

          {selected.notes && (
            <div className="bg-[var(--bg-surface-hover)]/30 rounded-lg p-3 text-xs text-[var(--text-muted)]">
              <p className="text-[var(--text-faint)] mb-1 font-semibold uppercase tracking-wider text-[10px]">
                Notes
              </p>
              {selected.notes}
            </div>
          )}
        </div>
      )}

      {/* Payment Modal */}
      {payModal && selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-base font-bold text-[var(--text-main)]">Record Payment</h2>
              <button
                onClick={() => setPayModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              {payError && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 text-rose-300 text-xs">
                  {payError}
                </div>
              )}
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Invoice Balance Due</p>
                <p className="text-lg font-bold font-mono text-amber-300">
                  {fmt(selected.balanceDue, selected.currency)}
                </p>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  value={payForm.amount}
                  placeholder="0.00"
                  onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Payment Method
                </label>
                <select
                  value={payForm.paymentMethod}
                  onChange={e => setPayForm(p => ({ ...p, paymentMethod: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                >
                  {[
                    'CASH',
                    'CREDIT_CARD',
                    'DEBIT_CARD',
                    'BANK_TRANSFER',
                    'CHEQUE',
                    'ONLINE',
                    'CORPORATE_ACCOUNT',
                  ].map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Reference / Receipt No.
                </label>
                <input
                  type="text"
                  value={payForm.referenceNo}
                  placeholder="Bank ref, card auth, cheque no., etc."
                  onChange={e => setPayForm(p => ({ ...p, referenceNo: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Notes</label>
                <textarea
                  value={payForm.notes}
                  rows={2}
                  onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setPayModal(false)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-sm"
              >
                Cancel
              </button>
              <button
                onClick={recordPayment}
                disabled={payLoading}
                className="px-6 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                {payLoading ? 'Saving…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue Credit Note / Void Modal */}
      {voidModal && selected && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-base font-bold text-[var(--text-main)]">
                {selected.status === 'DRAFT'
                  ? `Void Draft Invoice ${selected.invoiceNo}`
                  : `Issue Tax Credit Note / Void ${selected.invoiceNo}`}
              </h2>
              <button
                onClick={() => setVoidModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              {voidError && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-amber-300 text-xs">
                  {voidError}
                </div>
              )}
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {selected.status === 'DRAFT'
                  ? 'Draft invoices have not been posted to the VAT ledger and will be marked VOID.'
                  : 'Per UAE FTA VAT compliance, issued or paid tax invoices are reversed by issuing an immutable Tax Credit Note (RCN-) with proportional VAT adjustment.'}
              </p>
              {selected.status !== 'DRAFT' && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Credit Amount ({selected.currency}) — leave blank for full reversal (
                    {fmt(selected.totalAmount, selected.currency)})
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    max={selected.totalAmount}
                    step="0.01"
                    value={creditAmount}
                    onChange={e => setCreditAmount(e.target.value)}
                    placeholder={`Full reversal: ${selected.totalAmount.toFixed(2)}`}
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm font-mono"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">
                  Reason for {selected.status === 'DRAFT' ? 'Voiding' : 'Tax Credit Note'} *
                </label>
                <textarea
                  value={voidReason}
                  rows={3}
                  onChange={e => setVoidReason(e.target.value)}
                  placeholder="e.g. Early return adjustment, duplicate billing, customer goodwill credit…"
                  className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setVoidModal(false)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-sm"
              >
                Cancel
              </button>
              <button
                onClick={voidInvoice}
                disabled={voidLoading || !voidReason.trim()}
                className="px-6 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
              >
                {voidLoading
                  ? 'Processing…'
                  : selected.status === 'DRAFT'
                    ? 'Void Draft'
                    : 'Issue Credit Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Card Pre-Auth Hold Modal */}
      {newPreauthModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-base font-bold text-[var(--text-main)]">
                Authorize Card Pre-Auth Hold
              </h2>
              <button
                onClick={() => setNewPreauthModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              {newPreauthError && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 text-rose-300 text-xs">
                  {newPreauthError}
                </div>
              )}
              {agreementOptions.length > 0 && (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Active Agreement (Optional)
                  </label>
                  <select
                    value={newPreauthForm.agreementId}
                    onChange={e => {
                      const agId = e.target.value;
                      const ag = agreementOptions.find(a => a.id === agId);
                      setNewPreauthForm(f => ({
                        ...f,
                        agreementId: agId,
                        customerId: ag?.customerId || f.customerId,
                        bookingId: ag?.bookingId || f.bookingId,
                        cardholderName: ag?.customerName || f.cardholderName,
                      }));
                    }}
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                  >
                    <option value="">Select agreement…</option>
                    {agreementOptions.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.agreementNo} {a.customerName ? `— ${a.customerName}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Customer *</label>
                {customerOptions.length > 0 ? (
                  <select
                    value={newPreauthForm.customerId}
                    onChange={e => {
                      const cId = e.target.value;
                      const c = customerOptions.find(opt => opt.id === cId);
                      setNewPreauthForm(f => ({
                        ...f,
                        customerId: cId,
                        cardholderName: f.cardholderName || c?.label || '',
                      }));
                    }}
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                  >
                    <option value="">Select customer…</option>
                    {customerOptions.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={newPreauthForm.customerId}
                    onChange={e => setNewPreauthForm(f => ({ ...f, customerId: e.target.value }))}
                    placeholder="Customer ID"
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Hold Amount (AED) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={newPreauthForm.amount}
                    onChange={e => setNewPreauthForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Card Brand *</label>
                  <select
                    value={newPreauthForm.cardBrand}
                    onChange={e => setNewPreauthForm(f => ({ ...f, cardBrand: e.target.value }))}
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                  >
                    {['VISA', 'MASTERCARD', 'AMEX', 'MADA'].map(b => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Card Last 4 Digits *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPreauthForm.cardLast4}
                    onChange={e =>
                      setNewPreauthForm(f => ({
                        ...f,
                        cardLast4: e.target.value.replace(/\D/g, '').slice(0, 4),
                      }))
                    }
                    placeholder="4242"
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Cardholder Name
                  </label>
                  <input
                    type="text"
                    value={newPreauthForm.cardholderName}
                    onChange={e =>
                      setNewPreauthForm(f => ({ ...f, cardholderName: e.target.value }))
                    }
                    placeholder="Name on card"
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setNewPreauthModal(false)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-sm"
              >
                Cancel
              </button>
              <button
                onClick={createPreauthHold}
                disabled={newPreauthSaving}
                className="px-6 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-500 disabled:opacity-50"
              >
                {newPreauthSaving ? 'Authorizing…' : 'Authorize Hold'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Capture / Release Pre-Auth Hold Modal */}
      {actionHold && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
              <h2 className="text-base font-bold text-[var(--text-main)]">
                {holdActionType === 'CAPTURE'
                  ? `Capture Pre-Auth ${actionHold.authCode}`
                  : `Release Pre-Auth ${actionHold.authCode}`}
              </h2>
              <button
                onClick={() => setActionHold(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              {holdActionError && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 text-rose-300 text-xs">
                  {holdActionError}
                </div>
              )}
              <div className="text-xs text-[var(--text-muted)] space-y-1">
                <p>
                  Customer: <span className="text-[var(--text-main)]">{actionHold.customerName}</span>
                </p>
                <p>
                  Held Amount:{' '}
                  <span className="font-mono text-cyan-300">
                    {fmt(actionHold.amount, actionHold.currency)}
                  </span>{' '}
                  ({actionHold.cardBrand} •••• {actionHold.cardLast4})
                </p>
              </div>
              {holdActionType === 'CAPTURE' ? (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Capture Amount ({actionHold.currency}) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    max={actionHold.amount}
                    step="0.01"
                    value={captureAmount}
                    onChange={e => setCaptureAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm font-mono"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Release Notes
                  </label>
                  <textarea
                    rows={2}
                    value={releaseReason}
                    onChange={e => setReleaseReason(e.target.value)}
                    placeholder="e.g. Vehicle returned damage-free, deposit released"
                    className="w-full px-3 py-2 bg-[var(--bg-surface-hover)] border border-[var(--border-strong)] rounded-lg text-[var(--text-main)] text-sm resize-none"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-end p-5 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setActionHold(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submitHoldAction}
                disabled={holdActionLoading}
                className={`px-6 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 ${
                  holdActionType === 'CAPTURE'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-cyan-600 hover:bg-cyan-500'
                }`}
              >
                {holdActionLoading
                  ? 'Processing…'
                  : holdActionType === 'CAPTURE'
                    ? 'Confirm Capture'
                    : 'Confirm Release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RentalInvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-[var(--text-muted)] animate-pulse">
          Loading invoices…
        </div>
      }
    >
      <RentalInvoicesInner />
    </Suspense>
  );
}
