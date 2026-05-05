/**
 * Lease Quotation Workflow State Machine
 * Manages the 11-step sequence from NEW to DELIVERED
 */

export type QuotationStatus =
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

export interface QuotationAction {
  label: string;
  nextStatus: QuotationStatus;
  color: string;
  icon?: string;
  description?: string;
  secondaryAction?: QuotationAction;
}

const QUOTATION_WORKFLOW: Record<string, QuotationAction | null> = {
  NEW: {
    label: 'Send for Approval',
    nextStatus: 'PENDING_APPROVAL',
    color: 'blue',
    description: 'Submit for internal review.',
  },
  PENDING_APPROVAL: {
    label: 'Internal Approve',
    nextStatus: 'DRAFT_APPROVED',
    color: 'emerald',
    description: 'Confirm pricing and internal terms.',
  },
  DRAFT_APPROVED: {
    label: 'Submit Quotation',
    nextStatus: 'SENT_TO_CUSTOMER',
    color: 'indigo',
    description: 'Send the official quotation to the customer.',
  },
  SENT_TO_CUSTOMER: {
    label: 'Mark Customer Approved',
    nextStatus: 'CUSTOMER_APPROVED',
    color: 'emerald',
    description: 'Confirm client has accepted the terms.',
  },
  CUSTOMER_APPROVED: {
    label: 'Send for Credit Approval',
    nextStatus: 'PENDING_CREDIT_APPROVAL',
    color: 'blue',
    description: 'Pass to the Credit Team for review.',
    secondaryAction: {
      label: 'Bypass Credit Review',
      nextStatus: 'DELIVERY_IN_PROGRESS',
      color: 'slate',
      description: 'Skip credit and PO review and go straight to delivery.',
    }
  },
  PENDING_CREDIT_APPROVAL: {
    label: 'Approve Credit',
    nextStatus: 'CREDIT_APPROVED',
    color: 'emerald',
    description: 'Final financial clearance.',
  },
  CREDIT_APPROVED: {
    label: 'Start PO Preparation',
    nextStatus: 'PO_PREPARATION',
    color: 'indigo',
    description: 'Begin drafting the Purchase Order.',
  },
  PO_PREPARATION: {
    label: 'Finalize PO',
    nextStatus: 'PO_PREPARED',
    color: 'emerald',
    description: 'Mark PO as ready.',
  },
  PO_PREPARED: {
    label: 'Start Delivery',
    nextStatus: 'DELIVERY_IN_PROGRESS',
    color: 'blue',
    description: 'Begin vehicle registration and handover.',
  },
  DELIVERY_IN_PROGRESS: {
    label: 'Mark Delivered',
    nextStatus: 'DELIVERED',
    color: 'emerald',
    description: 'Confirm handover is complete.',
  },
  DELIVERED: null, // Final state
  REJECTED: null,
  CANCELLED: null,
};

export function getQuotationAction(status: string): QuotationAction | null {
  return QUOTATION_WORKFLOW[status] || null;
}

export function getQuotationStatusStyles(status: string) {
  const map: Record<string, string> = {
    NEW:                     'bg-slate-500/10 text-slate-400 border-slate-500/20',
    PENDING_APPROVAL:        'bg-amber-500/10 text-amber-500 border-amber-500/20',
    DRAFT_APPROVED:          'bg-blue-500/10 text-blue-500 border-blue-500/20',
    SENT_TO_CUSTOMER:        'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
    CUSTOMER_APPROVED:       'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    PENDING_CREDIT_APPROVAL: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    CREDIT_APPROVED:         'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    PO_PREPARATION:          'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
    PO_PREPARED:             'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    DELIVERY_IN_PROGRESS:    'bg-blue-500/10 text-blue-500 border-blue-500/20',
    DELIVERED:               'bg-emerald-500 text-white border-emerald-500',
    REJECTED:                'bg-rose-500/10 text-rose-500 border-rose-500/20',
    CANCELLED:               'bg-slate-700/50 text-slate-400 border-white/10',
  };
  return map[status] || 'bg-slate-700/50 text-slate-400 border-white/10';
}
